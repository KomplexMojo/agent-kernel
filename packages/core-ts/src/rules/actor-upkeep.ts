import type { ActorRecord, ActorAffinityEntry } from '../state/actor-types.ts';
import { affinityKey, equippedActorAffinities, exhaustedActorAffinityKeys, setExhaustedActorAffinityKeys } from '../state/actor-inventory.ts';

/**
 * Every affinity has a mana cost (maintainer, 2026-10-11). Push and pull pay per
 * cast; emit and draw are lasting, so they pay an upkeep every turn, charged
 * before regeneration. The amount is Configurator tuning handed in as a table
 * indexed by stacks (the last entry covers anything higher); core invents none.
 */
export function isLastingAffinityExpression(expression: string): boolean {
  return expression === 'emit' || expression === 'draw';
}

export function affinityUpkeepForStacks(upkeepByStacks: readonly number[], stacks: number): number {
  if (upkeepByStacks.length < 2 || stacks <= 0) return 0;
  const cost = upkeepByStacks[Math.min(stacks, upkeepByStacks.length - 1)];
  return Number.isSafeInteger(cost) && cost > 0 ? cost : 0;
}

/** The equipped lasting affinities that are switched on, in equip order. */
export function litActorAffinities(actor: ActorRecord): ActorAffinityEntry[] {
  if (!actor.capabilities.canCast) return [];
  const off = exhaustedActorAffinityKeys(actor);
  return equippedActorAffinities(actor)
    .filter(pair => isLastingAffinityExpression(pair.expression) && !off.includes(affinityKey(pair)));
}

/** True when any equipped lasting affinity is switched on. */
export function isActorAffinityLit(actor: ActorRecord): boolean {
  return litActorAffinities(actor).length > 0;
}

/**
 * Each lit slot pays its own upkeep from the one mana pool, in equip order. A
 * slot that cannot pay (including on an actor with no mana pool) goes off on its
 * own and pays nothing while it waits; the others keep paying.
 */
export function chargeActorAffinityUpkeep(actor: ActorRecord, upkeepByStacks: readonly number[]): void {
  const off = exhaustedActorAffinityKeys(actor);
  let changed = false;
  for (const pair of litActorAffinities(actor)) {
    const cost = affinityUpkeepForStacks(upkeepByStacks, pair.stacks);
    if (cost <= 0) continue;
    const mana = actor.vitals.mana;
    if (mana && mana.current >= cost) mana.current -= cost;
    else { off.push(affinityKey(pair)); changed = true; }
  }
  if (changed) setExhaustedActorAffinityKeys(actor, off);
}

/** After regeneration: every exhausted slot comes back on once mana is full again. */
export function recoverActorAffinity(actor: ActorRecord): void {
  if (actor.affinityExhausted !== true || actor.lifecycle !== 'alive') return;
  const mana = actor.vitals.mana;
  if (mana && mana.max > 0 && mana.current >= mana.max) setExhaustedActorAffinityKeys(actor, []);
}

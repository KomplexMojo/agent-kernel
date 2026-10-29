import type { ActorRecord, ActorAffinityEntry } from '../state/actor-types.ts';
import { affinityIntensity, affinityKey, equippedActorAffinities, exhaustedActorAffinityKeys, setExhaustedActorAffinityKeys } from '../state/actor-inventory.ts';

/**
 * Every affinity has a mana cost (maintainer, 2026-10-11). Push and pull pay per
 * cast; emit and draw are lasting, so they pay an upkeep every turn, charged
 * before regeneration. The amount is Configurator tuning handed in as a table
 * (the last entry covers anything higher); core invents none. A slot reads the
 * table at its range plus its intensity squared (Darren, 2026-10-29: mana follows
 * the effect, which is base × intensity²), so with the `2 + n` table the upkeep is
 * `2 + range + intensity²` mana a turn.
 */
export function isLastingAffinityExpression(expression: string): boolean {
  return expression === 'emit' || expression === 'draw';
}

/** Where a slot reads the upkeep table: its range plus its intensity squared. */
export function affinityUpkeepIndex(range: number, intensity: number): number {
  return range + intensity * intensity;
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
    const cost = affinityUpkeepForStacks(upkeepByStacks, affinityUpkeepIndex(pair.stacks, affinityIntensity(pair)));
    if (cost <= 0) continue;
    const mana = actor.vitals.mana;
    if (mana && mana.current >= cost) mana.current -= cost;
    else { off.push(affinityKey(pair)); changed = true; }
  }
  if (changed) setExhaustedActorAffinityKeys(actor, off);
}

/**
 * The equipped lasting affinities whose upkeep is above max mana, with that upkeep (#441, #454):
 * full mana never pays them, so once off they stay off.
 */
export function unpayableActorAffinities(actor: ActorRecord, upkeepByStacks: readonly number[] = []): { key: string; upkeep: number }[] {
  const max = actor.vitals.mana?.max ?? 0;
  return equippedActorAffinities(actor)
    .filter(pair => isLastingAffinityExpression(pair.expression))
    .map(pair => ({ key: affinityKey(pair), upkeep: affinityUpkeepForStacks(upkeepByStacks, affinityUpkeepIndex(pair.stacks, affinityIntensity(pair))) }))
    .filter(entry => entry.upkeep > max);
}

/**
 * After regeneration: an exhausted slot comes back on once mana is full again, and
 * only if full mana can pay its upkeep (#441); one that costs more than max mana
 * would otherwise be back on before every field resolve and never pay.
 */
export function recoverActorAffinity(actor: ActorRecord, upkeepByStacks: readonly number[] = []): void {
  if (actor.affinityExhausted !== true || actor.lifecycle !== 'alive') return;
  const mana = actor.vitals.mana;
  if (!mana || mana.max <= 0 || mana.current < mana.max) return;
  const unpayable = unpayableActorAffinities(actor, upkeepByStacks).map(entry => entry.key);
  setExhaustedActorAffinityKeys(actor, exhaustedActorAffinityKeys(actor).filter(key => unpayable.includes(key)));
}

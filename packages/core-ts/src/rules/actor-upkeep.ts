import type { ActorRecord } from '../state/actor-types.ts';
import { activeActorAffinity } from '../state/actor-inventory.ts';

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

/** True when the actor's active pair is a lasting affinity that is switched on. */
export function isActorAffinityLit(actor: ActorRecord): boolean {
  const pair = activeActorAffinity(actor);
  return !!pair && actor.capabilities.canCast && isLastingAffinityExpression(pair.expression)
    && actor.affinityExhausted !== true;
}

/**
 * Pay the active lasting affinity's upkeep from the one mana pool. A source that
 * cannot pay (including one with no mana pool) is exhausted and pays nothing
 * while it waits.
 */
export function chargeActorAffinityUpkeep(actor: ActorRecord, upkeepByStacks: readonly number[]): void {
  if (!isActorAffinityLit(actor)) return;
  const cost = affinityUpkeepForStacks(upkeepByStacks, activeActorAffinity(actor)!.stacks);
  if (cost <= 0) return;
  const mana = actor.vitals.mana;
  if (mana && mana.current >= cost) mana.current -= cost;
  else actor.affinityExhausted = true;
}

/** After regeneration: an exhausted source whose mana is full again switches back on. */
export function recoverActorAffinity(actor: ActorRecord): void {
  if (actor.affinityExhausted !== true || actor.lifecycle !== 'alive') return;
  const mana = actor.vitals.mana;
  if (mana && mana.max > 0 && mana.current >= mana.max) delete actor.affinityExhausted;
}

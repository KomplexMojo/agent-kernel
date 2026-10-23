// #227 — the old core world's move rules (createMoveRules: identity, geometry,
// hazard damage and resource capture on entry) were removed with the actor state
// they mutated. Actor moves now resolve in `rules/actor-turn.ts`, which shares
// this one cost rule.

/** Shared existing cardinal/diagonal cost rule, independent of actor storage. */
export function computeMovementStaminaCost(diagonal: boolean, cardinalCost: number): number {
  if (!diagonal || cardinalCost <= 0) return cardinalCost;
  const extra = cardinalCost > 1 ? Math.max(1, Math.trunc(cardinalCost / 2)) : 1;
  return cardinalCost + extra;
}

/**
 * Sprint (#437): two steps in one turn cost this many halves of the two steps' price, so a
 * straight cardinal sprint costs three steps, more than regen returns on a turn.
 */
export const SPRINT_STAMINA_FACTOR = 3;

/** A sprint's stamina: SPRINT_STAMINA_FACTOR/2 of its two steps' cost, rounded up. */
export function computeSprintStaminaCost(firstDiagonal: boolean, secondDiagonal: boolean, cardinalCost: number): number {
  const steps = computeMovementStaminaCost(firstDiagonal, cardinalCost) + computeMovementStaminaCost(secondDiagonal, cardinalCost);
  return Math.ceil((SPRINT_STAMINA_FACTOR * steps) / 2);
}

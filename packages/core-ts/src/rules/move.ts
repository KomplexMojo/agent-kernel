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

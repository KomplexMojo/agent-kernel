/**
 * core-ts affinity damage rules — M3 of feat/affinity-vital-matrix
 *
 * Pure deterministic primitive that routes (affinity, expression, stacks)
 * through the M2 matrix to the correct vital(s) on a target actor.
 *
 * No IO, no clock, no runtime imports. Pattern mirrors rules/combat.ts.
 *
 * Contract:
 *   applyAffinityDamage(attackerIndex, targetIndex, affinityKind, expression, stacks) -> 0 | 1
 *     0 = rejected (invalid args, out-of-range push/pull, self-target)
 *     1 = accepted (effect applied to target's matrix-routed vital, clamped to [0, max])
 *
 * Range semantics:
 *   - Push / Pull: single-target, Chebyshev distance must be <= stacks
 *     (e.g. fire+4+push reaches up to 4 tiles away).
 *   - Emit / Draw: continuous diffuse area effects. No range constraint at this
 *     per-target primitive level — the caller iterates the area and calls
 *     applyAffinityDamage once per affected target.
 *
 * Effect routing:
 *   For each vital index 0..3, look up the matrix cell. Cells with effect == 0
 *   are skipped (no-op for non-primary vitals). The loop generalizes for
 *   future cross-vital matrix extensions without changing the call surface.
 */
import {
  AffinityExpression,
  getAffinityVitalEffect,
  isValidAffinityExpression,
  isValidAffinityKind,
} from "../state/affinity.ts";

const VITAL_COUNT = 4;

type WorldLike = {
  getMotivatedActorCount(): number;
  getMotivatedActorXByIndex(index: number): number;
  getMotivatedActorYByIndex(index: number): number;
  getMotivatedActorVitalCurrentByIndex(index: number, vital: number): number;
  getMotivatedActorVitalMaxByIndex(index: number, vital: number): number;
  getMotivatedActorVitalRegenByIndex(index: number, vital: number): number;
  setMotivatedActorVital(
    index: number,
    vital: number,
    current: number,
    max: number,
    regen: number,
  ): void;
};

export function createAffinityDamageRules(world: WorldLike) {
  /**
   * Apply a matrix-routed affinity effect from attacker to target.
   *
   * @param attackerIndex  Motivated-actor index of the source actor
   * @param targetIndex    Motivated-actor index of the target actor
   * @param affinityKind   AffinityKind code (1..10)
   * @param expression     AffinityExpression code (1..4: push, pull, emit, draw)
   * @param stacks         Positive integer; doubles as projectile range for push/pull
   * @returns 0 on rejection, 1 on acceptance
   */
  function applyAffinityDamage(
    attackerIndex: number,
    targetIndex: number,
    affinityKind: number,
    expression: number,
    stacks: number,
  ): number {
    // --- Guard: actor indices and self-target ---
    const actorCount = world.getMotivatedActorCount();
    if (
      attackerIndex < 0 ||
      attackerIndex >= actorCount ||
      targetIndex < 0 ||
      targetIndex >= actorCount ||
      attackerIndex === targetIndex
    ) {
      return 0;
    }

    // --- Guard: affinity + expression validity ---
    if (!isValidAffinityKind(affinityKind)) return 0;
    if (!isValidAffinityExpression(expression)) return 0;

    // --- Guard: positive integer stacks ---
    if (!Number.isInteger(stacks) || stacks <= 0) return 0;

    // --- Range check: push/pull require Chebyshev distance <= stacks ---
    if (
      expression === AffinityExpression.Push ||
      expression === AffinityExpression.Pull
    ) {
      const ax = world.getMotivatedActorXByIndex(attackerIndex);
      const ay = world.getMotivatedActorYByIndex(attackerIndex);
      const tx = world.getMotivatedActorXByIndex(targetIndex);
      const ty = world.getMotivatedActorYByIndex(targetIndex);
      const chebyshev = Math.max(Math.abs(ax - tx), Math.abs(ay - ty));
      if (chebyshev > stacks) return 0;
    }

    // --- Apply matrix-routed effects to every non-zero vital ---
    // Loop generalizes for future cross-vital matrices; today each affinity
    // has only its primary vital non-zero, so only one apply happens.
    for (let vital = 0; vital < VITAL_COUNT; vital += 1) {
      const effect = getAffinityVitalEffect(
        affinityKind,
        expression,
        vital,
        stacks,
      );
      if (effect === 0) continue;

      const current = world.getMotivatedActorVitalCurrentByIndex(
        targetIndex,
        vital,
      );
      const max = world.getMotivatedActorVitalMaxByIndex(targetIndex, vital);
      const regen = world.getMotivatedActorVitalRegenByIndex(
        targetIndex,
        vital,
      );
      // Clamp to [0, max]: drain stops at 0, buff stops at max.
      const next = Math.max(0, Math.min(max, current + effect));
      world.setMotivatedActorVital(targetIndex, vital, next, max, regen);
    }

    return 1;
  }

  return { applyAffinityDamage };
}

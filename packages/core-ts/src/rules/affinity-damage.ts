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
import { VitalKind } from "../state/vitals.ts";

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
  // M3b: actor affinity state for neutralization detection
  getMotivatedActorAffinityKindByIndex(index: number): number;
  getMotivatedActorAffinityExpressionByIndex(index: number): number;
  clearMotivatedActorAffinity(index: number): number;
  // M3b: static hazard access for hazard pulls
  getStaticHazardAffinityAt(x: number, y: number): number;
  getStaticHazardExpressionAt(x: number, y: number): number;
  getStaticHazardManaReserveAt(x: number, y: number): number;
  setStaticHazardManaCurrentAt(x: number, y: number, current: number): number;
  disarmStaticHazardAt(x: number, y: number): number;
  // M3c: hazard durability
  getStaticHazardDurabilityAt(x: number, y: number): number;
  getStaticHazardDurabilityMaxAt(x: number, y: number): number;
  setStaticHazardDurabilityCurrentAt(x: number, y: number, current: number): number;
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

    // --- M3b: neutralization branch (Pull + matching active affinity on target) ---
    if (expression === AffinityExpression.Pull) {
      const targetKind = world.getMotivatedActorAffinityKindByIndex(targetIndex);
      const targetExpr = world.getMotivatedActorAffinityExpressionByIndex(targetIndex);
      const isNeutralizable =
        targetKind === affinityKind &&
        (targetExpr === AffinityExpression.Emit || targetExpr === AffinityExpression.Push);
      if (isNeutralizable) {
        return applyNeutralizationTransfer(attackerIndex, targetIndex);
      }
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

  /**
   * Drain the source actor's mana to 0, transfer as much as fits to the
   * attacker, and clear the source's active affinity expression.
   * Returns 1 (always accepted when called).
   */
  function applyNeutralizationTransfer(
    attackerIndex: number,
    sourceIndex: number,
  ): number {
    const sourceMana    = world.getMotivatedActorVitalCurrentByIndex(sourceIndex,   VitalKind.Mana);
    const sourceMax     = world.getMotivatedActorVitalMaxByIndex(sourceIndex,       VitalKind.Mana);
    const sourceRegen   = world.getMotivatedActorVitalRegenByIndex(sourceIndex,     VitalKind.Mana);
    const attackerMana  = world.getMotivatedActorVitalCurrentByIndex(attackerIndex, VitalKind.Mana);
    const attackerMax   = world.getMotivatedActorVitalMaxByIndex(attackerIndex,     VitalKind.Mana);
    const attackerRegen = world.getMotivatedActorVitalRegenByIndex(attackerIndex,   VitalKind.Mana);

    const capacity = attackerMax - attackerMana;
    const transfer = Math.min(sourceMana, capacity);

    world.setMotivatedActorVital(sourceIndex,   VitalKind.Mana, 0,                      sourceMax,   sourceRegen);
    world.setMotivatedActorVital(attackerIndex, VitalKind.Mana, attackerMana + transfer, attackerMax, attackerRegen);
    // Clear the source's active affinity expression (sentinel = 0)
    world.clearMotivatedActorAffinity(sourceIndex);
    return 1;
  }

  /**
   * Pull from a static hazard at (hazardX, hazardY).
   *
   * Accepted when:
   *   - attackerIndex is valid
   *   - affinityKind is valid and matches the hazard's kind
   *   - stacks > 0
   *   - A hazard exists at (hazardX, hazardY) with expression Emit or Push
   *
   * On acceptance: hazard is disarmed and its mana is transferred to the attacker
   * (clamped to attacker's remaining mana capacity). Returns 1.
   * Returns 0 on any rejection.
   */
  function applyAffinityPullFromHazard(
    attackerIndex: number,
    hazardX: number,
    hazardY: number,
    affinityKind: number,
    stacks: number,
  ): number {
    const actorCount = world.getMotivatedActorCount();
    if (attackerIndex < 0 || attackerIndex >= actorCount) return 0;
    if (!isValidAffinityKind(affinityKind)) return 0;
    if (!Number.isInteger(stacks) || stacks <= 0) return 0;

    const hazardKind = world.getStaticHazardAffinityAt(hazardX, hazardY);
    if (hazardKind !== affinityKind) return 0;

    const hazardExpr = world.getStaticHazardExpressionAt(hazardX, hazardY);
    if (
      hazardExpr !== AffinityExpression.Emit &&
      hazardExpr !== AffinityExpression.Push
    ) return 0;

    const hazardMana = world.getStaticHazardManaReserveAt(hazardX, hazardY);
    if (hazardMana <= 0) return 0; // nothing to neutralize

    // Drain mana to 0 but keep the hazard structure so it can regen (M3d)
    world.setStaticHazardManaCurrentAt(hazardX, hazardY, 0);

    const attackerMana  = world.getMotivatedActorVitalCurrentByIndex(attackerIndex, VitalKind.Mana);
    const attackerMax   = world.getMotivatedActorVitalMaxByIndex(attackerIndex,     VitalKind.Mana);
    const attackerRegen = world.getMotivatedActorVitalRegenByIndex(attackerIndex,   VitalKind.Mana);

    const capacity = attackerMax - attackerMana;
    const transfer = Math.min(hazardMana, capacity);
    world.setMotivatedActorVital(attackerIndex, VitalKind.Mana, attackerMana + transfer, attackerMax, attackerRegen);
    return 1;
  }

  /**
   * Apply a matrix-routed affinity effect to a static hazard's durability vital.
   *
   * Only affinities whose primary vital is VitalKind.Durability (Earth, Corrode,
   * Fortify) are routed; all others return 0 — hazards have no Health/Mana/Stamina.
   *
   * Hazards armed with durabilityMax == 0 are immortal; damage is rejected (0).
   *
   * When durability reaches 0 the hazard is destroyed via disarmStaticHazardAt.
   *
   * @returns 0 on rejection, 1 on acceptance
   */
  function applyAffinityDamageToHazard(
    attackerIndex: number,
    hazardX: number,
    hazardY: number,
    affinityKind: number,
    expression: number,
    stacks: number,
  ): number {
    const actorCount = world.getMotivatedActorCount();
    if (attackerIndex < 0 || attackerIndex >= actorCount) return 0;
    if (!isValidAffinityKind(affinityKind)) return 0;
    if (!isValidAffinityExpression(expression)) return 0;
    if (!Number.isInteger(stacks) || stacks <= 0) return 0;

    // Reject if no hazard at target cell
    if (world.getStaticHazardAffinityAt(hazardX, hazardY) === 0) return 0;

    // Only durability-routing affinities affect hazards
    const effect = getAffinityVitalEffect(affinityKind, expression, VitalKind.Durability, stacks);
    if (effect === 0) return 0;

    // Immortal hazard guard
    const durMax = world.getStaticHazardDurabilityMaxAt(hazardX, hazardY);
    if (durMax === 0) return 0;

    // Range check for Push/Pull
    if (expression === AffinityExpression.Push || expression === AffinityExpression.Pull) {
      const ax = world.getMotivatedActorXByIndex(attackerIndex);
      const ay = world.getMotivatedActorYByIndex(attackerIndex);
      const chebyshev = Math.max(Math.abs(ax - hazardX), Math.abs(ay - hazardY));
      if (chebyshev > stacks) return 0;
    }

    const current = world.getStaticHazardDurabilityAt(hazardX, hazardY);
    const next = Math.max(0, Math.min(durMax, current + effect));
    if (next === 0) {
      world.disarmStaticHazardAt(hazardX, hazardY);
    } else {
      world.setStaticHazardDurabilityCurrentAt(hazardX, hazardY, next);
    }
    return 1;
  }

  return { applyAffinityDamage, applyAffinityPullFromHazard, applyAffinityDamageToHazard };
}

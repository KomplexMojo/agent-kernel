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
  // M3b: static trap access for hazard pulls
  getStaticTrapAffinityAt(x: number, y: number): number;
  getStaticTrapExpressionAt(x: number, y: number): number;
  getStaticTrapManaReserveAt(x: number, y: number): number;
  setStaticTrapManaCurrentAt(x: number, y: number, current: number): number;
  disarmStaticTrapAt(x: number, y: number): number;
  // M3c: hazard durability
  getStaticTrapDurabilityAt(x: number, y: number): number;
  getStaticTrapDurabilityMaxAt(x: number, y: number): number;
  setStaticTrapDurabilityCurrentAt(x: number, y: number, current: number): number;
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
   * Pull from a static trap hazard at (hazardX, hazardY).
   *
   * Accepted when:
   *   - attackerIndex is valid
   *   - affinityKind is valid and matches the trap's kind
   *   - stacks > 0
   *   - A trap exists at (hazardX, hazardY) with expression Emit or Push
   *
   * On acceptance: trap is disarmed and its mana is transferred to the attacker
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

    const trapKind = world.getStaticTrapAffinityAt(hazardX, hazardY);
    if (trapKind !== affinityKind) return 0;

    const trapExpr = world.getStaticTrapExpressionAt(hazardX, hazardY);
    if (
      trapExpr !== AffinityExpression.Emit &&
      trapExpr !== AffinityExpression.Push
    ) return 0;

    const trapMana = world.getStaticTrapManaReserveAt(hazardX, hazardY);
    if (trapMana <= 0) return 0; // nothing to neutralize

    // Drain mana to 0 but keep the trap structure so it can regen (M3d)
    world.setStaticTrapManaCurrentAt(hazardX, hazardY, 0);

    const attackerMana  = world.getMotivatedActorVitalCurrentByIndex(attackerIndex, VitalKind.Mana);
    const attackerMax   = world.getMotivatedActorVitalMaxByIndex(attackerIndex,     VitalKind.Mana);
    const attackerRegen = world.getMotivatedActorVitalRegenByIndex(attackerIndex,   VitalKind.Mana);

    const capacity = attackerMax - attackerMana;
    const transfer = Math.min(trapMana, capacity);
    world.setMotivatedActorVital(attackerIndex, VitalKind.Mana, attackerMana + transfer, attackerMax, attackerRegen);
    return 1;
  }

  /**
   * Apply a matrix-routed affinity effect to a static trap's durability vital.
   *
   * Only affinities whose primary vital is VitalKind.Durability (Earth, Corrode,
   * Fortify) are routed; all others return 0 — hazards have no Health/Mana/Stamina.
   *
   * Traps armed with durabilityMax == 0 are immortal; damage is rejected (0).
   *
   * When durability reaches 0 the trap is destroyed via disarmStaticTrapAt.
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

    // Reject if no trap at target cell
    if (world.getStaticTrapAffinityAt(hazardX, hazardY) === 0) return 0;

    // Only durability-routing affinities affect hazards
    const effect = getAffinityVitalEffect(affinityKind, expression, VitalKind.Durability, stacks);
    if (effect === 0) return 0;

    // Immortal trap guard
    const durMax = world.getStaticTrapDurabilityMaxAt(hazardX, hazardY);
    if (durMax === 0) return 0;

    // Range check for Push/Pull
    if (expression === AffinityExpression.Push || expression === AffinityExpression.Pull) {
      const ax = world.getMotivatedActorXByIndex(attackerIndex);
      const ay = world.getMotivatedActorYByIndex(attackerIndex);
      const chebyshev = Math.max(Math.abs(ax - hazardX), Math.abs(ay - hazardY));
      if (chebyshev > stacks) return 0;
    }

    const current = world.getStaticTrapDurabilityAt(hazardX, hazardY);
    const next = Math.max(0, Math.min(durMax, current + effect));
    if (next === 0) {
      world.disarmStaticTrapAt(hazardX, hazardY);
    } else {
      world.setStaticTrapDurabilityCurrentAt(hazardX, hazardY, next);
    }
    return 1;
  }

  return { applyAffinityDamage, applyAffinityPullFromHazard, applyAffinityDamageToHazard };
}

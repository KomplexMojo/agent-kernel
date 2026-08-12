/**
 * core-ts combat rules — M3
 *
 * Pure, deterministic combat primitive.
 * No IO, no clock, no runtime imports.
 *
 * `createCombatRules(world)` returns `applyAttack(attackerIndex, defenderIndex, damage) -> number`
 *   returns 0   if rejected (invalid args, not adjacent, zero/negative damage, self-attack)
 *   returns 1   if accepted (defender HP reduced and clamped to 0)
 */
import { ValidationError } from "../validate/inputs.ts";

const HEALTH_VITAL_KIND = 0; // VitalKind.Health

type WorldLike = {
  getMotivatedActorCount(): number;
  getMotivatedActorXByIndex(index: number): number;
  getMotivatedActorYByIndex(index: number): number;
  getMotivatedActorVitalCurrentByIndex(index: number, kind: number): number;
  getMotivatedActorVitalMaxByIndex(index: number, kind: number): number;
  getMotivatedActorVitalRegenByIndex(index: number, kind: number): number;
  setMotivatedActorVital(
    index: number,
    kind: number,
    current: number,
    max: number,
    regen: number,
  ): void;
};

export function createCombatRules(world: WorldLike) {
  /**
   * Apply a deterministic adjacent attack.
   *
   * @param attackerIndex  Motivated-actor index of the attacker
   * @param defenderIndex  Motivated-actor index of the defender
   * @param damage         Positive integer HP to remove from the defender
   * @returns 0 on rejection, 1 on success
   */
  function applyAttack(
    attackerIndex: number,
    defenderIndex: number,
    damage: number,
  ): number {
    const actorCount = world.getMotivatedActorCount();

    // --- Guard: valid indices and self-attack ---
    if (
      attackerIndex < 0 ||
      attackerIndex >= actorCount ||
      defenderIndex < 0 ||
      defenderIndex >= actorCount ||
      attackerIndex === defenderIndex
    ) {
      return ValidationError.None; // 0 = rejected
    }

    // --- Guard: positive damage ---
    if (!Number.isInteger(damage) || damage <= 0) {
      return ValidationError.None;
    }

    // --- Guard: adjacency (Chebyshev distance ≤ 1, not same cell) ---
    const ax = world.getMotivatedActorXByIndex(attackerIndex);
    const ay = world.getMotivatedActorYByIndex(attackerIndex);
    const dx = world.getMotivatedActorXByIndex(defenderIndex);
    const dy = world.getMotivatedActorYByIndex(defenderIndex);

    const chebyshev = Math.max(Math.abs(ax - dx), Math.abs(ay - dy));
    if (chebyshev !== 1) {
      return ValidationError.None; // 0 = rejected (not adjacent or same cell)
    }

    // --- Apply damage, clamp to 0 ---
    const currentHp = world.getMotivatedActorVitalCurrentByIndex(
      defenderIndex,
      HEALTH_VITAL_KIND,
    );
    const maxHp = world.getMotivatedActorVitalMaxByIndex(
      defenderIndex,
      HEALTH_VITAL_KIND,
    );
    const regenHp = world.getMotivatedActorVitalRegenByIndex(
      defenderIndex,
      HEALTH_VITAL_KIND,
    );
    const newHp = Math.max(0, currentHp - damage);

    world.setMotivatedActorVital(
      defenderIndex,
      HEALTH_VITAL_KIND,
      newHp,
      maxHp,
      regenHp,
    );

    return 1; // accepted
  }

  return { applyAttack };
}

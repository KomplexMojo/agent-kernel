/**
 * Bounded actor logical validity owned by the Configurator.
 *
 * These rules evaluate authored values; they do not choose or repair them. The
 * bounded pair/count/threshold checks stay synchronous and solver-free. Shape
 * normalization remains with the artifact-specific callers that already own it.
 */
import {
  AFFINITY_KINDS,
  DEFAULT_VITALS,
  MOTIVATION_KINDS,
  VITAL_KEYS,
  getMotivationExclusiveGroup,
  normalizeMotivationKind,
} from "../../contracts/domain-constants.js";
import { getMotivationMobilityTier } from "../../../../core-ts/src/index.ts";
import { validateAffinityPrereqs } from "./cost-model.js";

const DEFAULT_MOVEMENT_COST = 1;

export const CONFIGURED_AFFINITY_SLOT_LIMIT = AFFINITY_KINDS.length;

function motivationKind(entry, { canonicalInputOnly = false } = {}) {
  const raw = typeof entry === "string" ? entry : entry?.kind;
  if (canonicalInputOnly && typeof raw === "string") {
    const canonical = raw.trim().toLowerCase();
    return MOTIVATION_KINDS.includes(canonical) ? canonical : null;
  }
  return normalizeMotivationKind(raw);
}

export function findMotivationConflict(
  selectedKinds = [],
  candidateKind = "",
  options = {},
) {
  const rightKind = motivationKind(candidateKind, options);
  const rightGroup = rightKind ? getMotivationExclusiveGroup(rightKind) : null;
  if (!rightGroup) return null;

  for (const entry of selectedKinds) {
    const leftKind = motivationKind(entry, options);
    const leftGroup = leftKind ? getMotivationExclusiveGroup(leftKind) : null;
    if (leftGroup?.id === rightGroup.id && leftKind !== rightKind) {
      return { leftKind, rightKind };
    }
  }
  return null;
}

export function collectMotivationConflicts(kinds = [], options = {}) {
  if (!Array.isArray(kinds)) return [];
  const conflicts = [];
  for (let rightIndex = 1; rightIndex < kinds.length; rightIndex += 1) {
    const rightRaw = typeof kinds[rightIndex] === "string"
      ? kinds[rightIndex].trim()
      : kinds[rightIndex]?.kind;
    for (let leftIndex = 0; leftIndex < rightIndex; leftIndex += 1) {
      const conflict = findMotivationConflict([kinds[leftIndex]], kinds[rightIndex], options);
      if (!conflict) continue;
      const leftRaw = typeof kinds[leftIndex] === "string"
        ? kinds[leftIndex].trim()
        : kinds[leftIndex]?.kind;
      conflicts.push({
        leftIndex,
        rightIndex,
        leftKind: leftRaw || conflict.leftKind,
        rightKind: rightRaw || conflict.rightKind,
      });
    }
  }
  return conflicts;
}

function motivationMoves(entry) {
  const kind = motivationKind(entry);
  const index = MOTIVATION_KINDS.indexOf(kind);
  return index >= 0 && getMotivationMobilityTier(index + 1) > 0;
}

export function requiresMovementStamina(card = null) {
  const motivations = Array.isArray(card?.motivations) ? card.motivations : [];
  return motivations.some((motivation) => motivationMoves(motivation));
}

export function resolveWorstCaseMoveCost(movementCost = DEFAULT_MOVEMENT_COST) {
  const cardinal = Number.isInteger(movementCost) && movementCost > 0
    ? movementCost
    : DEFAULT_MOVEMENT_COST;
  const diagonalExtra = cardinal > 1 ? Math.max(1, Math.trunc(cardinal / 2)) : 1;
  return cardinal + diagonalExtra;
}

function requirementValues(vitals, field) {
  return VITAL_KEYS.reduce((acc, key) => {
    const source = vitals?.[key] && typeof vitals[key] === "object"
      ? vitals[key]
      : DEFAULT_VITALS[key];
    acc[key] = Number.isInteger(source?.[field]) ? source[field] : 0;
    return acc;
  }, {});
}

export function assessConfiguredAffinitySlots({ affinities, path = "affinities", actorId } = {}) {
  if (!Array.isArray(affinities) || affinities.length <= CONFIGURED_AFFINITY_SLOT_LIMIT) return [];
  return [{
    code: "affinity_slot_limit_exceeded",
    path,
    message: `${path} has ${affinities.length} configured affinity slots; maximum is `
      + `${CONFIGURED_AFFINITY_SLOT_LIMIT}.`,
    ...(actorId ? { actorId } : {}),
  }];
}

export function assessAffinityStackTier({ affinity, preset, path = "affinity.stacks", actorId } = {}) {
  const stacks = affinity?.stacks;
  const maximum = preset?.stack?.max;
  if (!Number.isInteger(stacks) || !Number.isInteger(maximum) || stacks <= maximum) return [];
  return [{
    code: "stacks_exceed_max",
    path,
    message: `${path} is ${stacks}; preset maximum is ${maximum}.`,
    ...(actorId ? { actorId } : {}),
  }];
}

export function assessActorLogicalValidity({ card, path = "actor" } = {}) {
  const issues = [];
  const motivations = Array.isArray(card?.motivations) ? card.motivations : [];
  collectMotivationConflicts(motivations).forEach((conflict) => {
    issues.push({
      code: "conflicting_kind",
      path: `${path}.motivations[${conflict.rightIndex}]`,
      message: `${path} motivations "${conflict.leftKind}" and "${conflict.rightKind}" are mutually exclusive.`,
    });
  });

  const affinities = Array.isArray(card?.affinities) ? card.affinities : [];
  const vitals = card?.vitals;
  const prereqResult = validateAffinityPrereqs({
    vitals: requirementValues(vitals, "max"),
    regen: requirementValues(vitals, "regen"),
    affinities,
    fieldBase: `${path}.affinities`,
  });
  prereqResult.errors.forEach((error) => {
    if (error.code === "affinity_requires_mana") {
      issues.push({
        code: error.code,
        path: `${path}.vitals.mana.max`,
        message: `${path} affinities require mana.max >= 1.`,
      });
    }
    if (error.code === "affinity_requires_mana_regen") {
      issues.push({
        code: error.code,
        path: `${path}.vitals.mana.regen`,
        message: `${path} affinities require mana.regen >= 1.`,
      });
    }
  });

  if (requiresMovementStamina(card)) {
    const floor = resolveWorstCaseMoveCost(card?.capabilities?.movementCost);
    const staminaMax = requirementValues(vitals, "max").stamina;
    const staminaRegen = requirementValues(vitals, "regen").stamina;
    if (!(staminaMax >= floor)) {
      issues.push({
        code: "movement_requires_stamina_pool",
        path: `${path}.vitals.stamina.max`,
        message: `${path} movement requires stamina.max >= ${floor} (one worst-case move); `
          + "regen alone cannot accumulate past max.",
      });
    }
    if (staminaRegen <= 0) {
      issues.push({
        code: "movement_requires_stamina_regen",
        path: `${path}.vitals.stamina.regen`,
        message: `${path} movement requires stamina.regen >= 1.`,
      });
    }
  }

  issues.push(...assessConfiguredAffinitySlots({
    affinities,
    path: `${path}.affinities`,
  }));
  return issues;
}

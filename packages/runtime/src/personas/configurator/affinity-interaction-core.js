/**
 * core-delegated affinity interaction resolution and pressure computation.
 *
 * Delegates the 48-cell interaction matrix lookup and stack cancellation
 * to the core engine, ensuring runtime matches core-ts exactly.
 */

// ── Reverse code maps (string → core i32 code) ──

export const AFFINITY_KIND_TO_CODE = Object.freeze({
  fire: 1, water: 2, earth: 3, wind: 4, life: 5,
  decay: 6, corrode: 7, fortify: 8, light: 9, dark: 10,
});

export const AFFINITY_EXPRESSION_TO_CODE = Object.freeze({
  push: 1, pull: 2, emit: 3, draw: 4,
});

const AFFINITY_CODE_TO_KIND = Object.freeze({
  1: "fire", 2: "water", 3: "earth", 4: "wind", 5: "life",
  6: "decay", 7: "corrode", 8: "fortify", 9: "light", 10: "dark",
});

const RELATIONSHIP_NAMES = Object.freeze({
  0: "same", 1: "opposite", 2: "neutral",
});

const EFFECT_NAMES = Object.freeze({
  0: "none", 1: "damage", 2: "conditional_damage",
  3: "potency_reduced", 4: "mana_gain", 5: "mana_loss",
  6: "amplified_damage",
});

const VISUAL_STATE_NAMES = Object.freeze({
  1: "clash_neutral", 2: "clash_opposed", 3: "redirect",
  4: "conflict", 5: "disruption", 6: "strike",
  7: "vulnerability", 8: "backlash", 9: "siphon",
  10: "mutual_drain", 11: "absorb", 12: "toxic_exposure",
  13: "tug", 14: "rend", 15: "reinforcement",
  16: "conflict_zone", 17: "susceptible", 18: "resonance",
  19: "corrosion", 20: "layered", 21: "emit_field",
});

// ── Interaction resolution ──

/**
 * Resolve affinity interaction between two sources using the core matrix.
 *
 * @param {object} core - Core object from core-ts.
 * @param {object} source - { kind: string, expression: string, stacks: number }
 * @param {object} target - { kind: string, expression: string, stacks: number }
 * @returns {object|null} Interaction result or null if resolution failed.
 */
export function resolveAffinityInteractionFromCore(core, source, target) {
  if (!core || typeof core.resolveAffinityInteraction !== "function") return null;
  if (!source || !target) return null;

  const srcKind = AFFINITY_KIND_TO_CODE[source.kind];
  const srcExpr = AFFINITY_EXPRESSION_TO_CODE[source.expression];
  const srcStacks = Number.isInteger(source.stacks) && source.stacks > 0 ? source.stacks : 1;

  const tgtKind = AFFINITY_KIND_TO_CODE[target.kind];
  const tgtExpr = AFFINITY_EXPRESSION_TO_CODE[target.expression];
  const tgtStacks = Number.isInteger(target.stacks) && target.stacks > 0 ? target.stacks : 1;

  if (!srcKind || !srcExpr || !tgtKind || !tgtExpr) return null;

  const result = core.resolveAffinityInteraction(
    srcKind, srcExpr, srcStacks,
    tgtKind, tgtExpr, tgtStacks,
  );
  if (result !== 1) return null;

  const sourceEffect = core.getLastInteractionSourceEffect();
  const targetEffect = core.getLastInteractionTargetEffect();
  const visualState = core.getLastInteractionVisualState();
  const relationship = core.getLastInteractionRelationship();

  return {
    sourceEffect,
    sourceEffectName: EFFECT_NAMES[sourceEffect] || "unknown",
    targetEffect,
    targetEffectName: EFFECT_NAMES[targetEffect] || "unknown",
    visualState,
    visualStateName: VISUAL_STATE_NAMES[visualState] || "unknown",
    relationship,
    relationshipName: RELATIONSHIP_NAMES[relationship] || "unknown",
    netSourceStacks: core.getLastInteractionNetSourceStacks(),
    netTargetStacks: core.getLastInteractionNetTargetStacks(),
    canceledStacks: core.getLastInteractionCanceledStacks(),
  };
}

// ── Pressure resolution ──

const AFFINITY_KINDS_ORDERED = [
  "fire", "water", "earth", "wind", "life",
  "decay", "corrode", "fortify", "light", "dark",
];

/**
 * Resolve net affinity pressure using core stack cancellation.
 *
 * Takes a baseByKind map ({ fire: 3, water: 2, ... }) and resolves
 * opposite-pair cancellation via the core engine.
 *
 * @param {object} core - core.
 * @param {object} baseByKind - { [kind]: stackCount }
 * @returns {{ netByKind: object, cancellations: Array }}
 */
export function resolveNetPressureFromCore(core, baseByKind) {
  if (!core || typeof core.resolveAffinityStackCancellation !== "function") {
    return { netByKind: { ...baseByKind }, cancellations: [] };
  }

  const netByKind = {};
  const cancellations = [];
  const visited = new Set();

  for (const kind of AFFINITY_KINDS_ORDERED) {
    if (visited.has(kind)) continue;

    const kindCode = AFFINITY_KIND_TO_CODE[kind];
    const oppositeCode = core.getOppositeAffinityKind(kindCode);
    const opposite = AFFINITY_CODE_TO_KIND[oppositeCode];

    if (!opposite || visited.has(opposite)) {
      netByKind[kind] = baseByKind[kind] || 0;
      visited.add(kind);
      continue;
    }

    const sourceStacks = baseByKind[kind] || 0;
    const oppositeStacks = baseByKind[opposite] || 0;

    if (sourceStacks === 0 && oppositeStacks === 0) {
      netByKind[kind] = 0;
      netByKind[opposite] = 0;
      visited.add(kind);
      visited.add(opposite);
      continue;
    }

    // Use core cancellation (min-based)
    const s = Math.max(1, sourceStacks);
    const t = Math.max(1, oppositeStacks);
    core.resolveAffinityStackCancellation(s, t);
    const canceled = core.getLastAffinityCanceledStacks();

    // Reapply to actual (possibly 0) values
    const actualCanceled = Math.min(sourceStacks, oppositeStacks);
    netByKind[kind] = sourceStacks - actualCanceled;
    netByKind[opposite] = oppositeStacks - actualCanceled;

    if (actualCanceled > 0) {
      cancellations.push({
        kind,
        opposite,
        sourceStacks,
        oppositeStacks,
        canceled: actualCanceled,
      });
    }

    visited.add(kind);
    visited.add(opposite);
  }

  return { netByKind, cancellations };
}

/**
 * Resolve the relationship between two affinity kinds using core-ts.
 *
 * @param {object} core - core.
 * @param {string} sourceKind - Source affinity kind name.
 * @param {string} targetKind - Target affinity kind name.
 * @returns {string} "same", "opposite", "neutral", or "unknown"
 */
export function resolveRelationshipFromCore(core, sourceKind, targetKind) {
  if (!core || typeof core.resolveAffinityRelationshipCode !== "function") return "unknown";
  const srcCode = AFFINITY_KIND_TO_CODE[sourceKind];
  const tgtCode = AFFINITY_KIND_TO_CODE[targetKind];
  if (!srcCode || !tgtCode) return "unknown";
  const code = core.resolveAffinityRelationshipCode(srcCode, tgtCode);
  return RELATIONSHIP_NAMES[code] || "unknown";
}

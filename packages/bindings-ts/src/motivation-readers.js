// Motivation code maps and reader helpers for bindings-ts.
// Thin wrappers only — no recomputation. All values come from WASM.

// ── Code maps: WASM i32 codes → human-readable names ──

export const MOTIVATION_KIND_BY_CODE = Object.freeze({
  1: "random",
  2: "stationary",
  3: "exploring",
  4: "patrolling",
  5: "attacking",
  6: "defending",
  7: "stealthy",
  8: "friendly",
  9: "reflexive",
  10: "goal_oriented",
  11: "strategy_focused",
  12: "user_controlled",
});

export const MOTIVATION_FAMILY_BY_CODE = Object.freeze({
  0: "mobility",
  1: "posture",
  2: "cognition",
  3: "control",
});

export const MOTIVATION_TIER_BY_CODE = Object.freeze({
  0: "simple",
  1: "advanced",
  2: "control",
});

export const MOTIVATION_REASONING_CLASS_BY_CODE = Object.freeze({
  0: "instinctual",
  1: "tactical",
  2: "strategic",
});

export const MOTIVATION_MOBILITY_BY_CODE = Object.freeze({
  0: "stationary",
  1: "exploring",
  2: "patrolling",
});

export const MOTIVATION_COMBAT_BY_CODE = Object.freeze({
  0: "none",
  1: "attacking",
  2: "defending",
});

export const MOTIVATION_COGNITION_BY_CODE = Object.freeze({
  0: "none",
  1: "reflexive",
  2: "goal_oriented",
  3: "strategy_focused",
});

export const MOTIVATION_FLAG_NAMES = Object.freeze({
  1: "canMove",
  2: "prefersStealth",
  4: "prefersCover",
  8: "aggroRangeBoost",
});

// ── Readers: extract structured JS objects from WASM last-result getters ──

/**
 * Read the motivation cost accumulator state from WASM.
 * Call after resetMotivationCostAccumulator + addMotivationCostEntry calls.
 * Returns { total, lines[] } where each line has kind, kindName, family,
 * familyName, quantity, unitCost, spend.
 */
export function readMotivationCost(core) {
  const total = core.getMotivationCostTotal();
  const lineCount = core.getMotivationCostLineCount();
  const lines = [];
  for (let i = 0; i < lineCount; i += 1) {
    const kind = core.getMotivationCostLineKind(i);
    const family = core.getMotivationCostLineFamily(i);
    lines.push({
      kind,
      kindName: MOTIVATION_KIND_BY_CODE[kind] || "unknown",
      family,
      familyName: MOTIVATION_FAMILY_BY_CODE[family] || "unknown",
      quantity: core.getMotivationCostLineQuantity(i),
      unitCost: core.getMotivationCostLineUnitCost(i),
      spend: core.getMotivationCostLineSpend(i),
    });
  }
  return { total, lines };
}

/**
 * Read the motivation evaluation result from WASM.
 * Call after resetMotivationEvaluation + addMotivationEvaluationEntry +
 * evaluateMotivations.
 * Returns { flags, flagNames[], mobility, combat, cognition, reasoningClass,
 * mobilityName, combatName, cognitionName, reasoningClassName }.
 */
export function readMotivationEvaluation(core) {
  const flags = core.getLastMotivationFlags();
  const mobility = core.getLastMotivationMobilityTier();
  const combat = core.getLastMotivationCombatTier();
  const cognition = core.getLastMotivationCognitionTier();
  const reasoningClass = core.getLastMotivationReasoningClass();

  const flagNames = [];
  for (const [bit, name] of Object.entries(MOTIVATION_FLAG_NAMES)) {
    if (flags & Number(bit)) {
      flagNames.push(name);
    }
  }

  return {
    flags,
    flagNames,
    mobility,
    mobilityName: MOTIVATION_MOBILITY_BY_CODE[mobility] || "unknown",
    combat,
    combatName: MOTIVATION_COMBAT_BY_CODE[combat] || "unknown",
    cognition,
    cognitionName: MOTIVATION_COGNITION_BY_CODE[cognition] || "unknown",
    reasoningClass,
    reasoningClassName: MOTIVATION_REASONING_CLASS_BY_CODE[reasoningClass] || "unknown",
  };
}

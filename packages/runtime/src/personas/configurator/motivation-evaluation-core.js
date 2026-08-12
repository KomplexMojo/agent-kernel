/**
 * core-delegated motivation profile evaluation.
 *
 * Delegates behavior profile computation to the core evaluation engine,
 * ensuring runtime and core-ts produce identical behavioral axes and flags.
 *
 * Does NOT replace motivation-rules.js — that module still owns artifact
 * validation and normalization. This module is the evaluation shortcut
 * when a core implementation is available.
 */
import { MOTIVATION_KIND_TO_CODE } from "../allocator/motivation-price-policy.js";
import { MOTIVATION_PATTERNS } from "./motivation-loadouts.js";

// ── Conversion helpers ──

/**
 * Convert flag object → core bitmask.
 * canMove=1, prefersStealth=2, prefersCover=4, aggroRangeBoost=8
 */
function flagsToBitmask(flags) {
  if (!flags || typeof flags !== "object") return 0;
  let mask = 0;
  if (flags.canMove) mask |= 1;
  if (flags.prefersStealth) mask |= 2;
  if (flags.prefersCover) mask |= 4;
  if (flags.aggroRangeBoost) mask |= 8;
  return mask;
}

/**
 * Convert flag bitmask → flag object.
 */
function bitmaskToFlags(mask) {
  return {
    canMove: (mask & 1) !== 0,
    prefersStealth: (mask & 2) !== 0,
    prefersCover: (mask & 4) !== 0,
    aggroRangeBoost: (mask & 8) !== 0,
  };
}

/**
 * Convert pattern name → core pattern code (1-based, 0 = use default).
 */
function resolvePatternCode(kind, pattern) {
  const patterns = MOTIVATION_PATTERNS[kind];
  if (!patterns || !pattern) return 0;
  const index = patterns.indexOf(pattern);
  return index >= 0 ? index + 1 : 0;
}

// ── Evaluation ──

/**
 * Evaluate the behavior profile for a set of motivations using the core engine.
 *
 * Accepts the same normalized motivation entries as produced by
 * normalizeMotivation() / normalizeMotivations().
 *
 * Returns a profile object compatible with the runtime's behavioral model:
 *   { flags, flagValues, mobility, combat, cognition, reasoningClass }
 *
 * @param {object} core - Core object from core-ts.
 * @param {Array<{kind:string, intensity?:number, pattern?:string, flags?:object}|string>} motivations
 * @returns {{
 *   flags: number,
 *   flagValues: {canMove:boolean, prefersStealth:boolean, prefersCover:boolean, aggroRangeBoost:boolean},
 *   mobility: string,
 *   combat: string,
 *   cognition: string,
 *   reasoningClass: string,
 *   mobilityCode: number,
 *   combatCode: number,
 *   cognitionCode: number,
 *   reasoningClassCode: number,
 * } | null}
 */
export function evaluateMotivationProfileFromCore(core, motivations) {
  if (!core || typeof core.resetMotivationEvaluation !== "function") {
    return null;
  }
  if (!Array.isArray(motivations) || motivations.length === 0) {
    // Empty evaluation — return stationary/none/none defaults
    core.resetMotivationEvaluation();
    core.evaluateMotivations();
    return readEvaluationResult(core);
  }

  core.resetMotivationEvaluation();

  for (const entry of motivations) {
    const kind = typeof entry === "string" ? entry : entry?.kind;
    if (typeof kind !== "string") continue;
    const code = MOTIVATION_KIND_TO_CODE[kind];
    if (!code) continue;

    const intensity = typeof entry === "object" && Number.isInteger(entry.intensity) && entry.intensity > 0
      ? entry.intensity
      : 1;

    const pattern = typeof entry === "object" ? resolvePatternCode(kind, entry.pattern) : 0;
    const flagMask = typeof entry === "object" && entry.flags ? flagsToBitmask(entry.flags) : 0;

    core.addMotivationEvaluationEntry(code, intensity, pattern, flagMask);
  }

  core.evaluateMotivations();
  return readEvaluationResult(core);
}

const MOBILITY_NAMES = ["stationary", "exploring", "patrolling"];
const COMBAT_NAMES = ["none", "attacking", "defending"];
const COGNITION_NAMES = ["none", "reflexive", "goal_oriented", "strategy_focused"];
const REASONING_CLASS_NAMES = ["instinctual", "tactical", "strategic"];

function readEvaluationResult(core) {
  const flags = core.getLastMotivationFlags();
  const mobilityCode = core.getLastMotivationMobilityTier();
  const combatCode = core.getLastMotivationCombatTier();
  const cognitionCode = core.getLastMotivationCognitionTier();
  const reasoningClassCode = core.getLastMotivationReasoningClass();

  return {
    flags,
    flagValues: bitmaskToFlags(flags),
    mobility: MOBILITY_NAMES[mobilityCode] || "stationary",
    combat: COMBAT_NAMES[combatCode] || "none",
    cognition: COGNITION_NAMES[cognitionCode] || "none",
    reasoningClass: REASONING_CLASS_NAMES[reasoningClassCode] || "instinctual",
    mobilityCode,
    combatCode,
    cognitionCode,
    reasoningClassCode,
  };
}

export { flagsToBitmask, bitmaskToFlags, resolvePatternCode };

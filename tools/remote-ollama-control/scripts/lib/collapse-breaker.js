'use strict';

/**
 * Collapse breaker — aborts a content-gen run when the evidence says the RIG is broken, not
 * merely that a model is weak.
 *
 * That distinction is the whole design. "This model scores badly" is a legitimate finding and
 * the run exists to record it; aborting on it would destroy the evidence rather than protect
 * it. What must never be allowed to burn a day of GPU time is a broken tool schema, prompt, or
 * endpoint — and that looks different: tool calls stop being produced at all, or scores fall
 * far below anything a working model produces.
 *
 * Floors are evaluated per configuration and only after a minimum sample, because single-pass
 * content-gen variance is wide: the same scenario at the same model and settings has been
 * observed scoring 90 and 20 on consecutive passes.
 */

const DEFAULT_BREAKER = Object.freeze({
  enabled: true,
  // No trip before this many attempts within a configuration. Below this, collapse and ordinary
  // variance are not distinguishable.
  minimumAttempts: 20,
  // A weak model still EMITS tool calls and scores partially. A near-zero tool-call rate is a
  // broken schema, prompt, or endpoint — the highest-signal, lowest-false-positive indicator.
  toolCallFloor: 0.1,
  // Deliberately far below the 75 qualification bar. Models in this matrix score in the 30s-40s
  // against that bar in normal operation, so a floor anywhere near it would abort on ordinary
  // results. This traps collapse, not regression.
  averageScoreFloor: 25,
  // config/models.json designates this the cheap control: "a uniform drop across the whole
  // matrix says harness, not model." It is also ordered first, so tripping here spares the
  // expensive 27-30B dual configurations.
  canaryModel: 'qwen3.5:9b',
});

class CollapseError extends Error {
  constructor(trip) {
    super(trip.message);
    this.name = 'CollapseError';
    this.trip = trip;
  }
}

const rate = (pass, total) => (total > 0 ? pass / total : 0);
const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function assertRatio(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a ratio between 0 and 1`);
  }
}

/**
 * Merge operator overrides onto the defaults, rejecting values that would make the breaker
 * either inert or trigger-happy. Overrides are partial on purpose: naming one floor must not
 * silently reset the others.
 */
function resolveBreaker(overrides = {}) {
  const breaker = { ...DEFAULT_BREAKER, ...overrides };

  assertRatio(breaker.toolCallFloor, 'toolCallFloor');
  if (!Number.isInteger(breaker.minimumAttempts) || breaker.minimumAttempts < 1) {
    throw new Error('minimumAttempts must be a positive integer');
  }
  if (typeof breaker.averageScoreFloor !== 'number'
    || !Number.isFinite(breaker.averageScoreFloor)
    || breaker.averageScoreFloor < 0 || breaker.averageScoreFloor > 100) {
    throw new Error('averageScoreFloor must be a score between 0 and 100');
  }
  if (breaker.canaryModel !== null && typeof breaker.canaryModel !== 'string') {
    throw new Error('canaryModel must be a model id or null');
  }

  return Object.freeze(breaker);
}

/**
 * Decide whether the attempts recorded so far for one configuration constitute collapse.
 * Returns null when they do not — the common case, and the one that must stay cheap.
 */
function evaluateCollapse(records, { breaker = DEFAULT_BREAKER, model = null, configurationId = null } = {}) {
  if (!breaker.enabled) return null;

  const attempts = records.length;
  if (attempts < breaker.minimumAttempts) return null;

  const canary = Boolean(breaker.canaryModel) && model === breaker.canaryModel;
  const toolCallRate = rate(records.filter((record) => record.toolCallProduced === true).length, attempts);
  const averageScore = records.reduce((sum, record) => sum + (record.score || 0), 0) / attempts;

  // Tool-call collapse is checked first: when both floors are breached it names the cause far
  // more precisely than a score can.
  if (toolCallRate < breaker.toolCallFloor) {
    return describe({
      reason: 'tool_call_collapse', metric: 'toolCallRate',
      observed: round(toolCallRate, 4), floor: breaker.toolCallFloor,
      attempts, model, configurationId, canary,
      cause: 'almost no attempt produced a tool call, which points at the tool schema, prompt, or endpoint rather than the model',
    });
  }

  if (averageScore < breaker.averageScoreFloor) {
    return describe({
      reason: 'score_collapse', metric: 'averageScore',
      observed: round(averageScore, 1), floor: breaker.averageScoreFloor,
      attempts, model, configurationId, canary,
      cause: 'scores collapsed far below the range a working configuration produces',
    });
  }

  return null;
}

function describe(trip) {
  const subject = trip.canary
    ? `control model ${trip.model}`
    : `configuration ${trip.configurationId || trip.model || 'unknown'}`;
  const implication = trip.canary
    ? ' Because this is the control model, suspect the harness rather than the model.'
    : '';
  return {
    ...trip,
    message: `Content-gen collapse breaker tripped on ${subject}: `
      + `${trip.metric} ${trip.observed} is below the floor ${trip.floor} over ${trip.attempts} attempts — `
      + `${trip.cause}.${implication}`,
  };
}

module.exports = { CollapseError, DEFAULT_BREAKER, evaluateCollapse, resolveBreaker };

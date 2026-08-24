'use strict';

/**
 * Interim progress for a content-gen run.
 *
 * A full matrix is 6 configurations x 100 scenarios x up to 3 passes and takes days. Until this
 * module existed the only observable states were "started" and "finished" -- so a run that had
 * already become worthless (a configuration mathematically unable to qualify, a rig sliding toward
 * the collapse floors) stayed indistinguishable from a healthy one until it ended.
 *
 * Two design constraints follow from how the runner actually behaves, and both are easy to get
 * wrong:
 *
 *   - Progress is NOT a percentage. Early stop means a configuration can finish holding far fewer
 *     records than scenarios x passes, so recorded attempts cannot predict the remainder. Every
 *     count here is a floor/ceiling pair.
 *   - Quality is per configuration. The collapse breaker and early stop both evaluate one
 *     configuration at a time, so a matrix-wide average hides the failure it most needs to show:
 *     one configuration collapsing while the others carry the mean.
 *
 * This module only reports. Aborting is the breaker's decision and stopping is early stop's; a
 * reporter that also acted would be a second, quieter policy competing with them.
 */

const fs = require('fs');
const path = require('path');

const { DEFAULT_THRESHOLDS, canStillQualify } = require('./ak-compare');
const { DEFAULT_BREAKER } = require('./collapse-breaker');

const SCHEMA_VERSION = 'agent-kernel-benchmark-progress/v1';
const PROGRESS_NAME = 'progress.json';

/**
 * The writer is rename-based because the reader is a different process on a timer: a plain write
 * leaves a window in which the heartbeat publishes a truncated file, and a torn progress report is
 * worse than a stale one -- it looks like data.
 */
function writeProgress(resultDir, progress) {
  const target = path.join(resultDir, PROGRESS_NAME);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(progress, null, 2)}\n`);
  fs.renameSync(temporary, target);
  return target;
}

function readProgress(resultDir) {
  const target = path.join(resultDir, PROGRESS_NAME);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    // A parse failure here means the run is mid-rename or the file was damaged. Reporting "no
    // progress yet" is honest; throwing would take the heartbeat down with it.
    return null;
  }
}

const ratio = (pass, total) => (total > 0 ? pass / total : 0);
const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function quality(records) {
  const attempts = records.length;
  return {
    attempts,
    toolCallRate: round(ratio(records.filter((record) => record.toolCallProduced === true).length, attempts), 4),
    scenarioVerdictRate: round(ratio(records.filter((record) => record.scenarioVerdict?.passed === true).length, attempts), 4),
    executionSuccessRate: round(ratio(records.filter((record) => record.execSucceeded === true).length, attempts), 4),
    averageScore: round(records.reduce((sum, record) => sum + (record.score || 0), 0) / Math.max(1, attempts), 1),
  };
}

/**
 * Headroom to each collapse floor, in the floor's own units. Negative means the breaker would trip
 * on the next evaluation -- worth reporting rather than rounding to zero, because the size of the
 * breach is what separates "drifting" from "the endpoint is gone".
 */
function collapseMargins(records, breaker) {
  const armed = records.length >= breaker.minimumAttempts;
  if (records.length === 0) {
    return { armed: false, attempts: 0, toolCallMargin: null, scoreMargin: null };
  }
  const measured = quality(records);
  return {
    armed,
    attempts: records.length,
    toolCallMargin: round(measured.toolCallRate - breaker.toolCallFloor, 4),
    scoreMargin: round(measured.averageScore - breaker.averageScoreFloor, 1),
  };
}

function summarizeProgress(records, {
  matrix,
  scenarioCount,
  thresholds = DEFAULT_THRESHOLDS,
  breaker = DEFAULT_BREAKER,
  startedAt,
  now = Date.now(),
} = {}) {
  if (!matrix || !Array.isArray(matrix.configurations)) {
    throw new Error('summarizeProgress requires the matrix whose configurations are being reported');
  }
  const attempts = Array.isArray(records) ? records : [];
  const configurationCount = matrix.configurations.length;
  const maximumPasses = matrix.repeatPolicy?.maximumPasses ?? 1;
  const floor = scenarioCount * configurationCount;
  const ceiling = floor * maximumPasses;
  const elapsedMs = Math.max(0, now - Date.parse(startedAt));
  const alerts = [];

  const byConfiguration = new Map(matrix.configurations.map((entry) => [entry.configurationId, []]));
  for (const record of attempts) {
    const bucket = byConfiguration.get(record.configurationId);
    if (bucket) bucket.push(record);
  }

  const configurations = matrix.configurations.map((configuration) => {
    const owned = byConfiguration.get(configuration.configurationId) || [];
    const measured = quality(owned);
    // Outstanding work for THIS configuration at the ceiling, which is what canStillQualify needs
    // in order to decide whether a perfect remainder could still reach the bar.
    const remainingAttempts = Math.max(0, scenarioCount * maximumPasses - owned.length);
    const viable = owned.length === 0
      ? true
      : canStillQualify(owned, { remainingAttempts, thresholds });
    const collapse = collapseMargins(owned, breaker);

    if (!viable) {
      alerts.push(
        `${configuration.configurationId} can no longer qualify: `
        + `${measured.attempts} attempt(s), average score ${measured.averageScore} against a bar of `
        + `${thresholds.averageScore}, verdict rate ${measured.scenarioVerdictRate}.`,
      );
    }
    if (collapse.armed && collapse.toolCallMargin !== null && collapse.toolCallMargin < 0.1) {
      alerts.push(
        `${configuration.configurationId} is ${collapse.toolCallMargin} from the tool-call collapse floor `
        + `(${breaker.toolCallFloor}) over ${collapse.attempts} attempts.`,
      );
    }
    if (collapse.armed && collapse.scoreMargin !== null && collapse.scoreMargin < 5) {
      alerts.push(
        `${configuration.configurationId} is ${collapse.scoreMargin} points from the score collapse floor `
        + `(${breaker.averageScoreFloor}) over ${collapse.attempts} attempts.`,
      );
    }

    return {
      configurationId: configuration.configurationId,
      model: configuration.model?.id ?? null,
      profile: configuration.profile?.id ?? null,
      attempts: measured.attempts,
      // Floor division on purpose: a configuration mid-pass has not completed that pass, and
      // rounding up would report work that has not happened.
      passesComplete: scenarioCount > 0 ? Math.floor(measured.attempts / scenarioCount) : 0,
      toolCallRate: measured.toolCallRate,
      scenarioVerdictRate: measured.scenarioVerdictRate,
      averageScore: measured.averageScore,
      canStillQualify: viable,
      collapse,
    };
  });

  const infrastructure = attempts.filter((record) => record.failureClass === 'infrastructure');
  if (infrastructure.length > 0) {
    const detail = infrastructure[infrastructure.length - 1];
    alerts.push(
      `${infrastructure.length} infrastructure failure(s); the most recent on `
      + `${detail.configurationId}: ${detail.llmError || detail.execStderr || 'unknown'}.`,
    );
  }

  const overall = quality(attempts);
  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  const attemptsPerHour = elapsedHours > 0 ? round(attempts.length / elapsedHours, 2) : null;
  // No throughput, no forecast. A guess drawn from zero completed attempts would be reported with
  // the same confidence as a measured one.
  const projectable = attempts.length > 0 && attemptsPerHour > 0;
  const perAttemptMs = projectable ? (60 * 60 * 1000) / attemptsPerHour : null;

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    startedAt: startedAt ?? null,
    elapsedMs,
    attempts: {
      recorded: attempts.length,
      floor,
      ceiling,
      remainingFloor: Math.max(0, floor - attempts.length),
      remainingCeiling: Math.max(0, ceiling - attempts.length),
    },
    overall: {
      ...overall,
      meets: {
        toolCallRate: overall.toolCallRate >= thresholds.toolCallRate,
        scenarioVerdictRate: overall.scenarioVerdictRate >= thresholds.scenarioVerdictRate,
        averageScore: overall.averageScore >= thresholds.averageScore,
      },
      thresholds: { ...thresholds },
    },
    performance: {
      attemptsPerHour,
      medianLlmMs: median(attempts.map((record) => record.llmMs).filter((value) => Number.isFinite(value))),
      medianExecMs: median(attempts.map((record) => record.execMs).filter((value) => Number.isFinite(value))),
      etaFloorMs: projectable ? Math.round(Math.max(0, floor - attempts.length) * perAttemptMs) : null,
      etaCeilingMs: projectable ? Math.round(Math.max(0, ceiling - attempts.length) * perAttemptMs) : null,
    },
    configurations,
    alerts,
  };
}

module.exports = { PROGRESS_NAME, SCHEMA_VERSION, readProgress, summarizeProgress, writeProgress };

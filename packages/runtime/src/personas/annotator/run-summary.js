/**
 * Run summary derivation — the Annotator's end-of-run classification.
 *
 * artifacts.ts defines RunSummary as "Run-level summary emitted by Annotator at
 * end of run". Before P3.2 the kernel built it in glue with `outcome` hardcoded
 * to "unknown", so every run ever produced reported "unknown" — a label-only
 * field the charter treats as a defect. This module derives it from real run
 * signals instead.
 *
 * Pure: no IO, no clock. Callers supply the collected frames/effects and the
 * run-scoped meta, so the same inputs always yield the same summary.
 */

const RUN_SUMMARY_SCHEMA = "agent-kernel/RunSummary";

/**
 * A budget VIOLATION (core's LimitViolated) is the run-failure signal.
 *
 * The runtime effect kind is "limit_violation" for BOTH LimitReached and
 * LimitViolated (ports/effects.js) — they are distinguished only by
 * `data.status`. "reached" is severity warn (a cap touched), "violated" is
 * severity error (a cap exceeded). Only the latter fails a run.
 *
 * NOTE: "limit_reached"/"limit_violated" are TelemetryRecord *type* names in
 * artifacts.ts and never appear as effect kinds — matching on them would
 * silently never fire.
 */
function hasBudgetViolation(effectLog) {
  return effectLog.some((effect) => effect?.kind === "limit_violation" && effect?.data?.status === "violated");
}

/** The moderator's state on the last frame that carries one. */
function endedHalted(tickFrames) {
  for (let index = tickFrames.length - 1; index >= 0; index -= 1) {
    const state = tickFrames[index]?.personaViews?.moderator?.state;
    if (state) {
      // "pausing" counts: since P3.1 a paused run's step() calls are refused,
      // so a run ending paused did not complete its requested work.
      return state === "pausing" || state === "stopping";
    }
  }
  return false;
}

function countDistinctTicks(tickFrames) {
  const ticks = new Set();
  tickFrames.forEach((frame) => {
    if (Number.isInteger(frame?.tick)) ticks.add(frame.tick);
  });
  return ticks.size;
}

/**
 * Outcome classification, most-specific signal first:
 *   unknown  — nothing ran; there is nothing to judge.
 *   failure  — a budget cap was exceeded during the run.
 *   aborted  — the run stopped short: halted by the moderator, or fewer ticks
 *              executed than were requested.
 *   success  — every requested tick ran with no violation.
 */
export function deriveRunOutcome({ tickFrames = [], effectLog = [], ticksRequested } = {}) {
  if (tickFrames.length === 0) {
    return "unknown";
  }
  if (hasBudgetViolation(effectLog)) {
    return "failure";
  }
  if (endedHalted(tickFrames)) {
    return "aborted";
  }
  if (Number.isInteger(ticksRequested) && countDistinctTicks(tickFrames) < ticksRequested) {
    return "aborted";
  }
  return "success";
}

/**
 * Builds the RunSummary artifact. `meta` carries the run-scoped id/runId/
 * createdAt from the caller (same pattern as the Allocator's priceListMeta, so
 * the artifact stays deterministic per run); the persona stamps producedBy
 * itself so the artifact announces its own producer.
 */
export function buildRunSummary({
  tickFrames = [],
  effectLog = [],
  ticksRequested,
  meta,
  simConfigRef,
  intentRef,
  planRef,
  budgetReceiptRef,
} = {}) {
  const summary = {
    schema: RUN_SUMMARY_SCHEMA,
    schemaVersion: 1,
    meta: { ...meta, producedBy: "annotator" },
    outcome: deriveRunOutcome({ tickFrames, effectLog, ticksRequested }),
    metrics: {
      // `ticks` stays the REQUESTED tick count (the kernel's pre-P3.2
      // semantics), so existing metric consumers are unaffected.
      ticks: Number.isInteger(ticksRequested) ? ticksRequested : 0,
      frames: tickFrames.length,
      effects: effectLog.length,
    },
  };

  if (intentRef) summary.intentRef = intentRef;
  if (planRef) summary.planRef = planRef;
  if (simConfigRef) summary.simConfigRef = simConfigRef;
  if (budgetReceiptRef) summary.budgetReceiptRef = budgetReceiptRef;

  return summary;
}

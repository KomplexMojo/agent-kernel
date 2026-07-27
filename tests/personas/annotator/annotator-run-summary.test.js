const assert = require("node:assert/strict");

/**
 * P3.2 — the Annotator produces the run summary.
 *
 * artifacts.ts documents RunSummary as "Run-level summary emitted by Annotator
 * at end of run", but production built it in glue (kernel.js run()) with
 * `outcome` HARDCODED to "unknown" on every run ever produced. These tests pin
 * the persona surface and, critically, that `outcome` is now DERIVED from real
 * run signals rather than being a constant.
 *
 * Signal sources (verified against the real emitters, not assumed):
 *  - budget violations arrive as effects with kind "limit_violation" and
 *    data.status "violated" (ports/effects.js maps core's LimitViolated).
 *    NOTE: status "reached" is severity warn — a cap touched, not exceeded —
 *    and must NOT count as failure.
 *  - the moderator's end state lives on frame.personaViews.moderator.state.
 */

const P = "../../../packages/runtime/src/personas/";

const META = Object.freeze({
  id: "run_summary_test",
  runId: "run_test",
  createdAt: "1970-01-01T00:00:00.000Z",
});

function frame(tick, { moderatorState = "ticking", phaseDetail = "summarize" } = {}) {
  return {
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    tick,
    phase: "execute",
    phaseDetail,
    acceptedActions: [],
    emittedEffects: [],
    fulfilledEffects: [],
    events: [],
    personaViews: { moderator: { state: moderatorState } },
  };
}

function limitEffect(status) {
  return {
    schema: "agent-kernel/Effect",
    kind: "limit_violation",
    severity: status === "violated" ? "error" : "warn",
    data: { status, spent: 12, category: "default" },
  };
}

async function summarize(args) {
  const { createAnnotatorPersona } = await import(`${P}annotator/persona.js`);
  return createAnnotatorPersona({ clock: () => META.createdAt }).summarizeRun({
    meta: META,
    ...args,
  });
}

test("summarizeRun stamps the Annotator as producer and emits a valid RunSummary artifact", async () => {
  const summary = await summarize({
    tickFrames: [frame(1), frame(2)],
    effectLog: [],
    ticksRequested: 2,
  });

  assert.equal(summary.schema, "agent-kernel/RunSummary");
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.meta.producedBy, "annotator", "the artifact must announce its persona producer");
  assert.equal(summary.meta.runId, META.runId);
  assert.equal(summary.meta.id, META.id);
});

test("outcome is success when every requested tick ran with no violations", async () => {
  const summary = await summarize({
    tickFrames: [frame(1), frame(2)],
    effectLog: [],
    ticksRequested: 2,
  });

  assert.equal(summary.outcome, "success");
  assert.deepEqual(summary.metrics, { ticks: 2, frames: 2, effects: 0 });
});

test("outcome is failure when a budget limit was VIOLATED", async () => {
  const summary = await summarize({
    tickFrames: [frame(1), frame(2)],
    effectLog: [limitEffect("violated")],
    ticksRequested: 2,
  });

  assert.equal(summary.outcome, "failure");
});

test("outcome stays success when a limit was only REACHED (warn), not violated", async () => {
  const summary = await summarize({
    tickFrames: [frame(1), frame(2)],
    effectLog: [limitEffect("reached")],
    ticksRequested: 2,
  });

  assert.equal(
    summary.outcome,
    "success",
    "a cap touched but not exceeded is a warning, not a run failure",
  );
});

test("outcome is aborted when the run halted before every requested tick ran", async () => {
  const summary = await summarize({
    tickFrames: [frame(1)],
    effectLog: [],
    ticksRequested: 3,
  });

  assert.equal(summary.outcome, "aborted");
});

test("outcome is aborted when the moderator ended the run halted (P3.1 pause/stop gate)", async () => {
  const paused = await summarize({
    tickFrames: [frame(1), frame(2, { moderatorState: "pausing" })],
    effectLog: [],
    ticksRequested: 2,
  });
  assert.equal(paused.outcome, "aborted");

  const stopped = await summarize({
    tickFrames: [frame(1), frame(2, { moderatorState: "stopping" })],
    effectLog: [],
    ticksRequested: 2,
  });
  assert.equal(stopped.outcome, "aborted");
});

test("outcome is unknown only when nothing ran at all", async () => {
  const summary = await summarize({
    tickFrames: [],
    effectLog: [],
    ticksRequested: 0,
  });

  assert.equal(summary.outcome, "unknown");
  assert.deepEqual(summary.metrics, { ticks: 0, frames: 0, effects: 0 });
});

test("a violation outranks an incomplete run — the more specific signal wins", async () => {
  const summary = await summarize({
    tickFrames: [frame(1)],
    effectLog: [limitEffect("violated")],
    ticksRequested: 5,
  });

  assert.equal(summary.outcome, "failure");
});

test("summarizeRun carries optional refs through and is deterministic", async () => {
  const simConfigRef = { id: "sim_config_1", schema: "agent-kernel/SimConfig", schemaVersion: 1 };
  const args = { tickFrames: [frame(1)], effectLog: [], ticksRequested: 1, simConfigRef };

  const first = await summarize(args);
  const second = await summarize(args);

  assert.deepEqual(first.simConfigRef, simConfigRef);
  assert.deepEqual(first, second, "identical inputs must produce an identical summary");
});

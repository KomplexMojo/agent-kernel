/**
 * P5.1 item D / maintainer decision 1 (2026-08-12): a build round derives `createdAt`
 * from the clock it was given, and refuses only when it was given NEITHER.
 *
 * WHY THIS WAS A DECISION AND NOT A FIX. `beginDirectorRound` required `createdAt`
 * outright, while the two remaining allowlist rows — `ui-flow.js` and `ak-impl.mjs`
 * importing `director/buildspec-assembler.js` — belong to paths that legitimately carry
 * a clock instead: `ui-web/card-builder-controller.js` passes `clock: () => new
 * Date().toISOString()` with `createdAt: undefined`, and `cli-worker/shared.js` forwards
 * an opaque payload. Threading them through the Director as it stood would have THROWN
 * where the code works today, so the boundary rows could not close without answering
 * what a clock-only caller means.
 *
 * THE ANSWER IS ALREADY THE ASSEMBLER'S. `defaultMeta` in buildspec-assembler.js stamps
 * `createdAt || requireClock(clock, "director")()` — derive, else refuse. The round
 * opener disagreed with the module it fronts, which is why routing through the persona
 * changed behavior at all. This aligns the two.
 *
 * THE CLOCK IS READ ONCE, AT ROUND OPEN, AND THE ROUND IS THEN FROZEN TO THAT VALUE.
 * Passing a live clock down to the persona would let two artifacts from one round carry
 * different timestamps, which is a determinism regression that no output test would fail
 * on — the same silent class as PX.3's defaulted clock. One round, one instant.
 *
 * SCOPE MATTERS AS MUCH AS EXISTENCE (D8.3's rule): a refusal that fires on every input
 * is an outage, not a boundary. The last two tests pin the cases that must KEEP working.
 */
const assert = require("node:assert/strict");

const DIRECTOR_ROUND = "../../packages/runtime/src/commands/director-round.js";
const UI_FLOW = "../../packages/runtime/src/commands/ui-flow.js";

const SUMMARY = Object.freeze({
  goal: "a room and an actor",
  rooms: [{ id: "room_1", size: "small" }],
  actors: [{ id: "actor_1", motivation: { kind: "random" }, affinity: { kind: "fire" } }],
});

test("createdAt supplied: it is used verbatim, and the clock is not consulted", async () => {
  const { beginDirectorRound } = await import(DIRECTOR_ROUND);
  let clockCalls = 0;
  const director = beginDirectorRound({
    runId: "run_created_at",
    createdAt: "2026-08-12T00:00:00.000Z",
    clock: () => { clockCalls += 1; return "1999-01-01T00:00:00.000Z"; },
  });

  assert.equal(director.currentPlan().meta.createdAt, "2026-08-12T00:00:00.000Z");
  assert.equal(clockCalls, 0, "an explicit createdAt must win outright, not race the clock");
});

test("no createdAt, a clock: the round derives it, reading the clock exactly once", async () => {
  const { beginDirectorRound } = await import(DIRECTOR_ROUND);
  let clockCalls = 0;
  const director = beginDirectorRound({
    runId: "run_derived",
    clock: () => { clockCalls += 1; return `2026-08-12T00:00:0${clockCalls}.000Z`; },
  });

  assert.equal(director.currentPlan().meta.createdAt, "2026-08-12T00:00:01.000Z");
  // A round frozen to one instant. If the persona held the live clock instead, a second
  // stamp inside the same round would read :02 and replay would diverge from the record.
  const built = director.assembleBuildSpec({ summary: SUMMARY, runId: "run_derived", source: "test" });
  assert.ok(built.ok, `expected a spec, got ${JSON.stringify(built.errors)}`);
  assert.equal(built.spec.meta.createdAt, "2026-08-12T00:00:01.000Z");
  assert.equal(clockCalls, 1, "the clock is the round's instant, not a timer read per artifact");
});

test("REFUSAL: neither createdAt nor clock — the round will not invent an instant", async () => {
  const { beginDirectorRound } = await import(DIRECTOR_ROUND);
  assert.throws(
    () => beginDirectorRound({ runId: "run_no_time" }),
    (error) => /createdAt/.test(error.message) && /clock/.test(error.message),
    "the refusal must name BOTH inputs — a caller told only 'createdAt is required' will "
      + "add a wall-clock read, which is the defect PX.3 removed",
  );
});

test("REFUSAL: a clock that does not return a timestamp is refused, not stamped", async () => {
  const { beginDirectorRound } = await import(DIRECTOR_ROUND);
  for (const [label, clock] of [
    ["returns undefined", () => undefined],
    ["returns a number", () => 1_755_000_000_000],
    ["returns blank", () => "   "],
  ]) {
    assert.throws(
      () => beginDirectorRound({ runId: "run_bad_clock", clock }),
      (error) => /clock/.test(error.message),
      `${label}: a clock whose value cannot be a createdAt must fail at the round, not `
        + "reach an artifact as `undefined` or a raw epoch",
    );
  }
});

test("SCOPE: runId is still required, and its refusal is separate from the clock's", async () => {
  const { beginDirectorRound } = await import(DIRECTOR_ROUND);
  assert.throws(
    () => beginDirectorRound({ createdAt: "2026-08-12T00:00:00.000Z" }),
    (error) => /runId/.test(error.message),
  );
});

test("the UI path: a clock-only caller gets a spec, exactly as it did before the round", async () => {
  const { buildSpecFromSummaryFlow } = await import(UI_FLOW);
  // This is `ui-web/card-builder-controller.js` verbatim in shape: a live clock and no
  // createdAt at all. It worked before this milestone and must still work after it.
  const result = buildSpecFromSummaryFlow({
    summary: SUMMARY,
    runId: "run_ui_clock_only",
    source: "design-ui",
    createdAt: undefined,
    clock: () => "2026-08-12T09:00:00.000Z",
  });

  assert.ok(result.ok, `expected a spec, got ${JSON.stringify(result.errors)}`);
  assert.equal(result.spec.meta.createdAt, "2026-08-12T09:00:00.000Z");
  assert.equal(result.spec.meta.runId, "run_ui_clock_only");
});

test("the UI path REPORTS a missing instant rather than throwing at its caller", async () => {
  const { buildSpecFromSummaryFlow } = await import(UI_FLOW);
  const result = buildSpecFromSummaryFlow({ summary: SUMMARY, runId: "run_ui_no_time" });

  // Every other refusal in this flow is `{ ok, reason, errors }` and the browser reads
  // that shape; a throw here would surface as an unhandled rejection in the UI.
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_created_at");
  assert.match(result.errors.join(" "), /clock/);
});

// ## TODO: Test Permutations
// - a clock that throws: does the round surface the clock's error or its own?
// - beginDirectorBuildCapabilities with clock-only options (same derivation, one layer up)
// - two rounds opened from the same clock: the second must not reuse the first's instant

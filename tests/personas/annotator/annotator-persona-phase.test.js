const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/annotator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/annotator-phases-guards.json"), "utf8"));



/**
 * P2.6 — the bare label assertion is gone (charter §6). The Annotator's ownership is
 * answered by G1 `annotator/per-tick-telemetry` (an ablation: a silent Annotator means
 * frames carry no records, and the runner does not assemble them itself) and
 * `annotator/run-summary-provenance`.
 *
 * WHAT STAYS: the subscribed-phase contract (EMIT + SUMMARIZE) and the branch proving
 * an unsubscribed phase leaves the persona untouched — a declared subscription that is
 * actually honoured. `lastObservationCount` stays because it is what the Annotator took
 * from the tick, not what it is called.
 */
test("annotator persona subscribes to emit/summarize and counts what it observed", async () => {
const { createAnnotatorPersona, annotatorSubscribePhases } = await import("../../../packages/runtime/src/personas/annotator/persona.js");
const { TickPhases } = await import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const fixture = happyFixture;
const persona = createAnnotatorPersona({ clock: () => "fixed" });
assert.deepEqual(annotatorSubscribePhases, [TickPhases.EMIT, TickPhases.SUMMARIZE]);

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  if (!entry.event || !annotatorSubscribePhases.includes(entry.phase)) {
    assert.equal(
      result.state,
      before.state,
      "an unsubscribed phase (or a case with no event) must not advance the persona",
    );
    return;
  }
  if (entry.expectObservationCount !== undefined) {
    assert.equal(result.context.lastObservationCount, entry.expectObservationCount);
  }
});
});

test("annotator persona enforces guard/invalid events", async () => {
const { createAnnotatorPersona } = await import("../../../packages/runtime/src/personas/annotator/persona.js");

const fixture = guardFixture;
const persona = createAnnotatorPersona({ initialState: fixture.initialState || undefined, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  if (entry.expectError) {
    let threw = false;
    try {
      persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
    } catch (err) {
      threw = true;
      assert.match(err.message, new RegExp(entry.expectError));
    }
    assert.equal(threw, true);
  } else {
    const before = persona.view();
    const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
    assert.equal(result.state, before.state);
  }
});
});

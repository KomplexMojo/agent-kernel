const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/annotator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/annotator-transitions-guards.json"), "utf8"));



/**
 * P2.6 — label assertions removed; see the header of
 * `tests/personas/actor/actor-state-machine.test.js` for the full rationale.
 * Short form: `result.state` and `context.lastEvent` asserted that a LABEL changed
 * (charter §6 calls that legacy; G1 answers ownership), and `context.updatedAt`
 * duplicated the repo-wide `new Date(` ban in `single-origin.test.js`.
 *
 * The observation count survives because it is what the Annotator actually took from
 * the tick: a case carrying no observations must not silently discard it.
 *
 * ⚠️ TRACKED ABSOLUTELY, NOT AGAINST `before` — same reason as the Allocator's file.
 * The relative form catches a clobber here only because `reset` sits directly after
 * the case that sets the count; one intervening case makes it blind, as a perturbation
 * proved in `actor-state-machine.test.js`. Order-dependent assertions fail silently.
 */
test("annotator state machine walks the happy path and accumulates observation counts", async () => {
const { createAnnotatorStateMachine } = await import("../../../packages/runtime/src/personas/annotator/state-machine.js");

const fixture = happyFixture;
const machine = createAnnotatorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

// A baseline the machine cannot corrupt — see the header.
let expectedObservationCount = 0;

fixture.cases.forEach((entry) => {
  // advance() throws on an illegal transition — driving the sequence proves it walks.
  const result = machine.advance(entry.event, entry.payload);

  if (Array.isArray(entry.payload.observations)) {
    expectedObservationCount = entry.payload.observations.length;
  }
  if (entry.expectObservationCount !== undefined) {
    assert.equal(result.context.lastObservationCount, entry.expectObservationCount);
  }
  assert.equal(
    result.context.lastObservationCount,
    expectedObservationCount,
    `after "${entry.event}": a case carrying no observations must leave the count intact`,
  );
});
});

test("annotator state machine enforces guard and invalid transitions", async () => {
const { createAnnotatorStateMachine } = await import("../../../packages/runtime/src/personas/annotator/state-machine.js");

const fixture = guardFixture;
const machine = createAnnotatorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  let threw = false;
  try {
    machine.advance(entry.event, entry.payload);
  } catch (err) {
    threw = true;
    assert.match(err.message, new RegExp(entry.expectError));
  }
  assert.equal(threw, true);
});
});

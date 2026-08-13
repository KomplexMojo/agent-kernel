const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/allocator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/allocator-transitions-guards.json"), "utf8"));



/**
 * P2.6 — label assertions removed; see the header of
 * `tests/personas/actor/actor-state-machine.test.js` for the full rationale.
 * Short form: `result.state` and `context.lastEvent` asserted that a LABEL changed
 * (charter §6 calls that legacy; G1 answers ownership), and `context.updatedAt`
 * duplicated the repo-wide `new Date(` ban in `single-origin.test.js`.
 *
 * The budget and signal counts survive because they are what the Allocator DID with
 * the payload: observing must not clobber counts an earlier allocation earned.
 *
 * ⚠️ TRACKED ABSOLUTELY, NOT AGAINST `before`. The relative form (`result.count ===
 * before.count` on the `monitor` case) does catch a clobber in THIS fixture, but only
 * because `monitor` happens to sit directly after the case that sets the count. The
 * same shape in `actor-state-machine.test.js` was proven blind by exactly one
 * intervening case: the defect corrupted the baseline too, and 0 === 0 agreed. That
 * makes the relative form dependent on fixture ORDER, and it fails silently when the
 * order changes. Carrying the expectation independently removes the dependency.
 */
test("allocator state machine walks the happy path and accumulates budget/signal counts", async () => {
const { createAllocatorStateMachine } = await import("../../../packages/runtime/src/personas/allocator/state-machine.js");

const fixture = happyFixture;
const machine = createAllocatorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

// Baselines the machine cannot corrupt — see the header.
let expectedBudgetCount = 0;
let expectedSignalCount = 0;

fixture.cases.forEach((entry) => {
  // advance() throws on an illegal transition — driving the sequence proves it walks.
  const result = machine.advance(entry.event, entry.payload);

  if (Array.isArray(entry.payload.budgets)) expectedBudgetCount = entry.payload.budgets.length;
  if (Array.isArray(entry.payload.signals)) expectedSignalCount = entry.payload.signals.length;

  if (entry.expectBudgetCount !== undefined) {
    assert.equal(result.context.lastBudgetCount, entry.expectBudgetCount);
  }
  if (entry.expectSignalCount !== undefined) {
    assert.equal(result.context.lastSignalCount, entry.expectSignalCount);
  }
  assert.equal(
    result.context.lastBudgetCount,
    expectedBudgetCount,
    `after "${entry.event}": a case carrying no budgets must leave the allocated count intact`,
  );
  assert.equal(
    result.context.lastSignalCount,
    expectedSignalCount,
    `after "${entry.event}": a case carrying no signals must leave the signal count intact`,
  );
});
});

test("allocator state machine enforces guard and invalid transitions", async () => {
const { createAllocatorStateMachine } = await import("../../../packages/runtime/src/personas/allocator/state-machine.js");

const fixture = guardFixture;
const machine = createAllocatorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

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

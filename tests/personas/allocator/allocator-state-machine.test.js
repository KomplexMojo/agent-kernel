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

/**
 * P5.5 — the guard that turned REBALANCING from a label into a gate.
 *
 * It used to accept any non-empty `signals` array, and signals are counts of effects,
 * fulfilments and actions: enough to say a tick was busy, never enough to compare spend
 * against a cap. So the state was enterable with nothing to do in it — which is how it
 * stayed a label-only state (a charter defect) for as long as it did. Now entry requires
 * the issued-versus-actual ledger the reconciliation actually consumes.
 */
test("allocator refuses to enter rebalancing without a ledger to reconcile", async () => {
  const { createAllocatorStateMachine } = await import("../../../packages/runtime/src/personas/allocator/state-machine.js");

  const machine = createAllocatorStateMachine({ initialState: "monitoring", clock: () => "fixed" });

  // The pre-P5.5 payload: busy tick, nothing to reconcile. This used to be accepted.
  assert.throws(
    () => machine.advance("rebalance", { signals: [{ kind: "actions", count: 3 }] }),
    /Guard blocked transition/,
    "signal counts must not admit the reconciling state — they carry no spend",
  );
  assert.equal(machine.view().state, "monitoring", "a blocked guard must not move the state");

  // An empty ledger is not a ledger: there is nothing to be within.
  assert.throws(
    () => machine.advance("rebalance", { ledger: { categories: [] } }),
    /Guard blocked transition/,
  );

  const result = machine.advance("rebalance", {
    ledger: { categories: [{ category: "movement", categoryId: 0, issued: 5, spent: 2 }] },
  });
  assert.equal(result.state, "rebalancing");
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

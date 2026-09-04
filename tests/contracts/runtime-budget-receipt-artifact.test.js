const assert = require("node:assert/strict");

const ALLOCATOR = "../../packages/runtime/src/personas/allocator/persona.js";
const ARTIFACTS = "../../packages/runtime/src/contracts/artifacts.ts";
const CLOCK = () => "2026-09-02T00:00:00.000Z";

function meta(id = "runtime_budget_receipt") {
  return { id, runId: "run_runtime_budget", createdAt: CLOCK(), producedBy: "runtime" };
}

async function makeAllocator() {
  const { createAllocatorPersona } = await import(ALLOCATOR);
  return createAllocatorPersona({ clock: CLOCK });
}

test("Allocator issues the worked mixed-action receipt from unit-free outcomes", async () => {
  const { RUNTIME_BUDGET_RECEIPT_SCHEMA } = await import(ARTIFACTS);
  const allocator = await makeAllocator();
  const receipt = allocator.issueRuntimeBudgetReceipt({
    meta: meta(),
    outcomes: [
      { actorId: "delver", tick: 1, actionKind: "wait", outcome: "accepted" },
      { actorId: "warden", tick: 1, actionKind: "move", outcome: "accepted" },
      { actorId: "delver", tick: 2, actionKind: "request_solver", outcome: "accepted" },
      { actorId: "delver", tick: 2, actionKind: "attack", outcome: "accepted" },
      { actorId: "warden", tick: 2, actionKind: "cast_affinity", outcome: "accepted" },
      { actorId: null, tick: 2, actionKind: "attack", outcome: "rejected", reason: "missing_target_id" },
    ],
  });

  assert.equal(receipt.schema, RUNTIME_BUDGET_RECEIPT_SCHEMA);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.meta.producedBy, "allocator");
  assert.equal(receipt.unit, "runtimeBudgetUnits");
  assert.equal(receipt.enforcement, "descriptive");
  assert.deepEqual(receipt.rows.map((row) => row.units), [1, 0, 2, 1, 1, 0]);
  assert.deepEqual(receipt.rows.map((row) => row.source), Array(6).fill("allocator_runtime_action_price_v1"));
  assert.equal(receipt.rows[5].reason, "missing_target_id");
  assert.deepEqual(receipt.actorTotals, [
    { actorId: "delver", units: 4 },
    { actorId: "warden", units: 1 },
  ]);
  assert.equal(receipt.unattributedUnits, 0);
  assert.equal(receipt.totalUnits, 5);
  assert.equal(allocator.view().state, "idle", "descriptive receipt issuance does not advance the Allocator FSM");
});

test("receipt uses the published default only for accepted non-named actions", async () => {
  const allocator = await makeAllocator();
  const receipt = allocator.issueRuntimeBudgetReceipt({
    meta: meta("runtime_budget_default"),
    outcomes: [
      { actorId: "delver", tick: 3, actionKind: "emit_telemetry", outcome: "accepted" },
      { actorId: "delver", tick: 3, actionKind: "cast_affinity", outcome: "rejected", reason: "insufficient_affinity_mana" },
    ],
  });

  assert.deepEqual(receipt.rows.map((row) => row.units), [1, 0]);
  assert.deepEqual(receipt.actorTotals, [{ actorId: "delver", units: 1 }]);
  assert.equal(receipt.totalUnits, 1);
});

test("receipt refuses malformed outcomes and missing deterministic metadata", async () => {
  const allocator = await makeAllocator();
  assert.throws(
    () => allocator.issueRuntimeBudgetReceipt({ outcomes: [] }),
    (error) => error?.code === "allocator_runtime_budget_meta_required",
  );
  assert.throws(
    () => allocator.issueRuntimeBudgetReceipt({ meta: meta("bad_outcomes"), outcomes: null }),
    (error) => error?.code === "allocator_runtime_budget_outcomes_required",
  );
  assert.throws(
    () => allocator.issueRuntimeBudgetReceipt({
      meta: meta("bad_tick"),
      outcomes: [{ actorId: "delver", tick: -1, actionKind: "wait", outcome: "accepted" }],
    }),
    (error) => error?.code === "allocator_runtime_budget_outcome_invalid",
  );
});

// ## TODO: Test Permutations
// - blank actor ids should become unattributed rather than an inferred core actor
// - an unknown accepted action should use the current Allocator default after a retune
// - repeated equal outcome input should produce byte-identical receipts

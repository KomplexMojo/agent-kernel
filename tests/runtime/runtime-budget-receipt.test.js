const assert = require("node:assert/strict");

const FIXED_CLOCK = () => "2026-09-02T00:00:00.000Z";

function makeSimConfig() {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "runtime_receipt_sim", runId: "runtime_receipt", createdAt: FIXED_CLOCK() },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 7,
        height: 5,
        tiles: ["#######", "#.....#", "#.....#", "#.....#", "#######"],
        spawn: { x: 1, y: 1 },
        exit: { x: 5, y: 3 },
        rooms: [{ id: "R1", x: 0, y: 0, width: 7, height: 5 }],
      },
    },
  };
}

function makeInitialState() {
  const vitals = {
    health: { current: 10, max: 10, regen: 0 },
    mana: { current: 10, max: 10, regen: 0 },
    stamina: { current: 10, max: 10, regen: 0 },
    durability: { current: 1, max: 1, regen: 0 },
  };
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "runtime_receipt_state", runId: "runtime_receipt", createdAt: FIXED_CLOCK() },
    simConfigRef: { id: "runtime_receipt_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors: [
      { id: "delver", kind: "ambulatory", archetype: "delver", role: "delver", position: { x: 1, y: 1 }, motivation: { kind: "stationary" }, vitals },
      { id: "warden", kind: "ambulatory", archetype: "warden", role: "warden", position: { x: 3, y: 1 }, motivation: { kind: "stationary" }, vitals },
    ],
  };
}

function scriptedActor(actions) {
  let proposed = false;
  return {
    subscribePhases: ["observe", "decide"],
    state: "idle",
    view() {
      return { state: this.state, context: { lastEvent: null } };
    },
    advance({ event, tick }) {
      if (event === "propose" && !proposed) {
        proposed = true;
        return {
          state: "proposing",
          context: { lastEvent: event },
          actions: actions.map((action) => ({ ...action, tick })),
          effects: [],
          telemetry: null,
        };
      }
      return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
    },
  };
}

async function runReceipt() {
  const [{ createRuntime }, { createCore }, { createAllocatorPersona }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/runtime/src/personas/allocator/persona.js"),
  ]);
  const actions = [
    { actorId: "delver", kind: "wait", params: {} },
    { actorId: "warden", kind: "wait", params: {} },
    { actorId: "delver", kind: "request_solver", params: { requestId: "solver_1" } },
    { actorId: "delver", kind: "move", params: { from: { x: 1, y: 1 }, to: { x: 2, y: 1 } } },
    { actorId: "delver", kind: "attack", params: { targetId: "warden", damage: 2 } },
    { actorId: null, kind: "attack", params: { damage: 2 } },
    { actorId: "warden", kind: "move", params: {} },
    { actorId: "warden", kind: "fulfill_request", params: { requestId: "request_1" } },
  ];
  const runtime = createRuntime({
    core: createCore(),
    adapters: {},
    runId: "runtime_receipt",
    clock: FIXED_CLOCK,
    personas: {
      actor: scriptedActor(actions),
      allocator: createAllocatorPersona({ clock: FIXED_CLOCK }),
    },
  });
  await runtime.init({ seed: 0, simConfig: makeSimConfig(), initialState: makeInitialState(), clock: FIXED_CLOCK });
  await runtime.step();
  return runtime.issueRuntimeBudgetReceipt({
    meta: { id: "artifact_runtime_receipt", runId: "runtime_receipt", createdAt: FIXED_CLOCK(), producedBy: "runtime" },
  });
}

test("runtime captures actual direct and core outcomes, then delegates receipt pricing to its live Allocator", async () => {
  const receipt = await runReceipt();

  assert.deepEqual(receipt.rows.map(({ actorId, actionKind, outcome, units }) => ({ actorId, actionKind, outcome, units })), [
    { actorId: "delver", actionKind: "wait", outcome: "accepted", units: 1 },
    { actorId: "warden", actionKind: "wait", outcome: "accepted", units: 1 },
    { actorId: "delver", actionKind: "request_solver", outcome: "accepted", units: 2 },
    { actorId: "delver", actionKind: "move", outcome: "accepted", units: 0 },
    { actorId: "delver", actionKind: "attack", outcome: "accepted", units: 1 },
    { actorId: null, actionKind: "attack", outcome: "rejected", units: 0 },
    { actorId: "warden", actionKind: "move", outcome: "rejected", units: 0 },
    { actorId: "warden", actionKind: "fulfill_request", outcome: "rejected", units: 0 },
  ]);
  assert.match(receipt.rows[7].reason, /^action_rejected_by_core:/, "non-Move core rejection must not be recorded as accepted");
  assert.deepEqual(receipt.actorTotals, [
    { actorId: "delver", units: 4 },
    { actorId: "warden", units: 1 },
  ]);
  assert.equal(receipt.unattributedUnits, 0);
  assert.equal(receipt.totalUnits, 5);
  assert.deepEqual(await runReceipt(), receipt, "identical runs issue byte-identical receipts");
});

// ## TODO: Test Permutations
// - a direct core rejection with an actor id remains in that actor's subtotal at zero units
// - an action without an actor id remains unattributed rather than borrowing the primary actor
// - multiple solver requests and their concrete follow-up actions preserve application order

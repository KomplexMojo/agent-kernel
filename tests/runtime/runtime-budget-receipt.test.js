// #158 triage: stays here (not tests/personas/allocator/) — it asserts on the RUNTIME's capture
// of direct/core outcomes and its delegation to a live Allocator, not on Allocator pricing logic
// in isolation. Runtime-to-Allocator orchestration, not persona-alone behavior.
const assert = require("node:assert/strict");

const FIXED_CLOCK = () => "2026-09-02T00:00:00.000Z";

async function artifacts() {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const width = 7;
  const height = 5;
  const terrain = boxedTerrain(width, height);
  terrain[width + 1] = "spawn";
  terrain[3 * width + 5] = "exit";
  return buildUnifiedArtifacts({
    width,
    height,
    terrain,
    runId: "runtime_receipt",
    clock: FIXED_CLOCK(),
    actors: [
      {
        id: "delver",
        category: "delver",
        position: { x: 1, y: 1 },
        motivations: ["stationary"],
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 10, max: 10, regen: 0 },
          stamina: { current: 10, max: 10, regen: 0 },
        },
      },
      {
        id: "warden",
        category: "warden",
        position: { x: 3, y: 1 },
        motivations: ["stationary"],
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 10, max: 10, regen: 0 },
          stamina: { current: 10, max: 10, regen: 0 },
        },
      },
    ],
    movementStamina: { delver: 0, warden: 0 },
  });
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
    { actorId: "delver", kind: "wait" },
    { actorId: "warden", kind: "wait" },
    { actorId: "delver", kind: "request_solver", params: { requestId: "solver_1" } },
    { actorId: "delver", kind: "move", params: { target: { x: 2, y: 1 } } },
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
  const { simConfig, initialState } = await artifacts();
  await runtime.init({ seed: 0, simConfig, initialState, clock: FIXED_CLOCK });
  await runtime.step();
  return runtime.issueRuntimeBudgetReceipt({
    meta: { id: "artifact_runtime_receipt", runId: "runtime_receipt", createdAt: FIXED_CLOCK(), producedBy: "runtime" },
  });
}

test("runtime captures actual direct and core outcomes, then delegates receipt pricing to its live Allocator", async () => {
  const receipt = await runReceipt();

  // ROW ORDER IS NOW THE MODERATOR'S RESOLUTION ORDER, not collection order. Both actors
  // surface `wait` (intent class 100), so the tie breaks on actor id and `delver` resolves
  // its whole turn before `warden` starts -- where previously the two actors' actions
  // interleaved in the order the decide loop happened to collect them. Units, outcomes and
  // totals are unchanged; only who goes first is, which is the entire point of the binding.
  assert.deepEqual(receipt.rows.map(({ actorId, actionKind, outcome, units }) => ({ actorId, actionKind, outcome, units })), [
    { actorId: "delver", actionKind: "wait", outcome: "accepted", units: 1 },
    { actorId: "delver", actionKind: "request_solver", outcome: "accepted", units: 2 },
    { actorId: "delver", actionKind: "move", outcome: "rejected", units: 0 },
    { actorId: "delver", actionKind: "attack", outcome: "rejected", units: 0 },
    { actorId: "warden", actionKind: "wait", outcome: "accepted", units: 1 },
    { actorId: "warden", actionKind: "move", outcome: "rejected", units: 0 },
    { actorId: "warden", actionKind: "fulfill_request", outcome: "rejected", units: 0 },
    { actorId: null, actionKind: "attack", outcome: "rejected", units: 0 },
  ]);
  const attackRejected = receipt.rows.find((row) => row.actorId === "delver" && row.actionKind === "attack");
  assert.equal(attackRejected.reason, "unsupported_action_kind");
  const coreRejected = receipt.rows.find((row) => row.actorId === "warden" && row.actionKind === "fulfill_request");
  assert.match(coreRejected.reason, /^action_rejected_by_core:/, "non-Move core rejection must not be recorded as accepted");
  assert.deepEqual(receipt.actorTotals, [
    { actorId: "delver", units: 3 },
    { actorId: "warden", units: 1 },
  ]);
  assert.equal(receipt.unattributedUnits, 0);
  assert.equal(receipt.totalUnits, 4);
  assert.deepEqual(await runReceipt(), receipt, "identical runs issue byte-identical receipts");
});

// ## TODO: Test Permutations
// - a direct core rejection with an actor id remains in that actor's subtotal at zero units
// - an action without an actor id remains unattributed rather than borrowing the primary actor
// - multiple solver requests and their concrete follow-up actions preserve application order

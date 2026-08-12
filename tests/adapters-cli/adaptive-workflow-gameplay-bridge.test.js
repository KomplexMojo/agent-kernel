const assert = require("node:assert/strict");

async function loadOp() {
  return import("../../packages/adapters-cli/src/adapters/adaptive-workflow/gameplay-bridge.js");
}

const OK_SPEC = { ok: true, spec: { schema: "agent-kernel/BuildSpec", schemaVersion: 1 } };
const FAKE_BUNDLE = { spec: OK_SPEC.spec, artifacts: [{ schema: "agent-kernel/SimConfigArtifact" }, { schema: "agent-kernel/InitialStateArtifact" }] };

function stubs(overrides = {}) {
  const calls = { assemble: [], compile: [], push: [], onBundle: [] };
  return {
    calls,
    assembleSpec: overrides.assembleSpec || ((args) => { calls.assemble.push(args); return OK_SPEC; }),
    compile: overrides.compile || ((spec) => { calls.compile.push(spec); return FAKE_BUNDLE; }),
    push: overrides.push || ((envelope) => { calls.push.push(envelope); return { deliveredClientIds: ["ui_1"], timedOutClientIds: [] }; }),
    bridgeState: overrides.bridgeState || (() => ({ connectedClients: 1 })),
    onBundle: overrides.onBundle,
    clock: () => "2026-07-14T00:00:00.000Z",
    makeMessageId: () => "msg_fixed",
  };
}

test("compiles the workflow output into a bundle and pushes a gameplay envelope", async () => {
  const { createGameplayBridgeOperation } = await loadOp();
  const s = stubs();
  const bundleSeen = [];
  const op = createGameplayBridgeOperation({ ...s, onBundle: (b) => bundleSeen.push(b) });
  const receipt = await op({ runId: "run_x", generated: { rooms: [{ id: "r1" }] }, selectedStrategy: { strategyId: "flagship_full_context_v1" } });

  assert.equal(s.calls.assemble[0].summary.rooms[0].id, "r1");
  assert.equal(s.calls.compile[0], OK_SPEC.spec);
  assert.equal(bundleSeen[0], FAKE_BUNDLE);
  const envelope = s.calls.push[0];
  assert.equal(envelope.type, "ak.gameplayBundle.v1");
  assert.equal(envelope.targetTab, "gameplay");
  assert.equal(envelope.payload.bundle, FAKE_BUNDLE);
  assert.equal(envelope.payload.source.strategyId, "flagship_full_context_v1");

  assert.equal(receipt.operation, "gameplay_bridge");
  assert.equal(receipt.bundleArtifactCount, 2);
  assert.deepEqual(receipt.deliveredClientIds, ["ui_1"]);
  assert.equal(receipt.messageId, "msg_fixed");
});

test("rejects when the workflow output cannot assemble a BuildSpec", async () => {
  const { createGameplayBridgeOperation } = await loadOp();
  const op = createGameplayBridgeOperation({ ...stubs({ assembleSpec: () => ({ ok: false, errors: ["no rooms"] }) }) });
  await assert.rejects(() => op({ runId: "r", generated: {} }), /BuildSpec.*no rooms/);
});

test("requireClient rejects when no browser UI is connected, without pushing", async () => {
  const { createGameplayBridgeOperation } = await loadOp();
  const s = stubs({ bridgeState: () => ({ connectedClients: 0 }) });
  const op = createGameplayBridgeOperation({ ...s, requireClient: true });
  await assert.rejects(() => op({ runId: "r", generated: { rooms: [{ id: "r1" }] } }), /No browser UI is connected/);
  assert.equal(s.calls.push.length, 0);
});

test("surfaces a bridge start failure", async () => {
  const { createGameplayBridgeOperation } = await loadOp();
  const op = createGameplayBridgeOperation({ ...stubs({ bridgeState: () => ({ startFailed: true }) }) });
  await assert.rejects(() => op({ runId: "r", generated: { rooms: [{ id: "r1" }] } }), /bridge server failed to start/);
});

test("pre-stages (does not require a client) by default", async () => {
  const { createGameplayBridgeOperation } = await loadOp();
  let pushes = 0;
  const s = stubs({ bridgeState: () => ({ connectedClients: 0 }), push: () => { pushes += 1; return { deliveredClientIds: [], timedOutClientIds: [] }; } });
  const op = createGameplayBridgeOperation({ ...s });
  const receipt = await op({ runId: "r", generated: { rooms: [{ id: "r1" }] } });
  assert.equal(receipt.connectedClients, 0);
  assert.equal(pushes, 1, "bundle is still pushed to the replay window");
});

test("integration: a real AWA-style summary compiles to a SimConfig+InitialState bundle", async () => {
  const { createGameplayBridgeOperation } = await loadOp();
  const { buildBuildSpecFromSummary } = await import("../../packages/runtime/src/personas/director/buildspec-assembler.js");
  const { compileBuildSpecToGameplayBundle } = await import("../../packages/adapters-cli/src/cli/ak-impl.mjs");
  const pushed = [];
  const op = createGameplayBridgeOperation({
    assembleSpec: buildBuildSpecFromSummary,
    compile: compileBuildSpecToGameplayBundle,
    push: (envelope) => { pushed.push(envelope); return { deliveredClientIds: [], timedOutClientIds: [] }; },
    bridgeState: () => ({ connectedClients: 0 }),
  });
  const summary = { dungeonAffinity: "fire", rooms: [{ type: "room", count: 2, size: "small", affinity: "fire" }], actors: [{ type: "delver", count: 1, motivation: "attacking", affinity: "fire" }] };
  const receipt = await op({ runId: "run_real", generated: summary, selectedStrategy: { strategyId: "flagship_full_context_v1" } });
  assert.equal(receipt.bundleArtifactCount, 3);
  const schemas = pushed[0].payload.bundle.artifacts.map((a) => a.schema);
  assert.ok(schemas.some((s) => /SimConfig/.test(s)), "bundle must include a SimConfig artifact");
  assert.ok(schemas.some((s) => /InitialState/.test(s)), "bundle must include an InitialState artifact");
});

// ## TODO: Test Permutations
// - onBundle write failure surfaces as an execution error
// - compile throwing propagates without pushing
// - timedOutClientIds are reported in the receipt

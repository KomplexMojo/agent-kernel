const assert = require("node:assert/strict");

const capability = { schemaVersion: 1, providerId: "fixture", modelId: "fixture", source: "declared", providerContextWindowTokens: 128000, contextWindowTokens: 128000, maxOutputTokens: 4096, supports: { textGeneration: true, structuredOutput: true, streaming: false } };
const response = { response: JSON.stringify({ rooms: [{ id: "r1" }], actors: [{ id: "a1" }] }) };
function clock() { let i = 0; return () => `2026-07-13T00:00:${String(++i).padStart(2, "0")}.000Z`; }
const validator = { id: "valid", version: 1, validate: () => ({ ok: true }) };

test("recorded responses replay to the same final state without a live model call", async () => {
  const [{ runAdaptiveWorkflow }, { createReplayEnvelope, createReplayModelAdapter }, { createAdaptiveWorkflowTestStore }] = await Promise.all([
    import("../../packages/runtime/src/adaptive-workflow/runner.js"),
    import("../../packages/runtime/src/adaptive-workflow/replay.js"),
    import("../../packages/adapters-test/src/adapters/adaptive-workflow/store.js"),
  ]);
  const store = createAdaptiveWorkflowTestStore();
  let liveCalls = 0;
  const original = await runAdaptiveWorkflow({ objective: "replay", runId: "replay_run", declaredCapability: capability, ports: { model: { generate: async () => { liveCalls += 1; return response; } }, validator: [validator], persistence: store, clock: clock() } });
  const envelope = createReplayEnvelope(original);
  const replayed = await runAdaptiveWorkflow({ objective: "replay", runId: "replay_run", declaredCapability: capability, ports: { model: createReplayModelAdapter({ store, envelope }), validator: [validator], persistence: store, clock: clock() } });
  assert.equal(liveCalls, 1);
  assert.deepEqual(replayed.state, original.state);
  assert.equal(replayed.outcome, "complete");
});

test("missing or mismatched recorded response content fails deterministically", async () => {
  const [{ createReplayModelAdapter }, { createAdaptiveWorkflowTestStore }] = await Promise.all([
    import("../../packages/runtime/src/adaptive-workflow/replay.js"),
    import("../../packages/adapters-test/src/adapters/adaptive-workflow/store.js"),
  ]);
  const store = createAdaptiveWorkflowTestStore();
  const ref = await store.putContent(response);
  store.tamperContent(ref, { response: "changed" });
  const meta = { id: "r:replay", runId: "r", createdAt: "2026-07-13T00:00:00.000Z", producedBy: "adaptive-workflow" };
  await assert.rejects(() => createReplayModelAdapter({ store, envelope: { schema: "agent-kernel/AdaptiveWorkflowReplay", schemaVersion: 1, meta, runId: "r", responseRefs: [ref] } }).generate({}), /digest mismatch/i);
  assert.throws(() => createReplayModelAdapter({ store, envelope: { schema: "agent-kernel/AdaptiveWorkflowReplay", schemaVersion: 1, meta, runId: "r", responseRefs: [] } }), /recorded response/i);
  assert.throws(() => createReplayModelAdapter({ store, envelope: { schema: "agent-kernel/AdaptiveWorkflowReplay", schemaVersion: 1, meta, runId: "r", responseRefs: [{ algorithm: "sha256" }] } }), /recorded response/i);
});

test("replay envelope with a mismatched run identifier is rejected before any read", async () => {
  const [{ createReplayModelAdapter }, { createAdaptiveWorkflowTestStore }] = await Promise.all([
    import("../../packages/runtime/src/adaptive-workflow/replay.js"),
    import("../../packages/adapters-test/src/adapters/adaptive-workflow/store.js"),
  ]);
  const store = createAdaptiveWorkflowTestStore();
  const ref = await store.putContent(response);
  const meta = { id: "run-a:replay", runId: "run-a", createdAt: "2026-07-13T00:00:00.000Z", producedBy: "adaptive-workflow" };
  assert.throws(
    () => createReplayModelAdapter({ store, envelope: { schema: "agent-kernel/AdaptiveWorkflowReplay", schemaVersion: 1, meta, runId: "run-b", responseRefs: [ref] } }),
    /replay envelope/i,
  );
});

test("replay source without recorded responses cannot produce an envelope or fall back to a live model", async () => {
  const { createReplayEnvelope } = await import("../../packages/runtime/src/adaptive-workflow/replay.js");
  assert.throws(() => createReplayEnvelope({ state: { runId: "r", updatedAt: "2026-07-13T00:00:00.000Z", refs: { replayResponseRefs: [] } } }), /recorded response|invalid/i);
});

// ## TODO: Test Permutations (expanded in M11)
// - replay missing response hash -> covered here and by "missing or mismatched recorded response content ..."
// - replay envelope with the wrong run identifier -> covered by "replay envelope with a mismatched run identifier ..."

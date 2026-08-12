const assert = require("node:assert/strict");

async function modules() {
  return Promise.all([
    import("../../packages/runtime/src/adaptive-workflow/durable-log.js"),
    import("../../packages/adapters-test/src/adapters/adaptive-workflow/store.js"),
    import("../../packages/runtime/src/adaptive-workflow/state-machine.js"),
  ]);
}

test("duplicate side effects return the prior receipt and conflicting payloads fail", async () => {
  const [{ executeDurableSideEffect }, { createAdaptiveWorkflowTestStore }] = await modules();
  const store = createAdaptiveWorkflowTestStore();
  let calls = 0;
  const execute = async () => ({ receipt: ++calls });
  const first = await executeDurableSideEffect({ store, idempotencyKey: "cli:1", payload: { b: 2, a: 1 }, execute });
  const duplicate = await executeDurableSideEffect({ store, idempotencyKey: "cli:1", payload: { a: 1, b: 2 }, execute });
  assert.equal(calls, 1);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.receipt, first.receipt);
  await assert.rejects(() => executeDurableSideEffect({ store, idempotencyKey: "cli:1", payload: { a: 2 }, execute }), /idempotency conflict/i);
});

test("receipt persistence failure leaves the reservation pending and never re-executes", async () => {
  const [{ executeDurableSideEffect }, { createAdaptiveWorkflowTestStore }] = await modules();
  const base = createAdaptiveWorkflowTestStore();
  const store = { ...base, completeSideEffect: async () => { throw Object.assign(new Error("commit failed"), { code: "write_failed" }); } };
  let calls = 0;
  const input = { store, idempotencyKey: "cli:crash", payload: { command: "run" }, execute: async () => ({ call: ++calls }) };
  await assert.rejects(() => executeDurableSideEffect(input), /commit failed/i);
  await assert.rejects(() => executeDurableSideEffect(input), /still pending/i);
  assert.equal(calls, 1);
});

test("cancellation after reservation aborts before execution", async () => {
  const [{ executeDurableSideEffect }, { createAdaptiveWorkflowTestStore }] = await modules();
  const store = createAdaptiveWorkflowTestStore();
  let calls = 0;
  await assert.rejects(() => executeDurableSideEffect({ store, idempotencyKey: "cli:cancel", payload: {}, execute: async () => { calls += 1; }, isCancelled: async () => true }), /cancelled before execution/i);
  await executeDurableSideEffect({ store, idempotencyKey: "cli:cancel", payload: {}, execute: async () => ({ call: ++calls }) });
  assert.equal(calls, 1);
});

test("persisted active state is recovered as a valid resumable state", async () => {
  const [{ saveWorkflowState, recoverWorkflowState }, { createAdaptiveWorkflowTestStore }, { createAdaptiveWorkflowStateMachine, AdaptiveWorkflowEvents }] = await modules();
  const clock = () => "2026-07-13T00:00:00.000Z";
  const machine = createAdaptiveWorkflowStateMachine({ runId: "recover_run", clock });
  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "recover" });
  const store = createAdaptiveWorkflowTestStore();
  await saveWorkflowState(store, machine.view().context);
  const recovered = await recoverWorkflowState(store, "recover_run");
  assert.equal(recovered.phase, "plan");
  createAdaptiveWorkflowStateMachine({ initialContext: recovered, clock }).advance(AdaptiveWorkflowEvents.RECOVER);
  const { runAdaptiveWorkflow } = await import("../../packages/runtime/src/adaptive-workflow/runner.js");
  const capability = { schemaVersion: 1, providerId: "fixture", modelId: "fixture", source: "declared", providerContextWindowTokens: 128000, contextWindowTokens: 128000, maxOutputTokens: 1000, supports: { textGeneration: true, structuredOutput: true, streaming: false } };
  const result = await runAdaptiveWorkflow({ objective: "recover", runId: "recover_run", resumeState: recovered, declaredCapability: capability, ports: { model: { generate: async () => ({ response: JSON.stringify({ rooms: [{ id: "r1" }] }) }) }, validator: [{ id: "valid", version: 1, validate: () => ({ ok: true }) }], persistence: store, clock } });
  assert.equal(result.outcome, "complete");
  assert.equal(result.events.some((event) => event.kind === "recovery"), true);
});

test("recovery continues from every active phase without regenerating validated candidates", async () => {
  const [{ createAdaptiveWorkflowTestStore }, { createAdaptiveWorkflowStateMachine, AdaptiveWorkflowEvents }] = await Promise.all([
    import("../../packages/adapters-test/src/adapters/adaptive-workflow/store.js"),
    import("../../packages/runtime/src/adaptive-workflow/state-machine.js"),
  ]);
  const { runAdaptiveWorkflow } = await import("../../packages/runtime/src/adaptive-workflow/runner.js");
  const capability = { schemaVersion: 1, providerId: "fixture", modelId: "fixture", source: "declared", providerContextWindowTokens: 128000, contextWindowTokens: 128000, maxOutputTokens: 1000, supports: { textGeneration: true, structuredOutput: true, streaming: false } };
  const candidate = { rooms: [{ id: "persisted" }], actors: [] };
  for (const target of ["intake", "plan", "configure", "validate", "execute", "verify", "repair", "escalate"]) {
    const runId = `resume_${target}`;
    const store = createAdaptiveWorkflowTestStore();
    const contentRef = await store.putContent(candidate);
    const machine = createAdaptiveWorkflowStateMachine({ runId, clock: () => "2026-07-13T00:00:00.000Z" });
    if (target !== "intake") machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "recover" });
    if (!["intake", "plan"].includes(target)) machine.advance(AdaptiveWorkflowEvents.PLAN_READY, { planRef: { id: "plan", schema: "agent-kernel/AdaptiveWorkflowPlan", schemaVersion: 1, contentRef } });
    if (!["intake", "plan", "configure"].includes(target)) machine.advance(AdaptiveWorkflowEvents.CONFIGURATION_READY, { configurationRef: { id: "configuration", schema: "agent-kernel/AdaptiveWorkflowConfiguration", schemaVersion: 1, contentRef } });
    if (["execute", "verify"].includes(target)) machine.advance(AdaptiveWorkflowEvents.VALIDATION_PASSED, { validationResult: { outcome: "passed" } });
    if (target === "verify") machine.advance(AdaptiveWorkflowEvents.EXECUTION_SUCCEEDED);
    if (["repair", "escalate"].includes(target)) machine.advance(AdaptiveWorkflowEvents.VALIDATION_FAILED, { validationResult: { outcome: "failed" } });
    if (target === "escalate") machine.advance(AdaptiveWorkflowEvents.ESCALATE);
    let modelCalls = 0;
    const result = await runAdaptiveWorkflow({ objective: "recover", runId, resumeState: machine.view().context, declaredCapability: capability, ports: { model: { generate: async () => { modelCalls += 1; return { response: JSON.stringify(candidate) }; } }, validator: [{ id: "valid", version: 1, validate: () => ({ ok: true }) }], persistence: store, clock: () => "2026-07-13T00:00:00.000Z" } });
    assert.equal(result.outcome, "complete", target);
    assert.equal(result.events.some((event) => event.kind === "recovery"), true, target);
    assert.equal(modelCalls, ["configure", "validate", "execute", "verify"].includes(target) ? 0 : 1, target);
  }
});

test("recovery preserves the recorded strategy when current capabilities change", async () => {
  const [{ runAdaptiveWorkflow }, { createAdaptiveWorkflowTestStore }] = await Promise.all([
    import("../../packages/runtime/src/adaptive-workflow/runner.js"),
    import("../../packages/adapters-test/src/adapters/adaptive-workflow/store.js"),
  ]);
  const store = createAdaptiveWorkflowTestStore();
  const capability = { schemaVersion: 1, providerId: "fixture", modelId: "fixture", source: "declared", providerContextWindowTokens: 128000, contextWindowTokens: 128000, maxOutputTokens: 1000, supports: { textGeneration: true, structuredOutput: true, streaming: false } };
  const interruptedStore = { ...store, save: async (runId, state) => { await store.save(runId, state); throw new Error("interrupt"); } };
  const common = { objective: "recover strategy", runId: "resume_strategy", ports: { model: { generate: async () => ({ response: JSON.stringify({ rooms: [{ id: "r1" }] }) }) }, validator: [{ id: "valid", version: 1, validate: () => ({ ok: true }) }], clock: () => "2026-07-13T00:00:00.000Z" } };
  await assert.rejects(() => runAdaptiveWorkflow({ ...common, declaredCapability: capability, ports: { ...common.ports, persistence: interruptedStore } }), /interrupt/);
  const resumed = await runAdaptiveWorkflow({ ...common, resumeState: await store.load("resume_strategy"), declaredCapability: { ...capability, supports: { ...capability.supports, structuredOutput: false } }, ports: { ...common.ports, persistence: store } });
  assert.equal(resumed.outcome, "complete");
  assert.equal(resumed.selectedStrategy.strategyId, "flagship_full_context_v1");
});

test("provided durable ports require the complete callable contract", async () => {
  const { createAdaptiveWorkflowPorts } = await import("../../packages/runtime/src/adaptive-workflow/ports.js");
  const base = { model: { generate() {} }, validator: [{ id: "valid", version: 1, validate: () => ({ ok: true }) }], clock: () => "2026-07-13T00:00:00.000Z" };
  assert.throws(() => createAdaptiveWorkflowPorts({ ...base, persistence: { save() {} } }), /load must be a function/i);
});

test("runner cancellation and timeout preserve terminal taxonomy", async () => {
  const { runAdaptiveWorkflow } = await import("../../packages/runtime/src/adaptive-workflow/runner.js");
  const capability = { schemaVersion: 1, providerId: "fixture", modelId: "fixture", source: "declared", providerContextWindowTokens: 128000, contextWindowTokens: 128000, maxOutputTokens: 1000, supports: { textGeneration: true, structuredOutput: true, streaming: false } };
  const validator = [{ id: "valid", version: 1, validate: () => ({ ok: true }) }];
  const clock = () => "2026-07-13T00:00:00.000Z";
  let modelCalls = 0;
  const cancelled = await runAdaptiveWorkflow({ objective: "cancel", runId: "cancel_run", cancelRequested: true, declaredCapability: capability, ports: { model: { generate: async () => { modelCalls += 1; } }, validator, clock } });
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.state.phase, "cancelled");
  assert.equal(cancelled.failure.category, "cancellation");
  assert.equal(cancelled.events.at(-1).kind, "cancellation");
  assert.equal(cancelled.events.at(-1).details.acknowledged, true);
  assert.equal(modelCalls, 0);
  const timeoutError = Object.assign(new Error("timeout"), { name: "TimeoutError" });
  const timedOut = await runAdaptiveWorkflow({ objective: "timeout", runId: "timeout_run", declaredCapability: capability, ports: { model: { generate: async () => { throw timeoutError; } }, validator, clock } });
  assert.equal(timedOut.state.phase, "failed");
  assert.equal(timedOut.failure.category, "model_transport");
  assert.equal(timedOut.events.at(-1).kind, "timeout");
});

test("cancellation is terminal from every active workflow phase", async () => {
  const { createAdaptiveWorkflowStateMachine, AdaptiveWorkflowEvents } = await import("../../packages/runtime/src/adaptive-workflow/state-machine.js");
  const clock = () => "2026-07-13T00:00:00.000Z";
  const seed = createAdaptiveWorkflowStateMachine({ runId: "cancel_phases", clock }).view().context;
  for (const phase of ["intake", "plan", "configure", "validate", "execute", "verify", "repair", "escalate"]) {
    const result = createAdaptiveWorkflowStateMachine({ initialContext: { ...seed, phase }, clock }).advance(AdaptiveWorkflowEvents.CANCEL, { reason: "stop" });
    assert.equal(result.phase, "cancelled", phase);
    assert.equal(result.event.kind, "cancellation", phase);
  }
});

test("runner records the prior side-effect receipt without executing twice", async () => {
  const [{ runAdaptiveWorkflow }, { createAdaptiveWorkflowTestStore }] = await Promise.all([
    import("../../packages/runtime/src/adaptive-workflow/runner.js"),
    import("../../packages/adapters-test/src/adapters/adaptive-workflow/store.js"),
  ]);
  const store = createAdaptiveWorkflowTestStore();
  const capability = { schemaVersion: 1, providerId: "fixture", modelId: "fixture", source: "declared", providerContextWindowTokens: 128000, contextWindowTokens: 128000, maxOutputTokens: 1000, supports: { textGeneration: true, structuredOutput: true, streaming: false } };
  const generated = { rooms: [{ id: "r1" }], actors: [] };
  let executions = 0;
  const run = () => runAdaptiveWorkflow({ objective: "execute", runId: "side_effect_run", idempotencyKey: "mcp:request:1", declaredCapability: capability, ports: { model: { generate: async () => ({ response: JSON.stringify(generated) }) }, validator: [{ id: "valid", version: 1, validate: () => ({ ok: true }) }], execution: { run: async () => ({ execution: ++executions }) }, persistence: store, clock: () => "2026-07-13T00:00:00.000Z" } });
  const first = await run();
  const duplicate = await run();
  assert.equal(executions, 1);
  assert.equal(duplicate.events.find((event) => event.kind === "side_effect").details.duplicate, true);
  assert.deepEqual(duplicate.events.find((event) => event.kind === "side_effect").details.receipt, { execution: 1 });
  assert.deepEqual(first.events.find((event) => event.kind === "side_effect").details.receipt, { execution: 1 });
});

// ## TODO: Test Permutations
// - duplicate idempotency key with a different payload must remain a conflict after recovery
// - cancellation while a side effect is pending should not publish a receipt

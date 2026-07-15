const assert = require("node:assert/strict");

const OK_SUMMARY = { rooms: [{ id: "r1" }], actors: [{ id: "a1" }] };
const COMPLETE_SPOOF = { complete: true, rooms: [], actors: [] };
const capability = {
  schemaVersion: 1,
  providerId: "fixture",
  modelId: "fixture",
  source: "declared",
  providerContextWindowTokens: 128000,
  contextWindowTokens: 128000,
  maxOutputTokens: 4096,
  supports: { textGeneration: true, structuredOutput: true, streaming: false },
};

function clock() {
  let i = 0;
  return () => `2026-07-12T00:00:${String(++i).padStart(2, "0")}.000Z`;
}

function model(responses, calls = []) {
  return {
    async generate(request) {
      calls.push(request);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next || { response: "" };
    },
  };
}

function validator(okAfter = 1) {
  let calls = 0;
  return {
    calls: () => calls,
    id: "fixture-validator",
    version: 1,
    validate(value) {
      calls += 1;
      const ok = calls >= okAfter && Boolean(value?.rooms?.length);
      return ok ? { ok: true } : { ok: false, issues: [{ code: "domain_invalid", message: "not valid" }] };
    },
  };
}

async function loadRunner() { return import("../../packages/runtime/src/adaptive-workflow/runner.js"); }

test("flagship fixture path reaches complete only after validator success", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  await assert.rejects(() => runAdaptiveWorkflow({ objective: "unguarded", declaredCapability: capability, ports: { model: model([{ response: JSON.stringify(OK_SUMMARY) }]), clock: clock() } }), /validator/i);
  const v = validator(1);
  const result = await runAdaptiveWorkflow({
    objective: "build flagship",
    runId: "run_flagship",
    declaredCapability: capability,
    ports: { model: model([{ response: JSON.stringify(OK_SUMMARY) }]), validator: [v], clock: clock() },
  });

  assert.equal(result.outcome, "complete");
  assert.equal(result.state.phase, "complete");
  assert.equal(result.selectedStrategy.strategyId, "flagship_full_context_v1");
  assert.deepEqual(result.state.selectedStrategyRef, result.selectedStrategy.selectedStrategyRef);
  assert.equal(v.calls(), 2);
  assert.deepEqual(result.events.map((event) => event.phase), ["plan", "configure", "validate", "execute", "verify", "complete"]);
  assert.equal(result.validation.outcome, "passed");
  assert.equal(result.captures.length, 1);
});

test("local sectional repair path delegates to budget loop and records phase captures", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  const calls = [];
  const result = await runAdaptiveWorkflow({
    objective: "build sectional",
    runId: "run_sectional",
    declaredCapability: { ...capability, contextWindowTokens: 24000, supports: { ...capability.supports, structuredOutput: false } },
    budgetTokens: 320,
    catalog: { schema: "agent-kernel/PoolCatalog", schemaVersion: 1, entries: [] },
    ports: {
      model: model([
        { response: JSON.stringify({ phase: "layout_only", layout: { floorTiles: 1, hallwayTiles: 0 }, missing: [] }) },
      ], calls),
      validator: [{ ...validator(1), validate: () => ({ ok: true }) }],
      clock: clock(),
    },
  });

  assert.equal(result.outcome, "complete");
  assert.equal(result.selectedStrategy.strategyId, "local_sectional_repair_v1");
  assert.equal(result.captures.length, 1);
  assert.equal(result.captures[0].payload.phase, "layout_only");
  assert.equal(calls.length, 1);
});

test("model complete text cannot complete when validation fails", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  const result = await runAdaptiveWorkflow({
    objective: "spoof complete",
    runId: "run_spoof",
    maxModelAttempts: 1,
    declaredCapability: capability,
    ports: { model: model([{ response: JSON.stringify(COMPLETE_SPOOF) }]), validator: [validator(99)], clock: clock() },
  });

  assert.equal(result.outcome, "failed");
  assert.equal(result.state.phase, "failed");
  assert.equal(result.failure.category, "validation");
  assert.notEqual(result.state.phase, "complete");
});

test("retry exhaustion budget exhaustion and timeout are classified", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  const retry = await runAdaptiveWorkflow({
    objective: "retry",
    runId: "run_retry",
    maxModelAttempts: 2,
    declaredCapability: capability,
    ports: { model: model([{ response: JSON.stringify(COMPLETE_SPOOF) }, { response: JSON.stringify({ ...COMPLETE_SPOOF, rooms: [{ id: "r2" }] }) }]), validator: [validator(99)], clock: clock() },
  });
  assert.equal(retry.failure.code, "retry_exhausted");
  assert.equal(retry.failure.category, "validation");

  const budget = await runAdaptiveWorkflow({
    objective: "budget",
    runId: "run_budget",
    budgetTokens: 0,
    declaredCapability: { ...capability, contextWindowTokens: 24000, supports: { ...capability.supports, structuredOutput: false } },
    ports: { model: model([]), validator: [validator()], clock: clock() },
  });
  assert.equal(budget.failure.category, "budget_exhaustion");

  const err = new Error("model timeout");
  err.name = "TimeoutError";
  const timeout = await runAdaptiveWorkflow({
    objective: "timeout",
    runId: "run_timeout",
    declaredCapability: capability,
    ports: { model: model([err]), validator: [validator()], clock: clock() },
  });
  assert.equal(timeout.failure.category, "model_transport");
  assert.equal(timeout.failure.code, "timeout");
});
test("run state validates and verification failure is classified without replaying plan transitions", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  const { validateAdaptiveWorkflowRunState } = await import("../../packages/runtime/src/adaptive-workflow/contracts.ts");
  const result = await runAdaptiveWorkflow({
    objective: "verify fails",
    runId: "run_verify_fail",
    declaredCapability: capability,
    ports: {
      model: model([{ response: JSON.stringify(OK_SUMMARY) }]),
      validator: [{ id: "verify-validator", version: 1, validate: (_value, context) => (context.stage === "verify" ? { ok: false, issues: [{ code: "verification_failed", message: "bad verify" }] } : { ok: true }) }],
      clock: clock(),
    },
  });
  assert.equal(validateAdaptiveWorkflowRunState(result.state).ok, true);
  assert.equal(result.failure.category, "validation");
  assert.equal(result.events.at(-2).phase, "repair");
});
test("artifact store and execution port exceptions are classified", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  const base = () => ({ objective: "ports throw", declaredCapability: capability, ports: { model: model([{ response: JSON.stringify(OK_SUMMARY) }]), validator: [validator(1)], clock: clock() } });
  const [storeBase, execBase] = [base(), base()];
  const stored = await runAdaptiveWorkflow({ ...storeBase, runId: "run_store_fail", ports: { ...storeBase.ports, artifactStore: { put: async () => { const error = new Error("write failed"); error.code = "write_failed"; throw error; } } } });
  assert.equal(stored.failure.category, "persistence");
  const executed = await runAdaptiveWorkflow({ ...execBase, runId: "run_execute_fail", ports: { ...execBase.ports, execution: { run: async () => { throw Object.assign(new Error("command failed"), { code: "command_failed" }); } } } });
  assert.equal(executed.failure.category, "execution");
});
test("missing model adapter is rejected before any workflow state is created", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  await assert.rejects(
    () => runAdaptiveWorkflow({ objective: "no model", runId: "run_no_model", declaredCapability: capability, ports: { validator: [validator(1)], clock: clock() } }),
    /model\.generate is required/,
  );
});

test("empty model response fails without spoofing completion", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  const result = await runAdaptiveWorkflow({
    objective: "empty response",
    runId: "run_empty",
    maxModelAttempts: 1,
    declaredCapability: capability,
    ports: { model: model([{ response: "" }]), validator: [validator(1)], clock: clock() },
  });
  assert.equal(result.outcome, "failed");
  assert.notEqual(result.state.phase, "complete");
});

test("repeated validator failure across attempts exhausts retries in the validation taxonomy", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  const result = await runAdaptiveWorkflow({
    objective: "always invalid",
    runId: "run_repeat_invalid",
    maxModelAttempts: 2,
    declaredCapability: capability,
    ports: {
      model: model([
        { response: JSON.stringify({ rooms: [{ id: "r1" }], actors: [] }) },
        { response: JSON.stringify({ rooms: [{ id: "r2" }], actors: [] }) },
      ]),
      validator: [{ id: "always-fail", version: 1, validate: () => ({ ok: false, issues: [{ code: "domain_invalid", path: "/rooms" }] }) }],
      clock: clock(),
    },
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.failure.category, "validation");
  assert.ok(["retry_exhausted", "oscillation_detected"].includes(result.failure.code), result.failure.code);
});

// ## TODO: Test Permutations (expanded in M11)
// - missing adapter -> covered by "missing model adapter is rejected ..."
// - empty model response -> covered by "empty model response fails without spoofing completion"
// - repeated validator failure -> covered by "repeated validator failure across attempts ..."
// - completion spoofing -> covered by "model complete text cannot complete when validation fails"

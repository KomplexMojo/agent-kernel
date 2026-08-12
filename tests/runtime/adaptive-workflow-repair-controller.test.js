const assert = require("node:assert/strict");
const basic = require("../fixtures/adaptive-workflow/patch-request-v1-basic.json");
const immutable = require("../fixtures/artifacts/invalid/adaptive-workflow-patch-v1-immutable-path.json");

const capability = {
  schemaVersion: 1, providerId: "fixture", modelId: "fixture", source: "declared",
  providerContextWindowTokens: 128000, contextWindowTokens: 128000, maxOutputTokens: 4096,
  supports: { textGeneration: true, structuredOutput: true, streaming: false },
};

function clock() { let i = 0; return () => `2026-07-13T00:00:${String(++i).padStart(2, "0")}.000Z`; }

test("repair actions are deterministic across syntax schema domain and escalation failures", async () => {
  const { chooseRepairAction } = await import("../../packages/runtime/src/adaptive-workflow/repair-controller.js");
  const { AdaptiveWorkflowEvents, createAdaptiveWorkflowStateMachine } = await import("../../packages/runtime/src/adaptive-workflow/state-machine.js");
  assert.equal(chooseRepairAction({ issue: { code: "normalization_available" } }).action, "normalize");
  assert.equal(chooseRepairAction({ issue: { code: "invalid_json", stage: "syntax" } }).action, "syntax_repair");
  assert.equal(chooseRepairAction({ issue: { code: "schema_invalid", stage: "schema" } }).action, "targeted_patch");
  assert.equal(chooseRepairAction({ issue: { code: "domain_invalid", stage: "domain" }, section: "actors" }).action, "section_regeneration");
  assert.equal(chooseRepairAction({ issue: { code: "domain_invalid" }, attempt: 2 }).action, "complete_regeneration");
  assert.equal(chooseRepairAction({ history: ["a", "b", "a", "b"], canAlternateModel: true }).action, "alternate_model");
  assert.equal(chooseRepairAction({ history: ["a", "b", "a", "b"], canFlagship: true }).action, "flagship_escalation");
  assert.equal(chooseRepairAction({ history: ["a", "b", "a", "b"] }).action, "fail");
  const machine = createAdaptiveWorkflowStateMachine({ runId: "repair-guard", clock: clock() });
  const ref = { id: "candidate", schema: "agent-kernel/Candidate", schemaVersion: 1 };
  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "guard repair evidence" });
  machine.advance(AdaptiveWorkflowEvents.PLAN_READY, { planRef: ref });
  machine.advance(AdaptiveWorkflowEvents.CONFIGURATION_READY, { configurationRef: ref });
  machine.advance(AdaptiveWorkflowEvents.VALIDATION_FAILED, { validationResult: { outcome: "failed" } });
  assert.throws(() => machine.advance(AdaptiveWorkflowEvents.REPAIR_APPLIED, { configurationRef: ref, details: { repairAction: "bogus" } }), /Guard/u);
  assert.throws(() => machine.advance(AdaptiveWorkflowEvents.REPAIR_APPLIED, { details: { repairAction: "complete_regeneration" } }), /Guard/u);
});

test("patch contract rejects immutable overlap root and prototype paths and never mutates input", async () => {
  const { applyPatchRequest, validatePatchRequest } = await import("../../packages/runtime/src/adaptive-workflow/patch-contract.js");
  const source = { rooms: [{ count: 1 }], labels: { "a/b": { "~key": 1 } }, meta: { id: "m1" } };
  const applied = applyPatchRequest(source, {
    ...basic,
    operations: [...basic.operations, { op: "replace", path: "/labels/a~1b/~0key", value: 2 }],
  });
  assert.equal(applied.value.rooms[0].count, 2);
  assert.equal(applied.value.labels["a/b"]["~key"], 2);
  assert.equal(applyPatchRequest({ "": 1 }, { ...basic, operations: [{ op: "replace", path: "/", value: 2 }] }).value[""], 2);
  assert.equal(source.rooms[0].count, 1);
  assert.deepEqual(applied.changedPaths, ["/rooms/0/count", "/labels/a~1b/~0key"]);
  const aliased = { ...basic, operations: [{ op: "add", path: "/rooms/0/details", value: { size: 2 } }] };
  const aliasResult = applyPatchRequest(source, aliased);
  aliased.operations[0].value.size = 99;
  assert.equal(aliasResult.value.rooms[0].details.size, 2);
  assert.equal(validatePatchRequest(immutable).issues[0].code, "immutable_path");
  for (const path of ["/meta/id/value", "", "/__proto__/polluted", "/items/constructor/x"]) {
    assert.equal(validatePatchRequest({ ...basic, operations: [{ op: "replace", path, value: 1 }] }).ok, false);
  }
  assert.equal(validatePatchRequest({ ...basic, targetRef: undefined, reason: undefined, affectedValidators: undefined }).ok, false);
  assert.equal(validatePatchRequest({ ...basic, meta: { ...basic.meta, id: "other" } }).ok, false);
  assert.equal(validatePatchRequest({ ...basic, phase: "plan" }).ok, false);
  assert.equal(validatePatchRequest({ ...basic, immutablePaths: ["not-a-pointer"] }).ok, false);
  assert.equal(validatePatchRequest({ ...basic, operations: [{ op: "copy", path: "/rooms/0/count" }] }).ok, false);
  assert.equal(validatePatchRequest({ ...basic, operations: [{ op: "replace", path: "/rooms/0/count" }] }).ok, false);
  assert.doesNotThrow(() => validatePatchRequest({ ...basic, kind: "syntax_repair", operations: undefined }));
  assert.throws(() => applyPatchRequest({ asset: { algorithm: "sha256", digest: "abc" } }, { ...basic, operations: [{ op: "replace", path: "/asset/digest", value: "def" }] }), /immutable/i);
  assert.throws(() => applyPatchRequest({ rooms: [0, 1] }, { ...basic, operations: [{ op: "replace", path: "/rooms/01", value: 2 }] }), /index/i);
  assert.throws(() => applyPatchRequest({ rooms: [] }, { ...basic, operations: [{ op: "remove", path: "/rooms/0" }] }), /index/i);
  assert.throws(() => applyPatchRequest({ container: { asset: { algorithm: "sha256", digest: "abc" } } }, { ...basic, operations: [{ op: "replace", path: "/container", value: {} }] }), /immutable/i);
  assert.throws(() => applyPatchRequest({ container: { resultRef: { id: "result", schema: "agent-kernel/Result", schemaVersion: 1 } } }, { ...basic, operations: [{ op: "replace", path: "/container", value: {} }] }), /immutable/i);
});

test("accepted patch reruns every affected validator and records a receipt", async () => {
  const { applyRepairPatch } = await import("../../packages/runtime/src/adaptive-workflow/repair-controller.js");
  const { validateAdaptiveWorkflowPatchReceipt } = await import("../../packages/runtime/src/adaptive-workflow/contracts.ts");
  const calls = [];
  const registry = [
    { id: "rooms", paths: ["/rooms"], validate: (value) => { calls.push("rooms"); return { ok: value.rooms[0].count === 2 }; } },
    { id: "actors", paths: ["/actors"], validate: () => { calls.push("actors"); return { ok: true }; } },
    { id: "global", paths: [], validate: () => { calls.push("global"); return { ok: true }; } },
  ];
  const result = applyRepairPatch({ input: { rooms: [{ count: 1 }], actors: [] }, patchRequest: basic, registry, receiptId: "receipt-1" });
  assert.equal(result.validation.ok, true);
  assert.deepEqual(calls, ["global", "rooms"]);
  assert.equal(result.receipt.accepted, true);
  assert.match(result.receipt.meta.createdAt, /^\d{4}-/u);
  assert.deepEqual(result.receipt.rerunValidatorIds, ["global", "rooms"]);
  assert.equal(validateAdaptiveWorkflowPatchReceipt(result.receipt).ok, true);
  assert.throws(() => applyRepairPatch({ input: { rooms: [{ count: 1 }] }, patchRequest: basic, registry, expectedTargetRef: { ...basic.targetRef, id: "other" } }), /targetRef/u);
});

test("regeneration replaces invalid candidate refs before validation succeeds", async () => {
  const { runAdaptiveWorkflow } = await import("../../packages/runtime/src/adaptive-workflow/runner.js");
  const { validateAdaptiveWorkflowRunState } = await import("../../packages/runtime/src/adaptive-workflow/contracts.ts");
  const responses = [1, 2];
  const stored = [];
  const result = await runAdaptiveWorkflow({
    objective: "regenerate", runId: "run-regenerate", declaredCapability: capability, maxModelAttempts: 2,
    ports: {
      model: { generate: async () => ({ response: JSON.stringify({ rooms: [{ count: responses.shift() }], actors: [] }) }) },
      validator: [{ id: "rooms", paths: ["/rooms"], validate: (value) => value.rooms[0].count === 2 ? { ok: true } : { ok: false, issues: [{ code: "domain_invalid", path: "/rooms/0/count" }] } }],
      artifactStore: { put: async (artifact) => { stored.push(artifact); return { id: artifact.id, schema: artifact.schema, schemaVersion: 1 }; } },
      clock: clock(),
    },
  });
  assert.equal(result.outcome, "complete");
  const selected = stored.find(({ id }) => id === result.state.refs.configurationRef.id);
  assert.equal(selected.value.rooms[0].count, 2);
  assert.deepEqual(result.events.map(({ phase }) => phase), ["plan", "configure", "validate", "repair", "validate", "execute", "verify", "complete"]);
  assert.equal(result.state.refs.patchReceiptRefs.length, 0);
  assert.equal(validateAdaptiveWorkflowRunState(result.state).ok, true);
});

test("runner stops repeated candidates with an oscillation taxonomy failure", async () => {
  const { runAdaptiveWorkflow } = await import("../../packages/runtime/src/adaptive-workflow/runner.js");
  const { validateAdaptiveWorkflowRunState } = await import("../../packages/runtime/src/adaptive-workflow/contracts.ts");
  let modelCalls = 0;
  const result = await runAdaptiveWorkflow({
    objective: "detect convergence stall", runId: "run-oscillation", declaredCapability: capability, maxModelAttempts: 2,
    ports: {
      model: { generate: async () => { modelCalls += 1; return { response: JSON.stringify({ rooms: [{ count: 1 }], actors: [] }) }; } },
      validator: [{ id: "rooms", paths: ["/rooms"], validate: () => ({ ok: false, issues: [{ code: "domain_invalid", path: "/rooms/0/count" }] }) }],
      clock: clock(),
    },
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.failure.code, "oscillation_detected");
  assert.equal(result.failure.category, "validation");
  assert.equal(modelCalls, 2);
  assert.equal(validateAdaptiveWorkflowRunState(result.state).ok, true);
});

test("runner applies targeted patch with validate repair validate transitions", async () => {
  const { runAdaptiveWorkflow } = await import("../../packages/runtime/src/adaptive-workflow/runner.js");
  let modelCalls = 0;
  const validatorCalls = [];
  const patchStored = [];
  const result = await runAdaptiveWorkflow({
    objective: "repair room", runId: "run-repair", declaredCapability: capability, repairRequests: [basic],
    ports: {
      model: { generate: async () => { modelCalls += 1; return { response: JSON.stringify({ rooms: [{ name: "bad" }], actors: [] }) }; } },
      validator: [{ id: "rooms", paths: ["/rooms"], validate: (value, context) => { validatorCalls.push(context.stage); return value.rooms[0].count === 2 ? { ok: true } : { ok: false, issues: [{ code: "domain_invalid", path: "/rooms/0/count" }] }; } }],
      artifactStore: { put: async (artifact) => { patchStored.push(artifact); return artifact.schema === "agent-kernel/AdaptiveWorkflowPatchReceipt" ? { id: artifact.id, schema: "agent-kernel/WrongReceipt" } : { id: artifact.id, schema: artifact.schema, schemaVersion: 1 }; } },
      clock: clock(),
    },
  });
  assert.equal(result.outcome, "complete");
  assert.equal(modelCalls, 1);
  assert.deepEqual(validatorCalls, ["domain", "repair", "verify"]);
  assert.deepEqual(result.events.map(({ phase }) => phase), ["plan", "configure", "validate", "repair", "validate", "execute", "verify", "complete"]);
  assert.equal(result.state.refs.patchReceiptRefs.length, 1);
  const repairEvent = result.events.find(({ kind }) => kind === "repair");
  assert.equal(repairEvent.details.patchRequest.requestId, basic.requestId);
  assert.equal(repairEvent.details.patchReceipt.accepted, true);
  const storedReceipt = patchStored.find(({ schema }) => schema === "agent-kernel/AdaptiveWorkflowPatchReceipt");
  assert.equal(storedReceipt.id, repairEvent.details.patchReceipt.meta.id);
  assert.equal(storedReceipt.value.schema, "agent-kernel/AdaptiveWorkflowPatchReceipt");
  assert.deepEqual(result.state.refs.patchReceiptRefs[0], { id: storedReceipt.id, schema: storedReceipt.schema, schemaVersion: 1 });

  const wrongRun = await runAdaptiveWorkflow({
    objective: "reject cross-run patch", runId: "run-repair", declaredCapability: capability,
    repairRequests: [{ ...basic, runId: "other-run", meta: { ...basic.meta, runId: "other-run" } }],
    ports: { model: { generate: async () => ({ response: JSON.stringify({ rooms: [{ count: 1 }], actors: [] }) }) }, validator: [{ id: "rooms", paths: ["/rooms"], validate: () => ({ ok: false, issues: [{ code: "domain_invalid", path: "/rooms" }] }) }], clock: clock() },
  });
  assert.equal(wrongRun.failure.category, "validation");
  assert.equal(wrongRun.state.refs.patchReceiptRefs.length, 0);

  const wrongTarget = await runAdaptiveWorkflow({
    objective: "reject cross-target patch", runId: "run-repair", declaredCapability: capability,
    repairRequests: [{ ...basic, targetRef: { ...basic.targetRef, id: "other" } }],
    ports: { model: { generate: async () => ({ response: JSON.stringify({ rooms: [{ count: 1 }], actors: [] }) }) }, validator: [{ id: "rooms", paths: ["/rooms"], validate: () => ({ ok: false, issues: [{ code: "domain_invalid", path: "/rooms" }] }) }], clock: clock() },
  });
  assert.equal(wrongTarget.failure.code, "patch_target_mismatch");
  assert.equal(wrongTarget.state.refs.patchReceiptRefs.length, 0);
});

test("unknown patch operations and semantic syntax repairs are rejected", async () => {
  const { validatePatchRequest } = await import("../../packages/runtime/src/adaptive-workflow/patch-contract.js");
  const unknownOp = validatePatchRequest({ ...basic, operations: [{ op: "frobnicate", path: "/rooms/0/count", value: 2 }] });
  assert.equal(unknownOp.ok, false);
  assert.ok(unknownOp.issues.some((entry) => entry.code === "invalid_operation"));
  const semanticSyntax = validatePatchRequest({ ...basic, kind: "syntax_repair" });
  assert.equal(semanticSyntax.ok, false);
  assert.ok(semanticSyntax.issues.some((entry) => entry.code === "semantic_syntax_repair"));
});

test("repeated identical patches apply idempotently to an already-repaired candidate", async () => {
  const { applyPatchRequest } = await import("../../packages/runtime/src/adaptive-workflow/patch-contract.js");
  const first = applyPatchRequest({ rooms: [{ count: 1 }] }, basic);
  const second = applyPatchRequest(first.value, basic);
  assert.equal(first.value.rooms[0].count, 2);
  assert.equal(second.value.rooms[0].count, 2);
  assert.deepEqual(second.changedPaths, first.changedPaths);
});

// ## TODO: Test Permutations (expanded in M11)
// - repeated identical patches -> covered by "repeated identical patches apply idempotently ..."
// - semantic change disguised as syntax repair -> covered by "unknown patch operations and semantic syntax repairs ..."
// - unknown patch op -> covered by "unknown patch operations and semantic syntax repairs ..."

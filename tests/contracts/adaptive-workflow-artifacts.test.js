const assert = require("node:assert/strict");

const META = {
  id: "adaptive-workflow-artifact",
  runId: "run_adaptive_workflow",
  createdAt: "2026-07-12T00:00:00.000Z",
  producedBy: "test",
};

function ref(id, schema = "agent-kernel/TestArtifact", schemaVersion = 1) {
  return { id, schema, schemaVersion };
}

function loadContracts() {
  return import("../../packages/runtime/src/adaptive-workflow/contracts.ts");
}

test("adaptive workflow contract constants export versioned artifact schemas", async () => {
  const contracts = await loadContracts();

  assert.equal(contracts.ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA, "agent-kernel/AdaptiveWorkflowRunState");
  assert.equal(contracts.ADAPTIVE_WORKFLOW_POLICY_SCHEMA, "agent-kernel/AdaptiveWorkflowPolicy");
  assert.equal(contracts.ADAPTIVE_WORKFLOW_RUNTIME_PROFILE_SCHEMA, "agent-kernel/AdaptiveWorkflowRuntimeProfile");
  assert.equal(contracts.ADAPTIVE_WORKFLOW_VALIDATION_RESULT_SCHEMA, "agent-kernel/AdaptiveWorkflowValidationResult");
  assert.equal(contracts.ADAPTIVE_WORKFLOW_FAILURE_SCHEMA, "agent-kernel/AdaptiveWorkflowFailure");
  assert.equal(contracts.ADAPTIVE_WORKFLOW_PATCH_REQUEST_SCHEMA, "agent-kernel/AdaptiveWorkflowPatchRequest");
  assert.equal(contracts.ADAPTIVE_WORKFLOW_PATCH_RECEIPT_SCHEMA, "agent-kernel/AdaptiveWorkflowPatchReceipt");
  assert.equal(contracts.ADAPTIVE_WORKFLOW_EXECUTION_EVENT_SCHEMA, "agent-kernel/AdaptiveWorkflowExecutionEvent");
  assert.equal(contracts.ADAPTIVE_WORKFLOW_RUN_RECORD_SCHEMA, "agent-kernel/AdaptiveWorkflowRunRecord");
  assert.equal(contracts.ADAPTIVE_WORKFLOW_SCHEMA_VERSION, 1);
});

test("adaptive workflow phases and failure taxonomy include M1 durable execution states", async () => {
  const {
    ADAPTIVE_WORKFLOW_FAILURE_CATEGORIES,
    ADAPTIVE_WORKFLOW_PHASES,
    ADAPTIVE_WORKFLOW_TERMINAL_PHASES,
  } = await loadContracts();

  assert.deepEqual(ADAPTIVE_WORKFLOW_PHASES, [
    "intake",
    "plan",
    "configure",
    "validate",
    "execute",
    "verify",
    "repair",
    "escalate",
    "complete",
    "failed",
    "cancelled",
  ]);
  assert.deepEqual(ADAPTIVE_WORKFLOW_TERMINAL_PHASES, ["complete", "failed", "cancelled"]);
  assert.deepEqual(ADAPTIVE_WORKFLOW_FAILURE_CATEGORIES, [
    "model_transport",
    "model_contract",
    "validation",
    "execution",
    "infrastructure",
    "persistence",
    "cancellation",
    "budget_exhaustion",
  ]);
});

test("adaptive workflow validation result is machine-readable", async () => {
  const { ADAPTIVE_WORKFLOW_VALIDATION_RESULT_SCHEMA, validateAdaptiveWorkflowValidationResult } = await loadContracts();
  const artifact = {
    schema: ADAPTIVE_WORKFLOW_VALIDATION_RESULT_SCHEMA,
    schemaVersion: 1,
    meta: META,
    validatorId: "schema",
    validatorVersion: "1",
    stage: "validate",
    outcome: "failed",
    issues: [
      {
        code: "missing_field",
        message: "configurationRef is required",
        severity: "error",
        path: "/refs/configurationRef",
      },
    ],
    checkedRefs: [ref("config")],
    affectedPaths: ["/refs/configurationRef"],
  };

  const result = validateAdaptiveWorkflowValidationResult(artifact);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.issues, []);
});

test("adaptive workflow policy records versioning, timeout, cancellation, replay, and duplicate-side-effect semantics", async () => {
  const { ADAPTIVE_WORKFLOW_IMMUTABLE_PATCH_PATHS, ADAPTIVE_WORKFLOW_POLICY_SCHEMA, validateAdaptiveWorkflowPolicy } =
    await loadContracts();
  const artifact = {
    schema: ADAPTIVE_WORKFLOW_POLICY_SCHEMA,
    schemaVersion: 1,
    meta: META,
    policyVersion: "adaptive-workflow-policy-v1",
    maxRetries: {
      modelTransport: 2,
      modelContract: 1,
      validation: 2,
      execution: 1,
      persistence: 1,
    },
    timeoutMs: {
      model: 30000,
      validation: 5000,
      execution: 60000,
      persistence: 5000,
    },
    duplicateSideEffectPolicy: "return_existing",
    replay: {
      requireRecordedModelResponses: true,
      requirePromptHashes: true,
    },
    cancellation: {
      terminalPhase: "cancelled",
    },
    immutablePatchPaths: ADAPTIVE_WORKFLOW_IMMUTABLE_PATCH_PATHS,
  };

  const result = validateAdaptiveWorkflowPolicy(artifact);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("adaptive workflow state records state version, refs, replay responses, cancellation, and idempotency keys", async () => {
  const { ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA, validateAdaptiveWorkflowRunState } = await loadContracts();
  const state = {
    schema: ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA,
    schemaVersion: 1,
    meta: META,
    stateVersion: "adaptive-workflow-state-v1",
    runId: "run_adaptive_workflow",
    phase: "repair",
    policyRef: ref("policy", "agent-kernel/AdaptiveWorkflowPolicy"),
    runtimeProfileRef: ref("profile", "agent-kernel/AdaptiveWorkflowRuntimeProfile"),
    objective: {
      text: "build a deterministic dungeon",
      intakeRef: ref("intent", "agent-kernel/IntentEnvelope"),
    },
    refs: {
      planRef: ref("plan", "agent-kernel/PlanArtifact"),
      configurationRef: ref("config", "agent-kernel/SimConfigArtifact"),
      validationResultRefs: [ref("validation", "agent-kernel/AdaptiveWorkflowValidationResult")],
      failureRefs: [ref("failure", "agent-kernel/AdaptiveWorkflowFailure")],
      replayResponseRefs: [
        {
          algorithm: "sha256",
          digest: "abc123",
          bytes: 128,
          mediaType: "application/json",
        },
      ],
      patchReceiptRefs: [ref("patch", "agent-kernel/AdaptiveWorkflowPatchReceipt")],
    },
    counters: {
      modelTransportRetries: 0,
      modelContractRetries: 1,
      validationRetries: 2,
      executionRetries: 0,
      persistenceRetries: 0,
      repairAttempts: 1,
    },
    cancellation: {
      requested: false,
    },
    idempotency: {
      sideEffectKeys: ["cli:run:1"],
    },
    events: [],
    updatedAt: "2026-07-12T00:00:01.000Z",
  };

  const result = validateAdaptiveWorkflowRunState(state);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("adaptive workflow failure supports timeout classification without adding a runtime IO dependency", async () => {
  const { ADAPTIVE_WORKFLOW_FAILURE_SCHEMA, validateAdaptiveWorkflowFailure } = await loadContracts();
  const failure = {
    schema: ADAPTIVE_WORKFLOW_FAILURE_SCHEMA,
    schemaVersion: 1,
    meta: META,
    category: "infrastructure",
    code: "timeout",
    message: "execution timed out",
    retryable: true,
    phase: "execute",
    timeoutMs: 60000,
  };

  const result = validateAdaptiveWorkflowFailure(failure);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("adaptive workflow patch request and receipt require immutable paths and validator reruns", async () => {
  const {
    ADAPTIVE_WORKFLOW_IMMUTABLE_PATCH_PATHS,
    ADAPTIVE_WORKFLOW_PATCH_RECEIPT_SCHEMA,
    ADAPTIVE_WORKFLOW_PATCH_REQUEST_SCHEMA,
    validateAdaptiveWorkflowPatchReceipt,
    validateAdaptiveWorkflowPatchRequest,
  } = await loadContracts();
  const request = {
    schema: ADAPTIVE_WORKFLOW_PATCH_REQUEST_SCHEMA,
    schemaVersion: 1,
    meta: META,
    requestId: "patch_request_1",
    runId: "run_adaptive_workflow",
    phase: "repair",
    kind: "semantic_patch",
    targetRef: ref("config", "agent-kernel/SimConfigArtifact"),
    reason: {
      validationResultRef: ref("validation", "agent-kernel/AdaptiveWorkflowValidationResult"),
      summary: "repair invalid configuration field",
    },
    operations: [{ op: "replace", path: "/rooms/0/name", value: "entry" }],
    immutablePaths: ADAPTIVE_WORKFLOW_IMMUTABLE_PATCH_PATHS,
    affectedValidators: ["schema", "domain"],
  };
  const receipt = {
    schema: ADAPTIVE_WORKFLOW_PATCH_RECEIPT_SCHEMA,
    schemaVersion: 1,
    meta: { ...META, id: "patch_receipt_1" },
    requestRef: ref("patch_request_1", ADAPTIVE_WORKFLOW_PATCH_REQUEST_SCHEMA),
    accepted: true,
    appliedOperations: request.operations,
    rejectedOperations: [],
    rerunValidatorIds: ["schema", "domain"],
    resultRef: ref("config_repaired", "agent-kernel/SimConfigArtifact"),
  };

  assert.equal(validateAdaptiveWorkflowPatchRequest(request).ok, true);
  assert.equal(validateAdaptiveWorkflowPatchReceipt(receipt).ok, true);
});

test("adaptive workflow validators reject shallow nested policy and state mismatches", async () => {
  const {
    ADAPTIVE_WORKFLOW_POLICY_SCHEMA,
    ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA,
    validateAdaptiveWorkflowPolicy,
    validateAdaptiveWorkflowRunState,
  } = await loadContracts();

  const badPolicy = {
    schema: ADAPTIVE_WORKFLOW_POLICY_SCHEMA,
    schemaVersion: 1,
    meta: META,
    policyVersion: "stale-policy",
    maxRetries: {
      modelTransport: 1,
      modelContract: "1",
      validation: 1,
      execution: 1,
      persistence: 1,
    },
    timeoutMs: {
      model: 30000,
      validation: 5000,
      execution: -1,
      persistence: 5000,
    },
    duplicateSideEffectPolicy: "return_existing",
    replay: {
      requireRecordedModelResponses: "true",
      requirePromptHashes: true,
    },
    cancellation: {
      terminalPhase: "cancelled",
    },
    immutablePatchPaths: ["/schema"],
  };

  const badState = {
    schema: ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA,
    schemaVersion: 1,
    meta: { ...META, runId: "other_run" },
    stateVersion: "stale-state",
    runId: "run_adaptive_workflow",
    phase: "plan",
    policyRef: ref("policy", "agent-kernel/AdaptiveWorkflowPolicy"),
    refs: {
      validationResultRefs: [],
      failureRefs: [],
      replayResponseRefs: [],
      patchReceiptRefs: [],
    },
    counters: {
      modelTransportRetries: 0,
      modelContractRetries: 0,
      validationRetries: 0,
      executionRetries: 0,
      persistenceRetries: 0,
      repairAttempts: "1",
    },
    cancellation: {
      requested: false,
    },
    idempotency: {
      sideEffectKeys: ["cli:run:1", ""],
    },
    events: [],
    updatedAt: "2026-07-12T00:00:01.000Z",
  };

  const policyResult = validateAdaptiveWorkflowPolicy(badPolicy);
  assert.equal(policyResult.ok, false);
  assert(policyResult.issues.some((issue) => issue.code === "invalid_policy_version"));
  assert(policyResult.issues.some((issue) => issue.path === "policy.maxRetries.modelContract"));
  assert(policyResult.issues.some((issue) => issue.path === "policy.timeoutMs.execution"));
  assert(policyResult.issues.some((issue) => issue.path === "policy.replay.requireRecordedModelResponses"));
  assert(policyResult.issues.some((issue) => issue.code === "missing_immutable_path"));

  const stateResult = validateAdaptiveWorkflowRunState(badState);
  assert.equal(stateResult.ok, false);
  assert(stateResult.issues.some((issue) => issue.code === "invalid_state_version"));
  assert(stateResult.issues.some((issue) => issue.code === "run_id_mismatch"));
  assert(stateResult.issues.some((issue) => issue.path === "runState.counters.repairAttempts"));
  assert(stateResult.issues.some((issue) => issue.path === "runState.idempotency.sideEffectKeys"));
});

test("adaptive workflow execution event and run record enforce runId and meta consistency", async () => {
  const {
    ADAPTIVE_WORKFLOW_EXECUTION_EVENT_SCHEMA,
    ADAPTIVE_WORKFLOW_RUN_RECORD_SCHEMA,
    validateAdaptiveWorkflowExecutionEvent,
    validateAdaptiveWorkflowRunRecord,
  } = await loadContracts();
  const event = {
    schema: ADAPTIVE_WORKFLOW_EXECUTION_EVENT_SCHEMA,
    schemaVersion: 1,
    meta: { ...META, id: "event_meta", runId: "other_run" },
    eventId: "event_1",
    runId: "run_adaptive_workflow",
    phase: "plan",
    kind: "phase_transition",
    occurredAt: "2026-07-12T00:00:01.000Z",
  };
  const record = {
    schema: ADAPTIVE_WORKFLOW_RUN_RECORD_SCHEMA,
    schemaVersion: 1,
    meta: META,
    runId: "run_adaptive_workflow",
    stateRef: ref("state", "agent-kernel/AdaptiveWorkflowRunState"),
    policyRef: ref("policy", "agent-kernel/AdaptiveWorkflowPolicy"),
    finalPhase: "complete",
    events: [{ ...event, meta: { ...event.meta, id: "event_1", runId: "other_run" }, runId: "other_run" }],
    validationResultRefs: [],
    failureRefs: [],
  };

  const eventResult = validateAdaptiveWorkflowExecutionEvent(event);
  assert.equal(eventResult.ok, false);
  assert(eventResult.issues.some((issue) => issue.code === "run_id_mismatch"));
  assert(eventResult.issues.some((issue) => issue.code === "meta_id_mismatch"));

  const recordResult = validateAdaptiveWorkflowRunRecord(record);
  assert.equal(recordResult.ok, false);
  assert(recordResult.issues.some((issue) => issue.path.endsWith(".runId")));
});

test("adaptive workflow public contract collections are immutable and exported from runtime index", async () => {
  const contracts = await loadContracts();
  const runtime = await import("../../packages/runtime/src/index.ts");

  assert.equal(runtime.ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA, contracts.ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA);
  assert.equal(typeof runtime.validateAdaptiveWorkflowRunState, "function");
  assert.equal(typeof runtime.createAdaptiveWorkflowStateMachine, "function");
  assert(Object.isFrozen(contracts.ADAPTIVE_WORKFLOW_PHASES));
  assert(Object.isFrozen(contracts.ADAPTIVE_WORKFLOW_TERMINAL_PHASES));
  assert(Object.isFrozen(contracts.ADAPTIVE_WORKFLOW_FAILURE_CATEGORIES));
  assert(Object.isFrozen(contracts.ADAPTIVE_WORKFLOW_IMMUTABLE_PATCH_PATHS));
  assert.throws(() => contracts.ADAPTIVE_WORKFLOW_PHASES.push("mutated"), /object is not extensible|read only|not extensible/);
});

// ## TODO: Test Permutations
// - malformed state schemaVersion should fail validation
// - cancellation requested during repair should enter cancelled deterministically
// - duplicate side-effect key should not create a second execution event

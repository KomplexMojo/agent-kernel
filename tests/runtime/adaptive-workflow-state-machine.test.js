const assert = require("node:assert/strict");

function ref(id, schema = "agent-kernel/TestArtifact", schemaVersion = 1) {
  return { id, schema, schemaVersion };
}

function contentRef(digest) {
  return {
    algorithm: "sha256",
    digest,
    bytes: 64,
    mediaType: "application/json",
  };
}

function clockFactory() {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-07-12T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

async function loadMachine() {
  return import("../../packages/runtime/src/adaptive-workflow/state-machine.mts");
}

test("adaptive workflow state machine follows deterministic happy path transitions", async () => {
  const { AdaptiveWorkflowEvents, AdaptiveWorkflowPhases, createAdaptiveWorkflowStateMachine } = await loadMachine();
  const machine = createAdaptiveWorkflowStateMachine({
    runId: "run_happy",
    clock: clockFactory(),
  });

  assert.equal(machine.view().phase, AdaptiveWorkflowPhases.INTAKE);

  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "build a test dungeon" });
  machine.advance(AdaptiveWorkflowEvents.PLAN_READY, { planRef: ref("plan", "agent-kernel/PlanArtifact") });
  machine.advance(AdaptiveWorkflowEvents.CONFIGURATION_READY, {
    configurationRef: ref("config", "agent-kernel/SimConfigArtifact"),
  });
  machine.advance(AdaptiveWorkflowEvents.VALIDATION_PASSED, {
    validationResultRef: ref("validation", "agent-kernel/AdaptiveWorkflowValidationResult"),
  });
  machine.advance(AdaptiveWorkflowEvents.EXECUTION_SUCCEEDED, {
    artifactRefs: [ref("execution", "agent-kernel/ExecutionResult")],
  });
  const result = machine.advance(AdaptiveWorkflowEvents.VERIFICATION_PASSED, {
    validationResult: {
      outcome: "passed",
    },
    validationResultRef: ref("verify", "agent-kernel/AdaptiveWorkflowValidationResult"),
  });

  assert.equal(result.phase, AdaptiveWorkflowPhases.COMPLETE);
  assert.equal(result.context.objective.text, "build a test dungeon");
  assert.equal(result.context.refs.planRef.id, "plan");
  assert.equal(result.context.refs.configurationRef.id, "config");
  assert.equal(result.context.refs.validationResultRefs.length, 2);
  assert.equal(result.context.events.length, 6);
  assert.deepEqual(
    result.context.events.map((event) => event.phase),
    ["plan", "configure", "validate", "execute", "verify", "complete"],
  );
});

test("adaptive workflow state machine rejects invalid transitions and guarded completion", async () => {
  const { AdaptiveWorkflowEvents, createAdaptiveWorkflowStateMachine } = await loadMachine();
  const machine = createAdaptiveWorkflowStateMachine({ runId: "run_invalid", clock: clockFactory() });

  assert.throws(
    () => machine.advance(AdaptiveWorkflowEvents.VALIDATION_PASSED, { validationResultRef: ref("validation") }),
    /No transition/,
  );
  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "guard test" });
  assert.throws(() => machine.advance(AdaptiveWorkflowEvents.PLAN_READY, {}), /Guard blocked/);
});

test("adaptive workflow state machine records replay response refs without advancing phase", async () => {
  const { AdaptiveWorkflowEvents, AdaptiveWorkflowPhases, createAdaptiveWorkflowStateMachine } = await loadMachine();
  const machine = createAdaptiveWorkflowStateMachine({ runId: "run_replay", clock: clockFactory() });

  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "replay test" });
  const result = machine.advance(AdaptiveWorkflowEvents.RECORD_MODEL_RESPONSE, {
    responseRef: contentRef("response_digest"),
    promptHash: contentRef("prompt_digest"),
  });

  assert.equal(result.phase, AdaptiveWorkflowPhases.PLAN);
  assert.equal(result.context.refs.replayResponseRefs.length, 1);
  assert.equal(result.context.refs.replayResponseRefs[0].digest, "response_digest");
  assert.equal(result.context.events.at(-1).kind, "model_response");
});

test("adaptive workflow state machine enters cancelled deterministically from repair", async () => {
  const { AdaptiveWorkflowEvents, AdaptiveWorkflowPhases, createAdaptiveWorkflowStateMachine } = await loadMachine();
  const machine = createAdaptiveWorkflowStateMachine({ runId: "run_cancel", clock: clockFactory() });

  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "cancel test" });
  machine.advance(AdaptiveWorkflowEvents.PLAN_READY, { planRef: ref("plan") });
  machine.advance(AdaptiveWorkflowEvents.CONFIGURATION_READY, { configurationRef: ref("config") });
  machine.advance(AdaptiveWorkflowEvents.VALIDATION_FAILED, {
    validationResultRef: ref("validation", "agent-kernel/AdaptiveWorkflowValidationResult"),
  });
  const result = machine.advance(AdaptiveWorkflowEvents.CANCEL, { reason: "user requested stop" });

  assert.equal(result.phase, AdaptiveWorkflowPhases.CANCELLED);
  assert.equal(result.context.cancellation.requested, true);
  assert.equal(result.context.cancellation.reason, "user requested stop");
  assert.equal(result.context.events.at(-1).kind, "cancellation");
});

test("adaptive workflow state machine records timeout as failed with a failure ref", async () => {
  const { AdaptiveWorkflowEvents, AdaptiveWorkflowPhases, createAdaptiveWorkflowFailureRef, createAdaptiveWorkflowStateMachine } =
    await loadMachine();
  const machine = createAdaptiveWorkflowStateMachine({ runId: "run_timeout", clock: clockFactory() });

  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "timeout test" });
  const result = machine.advance(AdaptiveWorkflowEvents.TIMEOUT, {
    failureRef: createAdaptiveWorkflowFailureRef("timeout_failure"),
    details: { timeoutMs: 30000 },
  });

  assert.equal(result.phase, AdaptiveWorkflowPhases.FAILED);
  assert.equal(result.context.refs.failureRefs[0].id, "timeout_failure");
  assert.equal(result.context.events.at(-1).kind, "timeout");
});

test("adaptive workflow state machine does not duplicate side-effect events for the same idempotency key", async () => {
  const { AdaptiveWorkflowEvents, AdaptiveWorkflowPhases, createAdaptiveWorkflowStateMachine } = await loadMachine();
  const machine = createAdaptiveWorkflowStateMachine({ runId: "run_idempotent", clock: clockFactory() });

  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "idempotency test" });
  const first = machine.advance(AdaptiveWorkflowEvents.RECORD_SIDE_EFFECT, {
    idempotencyKey: "cli:execute:1",
    details: { command: "ak workflow dry-run" },
  });
  const second = machine.advance(AdaptiveWorkflowEvents.RECORD_SIDE_EFFECT, {
    idempotencyKey: "cli:execute:1",
    details: { command: "ak workflow dry-run" },
  });

  assert.equal(first.phase, AdaptiveWorkflowPhases.PLAN);
  assert.equal(second.phase, AdaptiveWorkflowPhases.PLAN);
  assert.equal(second.duplicate, true);
  assert.equal(second.context.events.length, first.context.events.length);
  assert.equal(second.context.idempotency.sideEffectKeys.length, 1);
  assert.equal(second.event.idempotencyKey, "cli:execute:1");
});

test("adaptive workflow state machine rejects invalid resumed run state", async () => {
  const { AdaptiveWorkflowEvents, createAdaptiveWorkflowStateMachine } = await loadMachine();
  const machine = createAdaptiveWorkflowStateMachine({ runId: "run_resume_invalid", clock: clockFactory() });

  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "resume validation" });
  const context = machine.view().context;

  assert.throws(
    () =>
      createAdaptiveWorkflowStateMachine({
        initialContext: { ...context, stateVersion: "stale-state" },
        clock: clockFactory(),
      }),
    /invalid stateVersion/,
  );
  assert.throws(
    () =>
      createAdaptiveWorkflowStateMachine({
        initialContext: { ...context, meta: { ...context.meta, runId: "other_run" } },
        clock: clockFactory(),
      }),
    /meta\.runId must match runId/,
  );
  assert.throws(
    () =>
      createAdaptiveWorkflowStateMachine({
        initialContext: context,
        initialPhase: "execute",
        clock: clockFactory(),
      }),
    /initialPhase must match context\.phase/,
  );
});

test("adaptive workflow state machine continues event ids after resumed event history", async () => {
  const { AdaptiveWorkflowEvents, createAdaptiveWorkflowStateMachine } = await loadMachine();
  const machine = createAdaptiveWorkflowStateMachine({ runId: "run_resume_ids", clock: clockFactory() });

  machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective: "resume ids" });
  machine.advance(AdaptiveWorkflowEvents.RECORD_SIDE_EFFECT, {
    idempotencyKey: "cli:execute:1",
    details: { command: "first" },
  });

  const context = machine.view().context;
  context.events[1] = {
    ...context.events[1],
    eventId: "run_resume_ids:event:10",
    meta: {
      ...context.events[1].meta,
      id: "run_resume_ids:event:10",
    },
  };

  const resumed = createAdaptiveWorkflowStateMachine({
    initialContext: context,
    clock: clockFactory(),
  });
  const result = resumed.advance(AdaptiveWorkflowEvents.PLAN_READY, { planRef: ref("plan") });

  assert.equal(result.event.eventId, "run_resume_ids:event:11");
  assert.equal(result.context.events.at(-1).meta.id, "run_resume_ids:event:11");
});

test("adaptive workflow transition exports are immutable", async () => {
  const { adaptiveWorkflowTerminalPhases, adaptiveWorkflowTransitions } = await loadMachine();

  assert(Object.isFrozen(adaptiveWorkflowTransitions));
  assert(Object.isFrozen(adaptiveWorkflowTerminalPhases));
  assert(Object.isFrozen(adaptiveWorkflowTransitions[0]));
  assert.throws(() => adaptiveWorkflowTransitions.push({}), /object is not extensible|read only|not extensible/);
});

// ## TODO: Test Permutations
// - malformed state schemaVersion should fail validation
// - cancellation requested during repair should enter cancelled deterministically
// - duplicate side-effect key should not create a second execution event

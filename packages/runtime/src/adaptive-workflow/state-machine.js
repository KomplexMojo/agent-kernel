export const AdaptiveWorkflowPhases = Object.freeze({
  INTAKE: "intake",
  PLAN: "plan",
  CONFIGURE: "configure",
  VALIDATE: "validate",
  EXECUTE: "execute",
  VERIFY: "verify",
  REPAIR: "repair",
  ESCALATE: "escalate",
  COMPLETE: "complete",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const AdaptiveWorkflowEvents = Object.freeze({
  SUBMIT_OBJECTIVE: "submit_objective",
  PLAN_READY: "plan_ready",
  CONFIGURATION_READY: "configuration_ready",
  VALIDATION_PASSED: "validation_passed",
  VALIDATION_FAILED: "validation_failed",
  EXECUTION_SUCCEEDED: "execution_succeeded",
  EXECUTION_FAILED: "execution_failed",
  VERIFICATION_PASSED: "verification_passed",
  VERIFICATION_FAILED: "verification_failed",
  REPAIR_APPLIED: "repair_applied",
  ESCALATE: "escalate",
  ESCALATION_RESOLVED: "escalation_resolved",
  FAIL: "fail",
  CANCEL: "cancel",
  TIMEOUT: "timeout",
  RECOVER: "recover",
  RECORD_MODEL_RESPONSE: "record_model_response",
  RECORD_SIDE_EFFECT: "record_side_effect",
});

const RUN_STATE_SCHEMA = "agent-kernel/AdaptiveWorkflowRunState";
const EXECUTION_EVENT_SCHEMA = "agent-kernel/AdaptiveWorkflowExecutionEvent";
const FAILURE_SCHEMA = "agent-kernel/AdaptiveWorkflowFailure";
const VALIDATION_RESULT_SCHEMA = "agent-kernel/AdaptiveWorkflowValidationResult";
const PATCH_RECEIPT_SCHEMA = "agent-kernel/AdaptiveWorkflowPatchReceipt";
const STATE_VERSION = "adaptive-workflow-state-v1";
const TERMINAL_PHASES = new Set([AdaptiveWorkflowPhases.COMPLETE, AdaptiveWorkflowPhases.FAILED, AdaptiveWorkflowPhases.CANCELLED]);
const ACTIVE_PHASES = Object.values(AdaptiveWorkflowPhases).filter((phase) => !TERMINAL_PHASES.has(phase));
const NON_PATCH_REPAIR_ACTIONS = new Set(["normalize", "syntax_repair", "section_regeneration", "complete_regeneration", "alternate_model", "flagship_escalation"]);

const transitions = Object.freeze([
  {
    from: AdaptiveWorkflowPhases.INTAKE,
    event: AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE,
    to: AdaptiveWorkflowPhases.PLAN,
    guard: hasObjective,
  },
  {
    from: AdaptiveWorkflowPhases.PLAN,
    event: AdaptiveWorkflowEvents.PLAN_READY,
    to: AdaptiveWorkflowPhases.CONFIGURE,
    guard: hasPlanRef,
  },
  {
    from: AdaptiveWorkflowPhases.CONFIGURE,
    event: AdaptiveWorkflowEvents.CONFIGURATION_READY,
    to: AdaptiveWorkflowPhases.VALIDATE,
    guard: hasConfigurationRef,
  },
  {
    from: AdaptiveWorkflowPhases.VALIDATE,
    event: AdaptiveWorkflowEvents.VALIDATION_PASSED,
    to: AdaptiveWorkflowPhases.EXECUTE,
    guard: hasPassedValidation,
  },
  {
    from: AdaptiveWorkflowPhases.VALIDATE,
    event: AdaptiveWorkflowEvents.VALIDATION_FAILED,
    to: AdaptiveWorkflowPhases.REPAIR,
    guard: hasValidationEvidence,
  },
  {
    from: AdaptiveWorkflowPhases.EXECUTE,
    event: AdaptiveWorkflowEvents.EXECUTION_SUCCEEDED,
    to: AdaptiveWorkflowPhases.VERIFY,
  },
  {
    from: AdaptiveWorkflowPhases.EXECUTE,
    event: AdaptiveWorkflowEvents.EXECUTION_FAILED,
    to: AdaptiveWorkflowPhases.REPAIR,
    guard: hasFailureEvidence,
  },
  {
    from: AdaptiveWorkflowPhases.VERIFY,
    event: AdaptiveWorkflowEvents.VERIFICATION_PASSED,
    to: AdaptiveWorkflowPhases.COMPLETE,
    guard: hasPassedValidation,
  },
  {
    from: AdaptiveWorkflowPhases.VERIFY,
    event: AdaptiveWorkflowEvents.VERIFICATION_FAILED,
    to: AdaptiveWorkflowPhases.REPAIR,
    guard: hasValidationEvidence,
  },
  {
    from: AdaptiveWorkflowPhases.REPAIR,
    event: AdaptiveWorkflowEvents.REPAIR_APPLIED,
    to: AdaptiveWorkflowPhases.VALIDATE,
    guard: hasRepairEvidence,
  },
  {
    from: AdaptiveWorkflowPhases.REPAIR,
    event: AdaptiveWorkflowEvents.ESCALATE,
    to: AdaptiveWorkflowPhases.ESCALATE,
  },
  {
    from: AdaptiveWorkflowPhases.ESCALATE,
    event: AdaptiveWorkflowEvents.ESCALATION_RESOLVED,
    to: AdaptiveWorkflowPhases.VALIDATE,
  },
  ...ACTIVE_PHASES.map((phase) => ({
    from: phase,
    event: AdaptiveWorkflowEvents.CANCEL,
    to: AdaptiveWorkflowPhases.CANCELLED,
  })),
  ...ACTIVE_PHASES.map((phase) => ({
    from: phase,
    event: AdaptiveWorkflowEvents.FAIL,
    to: AdaptiveWorkflowPhases.FAILED,
  })),
  ...ACTIVE_PHASES.map((phase) => ({
    from: phase,
    event: AdaptiveWorkflowEvents.TIMEOUT,
    to: AdaptiveWorkflowPhases.FAILED,
  })),
  ...ACTIVE_PHASES.map((phase) => ({
    from: phase,
    event: AdaptiveWorkflowEvents.RECOVER,
    to: phase,
  })),
  ...ACTIVE_PHASES.map((phase) => ({
    from: phase,
    event: AdaptiveWorkflowEvents.RECORD_MODEL_RESPONSE,
    to: phase,
    guard: hasResponseRef,
  })),
  ...ACTIVE_PHASES.map((phase) => ({
    from: phase,
    event: AdaptiveWorkflowEvents.RECORD_SIDE_EFFECT,
    to: phase,
    guard: hasIdempotencyKey,
  })),
].map((transition) => Object.freeze(transition)));

function hasObjective(payload = {}) {
  return typeof payload.objective === "string" && payload.objective.trim().length > 0;
}

function hasPlanRef(payload = {}) {
  return Boolean(payload.planRef);
}

function hasConfigurationRef(payload = {}) {
  return Boolean(payload.configurationRef);
}

function hasValidationEvidence(payload = {}) {
  return Boolean(payload.validationResultRef || payload.validationResult);
}

function hasFailureEvidence(payload = {}) {
  return Boolean(payload.failureRef || payload.failure);
}

function hasPassedValidation(payload = {}) {
  if (payload.validationResult && payload.validationResult.outcome !== "passed") {
    return false;
  }
  return Boolean(payload.validationResultRef || payload.validationResult);
}

function hasRepairEvidence(payload = {}) {
  return Boolean(payload.patchReceiptRef || (payload.configurationRef && NON_PATCH_REPAIR_ACTIONS.has(payload.details?.repairAction)));
}

function hasResponseRef(payload = {}) {
  return Boolean(payload.responseRef);
}

function hasIdempotencyKey(payload = {}) {
  return typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim().length > 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultArtifactRef(id, schema, schemaVersion = 1) {
  return { id, schema, schemaVersion };
}

function defaultMeta({ id, runId, now, producedBy = "adaptive-workflow" }) {
  return { id, runId, createdAt: now, producedBy };
}

function allowedEvents(phase) {
  return transitions.filter((entry) => entry.from === phase).map((entry) => entry.event);
}

function findTransition(fromPhase, event) {
  return transitions.find((entry) => entry.from === fromPhase && entry.event === event);
}

function isTerminalPhase(phase) {
  return TERMINAL_PHASES.has(phase);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertArray(value, path) {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid adaptive workflow resume context: ${path} must be an array`);
  }
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid adaptive workflow resume context: ${path} must be a non-negative integer`);
  }
}

function assertArtifactRef(value, path) {
  if (!isObject(value) || typeof value.id !== "string" || value.id.trim() === "" || typeof value.schema !== "string" || value.schema.trim() === "" || !Number.isInteger(value.schemaVersion)) {
    throw new Error(`Invalid adaptive workflow resume context: ${path} must be an artifact ref`);
  }
}

function assertResumeContext(context) {
  if (!isObject(context)) {
    throw new Error("Invalid adaptive workflow resume context: expected object");
  }
  if (context.schema !== RUN_STATE_SCHEMA || context.schemaVersion !== 1) {
    throw new Error("Invalid adaptive workflow resume context: invalid schema or schemaVersion");
  }
  if (context.stateVersion !== STATE_VERSION) {
    throw new Error("Invalid adaptive workflow resume context: invalid stateVersion");
  }
  if (typeof context.runId !== "string" || context.runId.trim() === "") {
    throw new Error("Invalid adaptive workflow resume context: runId must be a non-empty string");
  }
  if (!isObject(context.meta) || context.meta.runId !== context.runId) {
    throw new Error("Invalid adaptive workflow resume context: meta.runId must match runId");
  }
  if (!Object.values(AdaptiveWorkflowPhases).includes(context.phase)) {
    throw new Error("Invalid adaptive workflow resume context: phase is not supported");
  }
  assertArtifactRef(context.policyRef, "policyRef");
  if (context.runtimeProfileRef !== undefined) {
    assertArtifactRef(context.runtimeProfileRef, "runtimeProfileRef");
  }
  if (!isObject(context.refs)) {
    throw new Error("Invalid adaptive workflow resume context: refs must be an object");
  }
  assertArray(context.refs.validationResultRefs, "refs.validationResultRefs");
  assertArray(context.refs.failureRefs, "refs.failureRefs");
  assertArray(context.refs.replayResponseRefs, "refs.replayResponseRefs");
  assertArray(context.refs.patchReceiptRefs, "refs.patchReceiptRefs");
  if (!isObject(context.counters)) {
    throw new Error("Invalid adaptive workflow resume context: counters must be an object");
  }
  for (const key of [
    "modelTransportRetries",
    "modelContractRetries",
    "validationRetries",
    "executionRetries",
    "persistenceRetries",
    "repairAttempts",
  ]) {
    assertNonNegativeInteger(context.counters[key], `counters.${key}`);
  }
  if (!isObject(context.cancellation) || typeof context.cancellation.requested !== "boolean") {
    throw new Error("Invalid adaptive workflow resume context: cancellation.requested must be boolean");
  }
  if (!isObject(context.idempotency) || !Array.isArray(context.idempotency.sideEffectKeys) || !context.idempotency.sideEffectKeys.every((key) => typeof key === "string" && key.trim() !== "")) {
    throw new Error("Invalid adaptive workflow resume context: idempotency.sideEffectKeys must be non-empty strings");
  }
  assertArray(context.events, "events");
  for (const [index, event] of context.events.entries()) {
    if (!isObject(event) || event.schema !== EXECUTION_EVENT_SCHEMA || event.schemaVersion !== 1) {
      throw new Error(`Invalid adaptive workflow resume context: events[${index}] has invalid schema`);
    }
    if (event.runId !== context.runId || !isObject(event.meta) || event.meta.runId !== context.runId) {
      throw new Error(`Invalid adaptive workflow resume context: events[${index}] runId mismatch`);
    }
    if (event.eventId !== event.meta.id) {
      throw new Error(`Invalid adaptive workflow resume context: events[${index}] eventId/meta.id mismatch`);
    }
  }
}

function eventIndexFromEventId(runId, eventId) {
  if (typeof eventId !== "string") {
    return 0;
  }
  const prefix = `${runId}:event:`;
  if (!eventId.startsWith(prefix)) {
    return 0;
  }
  const value = Number(eventId.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function nextEventIndexFrom(context) {
  return context.events.reduce((max, event) => Math.max(max, eventIndexFromEventId(context.runId, event.eventId)), 0);
}

function makeEvent({ context, phase, kind, now, payload = {}, eventIndex }) {
  return {
    schema: EXECUTION_EVENT_SCHEMA,
    schemaVersion: 1,
    meta: defaultMeta({
      id: `${context.runId}:event:${eventIndex}`,
      runId: context.runId,
      now,
    }),
    eventId: `${context.runId}:event:${eventIndex}`,
    runId: context.runId,
    phase,
    kind,
    occurredAt: now,
    idempotencyKey: payload.idempotencyKey,
    promptHash: payload.promptHash,
    responseRef: payload.responseRef,
    artifactRefs: payload.artifactRefs,
    validationResultRef: payload.validationResultRef,
    failureRef: payload.failureRef,
    details: payload.details,
  };
}

function eventKindFor(event) {
  switch (event) {
    case AdaptiveWorkflowEvents.VALIDATION_PASSED:
    case AdaptiveWorkflowEvents.VALIDATION_FAILED:
      return "validation";
    case AdaptiveWorkflowEvents.REPAIR_APPLIED:
      return "repair";
    case AdaptiveWorkflowEvents.RECORD_MODEL_RESPONSE:
      return "model_response";
    case AdaptiveWorkflowEvents.RECORD_SIDE_EFFECT:
      return "side_effect";
    case AdaptiveWorkflowEvents.TIMEOUT:
      return "timeout";
    case AdaptiveWorkflowEvents.CANCEL:
      return "cancellation";
    case AdaptiveWorkflowEvents.RECOVER:
      return "recovery";
    default:
      return "phase_transition";
  }
}

function updateRefs(refs, payload, event) {
  const next = {
    validationResultRefs: [...refs.validationResultRefs],
    failureRefs: [...refs.failureRefs],
    replayResponseRefs: [...refs.replayResponseRefs],
    patchReceiptRefs: [...refs.patchReceiptRefs],
    planRef: refs.planRef,
    configurationRef: refs.configurationRef,
  };
  if (payload.planRef) {
    next.planRef = payload.planRef;
  }
  if (payload.configurationRef) {
    next.configurationRef = payload.configurationRef;
  }
  if (payload.validationResultRef) {
    next.validationResultRefs.push(payload.validationResultRef);
  }
  if (payload.failureRef) {
    next.failureRefs.push(payload.failureRef);
  }
  if (payload.responseRef && event === AdaptiveWorkflowEvents.RECORD_MODEL_RESPONSE) {
    next.replayResponseRefs.push(payload.responseRef);
  }
  if (payload.patchReceiptRef) {
    next.patchReceiptRefs.push(payload.patchReceiptRef);
  }
  return next;
}

function updateCounters(counters, payload, event) {
  const next = { ...counters };
  if (event === AdaptiveWorkflowEvents.VALIDATION_FAILED) {
    next.validationRetries += 1;
  }
  if (event === AdaptiveWorkflowEvents.EXECUTION_FAILED) {
    next.executionRetries += 1;
  }
  if (event === AdaptiveWorkflowEvents.REPAIR_APPLIED) {
    next.repairAttempts += 1;
  }
  if (payload.failure && payload.failure.category === "model_transport") {
    next.modelTransportRetries += 1;
  }
  if (payload.failure && payload.failure.category === "model_contract") {
    next.modelContractRetries += 1;
  }
  if (payload.failure && payload.failure.category === "persistence") {
    next.persistenceRetries += 1;
  }
  return next;
}

function initialContext({ runId, policyRef, runtimeProfileRef, clock }) {
  const now = clock();
  return {
    schema: RUN_STATE_SCHEMA,
    schemaVersion: 1,
    meta: defaultMeta({ id: `${runId}:state`, runId, now }),
    stateVersion: STATE_VERSION,
    runId,
    phase: AdaptiveWorkflowPhases.INTAKE,
    policyRef,
    runtimeProfileRef,
    selectedStrategyRef: undefined,
    objective: undefined,
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
      repairAttempts: 0,
    },
    cancellation: {
      requested: false,
    },
    idempotency: {
      sideEffectKeys: [],
    },
    events: [],
    updatedAt: now,
  };
}

export function createAdaptiveWorkflowStateMachine({
  initialPhase,
  initialContext: providedContext,
  runId = "adaptive-workflow-run",
  policyRef = defaultArtifactRef("adaptive-workflow-policy", "agent-kernel/AdaptiveWorkflowPolicy"),
  runtimeProfileRef,
  clock = () => new Date().toISOString(),
} = {}) {
  let context = providedContext ? clone(providedContext) : initialContext({ runId, policyRef, runtimeProfileRef, clock });

  if (providedContext) {
    assertResumeContext(context);
    if (initialPhase !== undefined && initialPhase !== context.phase) {
      throw new Error("Invalid adaptive workflow resume context: initialPhase must match context.phase");
    }
  }
  let phase = initialPhase ?? context.phase ?? AdaptiveWorkflowPhases.INTAKE;
  if (!Object.values(AdaptiveWorkflowPhases).includes(phase)) {
    throw new Error(`Invalid adaptive workflow initial phase: ${phase}`);
  }
  let eventIndex = providedContext ? nextEventIndexFrom(context) : 0;
  context.phase = phase;

  function view() {
    return {
      state: phase,
      phase,
      context: clone(context),
    };
  }

  function recordEvent(event, payload, nextPhase, now) {
    eventIndex += 1;
    const executionEvent = makeEvent({
      context,
      phase: nextPhase,
      kind: eventKindFor(event),
      now,
      payload,
      eventIndex,
    });
    context.events = [...context.events, executionEvent];
    return executionEvent;
  }

  function advance(event, payload = {}) {
    if (isTerminalPhase(phase)) {
      throw new Error(`No transition for terminal phase=${phase} event=${event}`);
    }

    const transition = findTransition(phase, event);
    if (!transition) {
      throw new Error(`No transition for phase=${phase} event=${event}; allowed events: ${allowedEvents(phase).join(",") || "none"}`);
    }
    if (transition.guard && !transition.guard(payload, { phase, context: view().context })) {
      throw new Error(`Guard blocked transition for phase=${phase} event=${event}`);
    }

    if (event === AdaptiveWorkflowEvents.RECORD_SIDE_EFFECT && context.idempotency.sideEffectKeys.includes(payload.idempotencyKey)) {
      const existingEvent = context.events.find((entry) => entry.idempotencyKey === payload.idempotencyKey);
      return {
        ...view(),
        duplicate: true,
        event: existingEvent ? clone(existingEvent) : undefined,
      };
    }

    const now = clock();
    const nextPhase = transition.to;
    const executionEvent = recordEvent(event, payload, nextPhase, now);

    phase = nextPhase;
    context = {
      ...context,
      phase,
      selectedStrategyRef: payload.selectedStrategyRef || payload.selectedStrategy?.selectedStrategyRef || context.selectedStrategyRef,
      objective: payload.objective ? { text: payload.objective, intakeRef: payload.intakeRef } : context.objective,
      refs: updateRefs(context.refs, payload, event),
      counters: updateCounters(context.counters, payload, event),
      cancellation:
        event === AdaptiveWorkflowEvents.CANCEL
          ? {
              requested: true,
              requestedAt: now,
              reason: payload.reason,
            }
          : context.cancellation,
      idempotency:
        event === AdaptiveWorkflowEvents.RECORD_SIDE_EFFECT
          ? {
              sideEffectKeys: [...context.idempotency.sideEffectKeys, payload.idempotencyKey],
            }
          : context.idempotency,
      events: context.events,
      updatedAt: now,
    };

    return {
      ...view(),
      duplicate: false,
      event: clone(executionEvent),
    };
  }

  return {
    advance,
    view,
  };
}

export function createAdaptiveWorkflowFailure({
  runId,
  id,
  phase,
  category,
  code,
  message,
  retryable = false,
  clock = () => new Date().toISOString(),
  timeoutMs,
}) {
  const now = clock();
  return {
    schema: FAILURE_SCHEMA,
    schemaVersion: 1,
    meta: defaultMeta({ id, runId, now }),
    category,
    code,
    message,
    retryable,
    phase,
    timeoutMs,
  };
}

export function createAdaptiveWorkflowValidationResult({
  runId,
  id,
  stage,
  outcome,
  validatorId = "adaptive-workflow",
  validatorVersion = "1",
  issues = [],
  clock = () => new Date().toISOString(),
}) {
  const now = clock();
  return {
    schema: VALIDATION_RESULT_SCHEMA,
    schemaVersion: 1,
    meta: defaultMeta({ id, runId, now }),
    validatorId,
    validatorVersion,
    stage,
    outcome,
    issues,
  };
}

export function createAdaptiveWorkflowPatchReceiptRef(id) {
  return defaultArtifactRef(id, PATCH_RECEIPT_SCHEMA);
}

export function createAdaptiveWorkflowValidationResultRef(id) {
  return defaultArtifactRef(id, VALIDATION_RESULT_SCHEMA);
}

export function createAdaptiveWorkflowFailureRef(id) {
  return defaultArtifactRef(id, FAILURE_SCHEMA);
}

export const adaptiveWorkflowTransitions = transitions;
export const adaptiveWorkflowTerminalPhases = Object.freeze(Array.from(TERMINAL_PHASES));

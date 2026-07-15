import { classifyFailure } from "./failures.js";
import { createRecordingModelAdapter, executeDurableSideEffect, saveWorkflowState } from "./durable-log.js";
import { summarizeAdaptiveWorkflowMetrics } from "./metrics.js";
import { runFlagshipLlmSeam, runSectionalBudgetLlmSeam } from "./llm-seams.js";
import { createAdaptiveWorkflowPorts } from "./ports.js";
import { applyRepairPatch, createRepairController } from "./repair-controller.js";
import { selectStrategy } from "./strategy-policy.js";
import {
  AdaptiveWorkflowEvents,
  createAdaptiveWorkflowFailure,
  createAdaptiveWorkflowFailureRef,
  createAdaptiveWorkflowPatchReceiptRef,
  createAdaptiveWorkflowStateMachine,
  createAdaptiveWorkflowValidationResult,
  createAdaptiveWorkflowValidationResultRef,
} from "./state-machine.js";
import { runValidators } from "./validators.js";

const FLAGSHIP = "flagship_full_context_v1";
const LOCAL = "local_sectional_repair_v1";

export async function runAdaptiveWorkflow({
  objective,
  runId = "adaptive_workflow_run",
  ports: rawPorts,
  declaredCapability,
  runtimeProfile,
  benchmarkEvidence,
  policy,
  model = "fixture",
  catalog,
  budgetTokens = 1000,
  maxModelAttempts = 2,
  repairRequests = [],
  resumeState,
  cancelRequested = false,
  idempotencyKey = `${runId}:execution`,
} = {}) {
  const ports = createAdaptiveWorkflowPorts(rawPorts);
  const selectedStrategy = recordedStrategyForResume(resumeState) || selectStrategy({
    declaredCapability,
    runtimeProfile: runtimeProfile || ports.runtimeProfile,
    benchmarkEvidence,
    policy,
    asOf: ports.clock(),
  });
  if (resumeState && resumeState.runId !== runId) throw new TypeError("resumeState.runId must match runId");
  if (resumeState && ["complete", "failed", "cancelled"].includes(resumeState.phase)) throw new TypeError("resumeState must be active");
  const machine = createAdaptiveWorkflowStateMachine({ runId, clock: ports.clock, ...(resumeState ? { initialContext: resumeState } : {}) });
  if (resumeState) {
    machine.advance(AdaptiveWorkflowEvents.RECOVER, { selectedStrategyRef: selectedStrategy.selectedStrategyRef, details: { recovered: true } });
    if (resumeState.phase === "intake") machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective, selectedStrategyRef: selectedStrategy.selectedStrategyRef });
  }
  else machine.advance(AdaptiveWorkflowEvents.SUBMIT_OBJECTIVE, { objective, selectedStrategyRef: selectedStrategy.selectedStrategyRef, details: { selectedStrategy } });
  await saveWorkflowState(ports.persistence, machine.view().context);
  if (await cancellationRequested(cancelRequested)) return cancelResult({ machine, ports, runId, selectedStrategy, captures: [], reason: "cancelled before model execution" });
  const activePorts = {
    ...ports,
    model: createRecordingModelAdapter({
      model: ports.model,
      store: ports.persistence,
      onRecorded: async (responseRef) => {
        machine.advance(AdaptiveWorkflowEvents.RECORD_MODEL_RESPONSE, { responseRef });
        await saveWorkflowState(ports.persistence, machine.view().context);
      },
    }),
  };

  const captures = [];
  let lastValidation = null;
  let lastOutput = null;
  let lastFailureInput = null;
  let pendingRepairAction = resumeState?.phase === "repair" ? "complete_regeneration" : null;
  const repairController = createRepairController();
  let resumedCandidate;
  const resumeUsesCandidate = resumeState && ["configure", "validate", "execute", "verify"].includes(resumeState.phase);
  if (resumeUsesCandidate) {
    try {
      resumedCandidate = await loadPersistedCandidate(ports, resumeState);
    } catch (error) {
      return failResult({ machine, ports, runId, phase: machine.view().phase, error, code: error?.code, captures, selectedStrategy, validation: lastValidation });
    }
  }

  for (let attempt = 1; attempt <= Math.max(1, maxModelAttempts); attempt += 1) {
    if (await cancellationRequested(cancelRequested)) return cancelResult({ machine, ports, runId, selectedStrategy, captures, validation: lastValidation, reason: "cancelled before model attempt" });
    let seam;
    try {
      seam = resumeUsesCandidate && attempt === 1
        ? { ok: true, responseParsed: resumedCandidate, captures: [] }
        : await runSelectedSeam({ selectedStrategy, ports: activePorts, model, objective, runId, catalog, budgetTokens });
    } catch (error) {
      return failResult({ machine, ports, runId, phase: machine.view().phase, error, code: codeForError(error), captures, selectedStrategy, validation: lastValidation });
    }
    captures.push(...(seam.captures || []));
    if (!seam.ok) {
      const issue = (seam.errors || [])[0] || { code: "model_generation_failed" };
      return failResult({ machine, ports, runId, phase: machine.view().phase, error: issue, code: issue.code, captures, selectedStrategy, validation: lastValidation });
    }

    lastOutput = serializableClone(seam.summary || seam.responseParsed || seam.response);
    try {
      await prepareValidation({ machine, ports, generated: lastOutput, repairAction: pendingRepairAction });
      await saveWorkflowState(ports.persistence, machine.view().context);
      pendingRepairAction = null;
    } catch (error) {
      return failResult({ machine, ports, runId, phase: machine.view().phase, error, code: error?.code, captures, selectedStrategy, validation: lastValidation });
    }
    lastValidation = runValidators(ports.validator, lastOutput, { stage: "domain", attempt, selectedStrategy });
    if (lastValidation.ok) {
      try {
        return await completeResult({ machine, ports, runId, selectedStrategy, captures, generated: lastOutput, validation: lastValidation, cancelRequested, idempotencyKey });
      } catch (error) {
        return failResult({ machine, ports, runId, phase: machine.view().phase, error, code: error?.code, captures, selectedStrategy, validation: lastValidation });
      }
    }
    if (machine.view().phase !== "validate") return failResult({ machine, ports, runId, phase: machine.view().phase, error: lastValidation.issues[0], code: "validation_failed", captures, selectedStrategy, validation: lastValidation });
    lastFailureInput = lastValidation.issues[0] || { code: "validation_failed", category: "validation" };
    const validationRef = validationResultRef({ runId, ports, stage: "domain", outcome: "failed", issues: lastValidation.issues });
    machine.advance(AdaptiveWorkflowEvents.VALIDATION_FAILED, { validationResultRef: validationRef, validationResult: { outcome: "failed" } });
    let decision = repairController.decide({ issue: lastFailureInput, candidateHash: candidateFingerprint(lastOutput) });
    if (decision.action === "fail") return failResult({ machine, ports, runId, phase: machine.view().phase, error: { code: decision.reason, category: decision.category }, code: decision.reason, captures, selectedStrategy, validation: lastValidation });
    const patchRequest = Array.isArray(repairRequests) ? repairRequests[attempt - 1] : undefined;
    if (patchRequest) {
      try {
        const repaired = applyRepairPatch({ input: lastOutput, patchRequest, registry: ports.validator, receiptId: ports.id.next("patch_receipt"), expectedRunId: runId, expectedTargetRef: machine.view().context.refs.configurationRef, clock: ports.clock, context: { attempt, selectedStrategy } });
        const refs = await storeCandidateRefs(ports, repaired.value);
        const patchReceiptRef = await storePatchReceipt(ports, repaired.receipt);
        machine.advance(AdaptiveWorkflowEvents.REPAIR_APPLIED, { ...refs, patchReceiptRef, details: { repairAction: decision.action, patchRequest: JSON.parse(JSON.stringify(patchRequest)), patchReceipt: repaired.receipt } });
        lastOutput = repaired.value;
        lastValidation = repaired.validation;
        if (lastValidation.ok) return await completeResult({ machine, ports, runId, selectedStrategy, captures, generated: lastOutput, validation: lastValidation, cancelRequested, idempotencyKey });
        lastFailureInput = lastValidation.issues[0] || lastFailureInput;
        decision = repairController.decide({ issue: lastFailureInput, candidateHash: candidateFingerprint(lastOutput) });
        if (decision.action === "fail") return failResult({ machine, ports, runId, phase: machine.view().phase, error: { code: decision.reason, category: decision.category }, code: decision.reason, captures, selectedStrategy, validation: lastValidation });
        const repairRef = validationResultRef({ runId, ports, stage: "repair", outcome: "failed", issues: lastValidation.issues });
        machine.advance(AdaptiveWorkflowEvents.VALIDATION_FAILED, { validationResultRef: repairRef, validationResult: { outcome: "failed" } });
      } catch (error) {
        return failResult({ machine, ports, runId, phase: machine.view().phase, error, code: error?.code, captures, selectedStrategy, validation: lastValidation });
      }
    }
    if (attempt < Math.max(1, maxModelAttempts)) {
      pendingRepairAction = decision.action === "targeted_patch" ? "complete_regeneration" : decision.action;
    }
  }

  return failAfterValidation({ machine, ports, runId, selectedStrategy, captures, validation: lastValidation, failureInput: lastFailureInput });
}

async function runSelectedSeam({ selectedStrategy, ports, model, objective, runId, catalog, budgetTokens }) {
  if (selectedStrategy.strategyId === LOCAL) {
    return runSectionalBudgetLlmSeam({
      adapter: ports.model,
      model,
      goal: objective,
      runId,
      clock: ports.clock,
      catalog,
      budgetTokens,
      poolWeights: [
        { id: "delver", weight: 0 },
        { id: "rooms", weight: 1 },
        { id: "wardens", weight: 0 },
        { id: "resources", weight: 0 },
      ],
    });
  }
  return runFlagshipLlmSeam({ adapter: ports.model, model, prompt: objective, runId, clock: ports.clock });
}

async function completeResult({ machine, ports, runId, selectedStrategy, captures, generated, validation, cancelRequested, idempotencyKey }) {
  if (!["execute", "verify"].includes(machine.view().phase)) {
    const validationRef = validationResultRef({ runId, ports, stage: "domain", outcome: "passed", issues: validation.issues });
    machine.advance(AdaptiveWorkflowEvents.VALIDATION_PASSED, { validationResultRef: validationRef, validationResult: { outcome: "passed" } });
    await saveWorkflowState(ports.persistence, machine.view().context);
  }
  if (await cancellationRequested(cancelRequested)) return cancelResult({ machine, ports, runId, selectedStrategy, captures, validation, reason: "cancelled before side effect" });
  if (machine.view().phase !== "verify") {
    try {
      if (ports.execution?.run) {
        const sideEffect = await executeDurableSideEffect({ store: ports.persistence, idempotencyKey, payload: { runId, generated, strategyId: selectedStrategy.strategyId }, execute: () => ports.execution.run({ runId, generated, selectedStrategy }), isCancelled: () => cancellationRequested(cancelRequested) });
        machine.advance(AdaptiveWorkflowEvents.RECORD_SIDE_EFFECT, { idempotencyKey, details: { duplicate: sideEffect.duplicate, receiptRef: sideEffect.receiptRef, receipt: sideEffect.receipt } });
        await saveWorkflowState(ports.persistence, machine.view().context);
      }
    } catch (error) {
      if (error?.category === "cancellation") return cancelResult({ machine, ports, runId, selectedStrategy, captures, validation, reason: error.message });
      return failAfterExecution({ machine, ports, runId, selectedStrategy, captures, validation, error });
    }
    machine.advance(AdaptiveWorkflowEvents.EXECUTION_SUCCEEDED, { artifactRefs: [machine.view().context.refs.configurationRef] });
    await saveWorkflowState(ports.persistence, machine.view().context);
  }
  const verify = runValidators(ports.validator, generated, { stage: "verify", verification: true, selectedStrategy });
  const verifyRef = validationResultRef({ runId, ports, stage: "verify", outcome: verify.ok ? "passed" : "failed", issues: verify.issues });
  if (!verify.ok) return failAfterVerification({ machine, ports, runId, selectedStrategy, captures, validation: verify, validationRef: verifyRef, failureInput: verify.issues[0] });
  machine.advance(AdaptiveWorkflowEvents.VERIFICATION_PASSED, { validationResultRef: verifyRef, validationResult: { outcome: "passed" } });
  return finish({ machine, ports, outcome: "complete", selectedStrategy, captures, validation: { outcome: "passed", ...verify } });
}

function failAfterVerification({ machine, ports, runId, selectedStrategy, captures, validation, validationRef, failureInput }) {
  const failure = failureFor({ runId, ports, phase: machine.view().phase, input: failureInput, code: failureInput?.code || "verification_failed" });
  machine.advance(AdaptiveWorkflowEvents.VERIFICATION_FAILED, { validationResultRef: validationRef, validationResult: { outcome: "failed" } });
  machine.advance(AdaptiveWorkflowEvents.FAIL, { failure, failureRef: createAdaptiveWorkflowFailureRef(failure.meta.id) });
  return finish({ machine, ports, outcome: "failed", selectedStrategy, captures, validation: { outcome: "failed", ...validation }, failure });
}

function failAfterExecution({ machine, ports, runId, selectedStrategy, captures, validation, error }) {
  const failure = failureFor({ runId, ports, phase: machine.view().phase, input: error, code: error?.code || "execution_failed" });
  machine.advance(AdaptiveWorkflowEvents.EXECUTION_FAILED, { failure, failureRef: createAdaptiveWorkflowFailureRef(failure.meta.id) });
  machine.advance(AdaptiveWorkflowEvents.FAIL, { failure, failureRef: createAdaptiveWorkflowFailureRef(failure.meta.id) });
  return finish({ machine, ports, outcome: "failed", selectedStrategy, captures, validation, failure });
}

function failAfterValidation({ machine, ports, runId, selectedStrategy, captures, validation, failureInput }) {
  const failure = failureFor({ runId, ports, phase: machine.view().phase, input: failureInput, code: "retry_exhausted" });
  machine.advance(AdaptiveWorkflowEvents.FAIL, { failure, failureRef: createAdaptiveWorkflowFailureRef(failure.meta.id) });
  return finish({ machine, ports, outcome: "failed", selectedStrategy, captures, validation: { outcome: "failed", ...(validation || { ok: false, issues: [] }) }, failure });
}

function failResult({ machine, ports, runId, phase, error, code, captures, selectedStrategy, validation }) {
  const failure = failureFor({ runId, ports, phase, input: error, code });
  const event = failure.category === "model_transport" && failure.code === "timeout" ? AdaptiveWorkflowEvents.TIMEOUT : AdaptiveWorkflowEvents.FAIL;
  machine.advance(event, { failure, failureRef: createAdaptiveWorkflowFailureRef(failure.meta.id) });
  return finish({ machine, ports, outcome: "failed", selectedStrategy, captures, validation: validation || { outcome: "not_run", ok: false, issues: [] }, failure });
}

function failureFor({ runId, ports, phase, input, code }) {
  const failureInput = {
    ...(input && typeof input === "object" ? input : {}),
    code: code || input?.code,
    name: input?.name,
    message: input?.message,
    category: input?.category,
  };
  const category = classifyFailure(failureInput);
  return createAdaptiveWorkflowFailure({
    runId,
    id: ports.id.next("failure"),
    phase,
    category,
    code: code || input?.code || category,
    message: input?.message || code || category,
    retryable: false,
    clock: ports.clock,
  });
}

function codeForError(error) {
  return String(error?.name || "").toLowerCase().includes("timeout") ? "timeout" : error?.code || "model_generation_failed";
}

function validationResultRef({ runId, ports, stage, outcome, issues }) {
  const id = ports.id.next("validation");
  createAdaptiveWorkflowValidationResult({ runId, id, stage, outcome, issues, clock: ports.clock });
  return createAdaptiveWorkflowValidationResultRef(id);
}

async function storeRef(ports, prefix, schema, value) {
  const id = ports.id.next(prefix);
  const contentRef = ports.persistence?.putContent ? await ports.persistence.putContent(value) : undefined;
  if (ports.artifactStore?.put) {
    const stored = await ports.artifactStore.put({ id, schema, schemaVersion: 1, value });
    if (stored?.id && stored?.schema) return { ...stored, ...(contentRef ? { contentRef } : {}) };
  }
  return { id, schema, schemaVersion: 1, ...(contentRef ? { contentRef } : {}) };
}

async function loadPersistedCandidate(ports, state) {
  const ref = state.phase === "configure" ? state.refs?.planRef : state.refs?.configurationRef;
  if (!ports.persistence?.getContent || !ref?.contentRef) {
    throw Object.assign(new Error(`Durable candidate is unavailable for resumed ${state.phase} phase`), { code: "durable_candidate_missing", category: "persistence" });
  }
  return ports.persistence.getContent(ref.contentRef);
}

async function storeCandidateRefs(ports, generated) {
  return {
    planRef: await storeRef(ports, "plan", "agent-kernel/AdaptiveWorkflowPlan", generated),
    configurationRef: await storeRef(ports, "configuration", "agent-kernel/AdaptiveWorkflowConfiguration", generated),
  };
}

async function storePatchReceipt(ports, receipt) {
  if (ports.artifactStore?.put) {
    const stored = await ports.artifactStore.put({
      id: receipt.meta.id,
      schema: receipt.schema,
      schemaVersion: receipt.schemaVersion,
      value: receipt,
    });
    if (typeof stored?.id === "string" && stored.id && stored.schema === receipt.schema && stored.schemaVersion === receipt.schemaVersion) return stored;
  }
  return createAdaptiveWorkflowPatchReceiptRef(receipt.meta.id);
}

async function prepareValidation({ machine, ports, generated, repairAction }) {
  const phase = machine.view().phase;
  if (!["plan", "configure", "repair", "escalate"].includes(phase)) return;
  const refs = await storeCandidateRefs(ports, generated);
  if (phase === "repair") {
    machine.advance(AdaptiveWorkflowEvents.REPAIR_APPLIED, { ...refs, details: { repairAction } });
    return;
  }
  if (phase === "configure") {
    machine.advance(AdaptiveWorkflowEvents.CONFIGURATION_READY, { configurationRef: refs.configurationRef });
    return;
  }
  if (phase === "escalate") {
    machine.advance(AdaptiveWorkflowEvents.ESCALATION_RESOLVED, { configurationRef: refs.configurationRef });
    return;
  }
  machine.advance(AdaptiveWorkflowEvents.PLAN_READY, { planRef: refs.planRef });
  machine.advance(AdaptiveWorkflowEvents.CONFIGURATION_READY, { configurationRef: refs.configurationRef });
}

async function finish({ machine, ports, outcome, selectedStrategy, captures, validation, failure }) {
  const state = machine.view().context;
  await saveWorkflowState(ports.persistence, state);
  const metrics = summarizeAdaptiveWorkflowMetrics({
    state,
    captures,
    selectedStrategy,
    runtimeProfile: ports.runtimeProfile,
    clock: ports.clock,
  });
  return { state, events: state.events, captures, validation, selectedStrategy, outcome, metrics, ...(failure ? { failure } : {}) };
}

async function cancellationRequested(value) {
  return typeof value === "function" ? Boolean(await value()) : Boolean(value);
}

function cancelResult({ machine, ports, runId, selectedStrategy, captures, validation, reason }) {
  const failure = createAdaptiveWorkflowFailure({ runId, id: ports.id.next("failure"), phase: machine.view().phase, category: "cancellation", code: "cancelled", message: reason, retryable: false, clock: ports.clock });
  machine.advance(AdaptiveWorkflowEvents.CANCEL, { failure, failureRef: createAdaptiveWorkflowFailureRef(failure.meta.id), reason, details: { acknowledged: true, category: "cancellation" } });
  return finish({ machine, ports, outcome: "cancelled", selectedStrategy, captures, validation: validation || { outcome: "not_run", ok: false, issues: [] }, failure });
}

function candidateFingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(candidateFingerprint).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${candidateFingerprint(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function serializableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function recordedStrategyForResume(state) {
  if (!state?.selectedStrategyRef || !Array.isArray(state.events)) return undefined;
  const recorded = [...state.events].reverse().find((event) => event.details?.selectedStrategy)?.details.selectedStrategy;
  if (![FLAGSHIP, LOCAL].includes(recorded?.strategyId)) return undefined;
  if (recorded.selectedStrategyRef?.id !== state.selectedStrategyRef.id || recorded.selectedStrategyRef?.schema !== state.selectedStrategyRef.schema) return undefined;
  return serializableClone(recorded);
}

import {
  ADAPTIVE_WORKFLOW_EXECUTION_EVENT_SCHEMA,
  ADAPTIVE_WORKFLOW_FAILURE_SCHEMA,
  ADAPTIVE_WORKFLOW_PATCH_RECEIPT_SCHEMA,
  ADAPTIVE_WORKFLOW_PATCH_REQUEST_SCHEMA,
  ADAPTIVE_WORKFLOW_POLICY_SCHEMA,
  ADAPTIVE_WORKFLOW_RUN_RECORD_SCHEMA,
  ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA,
  ADAPTIVE_WORKFLOW_RUNTIME_PROFILE_SCHEMA,
  ADAPTIVE_WORKFLOW_VALIDATION_RESULT_SCHEMA,
} from "../contracts/artifacts.ts";
import type {
  AdaptiveWorkflowExecutionEventKind,
  AdaptiveWorkflowExecutionEventV1,
  AdaptiveWorkflowFailureCategory,
  AdaptiveWorkflowFailureV1,
  AdaptiveWorkflowPatchKind,
  AdaptiveWorkflowPatchOperation,
  AdaptiveWorkflowPatchOperationV1,
  AdaptiveWorkflowPatchReceiptV1,
  AdaptiveWorkflowPatchRequestV1,
  AdaptiveWorkflowPhase,
  AdaptiveWorkflowPolicyV1,
  AdaptiveWorkflowRunRecordV1,
  AdaptiveWorkflowRunStateV1,
  AdaptiveWorkflowRuntimeProfileV1,
  AdaptiveWorkflowValidationIssueV1,
  AdaptiveWorkflowValidationOutcome,
  AdaptiveWorkflowValidationResultV1,
  AdaptiveWorkflowValidationSeverity,
  ArtifactRef,
  ContentAddressAlgorithm,
  ContentAddressedRefV1,
} from "../contracts/artifacts.ts";

export {
  ADAPTIVE_WORKFLOW_EXECUTION_EVENT_SCHEMA,
  ADAPTIVE_WORKFLOW_FAILURE_SCHEMA,
  ADAPTIVE_WORKFLOW_PATCH_RECEIPT_SCHEMA,
  ADAPTIVE_WORKFLOW_PATCH_REQUEST_SCHEMA,
  ADAPTIVE_WORKFLOW_POLICY_SCHEMA,
  ADAPTIVE_WORKFLOW_RUN_RECORD_SCHEMA,
  ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA,
  ADAPTIVE_WORKFLOW_RUNTIME_PROFILE_SCHEMA,
  ADAPTIVE_WORKFLOW_VALIDATION_RESULT_SCHEMA,
};
export type {
  AdaptiveWorkflowExecutionEventKind,
  AdaptiveWorkflowExecutionEventV1,
  AdaptiveWorkflowFailureCategory,
  AdaptiveWorkflowFailureV1,
  AdaptiveWorkflowPatchKind,
  AdaptiveWorkflowPatchOperation,
  AdaptiveWorkflowPatchOperationV1,
  AdaptiveWorkflowPatchReceiptV1,
  AdaptiveWorkflowPatchRequestV1,
  AdaptiveWorkflowPhase,
  AdaptiveWorkflowPolicyV1,
  AdaptiveWorkflowRunRecordV1,
  AdaptiveWorkflowRunStateV1,
  AdaptiveWorkflowRuntimeProfileV1,
  AdaptiveWorkflowValidationIssueV1,
  AdaptiveWorkflowValidationOutcome,
  AdaptiveWorkflowValidationResultV1,
  AdaptiveWorkflowValidationSeverity,
  ArtifactRef,
  ContentAddressAlgorithm,
  ContentAddressedRefV1,
};

export const ADAPTIVE_WORKFLOW_SCHEMA_VERSION = 1;
export const ADAPTIVE_WORKFLOW_STATE_VERSION = "adaptive-workflow-state-v1";
export const ADAPTIVE_WORKFLOW_POLICY_VERSION = "adaptive-workflow-policy-v1";
export const ADAPTIVE_WORKFLOW_STRATEGY_POLICY_VERSION = "adaptive-workflow-strategy-policy-v1";
export const ADAPTIVE_WORKFLOW_SELECTED_STRATEGY_SCHEMA = "agent-kernel/SelectedStrategy";
export const ADAPTIVE_WORKFLOW_BENCHMARK_EVIDENCE_SCHEMA = "agent-kernel/BenchmarkEvidence";
export const ADAPTIVE_WORKFLOW_CONTEXT_BUDGET_SCHEMA = "agent-kernel/ContextBudget";

export const ADAPTIVE_WORKFLOW_PHASES: ReadonlyArray<AdaptiveWorkflowPhase> = Object.freeze([
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

export const ADAPTIVE_WORKFLOW_TERMINAL_PHASES: ReadonlyArray<AdaptiveWorkflowPhase> = Object.freeze([
  "complete",
  "failed",
  "cancelled",
]);

export const ADAPTIVE_WORKFLOW_FAILURE_CATEGORIES: ReadonlyArray<AdaptiveWorkflowFailureCategory> = Object.freeze([
  "model_transport",
  "model_contract",
  "validation",
  "execution",
  "infrastructure",
  "persistence",
  "cancellation",
  "budget_exhaustion",
]);

export const ADAPTIVE_WORKFLOW_IMMUTABLE_PATCH_PATHS: ReadonlyArray<string> = Object.freeze([
  "/schema",
  "/schemaVersion",
  "/meta/id",
  "/meta/runId",
  "/meta/createdAt",
  "/refs/replayResponseRefs",
  "/idempotency/sideEffectKeys",
  "/events",
]);

export type DeclaredModelCapabilityV1 = { schemaVersion: 1; providerId: string; modelId: string | null; source: "declared"; contextWindowTokens: number | null; maxOutputTokens: number | null; providerContextWindowTokens?: number; supports: { textGeneration: boolean; structuredOutput: boolean; streaming: boolean } };
export type RuntimeProfileSnapshotV1 = AdaptiveWorkflowRuntimeProfileV1;
export type BenchmarkEvidenceV1 = { schema: typeof ADAPTIVE_WORKFLOW_BENCHMARK_EVIDENCE_SCHEMA; schemaVersion: 1; evidenceId: string; strategyId: string; sampleSize: number; stability: number; confidence: number; capturedAt: string; source: string; averageScore?: number; metrics?: Record<string, unknown> };
export type StrategyPolicyV1 = { schema: "agent-kernel/AdaptiveWorkflowStrategyPolicy"; schemaVersion: 1; policyVersion: string; strategies: Array<{ id: string; precedence: number; score: number; minContextTokens: number; requires: Record<string, boolean>; resourcePolicy: { maxConcurrency: number; candidateCount: number; routing: string }; benchmark?: Record<string, unknown> }>; fallbackOrder: string[]; thresholds: Record<string, number>; context: Record<string, number>; tieBreakers: string[] };
export type SelectedStrategyV1 = { schema: typeof ADAPTIVE_WORKFLOW_SELECTED_STRATEGY_SCHEMA; schemaVersion: 1; strategyId: string; policyVersion: string; selectedAt: string | null; selectedStrategyRef: ArtifactRef; resourcePolicy: { maxConcurrency: number; candidateCount: number; routing: string }; candidates: unknown[]; provenance: Record<string, unknown> };
export type ContextBudgetResultV1 = { schema: typeof ADAPTIVE_WORKFLOW_CONTEXT_BUDGET_SCHEMA; schemaVersion: 1; contextWindowTokens: number; outputReserveTokens: number; toolReserveTokens: number; inputBudgetTokens: number; limitingSources: string[]; provenance: Record<string, unknown> };

export interface AdaptiveWorkflowValidationReport {
  ok: boolean;
  errors: string[];
  issues: Array<{ code: string; path: string; message: string }>;
}

function report(): AdaptiveWorkflowValidationReport {
  return { ok: true, errors: [], issues: [] };
}

function addIssue(result: AdaptiveWorkflowValidationReport, path: string, code: string, message: string) {
  result.ok = false;
  result.errors.push(`${path}: ${message}`);
  result.issues.push({ code, path, message });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function validateEnvelope(
  value: unknown,
  path: string,
  schema: string,
  result: AdaptiveWorkflowValidationReport,
) {
  if (!isObject(value)) {
    addIssue(result, path, "expected_object", "expected object");
    return;
  }
  if (value.schema !== schema) {
    addIssue(result, `${path}.schema`, "invalid_schema", `expected ${schema}`);
  }
  if (value.schemaVersion !== ADAPTIVE_WORKFLOW_SCHEMA_VERSION) {
    addIssue(result, `${path}.schemaVersion`, "invalid_schema_version", "expected 1");
  }
  validateMeta(value.meta, `${path}.meta`, result);
}

function validateMeta(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!isObject(value)) {
    addIssue(result, path, "expected_object", "expected object");
    return;
  }
  for (const key of ["id", "runId", "createdAt", "producedBy"]) {
    if (!isNonEmptyString(value[key])) {
      addIssue(result, `${path}.${key}`, "required_string", "expected non-empty string");
    }
  }
}

function validateMetaRunId(
  value: unknown,
  path: string,
  runId: unknown,
  result: AdaptiveWorkflowValidationReport,
) {
  if (isObject(value) && isNonEmptyString(runId) && value.runId !== runId) {
    addIssue(result, `${path}.runId`, "run_id_mismatch", "expected meta.runId to match runId");
  }
}

function validateMetaId(value: unknown, path: string, id: unknown, result: AdaptiveWorkflowValidationReport) {
  if (isObject(value) && isNonEmptyString(id) && value.id !== id) {
    addIssue(result, `${path}.id`, "meta_id_mismatch", "expected meta.id to match artifact id");
  }
}

function validateArtifactRef(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!isObject(value)) {
    addIssue(result, path, "expected_object", "expected object");
    return;
  }
  if (!isNonEmptyString(value.id)) {
    addIssue(result, `${path}.id`, "required_string", "expected non-empty string");
  }
  if (!isNonEmptyString(value.schema)) {
    addIssue(result, `${path}.schema`, "required_string", "expected non-empty string");
  }
  if (!Number.isInteger(value.schemaVersion)) {
    addIssue(result, `${path}.schemaVersion`, "required_integer", "expected integer");
  }
}

function validateContentAddressedRef(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!isObject(value)) {
    addIssue(result, path, "expected_object", "expected object");
    return;
  }
  if (!["sha256", "sha512", "blake3"].includes(String(value.algorithm))) {
    addIssue(result, `${path}.algorithm`, "invalid_algorithm", "expected sha256, sha512, or blake3");
  }
  if (!isNonEmptyString(value.digest)) {
    addIssue(result, `${path}.digest`, "required_string", "expected non-empty string");
  }
  if (value.bytes !== undefined && !isNonNegativeInteger(value.bytes)) {
    addIssue(result, `${path}.bytes`, "invalid_bytes", "expected non-negative integer");
  }
  if (value.mediaType !== undefined && !isNonEmptyString(value.mediaType)) {
    addIssue(result, `${path}.mediaType`, "required_string", "expected non-empty string");
  }
}

function validateArtifactOrContentRef(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (isObject(value) && "algorithm" in value) {
    validateContentAddressedRef(value, path, result);
    return;
  }
  validateArtifactRef(value, path, result);
}

function validateRefArray(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!Array.isArray(value)) {
    addIssue(result, path, "expected_array", "expected array");
    return;
  }
  value.forEach((entry, index) => validateArtifactRef(entry, `${path}[${index}]`, result));
}

function validateStringArray(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    addIssue(result, path, "expected_array", "expected array of non-empty strings");
  }
}

function validateArtifactOrContentRefArray(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!Array.isArray(value)) {
    addIssue(result, path, "expected_array", "expected array");
    return;
  }
  value.forEach((entry, index) => validateArtifactOrContentRef(entry, `${path}[${index}]`, result));
}

function validatePhase(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!ADAPTIVE_WORKFLOW_PHASES.includes(value as AdaptiveWorkflowPhase)) {
    addIssue(result, path, "invalid_phase", `expected one of ${ADAPTIVE_WORKFLOW_PHASES.join(", ")}`);
  }
}

function validateNonNegativeIntegerField(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!isNonNegativeInteger(value)) {
    addIssue(result, path, "required_non_negative_integer", "expected non-negative integer");
  }
}

function validateBooleanField(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!isBoolean(value)) {
    addIssue(result, path, "required_boolean", "expected boolean");
  }
}

function validatePatchOperation(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!isObject(value)) {
    addIssue(result, path, "expected_object", "expected object");
    return;
  }
  if (!["add", "replace", "remove"].includes(String(value.op))) {
    addIssue(result, `${path}.op`, "invalid_operation", "expected add, replace, or remove");
  }
  if (!isNonEmptyString(value.path)) {
    addIssue(result, `${path}.path`, "required_string", "expected non-empty string");
  }
}

function validatePatchOperationArray(value: unknown, path: string, result: AdaptiveWorkflowValidationReport) {
  if (!Array.isArray(value)) {
    addIssue(result, path, "expected_array", "expected array");
    return;
  }
  value.forEach((operation, index) => validatePatchOperation(operation, `${path}[${index}]`, result));
}

function validateExecutionEventArray(
  value: unknown,
  path: string,
  result: AdaptiveWorkflowValidationReport,
  expectedRunId?: string,
) {
  if (!Array.isArray(value)) {
    addIssue(result, path, "expected_array", "expected array");
    return;
  }
  value.forEach((event, index) => {
    const eventResult = validateAdaptiveWorkflowExecutionEvent(event);
    for (const issue of eventResult.issues) {
      addIssue(result, `${path}[${index}].${issue.path}`, issue.code, issue.message);
    }
    if (isObject(event) && expectedRunId !== undefined && event.runId !== expectedRunId) {
      addIssue(result, `${path}[${index}].runId`, "run_id_mismatch", "expected event runId to match parent runId");
    }
  });
}

export function createAdaptiveWorkflowArtifactRef(
  id: string,
  schema: string,
  schemaVersion = ADAPTIVE_WORKFLOW_SCHEMA_VERSION,
): ArtifactRef {
  return { id, schema, schemaVersion };
}

export function createContentAddressedRef(ref: ContentAddressedRefV1): ContentAddressedRefV1 {
  const result = report();
  validateContentAddressedRef(ref, "ref", result);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
  return { ...ref };
}

export function validateAdaptiveWorkflowValidationResult(value: unknown): AdaptiveWorkflowValidationReport {
  const result = report();
  validateEnvelope(value, "validationResult", ADAPTIVE_WORKFLOW_VALIDATION_RESULT_SCHEMA, result);
  if (!isObject(value)) {
    return result;
  }
  if (!isNonEmptyString(value.validatorId)) {
    addIssue(result, "validationResult.validatorId", "required_string", "expected non-empty string");
  }
  if (!isNonEmptyString(value.validatorVersion)) {
    addIssue(result, "validationResult.validatorVersion", "required_string", "expected non-empty string");
  }
  validatePhase(value.stage, "validationResult.stage", result);
  if (!["passed", "failed", "warning", "skipped"].includes(String(value.outcome))) {
    addIssue(result, "validationResult.outcome", "invalid_outcome", "expected passed, failed, warning, or skipped");
  }
  if (!Array.isArray(value.issues)) {
    addIssue(result, "validationResult.issues", "expected_array", "expected array");
  } else {
    value.issues.forEach((issue, index) => {
      const path = `validationResult.issues[${index}]`;
      if (!isObject(issue)) {
        addIssue(result, path, "expected_object", "expected object");
        return;
      }
      if (!isNonEmptyString(issue.code)) {
        addIssue(result, `${path}.code`, "required_string", "expected non-empty string");
      }
      if (!isNonEmptyString(issue.message)) {
        addIssue(result, `${path}.message`, "required_string", "expected non-empty string");
      }
      if (!["info", "warning", "error"].includes(String(issue.severity))) {
        addIssue(result, `${path}.severity`, "invalid_severity", "expected info, warning, or error");
      }
      if (issue.path !== undefined && !isNonEmptyString(issue.path)) {
        addIssue(result, `${path}.path`, "required_string", "expected non-empty string");
      }
      if (issue.validatorId !== undefined && !isNonEmptyString(issue.validatorId)) {
        addIssue(result, `${path}.validatorId`, "required_string", "expected non-empty string");
      }
    });
  }
  if (value.checkedRefs !== undefined) {
    validateRefArray(value.checkedRefs, "validationResult.checkedRefs", result);
  }
  if (value.affectedPaths !== undefined) {
    validateStringArray(value.affectedPaths, "validationResult.affectedPaths", result);
  }
  return result;
}

export function validateAdaptiveWorkflowFailure(value: unknown): AdaptiveWorkflowValidationReport {
  const result = report();
  validateEnvelope(value, "failure", ADAPTIVE_WORKFLOW_FAILURE_SCHEMA, result);
  if (!isObject(value)) {
    return result;
  }
  if (!ADAPTIVE_WORKFLOW_FAILURE_CATEGORIES.includes(value.category as AdaptiveWorkflowFailureCategory)) {
    addIssue(result, "failure.category", "invalid_failure_category", "unexpected failure category");
  }
  if (!isNonEmptyString(value.code)) {
    addIssue(result, "failure.code", "required_string", "expected non-empty string");
  }
  if (!isNonEmptyString(value.message)) {
    addIssue(result, "failure.message", "required_string", "expected non-empty string");
  }
  if (typeof value.retryable !== "boolean") {
    addIssue(result, "failure.retryable", "required_boolean", "expected boolean");
  }
  validatePhase(value.phase, "failure.phase", result);
  if (value.timeoutMs !== undefined && !isNonNegativeInteger(value.timeoutMs)) {
    addIssue(result, "failure.timeoutMs", "invalid_timeout", "expected non-negative integer");
  }
  if (value.source !== undefined && !isNonEmptyString(value.source)) {
    addIssue(result, "failure.source", "required_string", "expected non-empty string");
  }
  if (value.validationResultRef !== undefined) {
    validateArtifactRef(value.validationResultRef, "failure.validationResultRef", result);
  }
  if (value.causeRef !== undefined) {
    validateArtifactOrContentRef(value.causeRef, "failure.causeRef", result);
  }
  return result;
}

export function validateAdaptiveWorkflowPolicy(value: unknown): AdaptiveWorkflowValidationReport {
  const result = report();
  validateEnvelope(value, "policy", ADAPTIVE_WORKFLOW_POLICY_SCHEMA, result);
  if (!isObject(value)) {
    return result;
  }
  if (value.policyVersion !== ADAPTIVE_WORKFLOW_POLICY_VERSION) {
    addIssue(
      result,
      "policy.policyVersion",
      "invalid_policy_version",
      `expected ${ADAPTIVE_WORKFLOW_POLICY_VERSION}`,
    );
  }
  if (!isObject(value.maxRetries)) {
    addIssue(result, "policy.maxRetries", "expected_object", "expected object");
  } else {
    for (const key of ["modelTransport", "modelContract", "validation", "execution", "persistence"]) {
      validateNonNegativeIntegerField(value.maxRetries[key], `policy.maxRetries.${key}`, result);
    }
  }
  if (!isObject(value.timeoutMs)) {
    addIssue(result, "policy.timeoutMs", "expected_object", "expected object");
  } else {
    for (const key of ["model", "validation", "execution", "persistence"]) {
      validateNonNegativeIntegerField(value.timeoutMs[key], `policy.timeoutMs.${key}`, result);
    }
  }
  if (!["return_existing", "fail"].includes(String(value.duplicateSideEffectPolicy))) {
    addIssue(result, "policy.duplicateSideEffectPolicy", "invalid_policy", "expected return_existing or fail");
  }
  if (!isObject(value.replay)) {
    addIssue(result, "policy.replay", "expected_object", "expected object");
  } else {
    validateBooleanField(value.replay.requireRecordedModelResponses, "policy.replay.requireRecordedModelResponses", result);
    validateBooleanField(value.replay.requirePromptHashes, "policy.replay.requirePromptHashes", result);
  }
  if (!isObject(value.cancellation) || value.cancellation.terminalPhase !== "cancelled") {
    addIssue(result, "policy.cancellation.terminalPhase", "invalid_phase", "expected cancelled");
  }
  validateStringArray(value.immutablePatchPaths, "policy.immutablePatchPaths", result);
  if (Array.isArray(value.immutablePatchPaths)) {
    for (const requiredPath of ADAPTIVE_WORKFLOW_IMMUTABLE_PATCH_PATHS) {
      if (!value.immutablePatchPaths.includes(requiredPath)) {
        addIssue(
          result,
          "policy.immutablePatchPaths",
          "missing_immutable_path",
          `expected immutable path ${requiredPath}`,
        );
      }
    }
  }
  return result;
}

export function validateAdaptiveWorkflowRuntimeProfile(value: unknown): AdaptiveWorkflowValidationReport {
  const result = report();
  validateEnvelope(value, "runtimeProfile", ADAPTIVE_WORKFLOW_RUNTIME_PROFILE_SCHEMA, result);
  if (!isObject(value)) {
    return result;
  }
  if (!isNonEmptyString(value.profileVersion)) {
    addIssue(result, "runtimeProfile.profileVersion", "required_string", "expected non-empty string");
  }
  if (!isNonEmptyString(value.capturedAt)) {
    addIssue(result, "runtimeProfile.capturedAt", "required_string", "expected non-empty string");
  }
  if (!["declared", "probed", "fixture"].includes(String(value.source))) {
    addIssue(result, "runtimeProfile.source", "invalid_source", "expected declared, probed, or fixture");
  }
  if (!isObject(value.capabilities)) {
    addIssue(result, "runtimeProfile.capabilities", "expected_object", "expected object");
  } else {
    if (value.capabilities.providerIds !== undefined) {
      validateStringArray(value.capabilities.providerIds, "runtimeProfile.capabilities.providerIds", result);
    }
    for (const key of ["maxContextTokens", "maxConcurrency"]) {
      if (value.capabilities[key] !== undefined) {
        validateNonNegativeIntegerField(value.capabilities[key], `runtimeProfile.capabilities.${key}`, result);
      }
    }
    for (const key of ["supportsReplay", "supportsCancellation"]) {
      if (value.capabilities[key] !== undefined) {
        validateBooleanField(value.capabilities[key], `runtimeProfile.capabilities.${key}`, result);
      }
    }
  }
  if (value.refs !== undefined) {
    if (!isObject(value.refs)) {
      addIssue(result, "runtimeProfile.refs", "expected_object", "expected object");
    } else if (value.refs.benchmarkEvidenceRefs !== undefined) {
      validateRefArray(value.refs.benchmarkEvidenceRefs, "runtimeProfile.refs.benchmarkEvidenceRefs", result);
    }
  }
  return result;
}

export function validateAdaptiveWorkflowExecutionEvent(value: unknown): AdaptiveWorkflowValidationReport {
  const result = report();
  validateEnvelope(value, "executionEvent", ADAPTIVE_WORKFLOW_EXECUTION_EVENT_SCHEMA, result);
  if (!isObject(value)) {
    return result;
  }
  if (!isNonEmptyString(value.eventId)) {
    addIssue(result, "executionEvent.eventId", "required_string", "expected non-empty string");
  }
  if (!isNonEmptyString(value.runId)) {
    addIssue(result, "executionEvent.runId", "required_string", "expected non-empty string");
  }
  validateMetaRunId(value.meta, "executionEvent.meta", value.runId, result);
  validateMetaId(value.meta, "executionEvent.meta", value.eventId, result);
  validatePhase(value.phase, "executionEvent.phase", result);
  if (
    ![
      "phase_transition",
      "model_request",
      "model_response",
      "validation",
      "repair",
      "side_effect",
      "timeout",
      "cancellation",
      "recovery",
      "replay",
    ].includes(String(value.kind))
  ) {
    addIssue(result, "executionEvent.kind", "invalid_kind", "unexpected event kind");
  }
  if (!isNonEmptyString(value.occurredAt)) {
    addIssue(result, "executionEvent.occurredAt", "required_string", "expected non-empty string");
  }
  if (value.promptHash !== undefined) {
    validateContentAddressedRef(value.promptHash, "executionEvent.promptHash", result);
  }
  if (value.responseRef !== undefined) {
    validateArtifactOrContentRef(value.responseRef, "executionEvent.responseRef", result);
  }
  if (value.artifactRefs !== undefined) {
    validateRefArray(value.artifactRefs, "executionEvent.artifactRefs", result);
  }
  if (value.validationResultRef !== undefined) {
    validateArtifactRef(value.validationResultRef, "executionEvent.validationResultRef", result);
  }
  if (value.failureRef !== undefined) {
    validateArtifactRef(value.failureRef, "executionEvent.failureRef", result);
  }
  if (value.details !== undefined && !isObject(value.details)) {
    addIssue(result, "executionEvent.details", "expected_object", "expected object");
  }
  return result;
}

export function validateAdaptiveWorkflowPatchRequest(value: unknown): AdaptiveWorkflowValidationReport {
  const result = report();
  validateEnvelope(value, "patchRequest", ADAPTIVE_WORKFLOW_PATCH_REQUEST_SCHEMA, result);
  if (!isObject(value)) {
    return result;
  }
  if (!isNonEmptyString(value.requestId)) {
    addIssue(result, "patchRequest.requestId", "required_string", "expected non-empty string");
  }
  if (!isNonEmptyString(value.runId)) {
    addIssue(result, "patchRequest.runId", "required_string", "expected non-empty string");
  }
  validateMetaRunId(value.meta, "patchRequest.meta", value.runId, result);
  validatePhase(value.phase, "patchRequest.phase", result);
  if (!["syntax_repair", "semantic_patch", "normalization"].includes(String(value.kind))) {
    addIssue(result, "patchRequest.kind", "invalid_kind", "unexpected patch kind");
  }
  validateArtifactRef(value.targetRef, "patchRequest.targetRef", result);
  if (!isObject(value.reason)) {
    addIssue(result, "patchRequest.reason", "expected_object", "expected object");
  } else {
    if (!isNonEmptyString(value.reason.summary)) {
      addIssue(result, "patchRequest.reason.summary", "required_string", "expected non-empty string");
    }
    if (value.reason.failureRef !== undefined) {
      validateArtifactRef(value.reason.failureRef, "patchRequest.reason.failureRef", result);
    }
    if (value.reason.validationResultRef !== undefined) {
      validateArtifactRef(value.reason.validationResultRef, "patchRequest.reason.validationResultRef", result);
    }
  }
  validatePatchOperationArray(value.operations, "patchRequest.operations", result);
  validateStringArray(value.immutablePaths, "patchRequest.immutablePaths", result);
  validateStringArray(value.affectedValidators, "patchRequest.affectedValidators", result);
  if (Array.isArray(value.operations) && Array.isArray(value.immutablePaths)) {
    value.operations.forEach((operation, index) => {
      if (isObject(operation) && isNonEmptyString(operation.path) && value.immutablePaths.includes(operation.path)) {
        addIssue(
          result,
          `patchRequest.operations[${index}].path`,
          "immutable_path",
          "patch operation targets an immutable path",
        );
      }
    });
  }
  return result;
}

export function validateAdaptiveWorkflowPatchReceipt(value: unknown): AdaptiveWorkflowValidationReport {
  const result = report();
  validateEnvelope(value, "patchReceipt", ADAPTIVE_WORKFLOW_PATCH_RECEIPT_SCHEMA, result);
  if (!isObject(value)) {
    return result;
  }
  validateArtifactRef(value.requestRef, "patchReceipt.requestRef", result);
  if (typeof value.accepted !== "boolean") {
    addIssue(result, "patchReceipt.accepted", "required_boolean", "expected boolean");
  }
  validatePatchOperationArray(value.appliedOperations, "patchReceipt.appliedOperations", result);
  if (!Array.isArray(value.rejectedOperations)) {
    addIssue(result, "patchReceipt.rejectedOperations", "expected_array", "expected array");
  } else {
    value.rejectedOperations.forEach((entry, index) => {
      const path = `patchReceipt.rejectedOperations[${index}]`;
      if (!isObject(entry)) {
        addIssue(result, path, "expected_object", "expected object");
        return;
      }
      validatePatchOperation(entry.operation, `${path}.operation`, result);
      if (!isNonEmptyString(entry.code)) {
        addIssue(result, `${path}.code`, "required_string", "expected non-empty string");
      }
      if (!isNonEmptyString(entry.message)) {
        addIssue(result, `${path}.message`, "required_string", "expected non-empty string");
      }
    });
  }
  validateStringArray(value.rerunValidatorIds, "patchReceipt.rerunValidatorIds", result);
  if (value.resultRef !== undefined) {
    validateArtifactRef(value.resultRef, "patchReceipt.resultRef", result);
  }
  return result;
}

export function validateAdaptiveWorkflowRunState(value: unknown): AdaptiveWorkflowValidationReport {
  const result = report();
  validateEnvelope(value, "runState", ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA, result);
  if (!isObject(value)) {
    return result;
  }
  if (value.stateVersion !== ADAPTIVE_WORKFLOW_STATE_VERSION) {
    addIssue(
      result,
      "runState.stateVersion",
      "invalid_state_version",
      `expected ${ADAPTIVE_WORKFLOW_STATE_VERSION}`,
    );
  }
  if (!isNonEmptyString(value.runId)) {
    addIssue(result, "runState.runId", "required_string", "expected non-empty string");
  }
  validateMetaRunId(value.meta, "runState.meta", value.runId, result);
  validatePhase(value.phase, "runState.phase", result);
  validateArtifactRef(value.policyRef, "runState.policyRef", result);
  if (value.runtimeProfileRef !== undefined) {
    validateArtifactRef(value.runtimeProfileRef, "runState.runtimeProfileRef", result);
  }
  if (!isObject(value.refs)) {
    addIssue(result, "runState.refs", "expected_object", "expected object");
  } else {
    if (value.refs.planRef !== undefined) {
      validateArtifactRef(value.refs.planRef, "runState.refs.planRef", result);
    }
    if (value.refs.configurationRef !== undefined) {
      validateArtifactRef(value.refs.configurationRef, "runState.refs.configurationRef", result);
    }
    validateRefArray(value.refs.validationResultRefs, "runState.refs.validationResultRefs", result);
    validateRefArray(value.refs.failureRefs, "runState.refs.failureRefs", result);
    validateArtifactOrContentRefArray(value.refs.replayResponseRefs, "runState.refs.replayResponseRefs", result);
    validateRefArray(value.refs.patchReceiptRefs, "runState.refs.patchReceiptRefs", result);
  }
  if (!isObject(value.counters)) {
    addIssue(result, "runState.counters", "expected_object", "expected object");
  } else {
    for (const key of [
      "modelTransportRetries",
      "modelContractRetries",
      "validationRetries",
      "executionRetries",
      "persistenceRetries",
      "repairAttempts",
    ]) {
      validateNonNegativeIntegerField(value.counters[key], `runState.counters.${key}`, result);
    }
  }
  if (!isObject(value.cancellation) || typeof value.cancellation.requested !== "boolean") {
    addIssue(result, "runState.cancellation.requested", "required_boolean", "expected boolean");
  } else {
    if (value.cancellation.requestedAt !== undefined && !isNonEmptyString(value.cancellation.requestedAt)) {
      addIssue(result, "runState.cancellation.requestedAt", "required_string", "expected non-empty string");
    }
    if (value.cancellation.reason !== undefined && !isNonEmptyString(value.cancellation.reason)) {
      addIssue(result, "runState.cancellation.reason", "required_string", "expected non-empty string");
    }
  }
  if (!isObject(value.idempotency) || !Array.isArray(value.idempotency.sideEffectKeys)) {
    addIssue(result, "runState.idempotency.sideEffectKeys", "expected_array", "expected array");
  } else if (!value.idempotency.sideEffectKeys.every(isNonEmptyString)) {
    addIssue(result, "runState.idempotency.sideEffectKeys", "expected_array", "expected array of non-empty strings");
  }
  validateExecutionEventArray(
    value.events,
    "runState.events",
    result,
    isNonEmptyString(value.runId) ? value.runId : undefined,
  );
  if (value.objective !== undefined) {
    if (!isObject(value.objective)) {
      addIssue(result, "runState.objective", "expected_object", "expected object");
    } else {
      if (!isNonEmptyString(value.objective.text)) {
        addIssue(result, "runState.objective.text", "required_string", "expected non-empty string");
      }
      if (value.objective.intakeRef !== undefined) {
        validateArtifactRef(value.objective.intakeRef, "runState.objective.intakeRef", result);
      }
    }
  }
  if (value.selectedStrategyRef !== undefined) {
    validateArtifactRef(value.selectedStrategyRef, "runState.selectedStrategyRef", result);
  }
  if (!isNonEmptyString(value.updatedAt)) {
    addIssue(result, "runState.updatedAt", "required_string", "expected non-empty string");
  }
  return result;
}

export function validateAdaptiveWorkflowRunRecord(value: unknown): AdaptiveWorkflowValidationReport {
  const result = report();
  validateEnvelope(value, "runRecord", ADAPTIVE_WORKFLOW_RUN_RECORD_SCHEMA, result);
  if (!isObject(value)) {
    return result;
  }
  if (!isNonEmptyString(value.runId)) {
    addIssue(result, "runRecord.runId", "required_string", "expected non-empty string");
  }
  validateMetaRunId(value.meta, "runRecord.meta", value.runId, result);
  validateArtifactRef(value.stateRef, "runRecord.stateRef", result);
  validateArtifactRef(value.policyRef, "runRecord.policyRef", result);
  if (value.runtimeProfileRef !== undefined) {
    validateArtifactRef(value.runtimeProfileRef, "runRecord.runtimeProfileRef", result);
  }
  validatePhase(value.finalPhase, "runRecord.finalPhase", result);
  validateExecutionEventArray(
    value.events,
    "runRecord.events",
    result,
    isNonEmptyString(value.runId) ? value.runId : undefined,
  );
  if (value.promptRefs !== undefined) {
    validateArtifactOrContentRefArray(value.promptRefs, "runRecord.promptRefs", result);
  }
  if (value.responseRefs !== undefined) {
    validateArtifactOrContentRefArray(value.responseRefs, "runRecord.responseRefs", result);
  }
  validateRefArray(value.validationResultRefs, "runRecord.validationResultRefs", result);
  validateRefArray(value.failureRefs, "runRecord.failureRefs", result);
  if (value.executionResultRefs !== undefined) {
    validateRefArray(value.executionResultRefs, "runRecord.executionResultRefs", result);
  }
  if (value.tokenUsage !== undefined) {
    if (!isObject(value.tokenUsage)) {
      addIssue(result, "runRecord.tokenUsage", "expected_object", "expected object");
    } else {
      for (const key of ["inputTokens", "outputTokens", "toolTokens", "totalTokens"]) {
        if (value.tokenUsage[key] !== undefined) {
          validateNonNegativeIntegerField(value.tokenUsage[key], `runRecord.tokenUsage.${key}`, result);
        }
      }
    }
  }
  if (value.latencyMs !== undefined) {
    validateNonNegativeIntegerField(value.latencyMs, "runRecord.latencyMs", result);
  }
  return result;
}

import { classifyFailure } from "./failures.js";
import { applyPatchRequest } from "./patch-contract.js";
import { runValidators, selectAffectedValidators } from "./validators.js";

export const REPAIR_ACTIONS = Object.freeze(["normalize", "syntax_repair", "targeted_patch", "section_regeneration", "complete_regeneration", "alternate_model", "flagship_escalation", "fail"]);

function oscillates(history) {
  const h = Array.isArray(history) ? history.filter((value) => typeof value === "string" && value) : [];
  return h.length >= 2 && (h.at(-1) === h.at(-2) || (h.length >= 4 && h.at(-1) === h.at(-3) && h.at(-2) === h.at(-4)));
}

export function chooseRepairAction({ issue = {}, failure, attempt = 0, history = [], section, canAlternateModel = false, canFlagship = false } = {}) {
  if (oscillates(history)) {
    if (canAlternateModel) return Object.freeze({ action: "alternate_model", reason: "convergence_stalled" });
    if (canFlagship) return Object.freeze({ action: "flagship_escalation", reason: "convergence_stalled" });
    return Object.freeze({ action: "fail", reason: "oscillation_detected", category: "validation" });
  }
  const category = classifyFailure(failure || issue);
  const code = String(issue.code || failure?.code || "").toLowerCase();
  const stage = issue.stage || failure?.stage;
  if (code === "normalization_available") return Object.freeze({ action: "normalize", reason: code });
  if (stage === "schema" || stage === "contract" || code.includes("schema")) return Object.freeze({ action: "targeted_patch", reason: code || stage });
  if (stage === "syntax" || category === "model_contract") return Object.freeze({ action: "syntax_repair", reason: code || category });
  if (attempt >= 2) return Object.freeze({ action: "complete_regeneration", reason: "repair_attempt_limit" });
  if (section) return Object.freeze({ action: "section_regeneration", reason: `affected_section:${section}` });
  return Object.freeze({ action: "targeted_patch", reason: code || category });
}

export function createRepairController(options = {}) {
  const history = [];
  let attempts = 0;
  return Object.freeze({
    decide(input = {}) {
      if (input.candidateHash) history.push(input.candidateHash);
      const decision = chooseRepairAction({ ...options, ...input, attempt: attempts, history });
      attempts += 1;
      return decision;
    },
    view: () => Object.freeze({ attempts, history: Object.freeze(history.slice()) }),
  });
}

export function applyRepairPatch({ input, patchRequest, registry, receiptId, expectedRunId, expectedTargetRef, clock = () => "1970-01-01T00:00:00.000Z", context = {} }) {
  if (expectedRunId && patchRequest?.runId !== expectedRunId) throw Object.assign(new Error("patch request runId does not match workflow runId"), { code: "patch_run_mismatch", category: "validation" });
  if (expectedTargetRef && ["id", "schema", "schemaVersion"].some((key) => patchRequest?.targetRef?.[key] !== expectedTargetRef[key])) throw Object.assign(new Error("patch request targetRef does not match the current candidate"), { code: "patch_target_mismatch", category: "validation" });
  const applied = applyPatchRequest(input, patchRequest);
  const validators = selectAffectedValidators(registry, applied.changedPaths);
  const validation = runValidators(validators, applied.value, { ...context, stage: "repair", changedPaths: applied.changedPaths });
  const id = receiptId || `${patchRequest.requestId}:receipt`;
  const receipt = Object.freeze({
    schema: "agent-kernel/AdaptiveWorkflowPatchReceipt", schemaVersion: 1,
    meta: Object.freeze({ id, runId: patchRequest.runId, createdAt: clock(), producedBy: "adaptive-workflow" }),
    requestRef: Object.freeze({ id: patchRequest.requestId, schema: patchRequest.schema, schemaVersion: 1 }),
    accepted: true, appliedOperations: Object.freeze(JSON.parse(JSON.stringify(patchRequest.operations)).map(Object.freeze)),
    rejectedOperations: Object.freeze([]), rerunValidatorIds: Object.freeze(validators.map(({ id: validatorId }) => validatorId)),
  });
  return Object.freeze({ value: applied.value, changedPaths: applied.changedPaths, validation, receipt });
}

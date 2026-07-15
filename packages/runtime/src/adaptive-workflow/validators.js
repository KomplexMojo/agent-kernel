import { classifyFailure } from "./failures.js";

export const VALIDATION_STAGES = Object.freeze(["syntax", "schema", "contract", "domain", "execution", "repair"]);
const DEFAULT_STAGE = "domain";

function freezeIssue(issue) {
  return Object.freeze(Object.fromEntries(Object.entries(issue).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))));
}

function normalizePath(value) {
  const raw = typeof value === "string" ? value : value?.path ?? value?.field ?? "";
  if (typeof raw !== "string" || raw.trim() === "") return "/";
  const parts = raw.trim().replace(/^\/*/, "").replace(/\./g, "/").split("/").filter(Boolean);
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function normalizeStage(value, fallback) {
  return VALIDATION_STAGES.includes(value) ? value : VALIDATION_STAGES.includes(fallback) ? fallback : DEFAULT_STAGE;
}

export function normalizeValidationIssues(errors = [], { validator, stage } = {}) {
  return Object.freeze((Array.isArray(errors) ? errors : [errors]).map((entry) => {
    const issue = entry && typeof entry === "object" ? entry : { code: "invalid_issue", message: String(entry) };
    const code = typeof issue.code === "string" && issue.code ? issue.code : "validation_failed";
    return freezeIssue({
      validatorId: validator?.id,
      validatorVersion: validator?.version,
      stage: normalizeStage(issue.stage, validator?.stage || stage),
      path: normalizePath(issue),
      code,
      message: typeof issue.message === "string" && issue.message ? issue.message : code,
      category: classifyFailure({ ...issue, category: issue.category || "validation" }),
      detail: issue.detail,
    });
  }));
}

export function normalizeValidationResult(result, metadata = {}) {
  const output = result && typeof result === "object" ? result : {};
  let issues = normalizeValidationIssues(Array.isArray(output.issues) ? output.issues : output.errors || [], metadata);
  if (output.ok === false && issues.length === 0) issues = normalizeValidationIssues([{ code: "validation_failed" }], metadata);
  return Object.freeze({ ok: output.ok === undefined ? issues.length === 0 : Boolean(output.ok) && issues.length === 0, issues });
}

function normalizeValidator(validator) {
  if (!validator || typeof validator !== "object" || typeof validator.validate !== "function") throw new TypeError("validator.validate is required");
  const id = typeof validator.id === "string" && validator.id ? validator.id : "";
  if (!id) throw new TypeError("validator.id is required");
  const paths = Array.isArray(validator.paths)
    ? Object.freeze(validator.paths.filter((path) => typeof path === "string" && path).map(normalizePath).sort())
    : Object.freeze([]);
  return Object.freeze({ ...validator, id, version: Number.isInteger(validator.version) && validator.version > 0 ? validator.version : 1, paths });
}

export function createValidatorRegistry(validators = []) {
  const entries = validators.map((validator, order) => ({ validator: normalizeValidator(validator), order }));
  const ordered = entries.sort((a, b) => a.validator.id.localeCompare(b.validator.id) || a.validator.version - b.validator.version || a.order - b.order);
  return Object.freeze({ validators: Object.freeze(ordered.map((entry) => entry.validator)) });
}

function registryValidators(registry) {
  return Array.isArray(registry) ? createValidatorRegistry(registry).validators : registry?.validators || [];
}

export function runValidators(registry, input, context = {}) {
  const issues = [];
  registryValidators(registry).forEach((validator) => {
    try {
      issues.push(...normalizeValidationResult(validator.validate(input, context), { validator, stage: context.stage }).issues);
    } catch (error) {
      issues.push(...normalizeValidationIssues([error], { validator, stage: context.stage }));
    }
  });
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
}

export function selectAffectedValidators(registry, changes = []) {
  const validators = registryValidators(registry);
  const paths = Array.isArray(changes) ? changes.map(normalizePath).filter(Boolean) : [];
  if (paths.length === 0) return Object.freeze(validators.slice());
  return Object.freeze(validators.filter((validator) => (
    validator.paths.length === 0 || paths.some((path) => validator.paths.some((declared) => (
      path === "/" || declared === "/" || path === declared || path.startsWith(`${declared}/`) || declared.startsWith(`${path}/`)
    )))
  )));
}

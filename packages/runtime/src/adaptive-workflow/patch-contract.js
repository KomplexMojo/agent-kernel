export const IMMUTABLE_PATCH_PATHS = Object.freeze([
  "/schema", "/schemaVersion", "/meta/id", "/meta/runId", "/meta/createdAt",
  "/refs/replayResponseRefs", "/idempotency/sideEffectKeys", "/events",
]);
const OPS = new Set(["add", "replace", "remove"]);
const KINDS = new Set(["syntax_repair", "semantic_patch", "normalization"]);
const POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function decodePointer(path) {
  if (typeof path !== "string" || path === "" || !path.startsWith("/")) throw issue("invalid_pointer", path, "path must be a non-root JSON Pointer");
  return path.slice(1).split("/").map((part) => {
    if (/~(?![01])/u.test(part)) throw issue("invalid_pointer", path, "path contains an invalid JSON Pointer escape");
    const decoded = part.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (POLLUTION_KEYS.has(decoded)) throw issue("unsafe_path", path, "path contains an unsafe segment");
    return decoded;
  });
}

function issue(code, path, message) { return { code, path: path || "/", message }; }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function ref(value) { return object(value) && typeof value.id === "string" && value.id && typeof value.schema === "string" && value.schema && value.schemaVersion === 1; }
function stringArray(value) { return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function prefixOf(left, right) { return left.length <= right.length && left.every((part, index) => part === right[index]); }
function overlaps(left, right) { return prefixOf(left, right) || prefixOf(right, left); }
function immutableName(parts) {
  return parts.some((part) => /(?:Ref|Refs|Hash|Hashes)$/u.test(part) || ["modelResponses", "idempotencyKey", "idempotencyKeys", "sideEffectReceipts", "completedTerminalEvents"].includes(part));
}

export function validatePatchRequest(request) {
  const issues = [];
  if (!request || typeof request !== "object" || Array.isArray(request)) issues.push(issue("invalid_request", "/", "patch request must be an object"));
  else {
    if (request.schema !== "agent-kernel/AdaptiveWorkflowPatchRequest" || request.schemaVersion !== 1) issues.push(issue("invalid_schema", "/schema", "unsupported patch request schema"));
    if (typeof request.requestId !== "string" || !request.requestId || typeof request.runId !== "string" || !request.runId) issues.push(issue("invalid_identity", "/requestId", "requestId and runId are required"));
    if (!KINDS.has(request.kind)) issues.push(issue("invalid_kind", "/kind", "unsupported patch kind"));
    if (!object(request.meta) || request.meta.id !== request.requestId || request.meta.runId !== request.runId || typeof request.meta.createdAt !== "string") issues.push(issue("invalid_meta", "/meta", "valid matching metadata is required"));
    if (request.phase !== "repair") issues.push(issue("invalid_phase", "/phase", "patch requests must target the repair phase"));
    if (!ref(request.targetRef)) issues.push(issue("invalid_target_ref", "/targetRef", "targetRef must be an artifact ref"));
    if (!object(request.reason) || typeof request.reason.summary !== "string" || !request.reason.summary) issues.push(issue("invalid_reason", "/reason", "repair reason summary is required"));
    if (!stringArray(request.immutablePaths) || !stringArray(request.affectedValidators)) issues.push(issue("invalid_routing", "/immutablePaths", "immutablePaths and affectedValidators must be string arrays"));
    if (!Array.isArray(request.operations) || (request.kind !== "syntax_repair" && request.operations.length === 0)) issues.push(issue("invalid_operations", "/operations", "patch operations are required"));
    const immutable = [...IMMUTABLE_PATCH_PATHS, ...(Array.isArray(request.immutablePaths) ? request.immutablePaths : [])].flatMap((path) => { try { return [decodePointer(path)]; } catch (error) { issues.push(error); return []; } });
    (Array.isArray(request.operations) ? request.operations : []).forEach((operation, index) => {
      const base = `/operations/${index}`;
      if (!operation || typeof operation !== "object" || !OPS.has(operation.op)) { issues.push(issue("invalid_operation", `${base}/op`, "unsupported patch operation")); return; }
      if (operation.op !== "remove" && !("value" in operation)) issues.push(issue("missing_value", `${base}/value`, "add and replace require value"));
      try {
        const parts = decodePointer(operation.path);
        if (immutableName(parts) || immutable.some((path) => overlaps(parts, path))) issues.push(issue("immutable_path", operation.path, "patch operation overlaps an immutable path"));
      } catch (error) { issues.push(error); }
    });
    if (request.kind === "syntax_repair" && Array.isArray(request.operations) && request.operations.length > 0) issues.push(issue("semantic_syntax_repair", "/kind", "syntax repair cannot mutate parsed semantics"));
  }
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues.map(Object.freeze)) });
}

function parentAt(root, parts, path) {
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    if (parent === null || typeof parent !== "object" || !Object.hasOwn(parent, part)) throw issue("missing_path", path, "patch parent does not exist");
    parent = parent[part];
  }
  return [parent, parts.at(-1)];
}

function touchesContentRef(root, parts) {
  let value = root;
  for (let index = 0; index <= parts.length; index += 1) {
    if (object(value) && typeof value.algorithm === "string" && typeof value.digest === "string") return true;
    if (index === parts.length) return containsContentRef(value);
    if (!object(value) && !Array.isArray(value) || !Object.hasOwn(value, parts[index])) return false;
    value = value[parts[index]];
  }
  return false;
}

function containsContentRef(value) {
  if (object(value) && typeof value.algorithm === "string" && typeof value.digest === "string") return true;
  if (object(value) && typeof value.id === "string" && typeof value.schema === "string" && Number.isInteger(value.schemaVersion)) return true;
  return Boolean(value && typeof value === "object" && Object.entries(value).some(([key, child]) => immutableName([key]) || containsContentRef(child)));
}

function applyOperation(root, operation) {
  const parts = decodePointer(operation.path);
  if (touchesContentRef(root, parts)) throw issue("immutable_path", operation.path, "patch operation overlaps an immutable content-addressed ref");
  const [parent, key] = parentAt(root, parts, operation.path);
  if (parent === null || typeof parent !== "object") throw issue("missing_path", operation.path, "patch parent is not an object");
  if (Array.isArray(parent)) {
    const index = key === "-" ? parent.length : /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : Number.NaN;
    if (!Number.isInteger(index) || index < 0 || index > parent.length || (operation.op !== "add" && index === parent.length)) throw issue("invalid_index", operation.path, "invalid array index");
    if (operation.op === "add") parent.splice(index, 0, clone(operation.value));
    else if (operation.op === "remove") parent.splice(index, 1);
    else parent[index] = clone(operation.value);
    return;
  }
  if (operation.op !== "add" && !Object.hasOwn(parent, key)) throw issue("missing_path", operation.path, "patch target does not exist");
  if (operation.op === "remove") delete parent[key]; else parent[key] = clone(operation.value);
}

export function applyPatchRequest(input, request) {
  const validation = validatePatchRequest(request);
  if (!validation.ok) throw Object.assign(new Error(validation.issues[0].message), validation.issues[0], { category: "validation" });
  const value = JSON.parse(JSON.stringify(input));
  try { request.operations.forEach((operation) => applyOperation(value, operation)); }
  catch (error) { throw Object.assign(new Error(error.message), error, { category: "validation" }); }
  return Object.freeze({ value, changedPaths: Object.freeze(request.operations.map(({ path }) => path)) });
}

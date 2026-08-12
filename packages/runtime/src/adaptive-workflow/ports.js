import { createValidatorRegistry } from "./validators.js";
export function createAdaptiveWorkflowPorts(input = {}) {
  const clock = typeof input.clock === "function" ? input.clock : input.clock?.now;
  if (typeof clock !== "function") throw new TypeError("AdaptiveWorkflowPorts.clock is required");
  if (!input.model || typeof input.model.generate !== "function") throw new TypeError("AdaptiveWorkflowPorts.model.generate is required");
  const validator = createValidatorRegistry(input.validator || []);
  if (validator.validators.length === 0) throw new TypeError("AdaptiveWorkflowPorts.validator is required");
  return Object.freeze({
    model: input.model,
    validator,
    clock,
    id: normalizeIdPort(input.id),
    artifactStore: normalizeOptionalPort(input.artifactStore, ["put"]),
    execution: normalizeOptionalPort(input.execution, ["run"]),
    persistence: normalizeOptionalPort(input.persistence, ["save", "load", "putContent", "getContent", "reserveSideEffect", "completeSideEffect", "abortSideEffect"]),
    runtimeProfile: input.runtimeProfile,
  });
}
function normalizeIdPort(id) {
  if (id && typeof id.next === "function") return id;
  let sequence = 0;
  return Object.freeze({
    next(prefix = "adaptive") {
      sequence += 1;
      return `${prefix}_${String(sequence).padStart(3, "0")}`;
    },
  });
}

function normalizeOptionalPort(port, methods) {
  if (!port) return undefined;
  for (const method of methods) {
    if (typeof port[method] !== "function") throw new TypeError(`AdaptiveWorkflowPorts.${method} must be a function`);
  }
  return port;
}

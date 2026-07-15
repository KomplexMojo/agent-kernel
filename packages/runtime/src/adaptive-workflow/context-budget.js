export const CONTEXT_BUDGET_SCHEMA = "agent-kernel/ContextBudget";
const SCHEMA_VERSION = 1;

export function calculateContextBudget({
  declaredCapability,
  runtimeProfile,
  policy,
  requestedOutputTokens = 0,
  toolReserveTokens = 0,
} = {}) {
  if (!declaredCapability || !policy) throw new Error("declaredCapability and policy are required");
  const limits = [
    limit("declaredCapability.providerContextWindowTokens", declaredCapability.providerContextWindowTokens),
    limit("declaredCapability.contextWindowTokens", declaredCapability.contextWindowTokens),
    limit("runtimeProfile.capabilities.maxContextTokens", runtimeProfile?.capabilities?.maxContextTokens),
    limit("policy.context.maxContextTokens", policy.context?.maxContextTokens),
  ].filter(Boolean);
  const contextWindowTokens = limits.length ? Math.min(...limits.map((item) => item.tokens)) : 0;
  const outputReserveTokens = minPositive([
    requestedOutputTokens,
    declaredCapability.maxOutputTokens,
    policy.context?.maxOutputTokens,
  ]);
  const toolTokens = [toolReserveTokens, policy.context?.toolReserveTokens].filter(positive);
  const toolReserve = toolTokens.length ? Math.max(...toolTokens) : 0;
  return deepFreeze({
    schema: CONTEXT_BUDGET_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    contextWindowTokens,
    outputReserveTokens,
    toolReserveTokens: toolReserve,
    inputBudgetTokens: Math.max(0, contextWindowTokens - outputReserveTokens - toolReserve),
    limitingSources: limits.filter((item) => item.tokens === contextWindowTokens).map((item) => item.source),
    provenance: { limits },
  });
}

function limit(source, tokens) { return positive(tokens) ? { source, tokens } : null; }
function minPositive(values) {
  const positiveValues = values.filter(positive);
  return positiveValues.length ? Math.min(...positiveValues) : 0;
}
function positive(value) { return Number.isInteger(value) && value > 0; }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function deepFreeze(value) {
  if (isObject(value) || Array.isArray(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

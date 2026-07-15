export const MODEL_ADAPTER_SCHEMA_VERSION = 1;
/** @typedef {string} ModelProviderId */
/** @typedef {{ inputTokens: number|null, outputTokens: number|null, totalTokens: number|null }} ModelUsageV1 */
/** @typedef {{ startedAt: string|null, endedAt: string|null, durationMs: number|null }} ModelLatencyV1 */
/** @typedef {{ schemaVersion: 1, modelId: string, prompt: string, options?: object, responseFormat?: "text"|"json", stream?: boolean }} ModelRequestV1 */
/** @typedef {{ schemaVersion: 1, providerId: ModelProviderId, modelId: string|null, supports: object, contextWindowTokens: number|null, maxOutputTokens: number|null, source: string }} ModelCapabilityProfileV1 */
/** @typedef {{ schemaVersion: 1, ok: boolean, providerId: ModelProviderId, modelId: string|null, text: string, content: object[], usage: ModelUsageV1, latency: ModelLatencyV1, finishReason?: string|null, raw?: unknown, failure?: object }} ModelResponseV1 */
/** @typedef {{ providerId: ModelProviderId, capabilityProfile: ModelCapabilityProfileV1, generateModel(request: ModelRequestV1): Promise<ModelResponseV1> }} ModelAdapterPort */
const MODEL_REQUEST_FIELDS = new Set(["schemaVersion", "modelId", "prompt", "options", "responseFormat", "stream"]);
const MODEL_REQUEST_OPTION_FIELDS = new Set(["temperature", "maxTokens", "topP", "seed"]);
const MODEL_RESPONSE_FIELDS = new Set(["schemaVersion", "ok", "providerId", "modelId", "text", "content", "usage", "latency", "finishReason", "raw", "failure"]);
const MODEL_FAILURE_FIELDS = new Set(["category", "reason", "message"]);
const RESPONSE_FORMATS = new Set(["text", "json"]);
export function createModelRequestV1({
  modelId, prompt, options = {}, responseFormat = "text", stream = false,
} = {}) {
  const request = freezePlain({ schemaVersion: MODEL_ADAPTER_SCHEMA_VERSION, modelId, prompt, options, responseFormat, stream });
  if (!isModelRequestV1(request)) throw new Error("Invalid ModelRequestV1.");
  return request;
}
export function isModelProviderId(value) { return isNonEmptyString(value); }
export function isModelRequestV1(value) {
  return isObject(value)
    && value.schemaVersion === MODEL_ADAPTER_SCHEMA_VERSION
    && Object.keys(value).every((key) => MODEL_REQUEST_FIELDS.has(key))
    && isNonEmptyString(value.modelId)
    && isNonEmptyString(value.prompt)
    && (value.responseFormat === undefined || RESPONSE_FORMATS.has(value.responseFormat))
    && (value.stream === undefined || typeof value.stream === "boolean")
    && (value.options === undefined || isModelRequestOptions(value.options));
}
export function isModelResponseV1(value) {
  return isObject(value)
    && Object.keys(value).every((key) => MODEL_RESPONSE_FIELDS.has(key))
    && value.schemaVersion === MODEL_ADAPTER_SCHEMA_VERSION
    && typeof value.ok === "boolean"
    && isModelProviderId(value.providerId)
    && (value.modelId === null || isNonEmptyString(value.modelId))
    && typeof value.text === "string"
    && Array.isArray(value.content)
    && value.content.every((item) => isObject(item) && item.type === "text" && typeof item.text === "string")
    && isUsage(value.usage)
    && isLatency(value.latency)
    && (value.ok ? value.failure === undefined : isModelFailure(value.failure));
}
export function createModelCapabilityProfileV1({
  providerId, modelId, contextWindowTokens = null, maxOutputTokens = null, supports = {}, source = "declared",
} = {}) {
  return freezePlain({
    schemaVersion: MODEL_ADAPTER_SCHEMA_VERSION,
    providerId,
    modelId,
    contextWindowTokens,
    maxOutputTokens,
    supports: freezePlain({
      textGeneration: supports.textGeneration !== false,
      structuredOutput: Boolean(supports.structuredOutput),
      streaming: Boolean(supports.streaming),
    }),
    source,
  });
}
export function createModelUsageV1({ inputTokens = null, outputTokens = null, totalTokens = null } = {}) {
  const total = totalTokens ?? (Number.isFinite(inputTokens) && Number.isFinite(outputTokens) ? inputTokens + outputTokens : null);
  return freezePlain({ inputTokens, outputTokens, totalTokens: total });
}
export function createModelLatencyV1({ startedAt = null, endedAt = null, durationMs = null } = {}) {
  return freezePlain({ startedAt, endedAt, durationMs: durationMs ?? durationBetween(startedAt, endedAt) });
}
export function createModelResponseV1({ providerId, modelId, text, raw, usage, latency, finishReason = null } = {}) {
  const body = text ?? "";
  return freezePlain({
    schemaVersion: MODEL_ADAPTER_SCHEMA_VERSION,
    ok: true,
    providerId,
    modelId,
    text: body,
    content: Object.freeze([{ type: "text", text: body }]),
    usage: usage ?? createModelUsageV1(),
    latency: latency ?? createModelLatencyV1(),
    finishReason,
    raw,
  });
}
export function createModelFailureResponseV1({ providerId, modelId = null, category, reason, message, latency } = {}) {
  return freezePlain({
    schemaVersion: MODEL_ADAPTER_SCHEMA_VERSION,
    ok: false,
    providerId,
    modelId,
    text: "",
    content: Object.freeze([]),
    usage: createModelUsageV1(),
    latency: latency ?? createModelLatencyV1(),
    failure: freezePlain({ category, reason, message }),
  });
}
function durationBetween(startedAt, endedAt) {
  const start = Date.parse(startedAt); const end = Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}
function isUsage(value) { return isObject(value) && nullableNumber(value.inputTokens) && nullableNumber(value.outputTokens) && nullableNumber(value.totalTokens); }
function isModelRequestOptions(value) {
  return isObject(value)
    && Object.keys(value).every((key) => MODEL_REQUEST_OPTION_FIELDS.has(key))
    && (value.temperature === undefined || nullableNumber(value.temperature))
    && (value.maxTokens === undefined || nullableNumber(value.maxTokens))
    && (value.topP === undefined || nullableNumber(value.topP))
    && (value.seed === undefined || nullableNumber(value.seed));
}
function isModelFailure(value) {
  return isObject(value)
    && Object.keys(value).every((key) => MODEL_FAILURE_FIELDS.has(key))
    && isNonEmptyString(value.category)
    && isNonEmptyString(value.reason)
    && typeof value.message === "string";
}
function isLatency(value) { return isObject(value) && nullableString(value.startedAt) && nullableString(value.endedAt) && nullableNumber(value.durationMs); }
function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function nullableNumber(value) { return value === null || Number.isFinite(value); }
function nullableString(value) { return value === null || typeof value === "string"; }
function freezePlain(value) { return Object.freeze(value); }

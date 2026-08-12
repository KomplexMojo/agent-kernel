import { createModelCapabilityProfileV1, createModelFailureResponseV1, createModelLatencyV1, createModelResponseV1, createModelUsageV1 } from "../../../../runtime/src/adaptive-workflow/model-adapter.js";
export { createModelFailureResponseV1, createModelLatencyV1, createModelResponseV1, createModelUsageV1 };
export function createCapability(providerId, config = {}, supports = {}) {
  return createModelCapabilityProfileV1({
    providerId, modelId: config.modelId ?? null, contextWindowTokens: config.contextWindowTokens ?? null, maxOutputTokens: config.maxOutputTokens ?? null, supports,
  });
}
export async function postJson(fetchFn, url, body, headers, { errorPrefix = "Model request failed" } = {}) {
  const response = await fetchFn(url, {
    method: "POST",
    headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = new Error(`${errorPrefix}: ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
export function failureFromError(providerId, error, { modelId, startedAt, endedAt }) {
  const reason = error?.name === "AbortError" ? "cancelled" : error?.name === "TimeoutError" || error?.status === 408 || error?.status === 504 ? "timeout" : "request_failed";
  return createModelFailureResponseV1({
    providerId, modelId, category: reason === "cancelled" ? "cancellation" : "model_transport", reason, message: error?.message ?? String(error), latency: createModelLatencyV1({ startedAt, endedAt }),
  });
}
export function failureResponse(providerId, reason, message, { modelId = null, startedAt, endedAt, category = "model_transport" } = {}) {
  return createModelFailureResponseV1({
    providerId, modelId, category, reason, message, latency: createModelLatencyV1({ startedAt, endedAt }),
  });
}
export function providerError(raw) {
  if (!raw?.error) return null;
  if (typeof raw.error === "string") return raw.error;
  return raw.error.message ?? raw.error.type ?? raw.error.code ?? "Provider error.";
}
export function assertAdapterArgs(label, { fetchFn, endpoint, clock }) {
  if (typeof fetchFn !== "function") throw new Error(`${label} model adapter requires fetchFn.`);
  if (endpoint !== undefined && (typeof endpoint !== "string" || endpoint.length === 0)) {
    throw new Error(`${label} model adapter requires config.endpoint.`);
  }
  if (typeof clock !== "function") throw new Error(`${label} model adapter requires clock.`);
}

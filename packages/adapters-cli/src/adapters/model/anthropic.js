import { assertAdapterArgs, createCapability, createModelLatencyV1, createModelResponseV1, createModelUsageV1, failureFromError, failureResponse, postJson, providerError } from "./shared.js";
const PROVIDER_ID = "anthropic";
export function createAnthropicModelAdapter({ fetchFn, config = {}, auth = {}, clock } = {}) {
  assertAdapterArgs("Anthropic", { fetchFn, endpoint: config.endpoint, clock });
  const capabilityProfile = createCapability(PROVIDER_ID, config, { textGeneration: true, structuredOutput: false, streaming: false });
  async function generateModel(request = {}) {
    const startedAt = clock();
    if (!auth.apiKey) return failureResponse(PROVIDER_ID, "missing_credentials", "Anthropic model adapter requires auth.apiKey.", { modelId: request.modelId, startedAt, endedAt: clock() });
    if (request.responseFormat === "json") return failureResponse(PROVIDER_ID, "unsupported_response_format", "Anthropic adapter does not declare structured output support.", { modelId: request.modelId, startedAt, endedAt: clock(), category: "model_contract" });
    try {
      const raw = await postJson(fetchFn, config.endpoint, buildAnthropicRequest(request), {
        "anthropic-version": config.version,
        "content-type": "application/json",
        "x-api-key": auth.apiKey,
      });
      return normalizeAnthropicResponse(raw, { startedAt, endedAt: clock() });
    } catch (error) {
      return failureFromError(PROVIDER_ID, error, { modelId: request.modelId, startedAt, endedAt: clock() });
    }
  }
  return Object.freeze({ providerId: PROVIDER_ID, capabilityProfile, generateModel });
}
function buildAnthropicRequest(request) {
  const body = {
    model: request.modelId,
    max_tokens: request.options?.maxTokens ?? 1024,
    messages: [{ role: "user", content: request.prompt }],
  };
  if (request.options?.temperature !== undefined) body.temperature = request.options.temperature;
  if (request.responseFormat === "json") body.system = "Return JSON only.";
  return body;
}
function normalizeAnthropicResponse(raw, timing) {
  const error = providerError(raw);
  if (error) return failureResponse(PROVIDER_ID, "provider_error", error, { modelId: raw.model ?? null, ...timing });
  const text = raw.content?.find((part) => typeof part.text === "string")?.text ?? "";
  return createModelResponseV1({
    providerId: PROVIDER_ID,
    modelId: raw.model ?? null,
    text,
    raw,
    usage: createModelUsageV1({
      inputTokens: raw.usage?.input_tokens ?? null,
      outputTokens: raw.usage?.output_tokens ?? null,
    }),
    latency: createModelLatencyV1(timing),
    finishReason: raw.stop_reason ?? null,
  });
}

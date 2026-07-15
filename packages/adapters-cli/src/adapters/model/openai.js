import { assertAdapterArgs, createCapability, createModelLatencyV1, createModelResponseV1, createModelUsageV1, failureFromError, failureResponse, postJson, providerError } from "./shared.js";
const PROVIDER_ID = "openai";
export function createOpenAiModelAdapter({ fetchFn, config = {}, auth = {}, clock } = {}) {
  assertAdapterArgs("OpenAI", { fetchFn, endpoint: config.endpoint, clock });
  const capabilityProfile = createCapability(PROVIDER_ID, config, { textGeneration: true, structuredOutput: true, streaming: false });
  async function generateModel(request = {}) {
    const startedAt = clock();
    if (!auth.apiKey) return failureResponse(PROVIDER_ID, "missing_credentials", "OpenAI model adapter requires auth.apiKey.", { modelId: request.modelId, startedAt, endedAt: clock() });
    try {
      const raw = await postJson(fetchFn, config.endpoint, buildOpenAiRequest(request), {
        authorization: auth.apiKey ? `Bearer ${auth.apiKey}` : undefined,
        "content-type": "application/json",
      });
      const endedAt = clock();
      return normalizeOpenAiResponse(raw, { startedAt, endedAt });
    } catch (error) {
      return failureFromError(PROVIDER_ID, error, { modelId: request.modelId, startedAt, endedAt: clock() });
    }
  }
  return Object.freeze({ providerId: PROVIDER_ID, capabilityProfile, generateModel });
}
function buildOpenAiRequest(request) {
  const body = { model: request.modelId, input: request.prompt };
  if (request.options?.temperature !== undefined) body.temperature = request.options.temperature;
  if (request.options?.maxTokens !== undefined) body.max_output_tokens = request.options.maxTokens;
  if (request.responseFormat === "json") body.text = { format: { type: "json_object" } };
  return body;
}
function normalizeOpenAiResponse(raw, timing) {
  const error = providerError(raw);
  if (error) return failureResponse(PROVIDER_ID, "provider_error", error, { modelId: raw.model ?? null, ...timing });
  const text = raw.output_text
    ?? raw.output?.flatMap((item) => item.content ?? []).find((part) => typeof part.text === "string")?.text
    ?? raw.choices?.[0]?.message?.content
    ?? "";
  return createModelResponseV1({
    providerId: PROVIDER_ID,
    modelId: raw.model ?? null,
    text,
    raw,
    usage: createModelUsageV1({
      inputTokens: raw.usage?.input_tokens ?? raw.usage?.prompt_tokens ?? null,
      outputTokens: raw.usage?.output_tokens ?? raw.usage?.completion_tokens ?? null,
      totalTokens: raw.usage?.total_tokens ?? null,
    }),
    latency: createModelLatencyV1(timing),
    finishReason: raw.status ?? raw.choices?.[0]?.finish_reason ?? null,
  });
}

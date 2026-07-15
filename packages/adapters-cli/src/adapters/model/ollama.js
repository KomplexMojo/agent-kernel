import { DEFAULT_LLM_BASE_URL } from "../../../../runtime/src/contracts/domain-constants.js";
import { assertAdapterArgs, createCapability, createModelLatencyV1, createModelResponseV1, createModelUsageV1, failureFromError, failureResponse, postJson, providerError } from "./shared.js";
const PROVIDER_ID = "ollama";
export function createOllamaModelAdapter({ fetchFn, config = {}, clock = () => null } = {}) {
  assertAdapterArgs("Ollama", { fetchFn, clock });
  const baseUrl = config.baseUrl ?? DEFAULT_LLM_BASE_URL;
  const capabilityProfile = createCapability(PROVIDER_ID, config, { textGeneration: true, structuredOutput: true, streaming: true });
  async function generateModel(request = {}) {
    const startedAt = clock();
    try {
      const raw = await generateRawOllama({
        modelId: request.modelId,
        prompt: request.prompt,
        options: request.options,
        stream: Boolean(request.stream),
        format: request.responseFormat === "json" ? "json" : request.format,
      });
      return normalizeOllamaResponse(raw, { startedAt, endedAt: clock() });
    } catch (error) {
      return failureFromError(PROVIDER_ID, error, { modelId: request.modelId, startedAt, endedAt: clock() });
    }
  }
  async function generateRawOllama({ modelId, model, prompt, options = {}, stream = false, format } = {}) {
    const payload = { model: modelId ?? model, prompt, options, stream };
    if (format) payload.format = format;
    return postJson(fetchFn, `${baseUrl}/api/generate`, payload, { "content-type": "application/json" }, {
      errorPrefix: "LLM request failed",
    });
  }
  return Object.freeze({ providerId: PROVIDER_ID, capabilityProfile, generateModel, generateRawOllama });
}
function normalizeOllamaResponse(raw, timing) {
  const error = providerError(raw);
  if (error) return failureResponse(PROVIDER_ID, "provider_error", error, { modelId: raw.model ?? null, ...timing });
  return createModelResponseV1({
    providerId: PROVIDER_ID,
    modelId: raw.model ?? null,
    text: raw.response ?? "",
    raw,
    usage: createModelUsageV1({
      inputTokens: raw.prompt_eval_count ?? null,
      outputTokens: raw.eval_count ?? null,
    }),
    latency: createModelLatencyV1({
      ...timing,
      durationMs: typeof raw.total_duration === "number" ? Math.round(raw.total_duration / 1_000_000) : null,
    }),
    finishReason: raw.done ? "stop" : null,
  });
}

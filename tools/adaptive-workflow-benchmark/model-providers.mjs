import { createLlmAdapter } from "../../packages/adapters-cli/src/adapters/llm/index.js";
import { createOpenAiModelAdapter, createAnthropicModelAdapter } from "../../packages/adapters-cli/src/adapters/model/index.js";

const DEFAULT_ENDPOINTS = {
  openai: "https://api.openai.com/v1/responses",
  anthropic: "https://api.anthropic.com/v1/messages",
};

// The M2 provider adapters speak generateModel(ModelRequestV1) -> ModelResponseV1,
// while the Orchestrator LLM seam expects generate({model,prompt,options,format,stream})
// -> a raw payload whose text lives at `.response`. This bridge adapts the former
// to the latter so OpenAI/Anthropic can drive the AdaptiveWorkflowAgent unchanged.
export function bridgeModelAdapter(m2Adapter, { model } = {}) {
  return {
    async generate({ model: reqModel, prompt, options, format } = {}) {
      const request = {
        modelId: reqModel || model,
        prompt,
        options: {
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(Number.isInteger(options?.num_predict) ? { maxTokens: options.num_predict } : {}),
        },
        ...(format === "json" || options?.format === "json" ? { responseFormat: "json" } : {}),
      };
      const response = await m2Adapter.generateModel(request);
      if (!response || response.ok !== true) {
        const reason = response?.reason || response?.failure?.reason || "model_failure";
        const message = response?.message || response?.failure?.message || `Model provider returned a failure (${reason})`;
        throw Object.assign(new Error(message), { code: reason, category: response?.category || response?.failure?.category });
      }
      return { response: response.text };
    },
  };
}

// Returns a modelFactory (scenario) => modelPort for the benchmark driver.
// `ollama` (default) uses the Ollama-compatible adapter directly; `openai` /
// `anthropic` build the M2 adapter (reading the API key from env unless supplied)
// and wrap it in the bridge. Credentials are never logged; the adapter fails
// before any request when the key is absent.
export function createModelFactory({
  provider = "ollama",
  baseUrl,
  model,
  endpoint,
  apiKey,
  fetchFn = globalThis.fetch,
  clock = () => new Date().toISOString(),
} = {}) {
  if (provider === "ollama") {
    if (!baseUrl) throw new Error("provider 'ollama' requires --base-url");
    return () => createLlmAdapter({ baseUrl });
  }

  const factories = { openai: createOpenAiModelAdapter, anthropic: createAnthropicModelAdapter };
  const envKeys = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
  const factory = factories[provider];
  if (!factory) throw new Error(`Unknown provider '${provider}'. Use ollama, openai, or anthropic.`);

  const resolvedKey = apiKey || process.env[envKeys[provider]];
  const adapter = factory({
    fetchFn,
    clock,
    config: { endpoint: endpoint || DEFAULT_ENDPOINTS[provider], modelId: model },
    auth: { apiKey: resolvedKey },
  });
  return () => bridgeModelAdapter(adapter, { model });
}

export { DEFAULT_ENDPOINTS };

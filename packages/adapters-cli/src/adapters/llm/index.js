import { DEFAULT_LLM_BASE_URL } from "../../../../runtime/src/contracts/domain-constants.js";
import { createOllamaModelAdapter } from "../model/ollama.js";
export function createLlmAdapter({ baseUrl = DEFAULT_LLM_BASE_URL, fetchFn = globalThis.fetch, fixture } = {}) {
  if (fixture !== undefined) {
    const response = JSON.parse(JSON.stringify(fixture));
    return { generate: async () => JSON.parse(JSON.stringify(response)) };
  }
  if (!fetchFn) {
    throw new Error("LLM adapter requires a fetch implementation.");
  }
  const adapter = createOllamaModelAdapter({ fetchFn, config: { baseUrl } });
  async function generate({ model, prompt, options = {}, stream = false, format } = {}) {
    if (!model || !prompt) {
      throw new Error("LLM generate requires model and prompt.");
    }
    return adapter.generateRawOllama({ model, prompt, options, stream, format });
  }
  return {
    generate,
  };
}

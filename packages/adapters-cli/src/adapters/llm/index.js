export function createLlmAdapter({ baseUrl = "http://localhost:11434", fetchFn = globalThis.fetch } = {}) {
  if (!fetchFn) {
    throw new Error("LLM adapter requires a fetch implementation.");
  }

  async function generate({ model, prompt, options = {}, stream = false, format } = {}) {
    if (!model || !prompt) {
      throw new Error("LLM generate requires model and prompt.");
    }
    const payload = { model, prompt, options, stream };
    if (format) {
      payload.format = format;
    }
    const response = await fetchFn(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  return {
    generate,
  };
}

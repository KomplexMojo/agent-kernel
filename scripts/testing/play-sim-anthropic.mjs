/**
 * Anthropic provider for the play-sim drivers (#679), beside the Ollama one. It answers the same
 * `generate({ model, prompt, options, format })` call the drivers already make and returns
 * `{ response: <text> }`, so `llmSeatPicker`, `llmPicker` and the LLM build source use it unchanged.
 *
 * Model calls live here, in the script layer; nothing in `runtime` or `core-ts` imports a provider.
 * The key comes from ANTHROPIC_API_KEY only and is never written to a log, a card or an error:
 * `redact` strips it from any text this module throws. Local use, never a merge gate.
 */
export const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_MAX_TOKENS = 512;

/** Replace every occurrence of the key in `text`, so an error can be printed without leaking it. */
export function redact(text, apiKey) {
  const out = String(text ?? "");
  return apiKey ? out.split(apiKey).join("[redacted]") : out;
}

/** `{ generate }` over the Messages API. `fetchFn` is injectable so tests never touch the network. */
export function createAnthropicAdapter({ apiKey, baseUrl = DEFAULT_ANTHROPIC_URL, fetchFn = globalThis.fetch, maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  if (!apiKey) throw new Error("Anthropic provider needs ANTHROPIC_API_KEY in the environment.");
  if (!fetchFn) throw new Error("Anthropic provider requires a fetch implementation.");
  const url = `${String(baseUrl).replace(/\/+$/, "")}/v1/messages`;
  async function generate({ model, prompt, options = {} } = {}) {
    if (!model || !prompt) throw new Error("Anthropic generate requires model and prompt.");
    let response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(Number.isFinite(options.temperature) ? { temperature: options.temperature } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch (error) {
      throw new Error(`Anthropic request failed: ${redact(error?.message, apiKey)}`);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Anthropic request failed (${response.status}): ${redact(body?.error?.message ?? "no detail", apiKey)}`);
    }
    const text = (body.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("").trim();
    return { response: text };
  }
  return { generate };
}

/** The provider named by `--provider` (default ollama). Throws on anything else. */
export function resolveProvider(name, env = process.env) {
  const provider = String(name ?? "ollama").toLowerCase();
  if (provider === "ollama") return { provider };
  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("--provider anthropic needs ANTHROPIC_API_KEY in the environment.");
    return { provider, apiKey: env.ANTHROPIC_API_KEY };
  }
  throw new Error(`unknown --provider ${name} (ollama or anthropic)`);
}

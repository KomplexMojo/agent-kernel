/**
 * Where the play-sim drivers find their model (#655). The benchmarks reach the darren-llm box with
 * `tools/remote-ollama-control/bin/remote-ollama-mac run-local`, which opens a tunnel and exports
 * OLLAMA_HOST (a full URL) and OLLAMA_MODEL to the command it wraps (`--local` points them at the
 * Mac's own Ollama). The play-sim drivers read the same two variables, so the same wrapper runs
 * them unchanged. Flags win over the environment; with neither, the adapter's own default applies.
 */

/** `127.0.0.1:11434` or `http://host:port` to a base URL the adapter accepts. */
export function normalizeHost(host) {
  const text = String(host ?? "").trim();
  if (!text) return undefined;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
}

/** `{ model, baseUrl }` from flags (`--model`, `--ollama-url`) over OLLAMA_MODEL / OLLAMA_HOST. */
export function resolveModelEnv({ model, ollamaUrl } = {}, env = process.env) {
  return {
    model: model || env.OLLAMA_MODEL || undefined,
    baseUrl: normalizeHost(ollamaUrl || env.OLLAMA_HOST),
  };
}

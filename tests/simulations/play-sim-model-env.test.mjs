// #655: the play-sim drivers find their model the way the benchmarks hand it over
// (OLLAMA_HOST / OLLAMA_MODEL from remote-ollama-mac run-local); flags win. No network.
import { expect, test } from "vitest";
import { normalizeHost, resolveModelEnv } from "../../scripts/testing/play-sim-model-env.mjs";

test("a bare host:port becomes a URL; a URL is kept; empty is undefined", () => {
  expect(normalizeHost("127.0.0.1:11436")).toBe("http://127.0.0.1:11436");
  expect(normalizeHost("http://127.0.0.1:11436")).toBe("http://127.0.0.1:11436");
  expect(normalizeHost("")).toBeUndefined();
  expect(normalizeHost(undefined)).toBeUndefined();
});

test("flags win over the environment; the environment fills what a flag leaves out", () => {
  const env = { OLLAMA_HOST: "http://127.0.0.1:11436", OLLAMA_MODEL: "qwen3-coder:30b" };
  expect(resolveModelEnv({}, env)).toEqual({ model: "qwen3-coder:30b", baseUrl: "http://127.0.0.1:11436" });
  expect(resolveModelEnv({ model: "phi4", ollamaUrl: "box:11434" }, env)).toEqual({ model: "phi4", baseUrl: "http://box:11434" });
  expect(resolveModelEnv({}, {})).toEqual({ model: undefined, baseUrl: undefined });
});

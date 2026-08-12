const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const FIXTURE_DIR = join(__dirname, "../fixtures/adaptive-workflow/model-adapters");
const neutralRequest = Object.freeze({
  modelId: "fixture-model",
  prompt: "Return JSON only.",
  options: { temperature: 0, maxTokens: 64 },
  responseFormat: "json",
});
const providers = [
  {
    id: "openai",
    file: "openai-response-v1-basic.json",
    module: "../../packages/adapters-cli/src/adapters/model/openai.js",
    exportName: "createOpenAiModelAdapter",
    args: { config: { endpoint: "https://openai.fixture/v1/responses" }, auth: { apiKey: "test-key" } },
    assertBody: (body) => assert.equal(body.text.format.type, "json_object"),
  },
  {
    id: "anthropic",
    file: "anthropic-response-v1-basic.json",
    module: "../../packages/adapters-cli/src/adapters/model/anthropic.js",
    exportName: "createAnthropicModelAdapter",
    args: { config: { endpoint: "https://anthropic.fixture/v1/messages", version: "2023-06-01" }, auth: { apiKey: "test-key" } },
    assertBody: (body) => assert.deepEqual(body.messages, [{ role: "user", content: neutralRequest.prompt }]),
  },
  {
    id: "ollama",
    file: "ollama-response-v1-basic.json",
    module: "../../packages/adapters-cli/src/adapters/model/ollama.js",
    exportName: "createOllamaModelAdapter",
    args: { config: { baseUrl: "http://ollama.fixture" } },
    assertBody: (body) => assert.equal(body.format, "json"),
  },
];
function fixture(name) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
}
function createJsonFetch(rawResponse, { ok = true, status = 200, statusText = "OK", calls = [] } = {}) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    return { ok, status, statusText, async json() { return rawResponse; } };
  };
}
function createClock(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
async function createFixtureAdapter(provider, fetchFn, clock = createClock("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.123Z")) {
  const mod = await import(provider.module);
  return mod[provider.exportName]({ fetchFn, clock, ...provider.args });
}
test("runtime model adapter contracts are provider neutral", async () => {
  const runtime = await import("../../packages/runtime/src/adaptive-workflow/model-adapter.js");
  const request = runtime.createModelRequestV1(neutralRequest);
  const okResponse = runtime.createModelResponseV1({ providerId: "fixture", modelId: "fixture-model", text: "ok" });
  const failure = runtime.createModelFailureResponseV1({ providerId: "fixture", modelId: "fixture-model", category: "model_transport", reason: "timeout", message: "timeout" });
  assert.equal(runtime.MODEL_ADAPTER_SCHEMA_VERSION, 1);
  assert.equal(runtime.isModelProviderId("local-fixture"), true);
  assert.equal(runtime.isModelProviderId(""), false);
  assert.equal(runtime.isModelRequestV1(request), true);
  assert.equal(runtime.isModelRequestV1({ ...request, endpoint: "https://example.test" }), false);
  assert.equal(runtime.isModelRequestV1({ ...request, headers: { authorization: "secret" } }), false);
  assert.equal(runtime.isModelRequestV1({ ...request, apiKey: "secret" }), false);
  assert.equal(runtime.isModelRequestV1({ ...request, stream: "false" }), false);
  assert.equal(runtime.isModelRequestV1({ ...request, options: { baseUrl: "http://provider.test" } }), false);
  assert.equal(runtime.isModelResponseV1(okResponse), true);
  assert.equal(runtime.isModelResponseV1({ ...okResponse, ok: true, failure: { category: "x", reason: "y", message: "z" } }), false);
  assert.equal(runtime.isModelResponseV1(failure), true);
  assert.equal(runtime.isModelResponseV1({ ...failure, failure: undefined }), false);
});
for (const provider of providers) {
  test(`${provider.id} adapter normalizes fixture response into ModelResponseV1`, async () => {
    const data = fixture(provider.file);
    const calls = [];
    const adapter = await createFixtureAdapter(provider, createJsonFetch(data.raw, { calls }));
    const request = provider.id === "anthropic" ? { ...neutralRequest, responseFormat: "text" } : neutralRequest;
    const response = await adapter.generateModel(request);
    assert.equal(response.schemaVersion, 1);
    assert.equal(response.providerId, data.providerId);
    assert.equal(response.modelId, data.expected.modelId);
    assert.equal(response.text, data.expected.text);
    assert.deepEqual(response.usage, data.expected.usage);
    assert.equal(response.finishReason, data.expected.finishReason);
    assert.equal(response.ok, true);
    assert.equal(response.latency.durationMs, provider.id === "ollama" ? 250 : 123);
    assert.equal(adapter.capabilityProfile.supports.structuredOutput, provider.id !== "anthropic");
    assert.equal("endpoint" in adapter.capabilityProfile, false);
    assert.equal("headers" in adapter.capabilityProfile, false);
    assert.equal("baseUrl" in adapter.capabilityProfile, false);
    provider.assertBody(JSON.parse(calls[0].init.body));
  });
}
test("OpenAI and Anthropic missing credentials fail before fetch", async () => {
  for (const provider of providers.filter((item) => item.id !== "ollama")) {
    const calls = [];
    const args = { ...provider.args, auth: {} };
    const mod = await import(provider.module);
    const adapter = mod[provider.exportName]({ fetchFn: createJsonFetch({}, { calls }), clock: createClock("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.001Z"), ...args });
    const response = await adapter.generateModel({ ...neutralRequest, responseFormat: "text" });
    assert.equal(response.ok, false);
    assert.equal(response.failure.reason, "missing_credentials");
    assert.equal(calls.length, 0);
  }
});
test("successful HTTP provider error envelopes map to failure responses", async () => {
  for (const provider of providers) {
    const adapter = await createFixtureAdapter(provider, createJsonFetch({ error: { message: `${provider.id} nope` } }));
    const response = await adapter.generateModel({ ...neutralRequest, responseFormat: provider.id === "anthropic" ? "text" : "json" });
    assert.equal(response.ok, false);
    assert.equal(response.failure.reason, "provider_error");
    assert.match(response.failure.message, /nope/);
  }
});
test("Anthropic rejects unsupported structured output before fetch", async () => {
  const provider = providers.find((item) => item.id === "anthropic");
  const calls = [];
  const adapter = await createFixtureAdapter(provider, createJsonFetch({}, { calls }));
  const response = await adapter.generateModel(neutralRequest);
  assert.equal(response.ok, false);
  assert.equal(response.failure.category, "model_contract");
  assert.equal(response.failure.reason, "unsupported_response_format");
  assert.equal(calls.length, 0);
});
test("legacy createLlmAdapter keeps Ollama raw response behavior", async () => {
  const { createLlmAdapter } = await import("../../packages/adapters-cli/src/adapters/llm/index.js");
  const data = fixture("ollama-response-v1-basic.json");
  const adapter = createLlmAdapter({ baseUrl: "http://ollama.fixture", fetchFn: createJsonFetch(data.raw) });
  const response = await adapter.generate({ model: "ollama-fixture", prompt: "Return JSON only.", options: { temperature: 0 }, stream: false, format: "json" });
  assert.deepEqual(response, data.raw);
});
test("model adapters classify timeout and cancellation consistently", async () => {
  const cases = [
    { reason: "timeout", error: Object.assign(new Error("deadline exceeded"), { name: "TimeoutError" }) },
    { reason: "cancelled", error: Object.assign(new Error("aborted"), { name: "AbortError" }) },
    { reason: "timeout", status: 408, statusText: "Request Timeout" },
    { reason: "timeout", status: 504, statusText: "Gateway Timeout" },
  ];
  for (const provider of providers) {
    for (const item of cases) {
      const fetchFn = item.error
        ? async () => { throw item.error; }
        : createJsonFetch({}, { ok: false, status: item.status, statusText: item.statusText });
      const adapter = await createFixtureAdapter(provider, fetchFn);
      const request = provider.id === "anthropic" ? { ...neutralRequest, responseFormat: "text" } : neutralRequest;
      const response = await adapter.generateModel(request);
      assert.equal(response.ok, false);
      assert.equal(response.failure.reason, item.reason);
      assert.equal(response.failure.category, item.reason === "cancelled" ? "cancellation" : "model_transport");
    }
  }
});
test("model adapter index exports all providers", async () => {
  const model = await import("../../packages/adapters-cli/src/adapters/model/index.js");
  assert.equal(typeof model.createOpenAiModelAdapter, "function");
  assert.equal(typeof model.createAnthropicModelAdapter, "function");
  assert.equal(typeof model.createOllamaModelAdapter, "function");
});
// ## TODO: Test Permutations
// - missing usage should normalize to null usage fields without failing the response
// - provider error envelope variants should map to stable model_transport failures
// - cancellation before response should return cancellation without a partial raw payload
// - unsupported structured-output capability should reject JSON responseFormat before provider fetch

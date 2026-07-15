const assert = require("node:assert/strict");

async function load() {
  return import("../../tools/adaptive-workflow-benchmark/model-providers.mjs");
}

test("bridge maps seam requests to ModelRequestV1 and unwraps the response text", async () => {
  const { bridgeModelAdapter } = await load();
  let seen = null;
  const m2 = { generateModel: async (request) => { seen = request; return { ok: true, text: "hello world", modelId: request.modelId }; } };
  const port = bridgeModelAdapter(m2, { model: "default-model" });
  const result = await port.generate({ model: "gpt-x", prompt: "make a room", options: { num_predict: 512, temperature: 0.2 }, format: "json" });
  assert.deepEqual(result, { response: "hello world" });
  assert.equal(seen.modelId, "gpt-x");
  assert.equal(seen.prompt, "make a room");
  assert.equal(seen.options.maxTokens, 512);
  assert.equal(seen.options.temperature, 0.2);
  assert.equal(seen.responseFormat, "json");
});

test("bridge falls back to the factory model and rejects failure responses", async () => {
  const { bridgeModelAdapter } = await load();
  const okPort = bridgeModelAdapter({ generateModel: async (r) => ({ ok: true, text: `m=${r.modelId}` }) }, { model: "fallback" });
  assert.deepEqual(await okPort.generate({ prompt: "p" }), { response: "m=fallback" });

  const failPort = bridgeModelAdapter({ generateModel: async () => ({ ok: false, reason: "missing_credentials", message: "no key configured" }) }, { model: "m" });
  await assert.rejects(() => failPort.generate({ prompt: "p" }), /no key configured/);
});

test("createModelFactory selects the ollama adapter by default", async () => {
  const { createModelFactory } = await load();
  const factory = createModelFactory({ provider: "ollama", baseUrl: "http://localhost:21436" });
  const port = factory();
  assert.equal(typeof port.generate, "function");
  assert.throws(() => createModelFactory({ provider: "ollama" }), /requires --base-url/);
  assert.throws(() => createModelFactory({ provider: "bogus", model: "x", apiKey: "k" }), /Unknown provider/);
});

test("createModelFactory wires OpenAI end-to-end through a stub fetch (no network, no real key)", async () => {
  const { createModelFactory } = await load();
  let calledUrl = null;
  const fetchFn = async (url) => { calledUrl = url; return { ok: true, json: async () => ({ output_text: "OK-from-openai", model: "gpt-test", status: "completed" }) }; };
  const factory = createModelFactory({ provider: "openai", model: "gpt-test", apiKey: "test-key", fetchFn, clock: () => "2026-07-14T00:00:00.000Z" });
  const port = factory();
  const result = await port.generate({ model: "gpt-test", prompt: "hi" });
  assert.deepEqual(result, { response: "OK-from-openai" });
  assert.match(calledUrl, /api\.openai\.com/);
});

// ## TODO: Test Permutations
// - anthropic provider selection and header shape
// - timeout/abort failures surface as model_transport rejections
// - endpoint override is honored

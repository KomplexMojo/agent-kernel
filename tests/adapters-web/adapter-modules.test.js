const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ipfsModule = moduleUrl("packages/adapters-web/src/adapters/ipfs/index.js");
const blockchainModule = moduleUrl("packages/adapters-web/src/adapters/blockchain/index.js");
const llmModule = moduleUrl("packages/adapters-web/src/adapters/llm/index.js");

const ipfsScript = `
import assert from "node:assert/strict";
import { createIpfsAdapter } from ${JSON.stringify(ipfsModule)};

const adapter = createIpfsAdapter({
  gatewayUrl: "https://example.com/ipfs",
  fetchFn: async () => ({ ok: true, text: async () => "{}" }),
});

assert.equal(
  adapter.buildUrl("ipfs://cid", "path"),
  "https://example.com/ipfs/cid/path",
);

const failing = createIpfsAdapter({
  gatewayUrl: "https://example.com/ipfs",
  fetchFn: async () => ({ ok: false, status: 500, statusText: "Boom" }),
});
await assert.rejects(() => failing.fetchText("cid"), /IPFS fetch failed/);
`;

const blockchainScript = `
import assert from "node:assert/strict";
import { createBlockchainAdapter } from ${JSON.stringify(blockchainModule)};

assert.throws(() => createBlockchainAdapter({}), /rpcUrl/);

const adapter = createBlockchainAdapter({
  rpcUrl: "http://rpc.local",
  fetchFn: async () => ({ ok: true, json: async () => ({ error: { message: "nope" } }) }),
});
await assert.rejects(() => adapter.getChainId(), /nope/);
`;

const llmScript = `
import assert from "node:assert/strict";
import { createLlmAdapter } from ${JSON.stringify(llmModule)};

const adapter = createLlmAdapter({
  baseUrl: "http://localhost:11434",
  fetchFn: async () => ({ ok: false, status: 500, statusText: "Down" }),
});

await assert.rejects(() => adapter.generate({ model: "m", prompt: "p" }), /LLM request failed/);
assert.throws(() => createLlmAdapter({ fetchFn: null }), /fetch implementation/);
await assert.rejects(() => adapter.generate({ model: "m" }), /model and prompt/);

const timeoutAdapter = createLlmAdapter({
  baseUrl: "http://localhost:11434",
  requestTimeoutMs: 25,
  fetchFn: async () => new Promise(() => {}),
});
const timeoutStartedAt = Date.now();
await assert.rejects(() => timeoutAdapter.generate({ model: "m", prompt: "p" }), /timed out/);
assert.ok(Date.now() - timeoutStartedAt < 1000);
`;

test("ipfs adapter builds URLs and handles fetch errors", () => {
  runEsm(ipfsScript);
});

test("blockchain adapter validates inputs and handles RPC errors", () => {
  runEsm(blockchainScript);
});

test("llm adapter validates inputs and handles HTTP errors", () => {
  runEsm(llmScript);
});

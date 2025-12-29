const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ipfsModule = moduleUrl("packages/adapters-web/src/adapters/ipfs/index.js");
const blockchainModule = moduleUrl("packages/adapters-web/src/adapters/blockchain/index.js");
const ollamaModule = moduleUrl("packages/adapters-web/src/adapters/ollama/index.js");

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

const ollamaScript = `
import assert from "node:assert/strict";
import { createOllamaAdapter } from ${JSON.stringify(ollamaModule)};

const adapter = createOllamaAdapter({
  baseUrl: "http://localhost:11434",
  fetchFn: async () => ({ ok: false, status: 500, statusText: "Down" }),
});

await assert.rejects(() => adapter.generate({ model: "m", prompt: "p" }), /Ollama request failed/);
assert.throws(() => createOllamaAdapter({ fetchFn: null }), /fetch implementation/);
await assert.rejects(() => adapter.generate({ model: "m" }), /model and prompt/);
`;

test("ipfs adapter builds URLs and handles fetch errors", () => {
  runEsm(ipfsScript);
});

test("blockchain adapter validates inputs and handles RPC errors", () => {
  runEsm(blockchainScript);
});

test("ollama adapter validates inputs and handles HTTP errors", () => {
  runEsm(ollamaScript);
});

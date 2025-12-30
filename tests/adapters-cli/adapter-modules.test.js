const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ipfsModule = moduleUrl("packages/adapters-cli/src/adapters/ipfs/index.js");
const blockchainModule = moduleUrl("packages/adapters-cli/src/adapters/blockchain/index.js");
const llmModule = moduleUrl("packages/adapters-cli/src/adapters/llm/index.js");
const solverModule = moduleUrl("packages/adapters-cli/src/adapters/solver-z3/index.js");

const ipfsScript = `
import assert from "node:assert/strict";
import { createIpfsAdapter } from ${JSON.stringify(ipfsModule)};

const adapter = createIpfsAdapter({
  gatewayUrl: "https://example.com/ipfs",
  fetchFn: async () => ({ ok: true, text: async () => "{}" }),
});
assert.equal(adapter.buildUrl("cid", "path"), "https://example.com/ipfs/cid/path");

const failing = createIpfsAdapter({
  gatewayUrl: "https://example.com/ipfs",
  fetchFn: async () => ({ ok: false, status: 404, statusText: "Not Found" }),
});
await assert.rejects(() => failing.fetchJson("cid"), /IPFS fetch failed/);
`;

const blockchainScript = `
import assert from "node:assert/strict";
import { createBlockchainAdapter } from ${JSON.stringify(blockchainModule)};

assert.throws(() => createBlockchainAdapter({}), /rpcUrl/);

const adapter = createBlockchainAdapter({
  rpcUrl: "http://rpc.local",
  fetchFn: async () => ({ ok: false, status: 500, statusText: "Boom" }),
});
await assert.rejects(() => adapter.getBalance("0x123"), /RPC call failed/);
`;

const llmScript = `
import assert from "node:assert/strict";
import { createLlmAdapter } from ${JSON.stringify(llmModule)};

const adapter = createLlmAdapter({
  baseUrl: "http://localhost:11434",
  fetchFn: async () => ({ ok: false, status: 503, statusText: "Down" }),
});
await assert.rejects(() => adapter.generate({ model: "m", prompt: "p" }), /LLM request failed/);
`;

const solverScript = `
import assert from "node:assert/strict";
import { createSolverAdapter } from ${JSON.stringify(solverModule)};

const adapter = createSolverAdapter({});
const result = await adapter.solve({ meta: { id: "test" } });
assert.equal(result.status, "fulfilled");
`;

test("cli ipfs adapter handles URL build and errors", () => {
  runEsm(ipfsScript);
});

test("cli blockchain adapter handles errors", () => {
  runEsm(blockchainScript);
});

test("cli llm adapter handles errors", () => {
  runEsm(llmScript);
});

test("cli solver adapter errors without solver", () => {
  runEsm(solverScript);
});

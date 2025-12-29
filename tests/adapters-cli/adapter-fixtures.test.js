const test = require("node:test");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const ipfsModule = moduleUrl("packages/adapters-cli/src/adapters/ipfs/index.js");
const blockchainModule = moduleUrl("packages/adapters-cli/src/adapters/blockchain/index.js");
const ollamaModule = moduleUrl("packages/adapters-cli/src/adapters/ollama/index.js");

const fixturesScript = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createIpfsAdapter } from ${JSON.stringify(ipfsModule)};
import { createBlockchainAdapter } from ${JSON.stringify(blockchainModule)};
import { createOllamaAdapter } from ${JSON.stringify(ollamaModule)};

const root = ${JSON.stringify(ROOT)};
const ipfsFixturePath = root + "/tests/fixtures/adapters/ipfs-price-list.json";
const chainFixturePath = root + "/tests/fixtures/adapters/blockchain-chain-id.json";
const balanceFixturePath = root + "/tests/fixtures/adapters/blockchain-balance.json";
const ollamaFixturePath = root + "/tests/fixtures/adapters/ollama-generate.json";

const ipfsFixture = await readFile(ipfsFixturePath, "utf8");
const ipfsAdapter = createIpfsAdapter({
  gatewayUrl: "https://example.com/ipfs",
  fetchFn: async () => ({ ok: true, text: async () => ipfsFixture }),
});
const ipfsJson = await ipfsAdapter.fetchJson("cid");
assert.equal(ipfsJson.schema, "agent-kernel/PriceList");

const chainFixture = JSON.parse(await readFile(chainFixturePath, "utf8"));
const balanceFixture = JSON.parse(await readFile(balanceFixturePath, "utf8"));
const blockchainAdapter = createBlockchainAdapter({
  rpcUrl: "http://rpc.local",
  fetchFn: async (_url, options) => {
    const body = JSON.parse(options.body || "{}");
    if (body.method === "eth_chainId") {
      return { ok: true, json: async () => chainFixture };
    }
    if (body.method === "eth_getBalance") {
      return { ok: true, json: async () => balanceFixture };
    }
    return { ok: true, json: async () => ({ result: null }) };
  },
});
const chainId = await blockchainAdapter.getChainId();
assert.equal(chainId, chainFixture.result);
const balance = await blockchainAdapter.getBalance("0xabc");
assert.equal(balance, balanceFixture.result);

const ollamaFixture = JSON.parse(await readFile(ollamaFixturePath, "utf8"));
const ollamaAdapter = createOllamaAdapter({
  baseUrl: "http://localhost:11434",
  fetchFn: async () => ({ ok: true, json: async () => ollamaFixture }),
});
const ollamaResponse = await ollamaAdapter.generate({ model: "fixture", prompt: "hello" });
assert.equal(ollamaResponse.response, "ok");
`;

test("cli adapters use deterministic fixtures", () => {
  runEsm(fixturesScript);
});

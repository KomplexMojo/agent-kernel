const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ipfsModule = moduleUrl("packages/adapters-test/src/adapters/ipfs/index.js");
const blockchainModule = moduleUrl("packages/adapters-test/src/adapters/blockchain/index.js");
const ollamaModule = moduleUrl("packages/adapters-test/src/adapters/ollama/index.js");

const ipfsScript = `
import assert from "node:assert/strict";
import { createIpfsTestAdapter } from ${JSON.stringify(ipfsModule)};

const adapter = createIpfsTestAdapter();
adapter.setFixture("cid", '{"ok": true}');
const json = await adapter.fetchJson("cid");
assert.equal(json.ok, true);
await assert.rejects(() => adapter.fetchText("missing"), /Missing IPFS fixture/);
`;

const blockchainScript = `
import assert from "node:assert/strict";
import { createBlockchainTestAdapter } from ${JSON.stringify(blockchainModule)};

const adapter = createBlockchainTestAdapter({ balances: { "0xabc": "0x1" } });
const balance = await adapter.getBalance("0xabc");
assert.equal(balance, "0x1");
await assert.rejects(() => adapter.getBalance("0xmissing"), /Missing balance fixture/);
`;

const ollamaScript = `
import assert from "node:assert/strict";
import { createOllamaTestAdapter } from ${JSON.stringify(ollamaModule)};

const adapter = createOllamaTestAdapter();
adapter.setResponse("model", "prompt", { response: "ok", done: true });
const result = await adapter.generate({ model: "model", prompt: "prompt" });
assert.equal(result.response, "ok");
const fallback = await adapter.generate({ model: "unknown", prompt: "missing" });
assert.equal(fallback.done, true);
`;

test("ipfs test adapter fixtures", () => {
  runEsm(ipfsScript);
});

test("blockchain test adapter fixtures", () => {
  runEsm(blockchainScript);
});

test("ollama test adapter fixtures", () => {
  runEsm(ollamaScript);
});

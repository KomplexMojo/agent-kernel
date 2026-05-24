const assert = require("node:assert/strict");





test("ipfs test adapter fixtures", async () => {
const { createIpfsTestAdapter } = await import("../../packages/adapters-test/src/adapters/ipfs/index.js");

const adapter = createIpfsTestAdapter();
adapter.setFixture("cid", '{"ok": true}');
const json = await adapter.fetchJson("cid");
assert.equal(json.ok, true);
await assert.rejects(() => adapter.fetchText("missing"), /Missing IPFS fixture/);
});

test("blockchain test adapter fixtures", async () => {
const { createBlockchainTestAdapter } = await import("../../packages/adapters-test/src/adapters/blockchain/index.js");

const adapter = createBlockchainTestAdapter({ balances: { "0xabc": "0x1" } });
const balance = await adapter.getBalance("0xabc");
assert.equal(balance, "0x1");
await assert.rejects(() => adapter.getBalance("0xmissing"), /Missing balance fixture/);
});

test("llm test adapter fixtures", async () => {
const { createLlmTestAdapter } = await import("../../packages/adapters-test/src/adapters/llm/index.js");

const adapter = createLlmTestAdapter();
adapter.setResponse("model", "prompt", { response: "ok", done: true });
const result = await adapter.generate({ model: "model", prompt: "prompt" });
assert.equal(result.response, "ok");
const fallback = await adapter.generate({ model: "unknown", prompt: "missing" });
assert.equal(fallback.done, true);
});

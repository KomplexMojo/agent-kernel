const assert = require("node:assert/strict");

test("cli ipfs adapter handles URL build and errors", async () => {
  const { createIpfsAdapter } = await import(
    "../../packages/adapters-cli/src/adapters/ipfs/index.js"
  );

  const adapter = createIpfsAdapter({
    gatewayUrl: "https://example.com/ipfs",
    fetchFn: async () => ({ ok: true, text: async () => "{}" }),
  });
  assert.equal(adapter.buildUrl("cid", "path"), "https://example.com/ipfs/cid/path");

  const publishAdapter = createIpfsAdapter({
    gatewayUrl: "https://example.com/ipfs",
    fetchFn: async (_url, options) => {
      assert.equal(options?.method, "POST");
      assert.ok(options?.body instanceof FormData);
      return {
        ok: true,
        text: async () => '{"Name":"bundle.json","Hash":"bafyfile","Size":"10"}\n{"Name":"wrap","Hash":"bafyroot","Size":"20"}\n',
      };
    },
  });
  const publish = await publishAdapter.publishJsonMap({ "bundle.json": { schema: "agent-kernel/Bundle" } }, { pathPrefix: "run_1" });
  assert.equal(publish.cid, "bafyroot");

  const failing = createIpfsAdapter({
    gatewayUrl: "https://example.com/ipfs",
    fetchFn: async () => ({ ok: false, status: 404, statusText: "Not Found" }),
  });
  await assert.rejects(() => failing.fetchJson("cid"), /IPFS fetch failed/);
});

test("cli blockchain adapter handles errors", async () => {
  const { createBlockchainAdapter } = await import(
    "../../packages/adapters-cli/src/adapters/blockchain/index.js"
  );

  assert.throws(() => createBlockchainAdapter({}), /rpcUrl/);

  const adapter = createBlockchainAdapter({
    rpcUrl: "http://rpc.local",
    fetchFn: async () => ({ ok: false, status: 500, statusText: "Boom" }),
  });
  await assert.rejects(() => adapter.getBalance("0x123"), /RPC call failed/);

  const happy = createBlockchainAdapter({
    rpcUrl: "http://rpc.local",
    fetchFn: async (_url, options) => {
      const body = JSON.parse(options?.body || "{}");
      if (body.method === "eth_chainId") {
        return { ok: true, json: async () => ({ result: "0x1" }) };
      }
      if (body.method === "ak_mintCard") {
        return { ok: true, json: async () => ({ result: { tokenId: "token_1", txHash: "0xmint" } }) };
      }
      if (body.method === "ak_getMintedCard") {
        return { ok: true, json: async () => ({ result: { tokenId: "token_1", card: { type: "delver" } } }) };
      }
      return { ok: true, json: async () => ({ result: null }) };
    },
  });
  const minted = await happy.mintCard({ card: { id: "A-1", type: "delver" }, owner: "0xabc" });
  assert.equal(minted.tokenId, "token_1");
  const loaded = await happy.loadMintedCard({ tokenId: "token_1" });
  assert.equal(loaded.card.type, "delver");
});

test("cli llm adapter handles errors", async () => {
  const { createLlmAdapter } = await import(
    "../../packages/adapters-cli/src/adapters/llm/index.js"
  );

  const adapter = createLlmAdapter({
    baseUrl: "http://localhost:11434",
    fetchFn: async () => ({ ok: false, status: 503, statusText: "Down" }),
  });
  await assert.rejects(() => adapter.generate({ model: "m", prompt: "p" }), /LLM request failed/);
});

test("cli solver adapter errors without solver", async () => {
  const { createSolverAdapter } = await import(
    "../../packages/adapters-cli/src/adapters/solver-z3/index.js"
  );

  const adapter = createSolverAdapter({});
  const result = await adapter.solve({ meta: { id: "test" } });
  assert.equal(result.status, "fulfilled");
});

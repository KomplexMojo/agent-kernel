const assert = require("node:assert/strict");

test("ipfs adapter builds URLs and handles fetch errors", async () => {
  const { createIpfsAdapter } = await import(
    "../../packages/adapters-web/src/adapters/ipfs/index.js"
  );

  const adapter = createIpfsAdapter({
    gatewayUrl: "https://example.com/ipfs",
    fetchFn: async () => ({ ok: true, text: async () => "{}" }),
  });

  assert.equal(
    adapter.buildUrl("ipfs://cid", "path"),
    "https://example.com/ipfs/cid/path",
  );

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
  const publish = await publishAdapter.publishJsonMap({ "bundle.json": { spec: { schema: "agent-kernel/BuildSpec" } } }, { pathPrefix: "run_1" });
  assert.equal(publish.cid, "bafyroot");

  const failing = createIpfsAdapter({
    gatewayUrl: "https://example.com/ipfs",
    fetchFn: async () => ({ ok: false, status: 500, statusText: "Boom" }),
  });
  await assert.rejects(() => failing.fetchText("cid"), /IPFS fetch failed/);
});

test("blockchain adapter validates inputs and handles RPC errors", async () => {
  const { createBlockchainAdapter } = await import(
    "../../packages/adapters-web/src/adapters/blockchain/index.js"
  );

  assert.throws(() => createBlockchainAdapter({}), /rpcUrl/);

  const adapter = createBlockchainAdapter({
    rpcUrl: "http://rpc.local",
    fetchFn: async () => ({ ok: true, json: async () => ({ error: { message: "nope" } }) }),
  });
  await assert.rejects(() => adapter.getChainId(), /nope/);

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
        return { ok: true, json: async () => ({ result: { tokenId: "token_1", card: { type: "defender" } } }) };
      }
      return { ok: true, json: async () => ({ result: null }) };
    },
  });
  const minted = await happy.mintCard({ card: { id: "D-1", type: "defender" }, owner: "0xabc" });
  assert.equal(minted.tokenId, "token_1");
  const loaded = await happy.loadMintedCard({ tokenId: "token_1" });
  assert.equal(loaded.card.type, "defender");
});

test("llm adapter validates inputs and handles HTTP errors", async () => {
  const { createLlmAdapter } = await import(
    "../../packages/adapters-web/src/adapters/llm/index.js"
  );

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
});

test("level builder adapter supports in-process and worker-backed requests", async () => {
  const { createLevelBuilderAdapter } = await import(
    "../../packages/adapters-web/src/adapters/level-builder/index.js"
  );

  const summary = {
    dungeonAffinity: "fire",
    budgetTokens: 1200,
    layout: { floorTiles: 120, hallwayTiles: 30 },
    roomDesign: { rooms: [{ id: "R1", width: 10, height: 8 }] },
    actors: [],
    rooms: [],
  };

  const inProcess = createLevelBuilderAdapter({ forceInProcess: true });
  const inProcessResult = await inProcess.buildFromGuidance({ summary });
  assert.equal(inProcessResult.ok, true);
  assert.equal(inProcessResult.walkableTiles, 120);
  assert.ok(inProcessResult.ascii && typeof inProcessResult.ascii.text === "string");
  assert.ok(inProcessResult.image && inProcessResult.image.pixels instanceof Uint8ClampedArray);
  assert.equal(inProcessResult.image.pixelFormat, "rgba8");

  const fromTiles = await inProcess.buildFromTiles({ tiles: ["S.E", ".#."], renderOptions: { includeImage: true } });
  assert.equal(fromTiles.ok, true);
  assert.equal(fromTiles.width, 3);
  assert.equal(fromTiles.height, 2);
  assert.equal(fromTiles.walkableTiles, 5);

  const affinityFromTiles = await inProcess.buildFromTiles({
    tiles: ["..."],
    renderOptions: {
      includeAscii: true,
      includeImage: true,
      floorAffinityTraps: [
        { x: 0, y: 0, affinity: { kind: "water", targetType: "floor", stacks: 1 } },
        { x: 1, y: 0, affinity: { kind: "water", targetType: "floor", stacks: 1, roomStacks: 3 } },
      ],
    },
  });
  assert.equal(affinityFromTiles.ok, true);
  assert.equal(affinityFromTiles.ascii.lines[0][0], "W");
  assert.equal(affinityFromTiles.ascii.lines[0][1], "W");
  assert.notDeepEqual(
    Array.from(affinityFromTiles.image.pixels.slice(0, 4)),
    Array.from(affinityFromTiles.image.pixels.slice(4, 8)),
  );

  const fromLevelGen = await inProcess.buildFromLevelGen({ levelGen: inProcessResult.levelGen });
  assert.equal(fromLevelGen.ok, true);
  assert.equal(fromLevelGen.walkableTiles, 120);

  let workerMessageHandler = null;
  let workerTerminated = false;
  globalThis.Worker = function MockWorker() {};
  const workerAdapter = createLevelBuilderAdapter({
    workerFactory: () => ({
      addEventListener(type, handler) {
        if (type === "message") workerMessageHandler = handler;
      },
      postMessage(payload) {
        queueMicrotask(() => {
          const pixels = new Uint8ClampedArray([
            10, 20, 30, 255,
            40, 50, 60, 255,
          ]);
          workerMessageHandler?.({
            data: {
              id: payload.id,
              ok: true,
              result: {
                ok: true,
                tiles: ["SE"],
                ascii: { lines: ["SE"], text: "SE" },
                image: { width: 2, height: 1, pixelFormat: "rgba8", pixels },
                width: 2,
                height: 1,
                walkableTiles: 2,
              },
            },
          });
        });
      },
      terminate() {
        workerTerminated = true;
      },
    }),
    requestTimeoutMs: 1000,
  });

  const workerResult = await workerAdapter.buildFromGuidance({ summary });
  assert.equal(workerResult.ok, true);
  assert.equal(workerResult.width, 2);
  assert.equal(workerResult.height, 1);
  assert.equal(workerResult.walkableTiles, 2);
  assert.ok(workerResult.ascii && typeof workerResult.ascii.text === "string");
  assert.ok(workerResult.image && workerResult.image.pixels instanceof Uint8ClampedArray);
  assert.equal(workerResult.image.pixelFormat, "rgba8");
  const workerRegen = await workerAdapter.regenerateLevel({ tiles: ["SE"] });
  assert.equal(workerRegen.ok, true);
  assert.equal(workerRegen.walkableTiles, 2);
  workerAdapter.dispose();
  assert.equal(workerTerminated, true);
});

const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ipfsModule = moduleUrl("packages/adapters-web/src/adapters/ipfs/index.js");
const blockchainModule = moduleUrl("packages/adapters-web/src/adapters/blockchain/index.js");
const llmModule = moduleUrl("packages/adapters-web/src/adapters/llm/index.js");
const levelBuilderModule = moduleUrl("packages/adapters-web/src/adapters/level-builder/index.js");

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

const levelBuilderScript = `
import assert from "node:assert/strict";
import { createLevelBuilderAdapter } from ${JSON.stringify(levelBuilderModule)};

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
assert.equal(inProcessResult.walkableTiles, 150);
assert.ok(inProcessResult.ascii && typeof inProcessResult.ascii.text === "string");
assert.ok(inProcessResult.image && inProcessResult.image.pixels instanceof Uint8ClampedArray);

const fromTiles = await inProcess.buildFromTiles({ tiles: ["S.E", ".#."], renderOptions: { includeImage: true } });
assert.equal(fromTiles.ok, true);
assert.equal(fromTiles.width, 3);
assert.equal(fromTiles.height, 2);
assert.equal(fromTiles.walkableTiles, 5);

const fromLevelGen = await inProcess.buildFromLevelGen({ levelGen: inProcessResult.levelGen });
assert.equal(fromLevelGen.ok, true);
assert.equal(fromLevelGen.walkableTiles, 150);

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
              image: { width: 2, height: 1, pixels },
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
const workerRegen = await workerAdapter.regenerateLevel({ tiles: ["SE"] });
assert.equal(workerRegen.ok, true);
assert.equal(workerRegen.walkableTiles, 2);
workerAdapter.dispose();
assert.equal(workerTerminated, true);
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

test("level builder adapter supports in-process and worker-backed requests", () => {
  runEsm(levelBuilderScript);
});

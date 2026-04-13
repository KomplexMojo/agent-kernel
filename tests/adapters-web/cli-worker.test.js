const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const cliWorkerModule = moduleUrl("packages/adapters-web/src/adapters/cli-worker/index.js");

const cliWorkerScript = `
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createCliWorkerAdapter } from ${JSON.stringify(cliWorkerModule)};

function fixtureResponse(body, contentType = "application/json; charset=utf-8") {
  const buffer = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const textBody = Buffer.isBuffer(body)
    ? buffer.toString("utf8")
    : typeof body === "string"
      ? body
      : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    async text() {
      return textBody;
    },
    async json() {
      return JSON.parse(textBody);
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

const root = process.cwd();
const loadJson = (relativePath) => JSON.parse(readFileSync(path.resolve(root, relativePath), "utf8"));
const fetchFn = async (resource) => {
  const value = String(resource);
  if (value.endsWith("/api/generate")) {
    const fixturePath = path.resolve(root, "tests/fixtures/adapters/llm-generate.json");
    return fixtureResponse(JSON.parse(readFileSync(fixturePath, "utf8")));
  }
  const normalized = value.startsWith("http://") || value.startsWith("https://")
    ? new URL(value).pathname
    : value;
  const filePath = path.resolve(root, normalized.replace(/^\\//, ""));
  if (filePath.endsWith(".wasm")) {
    return fixtureResponse(readFileSync(filePath), "application/wasm");
  }
  return fixtureResponse(readFileSync(filePath, "utf8"));
};

const specPath = "/tests/fixtures/artifacts/build-spec-v1-configurator.json";
const adapter = createCliWorkerAdapter({ forceInProcess: true, fetchFn, env: { AK_LLM_LIVE: "1" } });
const buildResult = await adapter.build({ specPath });

assert.equal(buildResult.spec.schema, "agent-kernel/BuildSpec");
assert.equal(buildResult.manifest.specPath, "spec.json");
assert.equal(buildResult.bundle.spec.schema, "agent-kernel/BuildSpec");
assert.equal(buildResult.telemetry.data.status, "success");
assert.ok(Array.isArray(buildResult.logs));
assert.ok(buildResult.artifacts["manifest.json"]);
assert.ok(buildResult.artifacts["resource-bundle.json"]);
assert.ok(buildResult.bundle.artifacts.some((artifact) => artifact.schema === "agent-kernel/ResourceBundleArtifact"));
assert.ok(buildResult.manifest.artifacts.some((entry) => entry.path === "resource-bundle.json"));

const configuratorResult = await adapter.configurator({
  levelGenPath: "/tests/fixtures/configurator/level-gen-input-v1-trap.json",
  actorsPath: "/tests/fixtures/configurator/actors-v1-affinity-base.json",
  budgetPath: "/tests/fixtures/artifacts/budget-artifact-v1-basic.json",
  priceListPath: "/tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
  outDir: "/artifacts/browser/configurator",
  runId: "run_browser_configurator",
});
assert.equal(configuratorResult.simConfig.schema, "agent-kernel/SimConfigArtifact");
assert.equal(configuratorResult.initialState.schema, "agent-kernel/InitialStateArtifact");
assert.equal(configuratorResult.budgetReceipt.schema, "agent-kernel/BudgetReceiptArtifact");
assert.equal(configuratorResult.budgetReceipt.meta.runId, "run_browser_configurator");
assert.ok(configuratorResult.artifacts["sim-config.json"]);
assert.ok(configuratorResult.artifacts["initial-state.json"]);
assert.ok(configuratorResult.artifacts["budget-receipt.json"]);

const budgetResult = await adapter.budget({
  budgetJson: loadJson("tests/fixtures/artifacts/budget-artifact-v1-basic.json"),
  priceListJson: loadJson("tests/fixtures/artifacts/price-list-artifact-v1-basic.json"),
  receiptJson: loadJson("tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json"),
  outDir: "/artifacts/browser/budget",
  outPath: "/artifacts/browser/budget-output.json",
});
assert.equal(budgetResult.output.budget.schema, "agent-kernel/BudgetArtifact");
assert.equal(budgetResult.output.priceList.schema, "agent-kernel/PriceList");
assert.equal(budgetResult.output.receipt.schema, "agent-kernel/BudgetReceiptArtifact");
assert.equal(budgetResult.outputFile.receipt.schema, "agent-kernel/BudgetReceiptArtifact");
assert.ok(budgetResult.artifacts["budget.json"]);
assert.ok(budgetResult.artifacts["price-list.json"]);
assert.ok(budgetResult.artifacts["budget-receipt.json"]);

const ipfsResult = await adapter.ipfs({
  cid: "bafy",
  gatewayUrl: "http://local",
  json: true,
  fixtureText: readFileSync(path.resolve(root, "tests/fixtures/adapters/ipfs-price-list.json"), "utf8"),
  outDir: "/artifacts/browser/ipfs",
});
assert.equal(ipfsResult.output.schema, "agent-kernel/PriceList");
assert.ok(ipfsResult.artifacts["ipfs.json"]);

const ipfsLoadResult = await adapter.ipfsLoad({
  cid: "bafyfixture",
  fixtureMap: loadJson("tests/fixtures/adapters/ipfs-artifacts-map.json"),
  outDir: "/artifacts/browser/ipfs-load",
});
assert.equal(ipfsLoadResult.output.cid, "bafyfixture");
assert.ok(ipfsLoadResult.bundle);
assert.equal(ipfsLoadResult.bundle.spec.schema, "agent-kernel/BuildSpec");
assert.ok(ipfsLoadResult.artifacts["bundle.json"]);
assert.ok(ipfsLoadResult.artifacts["manifest.json"]);

const ipfsPublishResult = await adapter.ipfsPublish({
  fixtureCid: "bafypublishfixture",
  artifactMap: loadJson("tests/fixtures/adapters/ipfs-artifacts-map.json"),
  outDir: "/artifacts/browser/ipfs-publish",
});
assert.equal(ipfsPublishResult.output.cid, "bafypublishfixture");
assert.equal(ipfsPublishResult.output.mode, "fixture");
assert.ok(ipfsPublishResult.output.publishedFiles.includes("bundle.json"));
assert.ok(ipfsPublishResult.artifacts["ipfs-publish.json"]);

const blockchainResult = await adapter.blockchain({
  rpcUrl: "http://local",
  address: "0xabc",
  fixtureChainIdJson: loadJson("tests/fixtures/adapters/blockchain-chain-id.json"),
  fixtureBalanceJson: loadJson("tests/fixtures/adapters/blockchain-balance.json"),
  outDir: "/artifacts/browser/blockchain",
});
assert.equal(blockchainResult.output.chainId, "0x1");
assert.equal(blockchainResult.output.balance, "0x10");
assert.ok(blockchainResult.artifacts["blockchain.json"]);

const blockchainMintResult = await adapter.blockchainMint({
  rpcUrl: "http://local",
  owner: "0xabc",
  cardJson: loadJson("tests/fixtures/adapters/card-config-delver.json"),
  fixtureChainIdJson: loadJson("tests/fixtures/adapters/blockchain-chain-id.json"),
  fixtureMintJson: loadJson("tests/fixtures/adapters/blockchain-mint.json"),
  outDir: "/artifacts/browser/blockchain-mint",
});
assert.equal(blockchainMintResult.output.chainId, "0x1");
assert.equal(blockchainMintResult.output.tokenId, "token_fixture_1");
assert.ok(blockchainMintResult.artifacts["blockchain-mint.json"]);

const blockchainLoadResult = await adapter.blockchainLoad({
  rpcUrl: "http://local",
  tokenId: "token_fixture_1",
  fixtureChainIdJson: loadJson("tests/fixtures/adapters/blockchain-chain-id.json"),
  fixtureLoadJson: loadJson("tests/fixtures/adapters/blockchain-load.json"),
  outDir: "/artifacts/browser/blockchain-load",
});
assert.equal(blockchainLoadResult.output.chainId, "0x1");
assert.equal(blockchainLoadResult.output.tokenId, "token_fixture_1");
assert.equal(blockchainLoadResult.output.card.type, "delver");
assert.ok(blockchainLoadResult.artifacts["blockchain-load.json"]);

const llmResult = await adapter.llm({
  model: "fixture",
  prompt: "hello",
  baseUrl: "http://local",
  fixtureJson: loadJson("tests/fixtures/adapters/llm-generate.json"),
  outDir: "/artifacts/browser/llm",
});
assert.equal(llmResult.output.response, "ok");
assert.ok(llmResult.artifacts["llm.json"]);

const llmPlanResult = await adapter.llmPlan({
  scenarioPath: "/tests/fixtures/e2e/e2e-scenario-v1-basic.json",
  model: "fixture",
  fixturePath: "/tests/fixtures/adapters/llm-generate-summary.json",
  runId: "run_browser_llm_plan",
  createdAt: "2025-01-01T00:00:00Z",
  outDir: "/artifacts/browser/llm-plan",
});
assert.equal(llmPlanResult.spec.schema, "agent-kernel/BuildSpec");
assert.equal(llmPlanResult.spec.meta.runId, "run_browser_llm_plan");
assert.ok(llmPlanResult.bundle.artifacts.some((artifact) => artifact.schema === "agent-kernel/SimConfigArtifact"));
assert.ok(llmPlanResult.bundle.artifacts.some((artifact) => artifact.schema === "agent-kernel/InitialStateArtifact"));
assert.ok(llmPlanResult.bundle.artifacts.some((artifact) => artifact.schema === "agent-kernel/ResourceBundleArtifact"));
assert.ok(llmPlanResult.bundle.artifacts.every((artifact) => artifact.schema !== "agent-kernel/CapturedInputArtifact"));
assert.ok(llmPlanResult.manifest.artifacts.some((entry) => entry.schema === "agent-kernel/SimConfigArtifact"));
assert.ok(llmPlanResult.manifest.artifacts.some((entry) => entry.schema === "agent-kernel/InitialStateArtifact"));
assert.ok(llmPlanResult.manifest.artifacts.some((entry) => entry.schema === "agent-kernel/ResourceBundleArtifact"));
assert.ok(llmPlanResult.manifest.artifacts.every((entry) => entry.schema !== "agent-kernel/CapturedInputArtifact"));
assert.ok(llmPlanResult.artifacts["bundle.json"]);
assert.ok(llmPlanResult.artifacts["manifest.json"]);
assert.ok(llmPlanResult.artifacts["telemetry.json"]);

const solveResult = await adapter.solve({
  scenario: "two actors conflict",
  solverFixturePath: "/tests/fixtures/artifacts/solver-result-v1-basic.json",
  outDir: "/artifacts/browser/solve",
  runId: "run_browser_solve",
});
assert.equal(solveResult.solverRequest.schema, "agent-kernel/SolverRequest");
assert.equal(solveResult.solverRequest.meta.runId, "run_browser_solve");
assert.equal(solveResult.solverResult.schema, "agent-kernel/SolverResult");
assert.ok(solveResult.artifacts["solver-request.json"]);
assert.ok(solveResult.artifacts["solver-result.json"]);

const wasmPath = "/build/core-as.wasm";
if (existsSync(path.resolve(root, "build/core-as.wasm"))) {
  const runResult = await adapter.run({
    simConfigPath: "/tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json",
    initialStatePath: "/tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json",
    ticks: 0,
    wasmPath,
    outDir: "/artifacts/browser/run",
    runId: "run_browser_runtime",
    affinityPresetsPath: "/tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json",
    affinityLoadoutsPath: "/tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json",
    affinitySummary: true,
    actor: "actor_probe,1,1,motivated",
    vitalDefault: "stamina,2,2,0",
    tileBarrier: "1,0",
  });
  assert.ok(Array.isArray(runResult.tickFrames));
  assert.ok(Array.isArray(runResult.effectsLog));
  assert.equal(runResult.runSummary.schema, "agent-kernel/RunSummary");
  assert.equal(runResult.actionLog.schema, "agent-kernel/ActionSequence");
  assert.ok(Array.isArray(runResult.runtimeDecisionCaptures));
  assert.equal(runResult.affinitySummary.schema, "agent-kernel/AffinitySummary");
  assert.ok(runResult.artifacts["tick-frames.json"]);
  assert.ok(runResult.artifacts["runtime-decision-captures.json"]);
  assert.ok(runResult.artifacts["inspect-summary.json"] === undefined);

  const replayResult = await adapter.replay({
    simConfigJson: runResult.resolvedSimConfig || runResult.artifacts["resolved-sim-config.json"] || loadJson("tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json"),
    initialStateJson: runResult.resolvedInitialState || runResult.artifacts["resolved-initial-state.json"] || loadJson("tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json"),
    tickFramesJson: runResult.tickFrames,
    ticks: 0,
    wasmPath,
    outDir: "/artifacts/browser/replay",
  });
  assert.equal(typeof replayResult.replaySummary.match, "boolean");
  assert.ok(Array.isArray(replayResult.replayTickFrames));
  assert.ok(replayResult.artifacts["replay-summary.json"]);

  const inspectResult = await adapter.inspect({
    tickFramesJson: runResult.tickFrames,
    effectsLogJson: runResult.effectsLog,
    outDir: "/artifacts/browser/inspect",
  });
  assert.equal(inspectResult.inspectSummary.schema, "agent-kernel/TelemetryRecord");
  assert.ok(inspectResult.artifacts["inspect-summary.json"]);
}

const manualMoveResult = await adapter.manualMove({
  action: "up-right",
  actorId: "actor_1",
  observation: {
    tick: 4,
    actors: [{ id: "actor_1", position: { x: 3, y: 4 } }],
  },
  controllableActorIds: ["actor_1"],
});
assert.equal(manualMoveResult.ok, true);
assert.equal(manualMoveResult.action.params.direction, "northeast");
assert.deepEqual(manualMoveResult.action.params.to, { x: 4, y: 3 });

const blockedManualMove = await adapter.manualMove({
  action: "right",
  actorId: "actor_2",
  observation: {
    tick: 1,
    actors: [{ id: "actor_2", position: { x: 0, y: 0 } }],
  },
  controllableActorIds: ["actor_1"],
});
assert.equal(blockedManualMove.ok, false);
assert.equal(blockedManualMove.reason, "actor_not_controllable");

let workerMessageHandler = null;
let workerErrorHandler = null;
let workerTerminated = false;
globalThis.Worker = function MockWorker() {};

const workerAdapter = createCliWorkerAdapter({
  workerFactory: () => ({
    addEventListener(type, handler) {
      if (type === "message") workerMessageHandler = handler;
      if (type === "error") workerErrorHandler = handler;
    },
    postMessage(payload) {
      if (payload.action === "build_spec_from_summary") {
        queueMicrotask(() => {
          workerMessageHandler?.({
            data: {
              id: payload.id,
              ok: true,
              result: {
                ok: true,
                runId: payload.payload.runId,
                spec: { schema: "agent-kernel/BuildSpec", meta: { runId: payload.payload.runId } },
                specText: "{}",
              },
            },
          });
        });
        return;
      }
      if (payload.action === "manual_move") {
        queueMicrotask(() => {
          workerMessageHandler?.({
            data: {
              id: payload.id,
              ok: true,
              result: {
                ok: true,
                action: "manual_move",
              },
            },
          });
        });
      }
    },
    terminate() {
      workerTerminated = true;
    },
  }),
  requestTimeoutMs: 1000,
});

const workerResult = await workerAdapter.buildSpecFromSummary({
  summary: { dungeonAffinity: "dark", budgetTokens: 1000, rooms: [], actors: [] },
  runId: "run_worker",
});
assert.equal(workerResult.ok, true);
assert.equal(workerResult.spec.meta.runId, "run_worker");

const workerManualMove = workerAdapter.manualMove({
  action: "down-left",
  actorId: "actor_1",
});
assert.equal((await workerManualMove).action, "manual_move");

workerAdapter.dispose();
assert.equal(workerTerminated, true);

const hangingWorker = {
  addEventListener() {},
  postMessage() {},
  terminate() {},
};

const timeoutAdapter = createCliWorkerAdapter({
  workerFactory: () => hangingWorker,
  requestTimeoutMs: 25,
});
await assert.rejects(
  () => timeoutAdapter.buildSpecFromSummary({ summary: { dungeonAffinity: "dark" } }),
  /timed out/,
);

const abortAdapter = createCliWorkerAdapter({
  workerFactory: () => hangingWorker,
  requestTimeoutMs: 1000,
});
const controller = new AbortController();
const aborted = abortAdapter.buildSpecFromSummary(
  { summary: { dungeonAffinity: "dark" } },
  { signal: controller.signal },
);
controller.abort();
await assert.rejects(() => aborted, /aborted/);
`;

test("cli worker adapter supports in-process build execution and worker lifecycle controls", () => {
  runEsm(cliWorkerScript);
});

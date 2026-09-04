const assert = require("node:assert/strict");

async function loadKernel() {
  return import("../../packages/runtime/src/commands/kernel.js");
}

function createHost() {
  const files = new Map();
  const logs = [];
  let seq = 0;

  function normalize(path) {
    return String(path || "").replace(/\\/g, "/");
  }

  return {
    files,
    logs,
    host: {
      readJson: async (path) => {
        const value = files.get(normalize(path));
        if (value === undefined) {
          throw new Error(`missing file: ${path}`);
        }
        return JSON.parse(JSON.stringify(value));
      },
      readText: async (path) => {
        const value = files.get(normalize(path));
        if (value === undefined) {
          throw new Error(`missing file: ${path}`);
        }
        if (typeof value === "string") {
          return value;
        }
        return JSON.stringify(value);
      },
      writeJson: async (path, value) => {
        files.set(normalize(path), JSON.parse(JSON.stringify(value)));
      },
      resolvePath: (input, baseDir = "/") => {
        if (!input) return null;
        const raw = String(input);
        if (raw.startsWith("/")) return normalize(raw);
        return normalize(`${baseDir}/${raw}`);
      },
      join: (...parts) => normalize(parts.filter(Boolean).join("/")),
      dirname: (path) => {
        const value = normalize(path);
        const index = value.lastIndexOf("/");
        return index > 0 ? value.slice(0, index) : "/";
      },
      exists: (path) => files.has(normalize(path)),
      makeId: (prefix) => `${prefix}_${++seq}`,
      createMeta: ({ producedBy = "test", runId, correlationId, note } = {}) => ({
        id: `artifact_${++seq}`,
        runId: runId || `run_${seq}`,
        createdAt: "2026-03-08T00:00:00.000Z",
        producedBy,
        correlationId,
        note,
      }),
      toRef: (artifact) => ({
        id: artifact.meta.id,
        schema: artifact.schema,
        schemaVersion: artifact.schemaVersion,
      }),
      defaultBuildOutDir: () => "/out/build",
      defaultRunCommandOutDir: (command, runId) => `/out/${runId}/${command}`,
      defaultLlmPlanOutDir: (runId) => `/out/${runId}/llm-plan`,
      allowNetworkRequests: () => false,
      isLlmLiveEnabled: () => false,
      isLlmStrictEnabled: () => false,
      isLlmBudgetLoopEnabled: () => false,
      isLocalBaseUrl: () => true,
      createSolverAdapter: async () => ({ solve: async () => ({}) }),
      createIpfsAdapter: () => ({ fetchJson: async () => ({}), fetchText: async () => "" }),
      createBlockchainAdapter: () => ({ getChainId: async () => "0x1", getBalance: async () => "0x0" }),
      createLlmAdapter: () => ({ generate: async () => ({}) }),
      nowIso: () => "2026-03-08T00:00:00.000Z",
      env: {},
      cwd: () => "/",
      log: (line) => logs.push(String(line)),
      warn: () => {},
    },
  };
}

test("command kernel budget reads, writes, and logs artifacts via injected host IO", async () => {
  const { createCommandKernel } = await loadKernel();
  const { files, logs, host } = createHost();

  const budget = {
    schema: "agent-kernel/BudgetArtifact",
    schemaVersion: 1,
    meta: { id: "budget_1", runId: "run_1", createdAt: "2026-03-08T00:00:00.000Z", producedBy: "test" },
    caps: {},
  };
  const priceList = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: { id: "price_1", runId: "run_1", createdAt: "2026-03-08T00:00:00.000Z", producedBy: "test" },
    entries: [],
  };
  const receipt = {
    schema: "agent-kernel/BudgetReceiptArtifact",
    schemaVersion: 1,
    meta: { id: "receipt_1", runId: "run_1", createdAt: "2026-03-08T00:00:00.000Z", producedBy: "test" },
    status: "approved",
    totalCost: 0,
    remaining: 100,
    lineItems: [],
  };

  files.set("/fixtures/budget.json", budget);
  files.set("/fixtures/price-list.json", priceList);
  files.set("/fixtures/receipt.json", receipt);

  const kernel = createCommandKernel(host);
  await kernel.budget({
    budget: "/fixtures/budget.json",
    "price-list": "/fixtures/price-list.json",
    receipt: "/fixtures/receipt.json",
    "out-dir": "/out/budget",
  });

  assert.deepEqual(files.get("/out/budget/budget.json"), budget);
  assert.deepEqual(files.get("/out/budget/price-list.json"), priceList);
  assert.deepEqual(files.get("/out/budget/budget-receipt.json"), receipt);

  const logged = JSON.parse(logs[0]);
  assert.equal(logged.budget.schema, "agent-kernel/BudgetArtifact");
  assert.equal(logged.priceList.schema, "agent-kernel/PriceList");
  assert.equal(logged.receipt.schema, "agent-kernel/BudgetReceiptArtifact");
});

test("command kernel persists the exact Allocator-issued runtime budget receipt", async () => {
  const { createCommandKernel } = await loadKernel();
  const { files, host } = createHost();
  const simConfig = {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "runtime_receipt_sim", runId: "runtime_receipt", createdAt: "2026-09-02T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 5,
        height: 5,
        tiles: ["#####", "#...#", "#...#", "#...#", "#####"],
        spawn: { x: 1, y: 1 },
        exit: { x: 3, y: 3 },
        rooms: [{ id: "R1", x: 0, y: 0, width: 5, height: 5 }],
      },
    },
  };
  const initialState = {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "runtime_receipt_state", runId: "runtime_receipt", createdAt: "2026-09-02T00:00:00.000Z" },
    simConfigRef: { id: "runtime_receipt_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors: [{
      id: "delver",
      kind: "ambulatory",
      archetype: "delver",
      role: "delver",
      position: { x: 1, y: 1 },
      motivation: { kind: "stationary" },
      vitals: {
        health: { current: 10, max: 10, regen: 0 },
        mana: { current: 10, max: 10, regen: 0 },
        stamina: { current: 10, max: 10, regen: 0 },
        durability: { current: 1, max: 1, regen: 0 },
      },
    }],
  };
  files.set("/fixtures/sim-config.json", simConfig);
  files.set("/fixtures/initial-state.json", initialState);

  const result = await createCommandKernel(host).run({
    "sim-config": "/fixtures/sim-config.json",
    "initial-state": "/fixtures/initial-state.json",
    ticks: 1,
    "run-id": "runtime_receipt",
    "out-dir": "/out/runtime-receipt",
  });

  const receipt = files.get("/out/runtime-receipt/runtime-budget-receipt.json");
  assert.equal(receipt.schema, "agent-kernel/RuntimeBudgetReceiptArtifact");
  assert.equal(receipt.meta.id, "artifact_runtime_receipt_runtimebudgetreceipt");
  assert.equal(receipt.meta.producedBy, "allocator");
  assert.deepEqual(receipt, result.runtimeBudgetReceipt, "kernel writes the exact runtime receipt without recomputing it");
});

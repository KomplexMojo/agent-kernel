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

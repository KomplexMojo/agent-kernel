const assert = require("node:assert/strict");

async function loadKernel() {
  return import("../../packages/runtime/src/commands/kernel.js");
}

function createHost() {
  const files = new Map();
  const logs = [];
  let seq = 0;
  let solverFixturePath = null;

  function normalize(path) {
    return String(path || "").replace(/\\/g, "/");
  }

  return {
    files,
    logs,
    getSolverFixturePath: () => solverFixturePath,
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
        return typeof value === "string" ? value : JSON.stringify(value);
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
        createdAt: "2026-03-12T00:00:00.000Z",
        producedBy,
        correlationId,
        note,
      }),
      toRef: (artifact) => {
        if (!artifact || typeof artifact !== "object") return null;
        if (!artifact.schema || !artifact.schemaVersion) return null;
        const id = artifact.meta?.id || `artifact_${++seq}`;
        return {
          id,
          schema: artifact.schema,
          schemaVersion: artifact.schemaVersion,
        };
      },
      defaultBuildOutDir: () => "/out/build",
      defaultRunCommandOutDir: (command, runId) => `/out/${runId}/${command}`,
      defaultLlmPlanOutDir: (runId) => `/out/${runId}/llm-plan`,
      allowNetworkRequests: () => false,
      isLlmLiveEnabled: () => false,
      isLlmStrictEnabled: () => false,
      isLlmBudgetLoopEnabled: () => false,
      isLocalBaseUrl: () => true,
      createSolverAdapter: async ({ fixturePath } = {}) => {
        solverFixturePath = fixturePath || null;
        return {
          solve: async () => ({
            status: "fulfilled",
            result: { note: "stubbed_solver_result" },
          }),
        };
      },
      createIpfsAdapter: () => ({ fetchJson: async () => ({}), fetchText: async () => "" }),
      createBlockchainAdapter: () => ({ getChainId: async () => "0x1", getBalance: async () => "0x0" }),
      createLlmAdapter: () => ({ generate: async () => ({}) }),
      nowIso: () => "2026-03-12T00:00:00.000Z",
      env: {},
      cwd: () => "/",
      log: (line) => logs.push(String(line)),
      warn: () => {},
    },
  };
}

test("command kernel solve writes solver artifacts via injected host services", async () => {
  const { createCommandKernel } = await loadKernel();
  const { files, logs, getSolverFixturePath, host } = createHost();

  files.set("/fixtures/scenario.txt", "two actors conflict");

  const kernel = createCommandKernel(host);
  const result = await kernel.solve({
    "scenario-file": "/fixtures/scenario.txt",
    "solver-fixture": "/fixtures/solver-result.json",
    "out-dir": "/out/solve",
    "run-id": "run_kernel_solve",
  });

  assert.equal(result.outDir, "/out/solve");
  assert.equal(getSolverFixturePath(), "/fixtures/solver-result.json");

  const solverRequest = files.get("/out/solve/solver-request.json");
  const solverResult = files.get("/out/solve/solver-result.json");

  assert.equal(solverRequest.schema, "agent-kernel/SolverRequest");
  assert.equal(solverRequest.schemaVersion, 1);
  assert.equal(solverRequest.meta.runId, "run_kernel_solve");
  assert.equal(solverRequest.problem.language, "custom");
  assert.equal(solverRequest.problem.data, "two actors conflict");

  assert.equal(solverResult.schema, "agent-kernel/SolverResult");
  assert.equal(solverResult.schemaVersion, 1);
  assert.equal(solverResult.meta.runId, "run_kernel_solve");
  assert.equal(solverResult.requestRef.schema, "agent-kernel/SolverRequest");
  assert.equal(solverResult.result.note, "stubbed_solver_result");

  assert.equal(logs[0], "solve: wrote /out/solve");
});

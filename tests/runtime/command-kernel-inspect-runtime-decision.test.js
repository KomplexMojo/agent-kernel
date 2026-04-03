const test = require("node:test");
const assert = require("node:assert/strict");

async function loadKernel() {
  return import("../../packages/runtime/src/commands/kernel.js");
}

function createHost() {
  const files = new Map();
  let seq = 0;

  function normalize(path) {
    return String(path || "").replace(/\\/g, "/");
  }

  return {
    files,
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
      createMeta: ({ producedBy = "test", runId } = {}) => ({
        id: `artifact_${++seq}`,
        runId: runId || `run_${seq}`,
        createdAt: "2026-03-15T00:00:00.000Z",
        producedBy,
      }),
      toRef: (artifact) => artifact?.meta ? { id: artifact.meta.id, schema: artifact.schema, schemaVersion: artifact.schemaVersion } : null,
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
      nowIso: () => "2026-03-15T00:00:00.000Z",
      env: {},
      cwd: () => "/",
      log: () => {},
      warn: () => {},
    },
  };
}

test("command kernel inspect surfaces runtime decisions and decision-driven actions", async () => {
  const { createCommandKernel } = await loadKernel();
  const { files, host } = createHost();

  files.set("/fixtures/tick-frames.json", [
    {
      tick: 4,
      phase: "decide",
      phaseDetail: "decide",
      emittedEffects: [{ kind: "solver_request" }],
      fulfilledEffects: [{ status: "fulfilled" }],
      solverResults: [
        {
          decision: {
            contract: "runtime-decision-v1",
            decisionKind: "next_move",
            selectedActionId: "move_east",
            confidence: 0.87,
          },
          action: {
            actorId: "boss_1",
            tick: 4,
            kind: "move",
            params: { direction: "east", to: { x: 2, y: 1 } },
          },
        },
      ],
      personaArtifacts: [
        {
          schema: "agent-kernel/CapturedInputArtifact",
          schemaVersion: 1,
          meta: {
            id: "capture_runtime_1",
            runId: "run_inspect_runtime_decision",
          },
          source: { adapter: "llm" },
          payload: {
            requestEnvelope: {
              contract: "runtime-decision-v1",
              actor: { id: "boss_1" },
              decisionKind: "next_move",
            },
            responseParsed: {
              decision: {
                contract: "runtime-decision-v1",
                decisionKind: "next_move",
                selectedActionId: "move_east",
              },
            },
          },
        },
      ],
      meta: {
        runId: "run_inspect_runtime_decision",
      },
    },
  ]);
  files.set("/fixtures/effects-log.json", []);

  const kernel = createCommandKernel(host);
  await kernel.inspect({
    "tick-frames": "/fixtures/tick-frames.json",
    "effects-log": "/fixtures/effects-log.json",
    "out-dir": "/out/inspect",
  });

  const summary = files.get("/out/inspect/inspect-summary.json");
  assert.equal(summary.data.runtimeDecisions.total, 1);
  assert.equal(summary.data.runtimeDecisions.decisionDrivenActions, 1);
  assert.equal(summary.data.runtimeDecisions.byActor.boss_1, 1);
  assert.equal(summary.data.runtimeDecisions.byActionKind.move, 1);
  assert.equal(summary.data.runtimeDecisions.decisions[0].selectedActionId, "move_east");
  assert.equal(summary.data.runtimeDecisionCaptures.total, 1);
  assert.equal(summary.data.runtimeDecisionCaptures.byAdapter.llm, 1);
  assert.equal(summary.data.runtimeDecisionCaptures.byActor.boss_1, 1);
  assert.equal(summary.data.runtimeDecisionCaptures.captures[0].selectedActionId, "move_east");
});

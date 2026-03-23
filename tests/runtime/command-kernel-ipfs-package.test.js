const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const IPFS_PACKAGE_FIXTURE = JSON.parse(
  readFileSync(resolve(ROOT, "tests/fixtures/adapters/ipfs-package-map.json"), "utf8"),
);

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
        if (value === undefined) throw new Error(`missing file: ${path}`);
        return JSON.parse(JSON.stringify(value));
      },
      readText: async (path) => {
        const value = files.get(normalize(path));
        if (value === undefined) throw new Error(`missing file: ${path}`);
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
      listFiles: (dirPath) => {
        const prefix = `${normalize(dirPath).replace(/\/+$/, "")}/`;
        const entries = new Set();
        files.forEach((_value, key) => {
          if (!key.startsWith(prefix)) return;
          const remainder = key.slice(prefix.length);
          if (!remainder || remainder.includes("/")) return;
          entries.add(remainder);
        });
        return Array.from(entries).sort((left, right) => left.localeCompare(right));
      },
      makeId: (prefix) => `${prefix}_${++seq}`,
      createMeta: ({ producedBy = "test", runId } = {}) => ({
        id: `artifact_${++seq}`,
        runId: runId || `run_${seq}`,
        createdAt: "2026-03-21T00:00:00.000Z",
        producedBy,
      }),
      toRef: (artifact) => artifact?.meta
        ? { id: artifact.meta.id, schema: artifact.schema, schemaVersion: artifact.schemaVersion }
        : null,
      defaultBuildOutDir: () => "/out/build",
      defaultRunCommandOutDir: (command, runId) => `/out/${runId}/${command}`,
      defaultLlmPlanOutDir: (runId) => `/out/${runId}/llm-plan`,
      allowNetworkRequests: () => false,
      isLlmLiveEnabled: () => false,
      isLlmStrictEnabled: () => false,
      isLlmBudgetLoopEnabled: () => false,
      isLocalBaseUrl: () => true,
      createSolverAdapter: async () => ({ solve: async () => ({}) }),
      createIpfsAdapter: ({ fetchFn } = {}) => ({
        fetchJson: async (cid, path) => {
          const response = await fetchFn(`https://fixture/${cid}/${path}`);
          if (!response?.ok) {
            throw new Error(`missing ipfs fixture for ${path}`);
          }
          return JSON.parse(await response.text());
        },
        fetchText: async (cid, path) => {
          const response = await fetchFn(`https://fixture/${cid}/${path}`);
          if (!response?.ok) {
            throw new Error(`missing ipfs fixture for ${path}`);
          }
          return response.text();
        },
        publishJsonMap: async (artifactMap) => ({
          cid: "bafytest",
          entries: Object.keys(artifactMap).map((name) => ({ Name: name })),
          rootName: "fixture",
        }),
      }),
      createBlockchainAdapter: () => ({ getChainId: async () => "0x1", getBalance: async () => "0x0" }),
      createLlmAdapter: () => ({ generate: async () => ({}) }),
      nowIso: () => "2026-03-21T00:00:00.000Z",
      env: {},
      cwd: () => "/",
      log: () => {},
      warn: () => {},
    },
  };
}

test("command kernel ipfs-publish packages canonical core and session files", async () => {
  const { createCommandKernel } = await loadKernel();
  const { host } = createHost();
  const kernel = createCommandKernel(host);

  const result = await kernel.ipfsPublish({
    scope: "session",
    "fixture-cid": "bafyfixture",
    "core-artifact-map": {
      "bundle.json": IPFS_PACKAGE_FIXTURE["core/bundle.json"],
      "manifest.json": IPFS_PACKAGE_FIXTURE["core/manifest.json"],
      "spec.json": IPFS_PACKAGE_FIXTURE["core/spec.json"],
      "affinity-rules.json": {
        schema: "agent-kernel/AffinityRulesArtifact",
        schemaVersion: 1,
        meta: { id: "affinity_rules_fixture", runId: "run_ipfs_fixture", createdAt: "2026-03-21T00:00:00.000Z", producedBy: "test" },
        balanceVersion: "2026.03.21",
        contentHash: "sha256:fixture",
        rulesetName: "Fixture Rules",
        affinities: [],
      },
      "motivation-rules.json": {
        schema: "agent-kernel/MotivationRulesArtifact",
        schemaVersion: 1,
        meta: { id: "motivation_rules_fixture", runId: "run_ipfs_fixture", createdAt: "2026-03-21T00:00:00.000Z", producedBy: "test" },
        balanceVersion: "2026.03.21",
        contentHash: "sha256:fixture",
        rulesetName: "Fixture Rules",
        globals: {
          defaultIntensity: 1,
          maxIntensity: 1,
          reasoningClasses: {
            none: "instinctual",
            reflexive: "instinctual",
            goal_oriented: "tactical",
            strategy_focused: "strategic",
          },
          profileCosts: {
            mobility: { stationary: 0, exploring: 0, patrolling: 0 },
            combat: { none: 0, attacking: 0, defending: 0 },
            cognition: { none: 0, reflexive: 0, goal_oriented: 0, strategy_focused: 0 },
          },
        },
        motivations: [],
      },
      "sim-config.json": IPFS_PACKAGE_FIXTURE["core/sim-config.json"],
      "initial-state.json": IPFS_PACKAGE_FIXTURE["core/initial-state.json"],
    },
    "session-artifact-map": {
      "checkpoint-state.json": IPFS_PACKAGE_FIXTURE["sessions/run_ipfs_fixture/checkpoints/tick-0/checkpoint-state.json"],
      "action-log.json": IPFS_PACKAGE_FIXTURE["sessions/run_ipfs_fixture/checkpoints/tick-0/action-log.json"],
      "run-summary.json": IPFS_PACKAGE_FIXTURE["sessions/run_ipfs_fixture/checkpoints/tick-0/run-summary.json"],
      "runtime-decision-captures.json": [],
    },
    "session-id": "run_ipfs_fixture",
    "checkpoint-id": "tick-0",
  });

  assert.equal(result.cid, "bafyfixture");
  assert.ok(result.publishedFiles.includes("ipfs-package.json"));
  assert.ok(result.publishedFiles.includes("core/bundle.json"));
  assert.ok(result.publishedFiles.includes("core/affinity-rules.json"));
  assert.ok(result.publishedFiles.includes("core/motivation-rules.json"));
  assert.ok(result.publishedFiles.includes("sessions/run_ipfs_fixture/session-manifest.json"));
  assert.ok(result.publishedFiles.includes("sessions/run_ipfs_fixture/checkpoints/tick-0/checkpoint-state.json"));
  assert.equal(result.package.schema, "agent-kernel/IpfsPackageArtifact");
  assert.ok(result.package.requiredCoreFiles.includes("bundle.json"));
  assert.ok(result.package.requiredCoreFiles.includes("affinity-rules.json"));
  assert.ok(result.package.requiredCoreFiles.includes("motivation-rules.json"));
  assert.equal(result.sessionManifest.schema, "agent-kernel/IpfsSessionManifestArtifact");
  assert.ok(result.sessionManifest.requiredSessionFiles.includes("checkpoint-state.json"));
});

test("command kernel ipfs-load restores canonical core package payloads", async () => {
  const { createCommandKernel } = await loadKernel();
  const { host } = createHost();
  const kernel = createCommandKernel(host);

  const result = await kernel.ipfsLoad({
    cid: "bafyfixture",
    "fixture-map": IPFS_PACKAGE_FIXTURE,
  });

  assert.equal(result.loadMode, "core");
  assert.equal(result.package.schema, "agent-kernel/IpfsPackageArtifact");
  assert.equal(result.fetched["bundle.json"].spec.schema, "agent-kernel/BuildSpec");
  assert.equal(result.fetched["sim-config.json"].schema, "agent-kernel/SimConfigArtifact");
});

test("command kernel ipfs-load resume restores core and session checkpoint payloads", async () => {
  const { createCommandKernel } = await loadKernel();
  const { host } = createHost();
  const kernel = createCommandKernel(host);

  const result = await kernel.ipfsLoad({
    cid: "bafyfixture",
    "load-mode": "resume",
    "fixture-map": IPFS_PACKAGE_FIXTURE,
  });

  assert.equal(result.loadMode, "resume");
  assert.equal(result.sessionManifest.schema, "agent-kernel/IpfsSessionManifestArtifact");
  assert.equal(result.fetched["checkpoint-state.json"].schema, "agent-kernel/RuntimeCheckpointArtifact");
  assert.equal(result.fetched["action-log.json"].schema, "agent-kernel/ActionSequence");
  assert.equal(result.fetched["run-summary.json"].schema, "agent-kernel/RunSummary");
});

test("command kernel ipfs-load rejects resume packages missing required session files", async () => {
  const { createCommandKernel } = await loadKernel();
  const { host } = createHost();
  const kernel = createCommandKernel(host);
  const missingActionLogFixture = { ...IPFS_PACKAGE_FIXTURE };
  delete missingActionLogFixture["sessions/run_ipfs_fixture/checkpoints/tick-0/action-log.json"];

  await assert.rejects(
    () => kernel.ipfsLoad({
      cid: "bafyfixture",
      "load-mode": "resume",
      "fixture-map": missingActionLogFixture,
    }),
    /required session file action-log\.json/i,
  );
});

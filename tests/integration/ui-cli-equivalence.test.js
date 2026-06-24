const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, readdirSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { pathToFileURL } = require("node:url");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const CLI_WORKER_URL = pathToFileURL(
  resolve(ROOT, "packages/adapters-web/src/adapters/cli-worker/index.js"),
).href;

const TIMESTAMP_KEYS = new Set(["createdAt", "startedAt", "endedAt", "updatedAt"]);
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const GENERATED_ARTIFACT_ID_RE = /^artifact[_-]/i;
const GENERATED_REPLAY_RUN_ID_RE = /^replay[_-]/i;

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

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

function createFixtureFetch(rootDir) {
  return async (resource) => {
    const value = String(resource);
    const normalized = value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value).pathname
      : value;
    const filePath = resolve(rootDir, normalized.replace(/^\/+/, ""));
    if (filePath.endsWith(".wasm")) {
      return fixtureResponse(readFileSync(filePath), "application/wasm");
    }
    return fixtureResponse(readFileSync(filePath, "utf8"));
  };
}

function collectJsonArtifacts(outDir) {
  const artifacts = {};

  function walk(currentDir, relativeDir = "") {
    const entries = readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    entries.forEach((entry) => {
      const absolutePath = join(currentDir, entry.name);
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
        return;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        artifacts[relativePath] = readJson(absolutePath);
      }
    });
  }

  walk(outDir);
  return artifacts;
}

function collectArtifactIds(value, idMap, nextIdRef) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectArtifactIds(entry, idMap, nextIdRef));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (typeof value.schema === "string" && typeof value.meta?.id === "string" && !idMap.has(value.meta.id)) {
    idMap.set(value.meta.id, `artifact_${nextIdRef.current}`);
    nextIdRef.current += 1;
  }
  Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .forEach((key) => collectArtifactIds(value[key], idMap, nextIdRef));
}

function normalizeArtifactValue(value, idMap, refIdMap, nextRefRef, parentKey = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeArtifactValue(entry, idMap, refIdMap, nextRefRef));
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (parentKey === "runId" && GENERATED_REPLAY_RUN_ID_RE.test(value)) {
        return "<replayRunId>";
      }
      if (idMap.has(value)) {
        return idMap.get(value);
      }
      if (TIMESTAMP_KEYS.has(parentKey) && ISO_TIMESTAMP_RE.test(value)) {
        return `<${parentKey}>`;
      }
    }
    return value;
  }

  const isRefObject = typeof value.id === "string"
    && typeof value.schema === "string"
    && Number.isFinite(value.schemaVersion)
    && !value.meta;
  if (isRefObject) {
    const normalizedRef = {};
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .forEach((key) => {
        if (key === "id" && !idMap.has(value.id) && GENERATED_ARTIFACT_ID_RE.test(value.id)) {
          if (!refIdMap.has(value.id)) {
            refIdMap.set(value.id, `ref_${nextRefRef.current}`);
            nextRefRef.current += 1;
          }
          normalizedRef.id = refIdMap.get(value.id);
          return;
        }
        normalizedRef[key] = normalizeArtifactValue(value[key], idMap, refIdMap, nextRefRef, key);
      });
    return normalizedRef;
  }

  const normalized = {};
  Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .forEach((key) => {
      normalized[key] = normalizeArtifactValue(value[key], idMap, refIdMap, nextRefRef, key);
    });
  return normalized;
}

function normalizeArtifacts(artifacts) {
  const idMap = new Map();
  const nextIdRef = { current: 1 };
  const refIdMap = new Map();
  const nextRefRef = { current: 1 };
  Object.entries(artifacts)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([, value]) => collectArtifactIds(value, idMap, nextIdRef));

  return Object.fromEntries(
    Object.entries(artifacts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, value]) => [path, normalizeArtifactValue(value, idMap, refIdMap, nextRefRef)]),
  );
}

async function createBrowserAdapter() {
  const { createCliWorkerAdapter } = await import(CLI_WORKER_URL);
  return createCliWorkerAdapter({
    forceInProcess: true,
    fetchFn: createFixtureFetch(ROOT),
    env: { AK_LLM_LIVE: "1" },
    nowIso: () => "2026-03-11T00:00:00.000Z",
  });
}

test("browser host build artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-build-"));
  runCli([
    "build",
    "--spec",
    "tests/fixtures/artifacts/build-spec-v1-configurator.json",
    "--out-dir",
    outDir,
  ]);

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.build({
    specPath: "/tests/fixtures/artifacts/build-spec-v1-configurator.json",
    outDir: "/artifacts/equivalence/build",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host normalizes agent-authored build specs for UI parity", async () => {
  const adapter = await createBrowserAdapter();
  const normalized = await adapter.normalizeBuildSpec({
    spec: {
      schema: "agent-kernel/BuildSpec",
      schemaVersion: 1,
      meta: {
        id: "build_spec_ui_equivalence",
        runId: "run_ui_equivalence",
        createdAt: "2026-04-08T00:00:00.000Z",
        source: "ui-test",
      },
      intent: {
        goal: "Normalize agent authoring",
      },
      authoring: {
        objectKinds: "room",
        request: {
          schema: "agent-kernel/AgentCommandRequestArtifact",
          schemaVersion: 1,
          meta: {
            id: "agent_command_ui_equivalence",
            runId: "run_ui_equivalence",
            createdAt: "2026-04-08T00:00:00.000Z",
            producedBy: "test",
          },
          command: {
            action: "author",
            text: "author one room",
            source: "ui-test",
            taxonomyVersion: 1,
          },
          objects: {
            kind: "room",
            prompt: "one room",
            count: 1,
          },
          compilation: {
            rules: {
              kind: "room",
              compileTo: {
                target: "build_spec_plan",
                path: "plan.hints.cardSet",
              },
            },
          },
        },
      },
    },
  });

  assert.equal(normalized.changed, true);
  assert.deepEqual(normalized.spec.authoring.objectKinds, ["room"]);
  assert.equal(Array.isArray(normalized.spec.authoring.request.objects), true);
  assert.equal(Array.isArray(normalized.spec.authoring.request.compilation.rules), true);
  assert.equal(Array.isArray(normalized.spec.authoring.request.compilation.rules[0].compileTo), true);
});

test("browser host solve artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-solve-"));
  runCli([
    "solve",
    "--scenario",
    "two actors conflict",
    "--solver-fixture",
    "tests/fixtures/artifacts/solver-result-v1-basic.json",
    "--run-id",
    "run_equivalence_solve",
    "--out-dir",
    outDir,
  ]);

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.solve({
    scenario: "two actors conflict",
    solverFixturePath: "/tests/fixtures/artifacts/solver-result-v1-basic.json",
    runId: "run_equivalence_solve",
    outDir: "/artifacts/equivalence/solve",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host configurator artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-configurator-"));
  runCli([
    "configurator",
    "--level-gen",
    "tests/fixtures/configurator/level-gen-input-v1-trap.json",
    "--actors",
    "tests/fixtures/configurator/actors-v1-affinity-base.json",
    "--budget",
    "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
    "--price-list",
    "tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
    "--out-dir",
    outDir,
    "--run-id",
    "run_equivalence_configurator",
  ]);

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.configurator({
    levelGenPath: "/tests/fixtures/configurator/level-gen-input-v1-trap.json",
    actorsPath: "/tests/fixtures/configurator/actors-v1-affinity-base.json",
    budgetPath: "/tests/fixtures/artifacts/budget-artifact-v1-basic.json",
    priceListPath: "/tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
    outDir: "/artifacts/equivalence/configurator",
    runId: "run_equivalence_configurator",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host budget artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-budget-"));
  runCli([
    "budget",
    "--budget",
    "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
    "--price-list",
    "tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
    "--receipt",
    "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json",
    "--out-dir",
    outDir,
  ]);

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.budget({
    budgetPath: "/tests/fixtures/artifacts/budget-artifact-v1-basic.json",
    priceListPath: "/tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
    receiptPath: "/tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json",
    outDir: "/artifacts/equivalence/budget",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host ipfs-publish artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-ipfs-publish-"));
  runCli([
    "ipfs-publish",
    "--artifact-map",
    "tests/fixtures/adapters/ipfs-artifacts-map.json",
    "--fixture-cid",
    "bafyequivalencepublish",
    "--out-dir",
    outDir,
  ]);

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.ipfsPublish({
    fixtureCid: "bafyequivalencepublish",
    artifactMap: readJson(resolve(ROOT, "tests/fixtures/adapters/ipfs-artifacts-map.json")),
    outDir: "/artifacts/equivalence/ipfs-publish",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host ipfs-load artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-ipfs-load-"));
  runCli([
    "ipfs-load",
    "--cid",
    "bafyequivalenceload",
    "--fixture-map",
    "tests/fixtures/adapters/ipfs-artifacts-map.json",
    "--out-dir",
    outDir,
  ]);

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.ipfsLoad({
    cid: "bafyequivalenceload",
    fixtureMap: readJson(resolve(ROOT, "tests/fixtures/adapters/ipfs-artifacts-map.json")),
    outDir: "/artifacts/equivalence/ipfs-load",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host blockchain-mint artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-blockchain-mint-"));
  runCli([
    "blockchain-mint",
    "--rpc-url",
    "http://local",
    "--card",
    "tests/fixtures/adapters/card-config-delver.json",
    "--owner",
    "0xabc",
    "--fixture-chain-id",
    "tests/fixtures/adapters/blockchain-chain-id.json",
    "--fixture-mint",
    "tests/fixtures/adapters/blockchain-mint.json",
    "--out-dir",
    outDir,
  ]);

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.blockchainMint({
    rpcUrl: "http://local",
    owner: "0xabc",
    cardJson: readJson(resolve(ROOT, "tests/fixtures/adapters/card-config-delver.json")),
    fixtureChainIdJson: readJson(resolve(ROOT, "tests/fixtures/adapters/blockchain-chain-id.json")),
    fixtureMintJson: readJson(resolve(ROOT, "tests/fixtures/adapters/blockchain-mint.json")),
    outDir: "/artifacts/equivalence/blockchain-mint",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host blockchain-load artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-blockchain-load-"));
  runCli([
    "blockchain-load",
    "--rpc-url",
    "http://local",
    "--token-id",
    "token_fixture_1",
    "--fixture-chain-id",
    "tests/fixtures/adapters/blockchain-chain-id.json",
    "--fixture-load",
    "tests/fixtures/adapters/blockchain-load.json",
    "--out-dir",
    outDir,
  ]);

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.blockchainLoad({
    rpcUrl: "http://local",
    tokenId: "token_fixture_1",
    fixtureChainIdJson: readJson(resolve(ROOT, "tests/fixtures/adapters/blockchain-chain-id.json")),
    fixtureLoadJson: readJson(resolve(ROOT, "tests/fixtures/adapters/blockchain-load.json")),
    outDir: "/artifacts/equivalence/blockchain-load",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host llm-plan artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-llm-plan-"));
  runCli([
    "llm-plan",
    "--scenario",
    "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
    "--model",
    "fixture",
    "--fixture",
    "tests/fixtures/adapters/llm-generate-summary.json",
    "--run-id",
    "run_equivalence_llm_plan",
    "--created-at",
    "2025-01-01T00:00:00Z",
    "--out-dir",
    outDir,
  ], { AK_LLM_LIVE: "1" });

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.llmPlan({
    scenarioPath: "/tests/fixtures/e2e/e2e-scenario-v1-basic.json",
    model: "fixture",
    fixturePath: "/tests/fixtures/adapters/llm-generate-summary.json",
    runId: "run_equivalence_llm_plan",
    createdAt: "2025-01-01T00:00:00Z",
    outDir: "/artifacts/equivalence/llm-plan",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host llm artifacts are equivalent to Node CLI output", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-llm-"));
  runCli([
    "llm",
    "--model",
    "fixture",
    "--prompt",
    "hello",
    "--base-url",
    "http://local",
    "--fixture",
    "tests/fixtures/adapters/llm-generate.json",
    "--out-dir",
    outDir,
  ], { AK_LLM_LIVE: "1" });

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.llm({
    model: "fixture",
    prompt: "hello",
    baseUrl: "http://local",
    fixtureJson: readJson(resolve(ROOT, "tests/fixtures/adapters/llm-generate.json")),
    outDir: "/artifacts/equivalence/llm",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host run artifacts are equivalent to Node CLI output", async () => {

  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-run-"));
  runCli([
    "run",
    "--sim-config",
    "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json",
    "--initial-state",
    "tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json",
    "--ticks",
    "0",    "--out-dir",
    outDir,
    "--affinity-presets",
    "tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json",
    "--affinity-loadouts",
    "tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json",
    "--affinity-summary",
    "--actions",
    "tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json",
    "--actor",
    "actor_probe,1,1,motivated",
    "--vital-default",
    "stamina,2,2,0",
    "--tile-barrier",
    "1,0",
  ]);

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter.run({
    simConfigPath: "/tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json",
    initialStatePath: "/tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json",
    ticks: 0,    outDir: "/artifacts/equivalence/run",
    affinityPresetsPath: "/tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json",
    affinityLoadoutsPath: "/tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json",
    affinitySummary: true,
    actionsPath: "/tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json",
    actor: "actor_probe,1,1,motivated",
    vitalDefault: "stamina,2,2,0",
    tileBarrier: "1,0",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host replay artifacts are equivalent to Node CLI output", async () => {

  const runOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-replay-run-"));
  runCli([
    "run",
    "--sim-config",
    "tests/fixtures/artifacts/sim-config-artifact-v1-basic.json",
    "--initial-state",
    "tests/fixtures/artifacts/initial-state-artifact-v1-basic.json",
    "--ticks",
    "1",    "--out-dir",
    runOutDir,
  ]);

  const replayOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-replay-"));
  runCli([
    "replay",
    "--sim-config",
    "tests/fixtures/artifacts/sim-config-artifact-v1-basic.json",
    "--initial-state",
    "tests/fixtures/artifacts/initial-state-artifact-v1-basic.json",
    "--tick-frames",
    join(runOutDir, "tick-frames.json"),
    "--ticks",
    "1",    "--out-dir",
    replayOutDir,
  ]);

  const cliArtifacts = collectJsonArtifacts(replayOutDir);
  const adapter = await createBrowserAdapter();
  const browserRun = await adapter.run({
    simConfigPath: "/tests/fixtures/artifacts/sim-config-artifact-v1-basic.json",
    initialStatePath: "/tests/fixtures/artifacts/initial-state-artifact-v1-basic.json",
    ticks: 1,    outDir: "/artifacts/equivalence/replay-run",
  });
  const browserResult = await adapter.replay({
    simConfigPath: "/tests/fixtures/artifacts/sim-config-artifact-v1-basic.json",
    initialStatePath: "/tests/fixtures/artifacts/initial-state-artifact-v1-basic.json",
    tickFramesJson: browserRun.tickFrames,
    ticks: 1,    outDir: "/artifacts/equivalence/replay",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

test("browser host inspect artifacts are equivalent to Node CLI output", async () => {

  const runOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-inspect-run-"));
  runCli([
    "run",
    "--sim-config",
    "tests/fixtures/artifacts/sim-config-artifact-v1-basic.json",
    "--initial-state",
    "tests/fixtures/artifacts/initial-state-artifact-v1-basic.json",
    "--ticks",
    "1",    "--out-dir",
    runOutDir,
  ]);

  const inspectOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-inspect-"));
  runCli([
    "inspect",
    "--tick-frames",
    join(runOutDir, "tick-frames.json"),
    "--effects-log",
    join(runOutDir, "effects-log.json"),
    "--out-dir",
    inspectOutDir,
  ]);

  const cliArtifacts = collectJsonArtifacts(inspectOutDir);
  const adapter = await createBrowserAdapter();
  const browserRun = await adapter.run({
    simConfigPath: "/tests/fixtures/artifacts/sim-config-artifact-v1-basic.json",
    initialStatePath: "/tests/fixtures/artifacts/initial-state-artifact-v1-basic.json",
    ticks: 1,    outDir: "/artifacts/equivalence/inspect-run",
  });
  const browserResult = await adapter.inspect({
    tickFramesJson: browserRun.tickFrames,
    effectsLogJson: browserRun.effectsLog,
    outDir: "/artifacts/equivalence/inspect",
  });

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});

// ---------------------------------------------------------------------------
// UI <-> CLI parity across the complexity ladder (see plan: cuddly-noodling-gizmo).
// For each tier fixture we author a BuildSpec via the CLI `create`, then build
// that spec two ways — Node CLI `build` and the in-process cli-worker adapter
// (the same path the browser uses) — and assert the produced artifacts are
// identical after normalizing generated ids/timestamps. This is the core
// "same input -> same output" guarantee for complex, high-token-cost levels.
// ---------------------------------------------------------------------------
const { readdirSync: ladderReaddir, rmSync: ladderRmSync } = require("node:fs");
const LADDER_DIR = resolve(ROOT, "tests/fixtures/scenarios/complexity-ladder");
const LADDER_TIERS = ladderReaddir(LADDER_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(LADDER_DIR, f), "utf8")));

for (const tier of LADDER_TIERS) {
  test(`UI<->CLI build parity for complexity ladder ${tier.id}`, async () => {
    // Author the BuildSpec under the gitignored artifacts/ tree so both the
    // ROOT-relative fixture fetch (browser adapter) and the CLI can read it.
    // The whole artifacts/parity root is removed in `finally` so the repo tree
    // stays clean (tests in this file run sequentially — no cross-tier race).
    const parityRoot = resolve(ROOT, "artifacts", "parity");
    const specDir = join(parityRoot, tier.id);
    try {
      runCli([
        "create",
        ...tier.createArgs,
        "--run-id",
        `run_parity_${tier.id}`,
        "--created-at",
        "2026-04-14T00:00:00.000Z",
        "--out-dir",
        specDir,
      ]);
      const specAbsPath = join(specDir, "spec.json");
      const specRootRelPath = `/artifacts/parity/${tier.id}/spec.json`;

      const cliBuildOut = mkdtempSync(join(os.tmpdir(), `agent-kernel-parity-${tier.id}-`));
      runCli(["build", "--spec", specAbsPath, "--out-dir", cliBuildOut]);
      const cliArtifacts = collectJsonArtifacts(cliBuildOut);

      const adapter = await createBrowserAdapter();
      const browserResult = await adapter.build({
        specPath: specRootRelPath,
        outDir: `/artifacts/parity/${tier.id}/build`,
      });

      assert.deepEqual(
        normalizeArtifacts(browserResult.artifacts),
        normalizeArtifacts(cliArtifacts),
      );
    } finally {
      ladderRmSync(parityRoot, { recursive: true, force: true });
    }
  });
}

// ## TODO: Test Permutations
// - Per-element parity: author each affinity/expression/motivation/vital both ways and assert build parity.
// - Run-stage parity across the ladder (adapter.run vs CLI run) on the built sim-config/initial-state.
// - Parity under setup-mode=user vs auto for actor vital authoring.

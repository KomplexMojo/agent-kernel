const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const PRESETS = resolve(ROOT, "tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json");
const PRESETS_V2 = resolve(ROOT, "tests/fixtures/artifacts/affinity-presets-artifact-v2-basic.json");
const LOADOUTS = resolve(ROOT, "tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json");
const SIM_CONFIG = resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-hazard.json");
const INITIAL_STATE = resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json");
const AFFINITY_FIXTURE = resolve(ROOT, "tests/fixtures/personas/affinity-resolution-v1-basic.json");

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }
  return result;
}

async function writeUnifiedAffinityArtifacts(dir) {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const width = 5;
  const height = 5;
  const { simConfig, initialState } = buildUnifiedArtifacts({
    width,
    height,
    terrain: boxedTerrain(width, height),
    runId: "run_configurator_hazard",
    actors: [
      {
        id: "actor_mvp",
        category: "delver",
        position: { x: 1, y: 1 },
        motivations: ["attacking"],
        affinities: [
          { kind: "fire", expression: "push", stacks: 2 },
          { kind: "growth", expression: "pull", stacks: 1 },
        ],
        activeAffinityKey: "fire:push",
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 0, max: 0, regen: 0 },
          stamina: { current: 0, max: 0, regen: 0 },
          durability: { current: 0, max: 0, regen: 0 },
        },
      },
      {
        id: "actor_rival",
        category: "warden",
        position: { x: 2, y: 1 },
        motivations: ["defending"],
        affinities: [{ kind: "decay", expression: "emit", stacks: 1 }],
        activeAffinityKey: "decay:emit",
        vitals: {
          health: { current: 6, max: 6, regen: 0 },
          mana: { current: 1, max: 1, regen: 0 },
          stamina: { current: 0, max: 0, regen: 0 },
          durability: { current: 0, max: 0, regen: 0 },
        },
      },
    ],
  });
  const simConfigPath = join(dir, "sim-config.json");
  const initialStatePath = join(dir, "initial-state.json");
  writeFileSync(simConfigPath, `${JSON.stringify(simConfig, null, 2)}\n`);
  writeFileSync(initialStatePath, `${JSON.stringify(initialState, null, 2)}\n`);
  return { simConfigPath, initialStatePath };
}

test("cli run writes affinity summary", async () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-affinity-"));
  const outDir = join(workDir, "out");
  const { simConfigPath, initialStatePath } = await writeUnifiedAffinityArtifacts(workDir);

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "0",
    "--out-dir",
    outDir,
    "--affinity-presets",
    PRESETS,
    "--affinity-loadouts",
    LOADOUTS,
    "--affinity-summary",
  ]);

  const summaryPath = join(outDir, "affinity-summary.json");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const expected = JSON.parse(readFileSync(AFFINITY_FIXTURE, "utf8")).expected;

  assert.equal(summary.schema, "agent-kernel/AffinitySummary");
  assert.equal(summary.schemaVersion, 2);
  assert.deepEqual(summary.actors, expected.actors);
  assert.deepEqual(summary.hazards, []);
});

// #264: v2 presets (no attack/buff/area effects or abilities) resolve to the same summary
// as the v1 catalog they replace; v1 stays readable.
test("cli run accepts v2 affinity presets and writes the same summary as v1", async () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-affinity-v2-"));
  const { simConfigPath, initialStatePath } = await writeUnifiedAffinityArtifacts(workDir);
  const summaries = [PRESETS, PRESETS_V2].map((presets, index) => {
    const outDir = join(workDir, `out-${index}`);
    runCli([
      "run",
      "--sim-config", simConfigPath,
      "--initial-state", initialStatePath,
      "--ticks", "0",
      "--out-dir", outDir,
      "--affinity-presets", presets,
      "--affinity-loadouts", LOADOUTS,
      "--affinity-summary",
    ]);
    return JSON.parse(readFileSync(join(outDir, "affinity-summary.json"), "utf8"));
  });
  assert.equal(summaries[1].schemaVersion, 2);
  assert.deepEqual(summaries[1].actors, summaries[0].actors);
  assert.ok(summaries[1].actors.every((actor) => !("abilities" in actor)));
});

test("cli run rejects affinity summary without presets or loadouts", (t) => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-affinity-"));
  const outDir = join(workDir, "out");
  const result = spawnSync(process.execPath, [
    CLI,
    "run",
    "--sim-config",
    SIM_CONFIG,
    "--initial-state",
    INITIAL_STATE,
    "--ticks",
    "0",    "--out-dir",
    outDir,
    "--affinity-summary",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Affinity summary requires/);
});

// #150 — affinity-summary.json used to stamp meta.id/createdAt via createMeta()'s host wall-clock
// (Date.now()/Math.random()) instead of the run's seeded clock, the same bug #149 fixed for
// action-log/run-summary/world-state. Two runs of byte-identical input must produce a
// byte-identical meta stamp; asserting on the run's own seeded id/timestamp (not a hardcoded
// literal) keeps this from silently passing if the clock seed itself ever changes.
test("cli run stamps affinity-summary.json meta from the seeded clock, not the wall clock", async () => {
  const runOnce = async () => {
    const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-affinity-determinism-"));
    const outDir = join(workDir, "out");
    const { simConfigPath, initialStatePath } = await writeUnifiedAffinityArtifacts(workDir);
    runCli([
      "run",
      "--sim-config", simConfigPath,
      "--initial-state", initialStatePath,
      "--ticks", "0",
      "--out-dir", outDir,
      "--affinity-presets", PRESETS,
      "--affinity-loadouts", LOADOUTS,
      "--affinity-summary",
    ]);
    return JSON.parse(readFileSync(join(outDir, "affinity-summary.json"), "utf8")).meta;
  };

  const first = await runOnce();
  const second = await runOnce();
  assert.deepEqual(second, first);
});

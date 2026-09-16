const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    ...options,
  });
}

test("cli scenario composes llm-plan, run, and inspect into one pipeline", (t) => {

  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-scenario-"));
  const result = runCli(
    [
      "scenario",
      "--text",
      "Build a compact fire dungeon with one delver and one defending warden.",
      "--catalog",
      "tests/fixtures/pool/catalog-basic.json",
      "--budget-tokens",
      "700",
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary.json",
      "--ticks",
      "1",      "--run-id",
      "run_scenario_fixture",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { env: { AK_LLM_LIVE: "1" } },
  );

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }

  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.ok, true);
  assert.equal(summary.command, "scenario");
  assert.equal(summary.runId, "run_scenario_fixture");
  assert.equal(summary.outDir, outDir);
  assert.ok(Array.isArray(summary.actorIds));
  assert.ok(summary.actorIds.length > 0);
  assert.ok(Array.isArray(summary.roomIds));
  assert.ok(summary.roomIds.length > 0);
  assert.equal(summary.ticks, 1);

  assert.equal(summary.artifactPaths.llm_plan_spec, join(outDir, "llm-plan", "spec.json"));
  assert.equal(summary.artifactPaths.llm_plan_sim_config, join(outDir, "llm-plan", "sim-config.json"));
  assert.equal(summary.artifactPaths.llm_plan_initial_state, join(outDir, "llm-plan", "initial-state.json"));
  assert.equal(summary.artifactPaths.tick_frames, join(outDir, "run", "tick-frames.json"));
  assert.equal(summary.artifactPaths.inspect_summary, join(outDir, "inspect", "inspect-summary.json"));
  assert.equal(existsSync(summary.artifactPaths.llm_plan_spec), true);
  assert.equal(existsSync(summary.artifactPaths.llm_plan_sim_config), true);
  assert.equal(existsSync(summary.artifactPaths.llm_plan_initial_state), true);
  assert.equal(existsSync(summary.artifactPaths.tick_frames), true);
  assert.equal(existsSync(summary.artifactPaths.inspect_summary), true);
});

test("cli scenario resumes run and inspect from --from-run", async () => {

  const workspaceDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-scenario-from-run-"));
  const sourceRunId = "run_llm_plan_resume";
  const sourceDir = join(workspaceDir, "artifacts", "runs", sourceRunId, "llm-plan");
  const outDir = join(workspaceDir, "artifacts", "runs", sourceRunId);

  mkdirSync(sourceDir, { recursive: true });
  const { buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const { simConfig, initialState } = buildUnifiedArtifacts({
    width: 1,
    height: 1,
    terrain: ["spawn"],
    runId: sourceRunId,
    clock: "2025-01-01T00:00:00Z",
    actors: [{
      id: "actor_1",
      category: "delver",
      position: { x: 0, y: 0 },
      motivations: ["exploring"],
      vitals: { health: { current: 10, max: 10, regen: 0 } },
    }],
  });
  writeFileSync(join(sourceDir, "sim-config.json"), `${JSON.stringify(simConfig, null, 2)}\n`, "utf8");
  writeFileSync(join(sourceDir, "initial-state.json"), `${JSON.stringify(initialState, null, 2)}\n`, "utf8");

  const result = runCli(
    [
      "scenario",
      "--from-run",
      sourceRunId,
      "--ticks",
      "1",    ],
    { cwd: workspaceDir },
  );

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }

  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.ok, true);
  assert.equal(summary.command, "scenario");
  assert.equal(summary.runId, sourceRunId);
  assert.match(summary.outDir, new RegExp(`artifacts/runs/${sourceRunId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}$`));
  assert.match(summary.artifactPaths.source_sim_config, /artifacts\/runs\/run_llm_plan_resume\/llm-plan\/sim-config\.json$/);
  assert.match(summary.artifactPaths.source_initial_state, /artifacts\/runs\/run_llm_plan_resume\/llm-plan\/initial-state\.json$/);
  assert.match(summary.artifactPaths.tick_frames, /artifacts\/runs\/run_llm_plan_resume\/run\/tick-frames\.json$/);
  assert.match(summary.artifactPaths.inspect_summary, /artifacts\/runs\/run_llm_plan_resume\/inspect\/inspect-summary\.json$/);
  assert.equal(existsSync(summary.artifactPaths.tick_frames), true);
  assert.equal(existsSync(summary.artifactPaths.inspect_summary), true);
});

test("cli scenario dry-run validates the llm-plan/build path with core-ts or artifact writes", () => {
  const rootDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-scenario-dry-run-"));
  const outDir = join(rootDir, "out");
  const result = runCli(
    [
      "scenario",
      "--dry-run",
      "--text",
      "Build a compact fire dungeon with one delver and one defending warden.",
      "--catalog",
      "tests/fixtures/pool/catalog-basic.json",
      "--budget-tokens",
      "700",
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary.json",
      "--ticks",
      "1",
      "--run-id",
      "run_scenario_dry_run",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }

  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.ok, true);
  assert.equal(summary.command, "scenario");
  assert.equal(summary.valid, true);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.runId, "run_scenario_dry_run");
  assert.equal(summary.outDir, outDir);
  assert.equal(summary.ticks, 1);
  assert.ok(Array.isArray(summary.actorIds));
  assert.ok(Array.isArray(summary.roomIds));
  assert.equal(summary.budgetEstimate.total, 700);
  assert.equal(existsSync(join(outDir, "llm-plan", "spec.json")), false);
  assert.equal(existsSync(join(outDir, "run", "tick-frames.json")), false);
  assert.equal(existsSync(join(outDir, "inspect", "inspect-summary.json")), false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("cli scenario composes llm-plan, run, and inspect into one pipeline", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }

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
      "1",
      "--wasm",
      WASM_PATH,
      "--run-id",
      "run_scenario_fixture",
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

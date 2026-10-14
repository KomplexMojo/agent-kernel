// The "author one level, play it several times, compare" chain through the CLI.
//
// `run --from-run <level>` writes only run outputs (tick frames, summary, a GameplayBundle
// that embeds the level's SimConfig and InitialState). `diff` and `show` used to look for
// sim-config.json / initial-state.json files beside those outputs, so `diff` failed and
// `show` reported no actors or rooms for every run made this way.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(workDir, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: workDir, encoding: "utf8" });
}

function runCliJson(workDir, args) {
  const result = runCli(workDir, args);
  assert.equal(result.status, 0, `ak ${args[0]} failed:\n${result.stderr}\n${result.stdout}`);
  const lines = result.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function authorLevel(workDir, runId) {
  return runCliJson(workDir, [
    "create",
    "--room", "size=small;count=2",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--warden", "count=1;affinity=dark;motivation=defending",
    "--budget-tokens", "2000",
    "--run-id", runId,
    "--created-at", "2026-10-14T00:00:00.000Z",
  ]);
}

test("cli diff compares two runs played from the same authored level", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-from-run-diff-"));
  const level = authorLevel(workDir, "level_chain");
  runCliJson(workDir, ["run", "--from-run", "level_chain", "--ticks", "3", "--seed", "1", "--run-id", "play_a"]);
  runCliJson(workDir, ["run", "--from-run", "level_chain", "--ticks", "4", "--seed", "1", "--run-id", "play_b"]);

  const diff = runCliJson(workDir, ["diff", "--run-a", "play_a", "--run-b", "play_b"]);
  assert.equal(diff.ok, true);
  assert.equal(diff.runA, "play_a");
  assert.equal(diff.runB, "play_b");
  assert.deepEqual(diff.ticks, { a: 3, b: 4, delta: 1 });
  const actorIds = diff.actors.map((actor) => actor.id);
  for (const actorId of level.actorIds) {
    assert.ok(actorIds.includes(actorId), `diff lists level actor ${actorId}: ${JSON.stringify(actorIds)}`);
  }
  assert.ok(diff.actors.every((actor) => actor.presentInA && actor.presentInB));
});

test("cli show lists the actors and rooms of a run played from an authored level", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-from-run-show-"));
  const level = authorLevel(workDir, "level_show");
  runCliJson(workDir, ["run", "--from-run", "level_show", "--ticks", "2", "--run-id", "play_show"]);

  const shown = runCliJson(workDir, ["show", "--run-id", "play_show"]);
  assert.deepEqual(shown.actorIds, [...level.actorIds].sort());
  assert.deepEqual(shown.roomIds, [...level.roomIds].sort());
  assert.equal(shown.actorCount, level.actorIds.length);
  assert.equal(shown.roomCount, level.roomIds.length);
});

test("cli scenario runs an explicit sim-config and initial-state pair", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-from-run-scenario-"));
  const level = authorLevel(workDir, "level_scenario");

  const scenario = runCliJson(workDir, [
    "scenario",
    "--sim-config", level.artifactPaths.sim_config,
    "--initial-state", level.artifactPaths.initial_state,
    "--ticks", "2",
    "--run-id", "scenario_explicit",
  ]);
  assert.equal(scenario.ok, true);
  assert.equal(scenario.runId, "scenario_explicit");
});

test("cli scenario rejects --sim-config without --initial-state", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-from-run-scenario-half-"));
  const level = authorLevel(workDir, "level_half");
  const result = runCli(workDir, ["scenario", "--sim-config", level.artifactPaths.sim_config]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /--sim-config and --initial-state/);
});

test("cli solve says nothing was solved when the solver defers a free-text scenario", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-solve-deferred-"));
  const output = runCliJson(workDir, ["solve", "--scenario", "two rooms joined by a corridor", "--run-id", "solve_deferred"]);
  assert.equal(output.command, "solve");
  assert.equal(output.solved, false, "a deferred solve answered nothing");
  assert.equal(output.status, "deferred");
  assert.equal(output.reason, "constraint_domain_unsupported");
  assert.match(output.artifactPaths.solver_result, /solver-result\.json$/);
});

// ## TODO: Test Permutations
// - diff where only one side was played from an authored level and the other carries sim-config files.
// - diff where the run bundle lacks an embedded InitialState: the original --from-run error names the run.
// - show on a scenario root (llm-plan/run/inspect) reports the llm-plan actors once, not twice.
// - scenario --sim-config together with --from-run or --text is rejected.
// - solve with --solver-fixture whose status is "unsat" reports solved: true and status "unsat".
// - solve whose adapter returns status "error" reports solved: false.

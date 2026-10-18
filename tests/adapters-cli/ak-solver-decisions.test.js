/**
 * #299 — a build records which decisions the solver made in its telemetry.json, and
 * `ak inspect --build-dir` and `ak show` print the one-line summary.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCliOk(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`CLI failed (${result.status}): ${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
  }
  return JSON.parse((result.stdout || "").trim());
}

test("ak create records the placement decision and inspect prints it", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-solver-decisions-"));
  runCliOk([
    "create",
    "--text", "One room with an unplaced resource and one delver.",
    "--room", "size=large;count=1",
    "--floor-tile", "count=18",
    "--resource", "permanenceMode=permanent;vital=mana;delta=6",
    "--delver", "id=lone_delver;count=1;affinity=fire;motivation=exploring",
    "--run-id", "run_solver_decisions",
    "--created-at", "2026-10-18T00:00:00.000Z",
    "--out-dir", outDir,
  ]);

  const telemetry = JSON.parse(readFileSync(join(outDir, "telemetry.json"), "utf8"));
  assert.deepEqual(telemetry.data.solverDecisions, [{
    domain: "configurator_satisfiability",
    decision: "fallback",
    status: "deferred",
    reason: "solver_domain_unavailable",
  }]);

  const inspected = runCliOk([
    "inspect",
    "--build-dir", outDir,
    "--out-dir", join(outDir, "inspect"),
  ]);
  assert.equal(inspected.solverDecisions, "placement: fallback (solver_domain_unavailable)");
  assert.equal(inspected.artifactPaths.build_telemetry, join(outDir, "telemetry.json"));
});

// ## TODO: Test Permutations
// - `ak build` with a solver-capable engine records `solver` and its objective values
// - `ak llm-plan --budget-loop` records each budget-fit decision in order
// - `ak show --run-id` prints the same line for the create command

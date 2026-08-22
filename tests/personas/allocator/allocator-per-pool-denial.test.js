/**
 * Characterization for Prompt-Allocator-Per-Line-Denial.md.
 *
 * A positive receipt.remaining is the total-budget remainder. It does not
 * override a category pool cap: scenario 59 spends 132 tokens from the
 * 126-token warden pool while leaving 293 tokens unspent overall.
 */
const assert = require("node:assert/strict");
const { readFileSync, rmSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = resolve(__dirname, "../../..");
const CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const SCENARIOS = join(ROOT, "tools/remote-ollama-control/benchmarks/content-gen/constrained.json");

function constrainedScenario(index) {
  const fixture = JSON.parse(readFileSync(SCENARIOS, "utf8"));
  return fixture.scenarios.find((scenario) => scenario.index === index);
}

test("allocator denies a warden pool overspend while total budget remains", () => {
  const scenario = constrainedScenario(59);
  assert.equal(scenario.title, "Constrained Two Warden Patrol");

  const outDir = mkdtempSync(join(tmpdir(), "ak-allocator-pool-denial-"));
  try {
    const result = spawnSync(process.execPath, [
      CLI,
      "create",
      "--text", scenario.payload.text,
      "--room", scenario.payload.room[0],
      "--warden", scenario.payload.warden[0],
      "--budget-tokens", String(scenario.payload.budgetTokens),
      "--run-id", "allocator_pool_denial_characterization",
      "--created-at", scenario.payload.createdAt,
      "--emit-intermediates",
      "--out-dir", outDir,
    ], { cwd: ROOT, encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Budget receipt denied: status=denied; remaining=293/);
    assert.match(result.stderr, /deniedLines=actor:actor_spawn:wardens/);
    assert.match(result.stderr, /deniedPools=wardens:132\/126/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

// ## TODO: Test Permutations
// - an exact scenario whose active actor pool is capped at the former 55-token minimum
// - a proposal at the pool cap remains approved when total remaining is positive

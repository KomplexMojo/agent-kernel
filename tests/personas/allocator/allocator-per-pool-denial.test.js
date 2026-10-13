/**
 * Characterization for Prompt-Allocator-Per-Line-Denial.md.
 *
 * A positive receipt.remaining is the total-budget remainder. It does not
 * override a category pool cap: one token below scenario 59's passing
 * boundary spends 186 tokens from a 176-token warden pool while leftover
 * tiles-grid billing used to leave 132 tokens unspent overall. Terrain floor
 * billing leaves 188. The warden pool denial is unchanged.
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

test("allocator denies one token below a warden pool boundary while total budget remains", () => {
  const scenario = constrainedScenario(59);
  assert.equal(scenario.title, "Constrained Two Warden Patrol");
  // The scenario's own budget was its minimum until the actor viability floor retuned the pool
  // split (warden 16% -> 23%). It is no longer: the minimum for this payload measured 400 against a
  // catalog budget of 469, so `budgetTokens - 1` now SUCCEEDS and characterises nothing. Pinned to
  // the measured boundary instead. The property under test is unchanged and still holds -- the
  // allocator denies on the WARDEN POOL while leftover tiles-grid remaining
  // was 132 and terrain floor remaining is 188. The warden shortfall is unchanged.
  const boundaryBudget = 399;
  const boundaryText = scenario.payload.text.replace(
    /Use a \d+ token hard budget/,
    `Use a ${boundaryBudget} token hard budget`,
  );

  const outDir = mkdtempSync(join(tmpdir(), "ak-allocator-pool-denial-"));
  try {
    const result = spawnSync(process.execPath, [
      CLI,
      "create",
      "--text", boundaryText,
      "--room", scenario.payload.room[0],
      "--warden", scenario.payload.warden[0],
      "--budget-tokens", String(boundaryBudget),
      "--run-id", "allocator_pool_denial_characterization",
      "--created-at", scenario.payload.createdAt,
      "--emit-intermediates",
      "--out-dir", outDir,
    ], { cwd: ROOT, encoding: "utf8" });

    assert.notEqual(result.status, 0);
    // remaining was 188 until #198 gave medium rooms their real 5-8 range (more floor billed).
    assert.match(result.stderr, /Budget receipt denied: status=denied; remaining=173/);
    assert.match(result.stderr, /deniedLines=actor:actor_spawn:wardens/);
    assert.match(result.stderr, /deniedPools=wardens:186\/176/);
    // #145 — the shortfall (how many more tokens this one pool alone needed) used to be
    // uncomputable from the denial message; 186 spent against a 176 cap is short by 10.
    assert.match(result.stderr, /deniedPools=wardens:186\/176 \(short 10\)/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

// ## TODO: Test Permutations
// - an exact scenario whose active actor pool is capped at the former 55-token minimum
// - a proposal at the pool cap remains approved when total remaining is positive

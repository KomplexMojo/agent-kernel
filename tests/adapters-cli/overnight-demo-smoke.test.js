// The overnight demo script (scripts/demo/overnight-2026-10-17.sh) drives the game through `ak`.
// Its quick sections run here so a CLI change that breaks the walkthrough fails the suite.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/demo/overnight-2026-10-17.sh");

const demo = (...sections) => spawnSync("bash", [SCRIPT, ...sections], { cwd: ROOT, encoding: "utf8" });

test("the stamina, rename and regen sections run through ak", () => {
  const result = demo("stamina", "rename", "regen");
  assert.equal(result.status, 0, result.stderr);
  // #407: a step costs 1 and regen 1 returns it, so walking never drains the pool.
  assert.doesNotMatch(result.stdout, /move {2}ST [0-9]\/10/);
  assert.match(result.stdout, /move {2}ST 10\/10/);
  assert.match(result.stdout, /wait {2}ST 10\/10/);
  assert.match(result.stdout, /affinity must be one of: .*growth/);
  assert.match(result.stdout, /"wastedTokens":125/);
});

test("an unknown section is refused", () => {
  const result = demo("nope");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown section: nope/);
});

// ## TODO: Test Permutations
// - the corrode section ends with the hero defeated at health 0 after durability reaches 0.
// - the rules section prints one line per pair and stack count (10 lines).

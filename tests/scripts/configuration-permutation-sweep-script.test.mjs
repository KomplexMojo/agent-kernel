import assert from "node:assert/strict";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/testing/run-configuration-permutation-sweep.mjs");

// #319: the sweep's position replay read a move's old `params.to`, so every accepted move was
// reported as a malformed destination. One sweep point with moves must replay clean.
test("one sweep point with accepted moves passes the step-level position replay", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--only", "A-delver-affinity-fire", "--ticks", "5"],
    { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /actions=[1-9]\d* .*step=OK\(5\)/);
  assert.doesNotMatch(result.stdout, /malformed destination/);
});

// ## TODO: Test Permutations
// - a move to a wall tile is reported as a violation
// - two solid actors on one tile are reported; a non-solid hazard sharing a tile is not

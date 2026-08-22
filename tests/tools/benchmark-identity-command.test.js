const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const TOOL_ROOT = resolve(__dirname, "../../tools/remote-ollama-control");
const SCRIPT = join(TOOL_ROOT, "scripts/print-benchmark-identity.js");
const { currentBenchmarkIdentity } = require("../../tools/remote-ollama-control/scripts/lib/benchmark-result-reader.js");

function run(args = []) {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

const SHA256 = /^[0-9a-f]{64}$/;

test("the identity command reports the same hashes the reader derives", () => {
  const expected = currentBenchmarkIdentity();
  const actual = JSON.parse(run());

  assert.equal(actual.scenarioSet.sha256, expected.scenarioSet.sha256);
  assert.equal(actual.scenarioSet.count, expected.scenarioSet.count);
  assert.equal(actual.matrix.sha256, expected.matrix.sha256);
  assert.equal(actual.execution.executionSuiteHash, expected.execution.executionSuiteHash);
  assert.equal(actual.execution.seedSetHash, expected.execution.seedSetHash);
  assert.equal(actual.execution.tickProfileHash, expected.execution.tickProfileHash);
  assert.equal(actual.execution.evaluatorVersion, expected.execution.evaluatorVersion);
});

// The catalog contract is 100 scenarios; an operator reading a smaller number
// off this command is looking at a broken checkout, not a valid run identity.
test("the reported scenario count is the canonical catalog size", () => {
  assert.equal(JSON.parse(run()).scenarioSet.count, 100);
});

// The installed agent refuses to start without all three hashes, and the shipped
// env template carries only <placeholder> markers. Without a pasteable form the
// operator has no way to fill them in.
test("--env emits exactly the three variables the installed agent requires", () => {
  const lines = run(["--env"]).trim().split("\n").filter(Boolean);
  const pairs = new Map(lines.map((line) => {
    const index = line.indexOf("=");
    assert.notEqual(index, -1, `expected KEY=value, received ${line}`);
    return [line.slice(0, index), line.slice(index + 1)];
  }));

  assert.deepEqual([...pairs.keys()].sort(), [
    "AK_BENCHMARK_EXECUTION_SUITE_HASH",
    "AK_BENCHMARK_MATRIX_HASH",
    "AK_BENCHMARK_SCENARIO_HASH",
  ]);
  for (const [key, value] of pairs) {
    assert.match(value, SHA256, `${key} must be a lowercase sha256, received ${value}`);
  }
});

test("the emitted values match the ones the agent env template asks for by name", () => {
  const template = readFileSync(join(TOOL_ROOT, "config/benchmark-agent.env.example"), "utf8");
  const emitted = run(["--env"]).trim().split("\n").filter(Boolean)
    .map((line) => line.slice(0, line.indexOf("=")));

  for (const key of emitted) {
    assert.match(template, new RegExp(`^#?\\s*${key}=`, "m"), `${key} is emitted but the template never asks for it`);
  }
});

// Every documented invocation goes through `pnpm run ... -- --env`, which forwards
// the separator as a real argument.
test("the pnpm separator is tolerated, so the documented invocation works", () => {
  assert.equal(run(["--", "--env"]), run(["--env"]));
  assert.equal(run(["--"]), run([]));
});

test("--env output carries no placeholder markers left to fill in by hand", () => {
  assert.doesNotMatch(run(["--env"]), /[<>]|placeholder|canonical-/i);
});

// A runbook naming a command that does not exist is worse than no runbook: the
// operator follows it, gets an error, and cannot tell whether they typed it wrong.
test("the runbook's deployment commands exist as written", () => {
  const runbook = readFileSync(join(TOOL_ROOT, "benchmarks/execution/RUNBOOK.md"), "utf8");
  const pkg = JSON.parse(readFileSync(join(TOOL_ROOT, "package.json"), "utf8"));

  const scriptName = /pnpm --dir tools\/remote-ollama-control run ([\w:-]+)/.exec(runbook)?.[1];
  assert.ok(scriptName, "the runbook must name a pnpm script for reading identities");
  assert.ok(pkg.scripts[scriptName], `runbook names "${scriptName}", which package.json does not define`);

  // Only the deployment section tells the operator what to set; elsewhere the
  // runbook reads values the pipeline provides itself (AK_BENCHMARK_SOURCE_WORKTREE).
  const template = readFileSync(join(TOOL_ROOT, "config/benchmark-agent.env.example"), "utf8");
  const deployment = /## 6\. First standalone deployment[\s\S]*?\n## /.exec(runbook)?.[0];
  assert.ok(deployment, "the runbook must carry a first-deployment section");
  for (const name of new Set(deployment.match(/AK_BENCHMARK_[A-Z_]+/g) || [])) {
    assert.match(template, new RegExp(`^#?\\s*${name}=`, "m"), `runbook names ${name}, absent from the template`);
  }
});

// ## TODO: Test Permutations
test.skip("a corrupt content-gen catalog fails the command loudly rather than printing a partial identity", async () => {});
test.skip("--env and the JSON form always report the same three hashes in one invocation", async () => {});
test.skip("changing one execution catalog file moves executionSuiteHash and nothing else", async () => {});
test.skip("changing one content scenario moves scenarioSet.sha256 and nothing else", async () => {});
test.skip("an unknown flag is rejected instead of silently printing the default form", async () => {});

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const { runBenchmarkAgent } = require("../../tools/remote-ollama-control/scripts/benchmark-agent");
const { classifyTrigger, computeRunKey, loadTriggerPolicy } = require("../../tools/remote-ollama-control/scripts/lib/benchmark-trigger");
const { acquireAgentLock } = require("../../tools/remote-ollama-control/scripts/lib/benchmark-state");
const { publishResult, readJsonFromBranch } = require("../../tools/remote-ollama-control/scripts/lib/benchmark-publisher");

const ROOT = resolve(__dirname, "../../tools/remote-ollama-control");
const POLICY = loadTriggerPolicy(ROOT);
const RESULT_FIXTURE = JSON.parse(readFileSync(resolve(
  __dirname,
  "../fixtures/benchmarks/benchmark-agent-result-v1.json",
), "utf8"));

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function setupRepository() {
  const root = mkdtempSync(join(tmpdir(), "ak-benchmark-agent-"));
  const remote = join(root, "remote.git");
  const operator = join(root, "operator");
  git(root, ["init", "--bare", remote]);
  git(root, ["clone", remote, operator]);
  git(operator, ["config", "user.email", "benchmark@example.invalid"]);
  git(operator, ["config", "user.name", "Benchmark Fixture"]);
  writeFileSync(join(operator, "README.md"), "source\n");
  git(operator, ["add", "README.md"]);
  git(operator, ["commit", "-m", "initial"]);
  git(operator, ["branch", "-M", "main"]);
  git(operator, ["push", "-u", "origin", "main"]);
  return { root, remote, operator };
}

function sourceCommit(repo, path, content, message) {
  const file = join(repo.operator, path);
  require("node:fs").mkdirSync(require("node:path").dirname(file), { recursive: true });
  writeFileSync(file, content);
  git(repo.operator, ["add", path]);
  git(repo.operator, ["commit", "-m", message]);
  git(repo.operator, ["push", "origin", "main"]);
  return git(repo.operator, ["rev-parse", "HEAD"]);
}

function fixtureBenchmark(status = "completed") {
  return async () => ({
    ...RESULT_FIXTURE,
    status,
    qualifies: status === "completed",
    scenarioSetHash: "scenario-a",
    matrixHash: "matrix-a",
  });
}

test("trigger policy is branch-separated, hash-aware, path-aware, and stable", () => {
  assert.equal(classifyTrigger({ policy: POLICY, changedPaths: ["docs/notes.md"] }).required, false);
  assert.equal(classifyTrigger({ policy: POLICY, scenarioHashChanged: true }).required, true);
  assert.equal(classifyTrigger({ policy: POLICY, matrixHashChanged: true }).required, true);
  assert.equal(classifyTrigger({
    policy: POLICY,
    changedPaths: ["packages/adapters-cli/src/mcp/server.js"],
  }).required, true);
  assert.equal(classifyTrigger({
    policy: POLICY,
    polledRef: "benchmark-results",
    changedPaths: ["tools/remote-ollama-control/benchmarks/content-gen/simple.json"],
  }).required, false);
  assert.equal(computeRunKey({
    sourceCommit: "abc", scenarioSetHash: "scenarios", matrixHash: "matrix",
    runnerContractVersion: POLICY.runnerContractVersion,
  }), computeRunKey({
    matrixHash: "matrix", runnerContractVersion: POLICY.runnerContractVersion,
    scenarioSetHash: "scenarios", sourceCommit: "abc",
  }));
});

test("agent deduplicates, ignores irrelevant/results commits, coalesces, and publishes failures", async () => {
  const repo = setupRepository();
  const stateDir = join(repo.root, "state");
  const baseOptions = {
    sourceRepo: repo.remote,
    sourceRef: "main",
    resultsRemote: repo.remote,
    resultBranch: "benchmark-results",
    stateDir,
    policy: POLICY,
    scenarioSetHash: "scenario-a",
    matrixHash: "matrix-a",
  };
  let runs = 0;
  const first = await runBenchmarkAgent({
    ...baseOptions,
    runBenchmark: async (context) => { runs += 1; return { ...(await fixtureBenchmark()(context)) }; },
  });
  assert.equal(first.status, "published");
  assert.equal(runs, 1);
  const firstPublished = readJsonFromBranch(repo.remote, "benchmark-results", "latest.json");
  assert.equal(firstPublished.run.status, "completed");
  assert.equal(firstPublished.run.runnerContractVersion, POLICY.runnerContractVersion);
  assert.equal(firstPublished.source.repository, "agent-kernel");
  assert.match(firstPublished.source.tree, /^[a-f0-9]{40,64}$/);
  assert.equal(firstPublished.scenarioSet.sha256, "scenario-a");
  assert.equal(firstPublished.matrix.sha256, "matrix-a");
  assert.equal(firstPublished.minimumSuccessfulConfiguration.configurationId, "fixture-single");
  assert.equal(firstPublished.result, undefined, "high-level result fields must not be hidden in a nested payload");

  const restart = await runBenchmarkAgent({
    ...baseOptions,
    stateDir: join(repo.root, "fresh-state"),
    runBenchmark: async () => { runs += 1; return fixtureBenchmark()(); },
  });
  assert.equal(restart.status, "deduplicated");
  assert.equal(runs, 1);

  sourceCommit(repo, "docs/notes.md", "irrelevant\n", "docs only");
  const irrelevant = await runBenchmarkAgent({ ...baseOptions, runBenchmark: fixtureBenchmark() });
  assert.equal(irrelevant.status, "no_trigger");

  sourceCommit(repo, "packages/adapters-cli/src/mcp/gate.js", "relevant\n", "relevant source");
  const coalescedSha = { value: null };
  const coalesced = await runBenchmarkAgent({
    ...baseOptions,
    runBenchmark: async () => {
      coalescedSha.value = sourceCommit(
        repo,
        "tools/remote-ollama-control/config/models.json",
        "{}\n",
        "newer matrix commit",
      );
      return fixtureBenchmark()();
    },
  });
  assert.equal(coalesced.status, "published");
  assert.equal(coalesced.queuedCommit, coalescedSha.value);

  const hashRun = await runBenchmarkAgent({
    ...baseOptions,
    scenarioSetHash: "scenario-b",
    matrixHash: "matrix-b",
    runBenchmark: fixtureBenchmark("infrastructure_error"),
  });
  assert.equal(hashRun.status, "published");
  const latest = readJsonFromBranch(repo.remote, "benchmark-results", "latest.json");
  const latestSuccess = readJsonFromBranch(repo.remote, "benchmark-results", "latest-success.json");
  assert.equal(latest.run.status, "infrastructure_error");
  assert.notEqual(latestSuccess.run.id, latest.run.id, "failed attempt must not replace latest success");
  assert.match(git(repo.operator, ["status", "--short"]), /docs\/notes\.md|^$/);
});

test("lock refusal and non-force push races leave operator and remote state intact", async () => {
  const repo = setupRepository();
  writeFileSync(join(repo.operator, "operator-dirty.txt"), "keep me\n");
  const stateDir = join(repo.root, "state");
  const lock = acquireAgentLock(stateDir, "holder");
  try {
    const locked = await runBenchmarkAgent({
      sourceRepo: repo.remote,
      sourceRef: "main",
      resultsRemote: repo.remote,
      resultBranch: "benchmark-results",
      stateDir,
      policy: POLICY,
      scenarioSetHash: "scenario-a",
      matrixHash: "matrix-a",
      runBenchmark: fixtureBenchmark(),
    });
    assert.equal(locked.status, "locked");
  } finally {
    lock.release();
  }
  assert.equal(readFileSync(join(repo.operator, "operator-dirty.txt"), "utf8"), "keep me\n");

  await publishResult({
    remote: repo.remote,
    branch: "benchmark-results",
    workDir: join(repo.root, "publisher-a"),
    record: { schemaVersion: "agent-kernel-benchmark-result/v1", run: { id: "base", key: "base", status: "completed" } },
  });
  await assert.rejects(() => publishResult({
    remote: repo.remote,
    branch: "benchmark-results",
    workDir: join(repo.root, "publisher-b"),
    record: { schemaVersion: "agent-kernel-benchmark-result/v1", run: { id: "loser", key: "loser", status: "completed" } },
    beforePush: () => publishResult({
      remote: repo.remote,
      branch: "benchmark-results",
      workDir: join(repo.root, "publisher-racer"),
      record: { schemaVersion: "agent-kernel-benchmark-result/v1", run: { id: "winner", key: "winner", status: "completed" } },
    }),
  }), /push rejected/i);
  assert.equal(readJsonFromBranch(repo.remote, "benchmark-results", "latest.json").run.id, "winner");
  assert.equal(git(repo.operator, ["status", "--short"]), "?? operator-dirty.txt");
});

// ## TODO: Test Permutations
// - corrupt local poll state fails closed without rewriting it
// - a deleted result branch is recreated only from an explicit empty publication state
// - two queued source commits coalesce to the newest reachable source ref

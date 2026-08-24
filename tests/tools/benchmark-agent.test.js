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
  const scenarioChange = classifyTrigger({ policy: POLICY, scenarioHashChanged: true });
  assert.equal(scenarioChange.required, true);
  assert.deepEqual(scenarioChange.modes, {
    authoring: true, runtimeExecution: false, generatedExecution: true,
  });
  assert.equal(classifyTrigger({ policy: POLICY, matrixHashChanged: true }).required, true);
  const authoringChange = classifyTrigger({
    policy: POLICY,
    changedPaths: ["packages/adapters-cli/src/mcp/server.js"],
  });
  assert.equal(authoringChange.required, true);
  assert.deepEqual(authoringChange.modes, {
    authoring: true, runtimeExecution: false, generatedExecution: true,
  });
  const runtimeChange = classifyTrigger({
    policy: POLICY,
    changedPaths: ["packages/runtime/src/kernel.js"],
  });
  assert.equal(runtimeChange.required, true);
  assert.deepEqual(runtimeChange.modes, {
    authoring: false, runtimeExecution: true, generatedExecution: true,
  }, "runtime-only changes must reuse retained authoring rather than invoke an LLM");
  const resultBranch = classifyTrigger({
    policy: POLICY,
    polledRef: "benchmark-results",
    changedPaths: ["tools/remote-ollama-control/benchmarks/content-gen/simple.json"],
  });
  assert.equal(resultBranch.required, false);
  assert.deepEqual(resultBranch.modes, {
    authoring: false, runtimeExecution: false, generatedExecution: false,
  });
  assert.equal(computeRunKey({
    sourceCommit: "abc", scenarioSetHash: "scenarios", matrixHash: "matrix", executionSuiteHash: "execution-a",
    runnerContractVersion: POLICY.runnerContractVersion,
  }), computeRunKey({
    matrixHash: "matrix", runnerContractVersion: POLICY.runnerContractVersion,
    executionSuiteHash: "execution-a", scenarioSetHash: "scenarios", sourceCommit: "abc",
  }));
  assert.notEqual(computeRunKey({
    sourceCommit: "abc", scenarioSetHash: "scenarios", matrixHash: "matrix",
    executionSuiteHash: "execution-a", runnerContractVersion: POLICY.runnerContractVersion,
  }), computeRunKey({
    sourceCommit: "abc", scenarioSetHash: "scenarios", matrixHash: "matrix",
    executionSuiteHash: "execution-b", runnerContractVersion: POLICY.runnerContractVersion,
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
    executionSuiteHash: "execution-a",
  };
  let runs = 0;
  const first = await runBenchmarkAgent({
    ...baseOptions,
    runBenchmark: async (context) => { runs += 1; return { ...(await fixtureBenchmark()(context)) }; },
  });
  assert.equal(first.status, "published");
  assert.equal(runs, 1);
  const firstPublished = readJsonFromBranch(repo.remote, "benchmark-results", "latest.json");
  assert.equal(firstPublished.schemaVersion, "agent-kernel-benchmark-result/v2");
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
      executionSuiteHash: "execution-a",
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

test("execution-suite identity triggers execution modes, persists, publishes, and deduplicates", async () => {
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
  await runBenchmarkAgent({
    ...baseOptions,
    executionSuiteHash: "execution-a",
    runBenchmark: fixtureBenchmark(),
  });
  let receivedTrigger;
  const changed = await runBenchmarkAgent({
    ...baseOptions,
    executionSuiteHash: "execution-b",
    runBenchmark: async ({ trigger }) => {
      receivedTrigger = trigger;
      return fixtureBenchmark()();
    },
  });
  assert.equal(changed.status, "published");
  assert.deepEqual(receivedTrigger.modes, {
    authoring: false, runtimeExecution: true, generatedExecution: true,
  });
  assert.ok(receivedTrigger.reasons.includes("execution_suite_hash"));
  assert.equal(changed.record.trigger.executionSuiteHashChanged, true);
  assert.equal(changed.record.execution.identity.executionSuiteHash, "execution-b");
  const state = JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8"));
  assert.equal(state.executionSuiteHash, "execution-b");

  const restart = await runBenchmarkAgent({
    ...baseOptions,
    stateDir: join(repo.root, "fresh-state"),
    executionSuiteHash: "execution-b",
    runBenchmark: async () => { throw new Error("deduplication must precede execution"); },
  });
  assert.equal(restart.status, "deduplicated");
});

// ## TODO: Test Permutations
// - corrupt local poll state fails closed without rewriting it
// - a deleted result branch is recreated only from an explicit empty publication state
// - two queued source commits coalesce to the newest reachable source ref

// The lock was a bare `wx` create with no liveness check, so it outlived its owner. Any SIGTERM,
// crash, OOM, reboot mid-run, or kill at the 72h authoring ceiling left it held forever, and the
// agent then reported `locked` and exited ZERO on every poll while the heartbeat kept beating
// "idle" -- exits clean, looks healthy, does nothing. Observed live on 2026-08-24 after a run was
// stopped by hand; the agent refused to start again until the file was removed by hand.
const { acquireAgentLock: acquireLock } = require("../../tools/remote-ollama-control/scripts/lib/benchmark-state");
const { mkdtempSync: mkTemp, writeFileSync: writeFile, existsSync: exists, rmSync: rmFile } = require("node:fs");
const { tmpdir: tmp } = require("node:os");

function lockDir() {
  return mkTemp(join(tmp(), "ak-agent-lock-"));
}
function lockFile(dir) {
  return join(dir, "agent.lock");
}

test("a lock stranded by a dead owner is reclaimed, and the reclaim is reported", () => {
  const dir = lockDir();
  // A pid that cannot be running: the previous holder, killed without releasing.
  writeFile(lockFile(dir), "876367\n");

  const lock = acquireLock(dir);
  assert.equal(lock.acquired, true, "a lock whose owner is gone must not block the agent forever");
  // Reported, not swallowed — silently taking it would hide the crash that stranded it.
  assert.equal(lock.reclaimedFrom, 876367);
  lock.release();
  assert.equal(exists(lockFile(dir)), false, "release must remove the lock file");
});

test("a lock held by a live owner is refused, and says so", () => {
  const dir = lockDir();
  // This test process is unambiguously alive.
  writeFile(lockFile(dir), `${process.pid}\n`);

  const lock = acquireLock(dir);
  assert.equal(lock.acquired, false, "mutual exclusion is the point — a live holder still wins");
  assert.equal(lock.heldBy, process.pid);
  assert.match(lock.reason, /live agent/);
  // Refusing must not delete someone else's lock.
  assert.equal(exists(lockFile(dir)), true);
});

test("a lock with an unreadable owner is refused rather than reclaimed", () => {
  const dir = lockDir();
  writeFile(lockFile(dir), "not-a-pid\n");

  const lock = acquireLock(dir);
  // Conservative on purpose: a corrupt lock cannot be shown to be free, and quietly seizing it
  // would trade a rare stuck state for a real double-run.
  assert.equal(lock.acquired, false);
  assert.equal(lock.heldBy, null);
  assert.match(lock.reason, /unreadable owner/);
  assert.match(lock.reason, /agent\.lock/);
});

test("an uncontended lock reports no reclaim", () => {
  const dir = lockDir();
  const lock = acquireLock(dir);
  assert.equal(lock.acquired, true);
  assert.equal(lock.reclaimedFrom, null, "a clean acquisition must not look like a recovered crash");

  // A second acquisition while the first is held is refused by the live-owner path.
  const second = acquireLock(dir);
  assert.equal(second.acquired, false);
  lock.release();
  rmFile(lockFile(dir), { force: true });
});

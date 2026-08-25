const assert = require("node:assert/strict");

const { runnerIdentity } = require("../../tools/remote-ollama-control/scripts/lib/runner-identity");
const { computeRunKey } = require("../../tools/remote-ollama-control/scripts/lib/benchmark-trigger");

const LINUX_BOX = { hostname: "darren-LLM", platform: "linux", arch: "x64", cpu: "AMD Ryzen 9" };
const APPLE_MAC = { hostname: "darren-mac", platform: "darwin", arch: "arm64", cpu: "Apple M3 Pro" };

// computeRunKey hashed the commit, the three identity hashes and the contract version — and nothing
// about the host. Two machines running the same commit against the same matrix produced the SAME
// key: the second overwrites the first's latest.json, conflates completedRunKeys, and leaves two
// results from different hardware indistinguishable. Harmless with one runner; silently wrong the
// moment there are two.

test("two machines running the same commit and matrix do not collide", () => {
  const shared = {
    sourceCommit: "a".repeat(40),
    scenarioSetHash: "b".repeat(64),
    matrixHash: "c".repeat(64),
    executionSuiteHash: "d".repeat(64),
    runnerContractVersion: "benchmark-agent-v2",
  };
  const box = computeRunKey({ ...shared, runnerId: runnerIdentity({}, LINUX_BOX).id });
  const mac = computeRunKey({ ...shared, runnerId: runnerIdentity({}, APPLE_MAC).id });
  assert.notEqual(box, mac, "the same work on different hardware must not share a run key");

  // ...and without the host it is exactly the collision this prevents.
  assert.equal(computeRunKey(shared), computeRunKey(shared));
});

test("a machine's identity is stable across calls, so its own runs stay comparable", () => {
  assert.equal(runnerIdentity({}, LINUX_BOX).id, runnerIdentity({}, LINUX_BOX).id);
  // Stability must not come from ignoring the machine.
  assert.notEqual(runnerIdentity({}, LINUX_BOX).id, runnerIdentity({}, APPLE_MAC).id);
});

test("identity is derived, not configured, so a second runner cannot collide by omission", () => {
  // The failure being prevented is one of forgetting. An unset environment must still be distinct.
  const withoutEnv = runnerIdentity({}, APPLE_MAC);
  const withEnv = runnerIdentity({ AK_BENCHMARK_RUNNER_LABEL: "m3-pro" }, APPLE_MAC);
  assert.equal(withoutEnv.id, withEnv.id, "a label must not change which machine this is");
  assert.equal(withoutEnv.label, null);
  assert.equal(withEnv.label, "m3-pro");
});

test("the published identity carries no hostname, address, port or route", () => {
  // This lands on a branch of a PUBLIC repository, under the same rule as the heartbeat.
  const serialized = JSON.stringify(runnerIdentity({ AK_BENCHMARK_RUNNER_LABEL: "box" }, LINUX_BOX));
  for (const leak of ["darren-LLM", "darren-mac", "11434", "127.0.0.1", "192.168"]) {
    assert.ok(!serialized.includes(leak), `runner identity leaked ${leak}: ${serialized}`);
  }
  // Exhaustive on purpose: a new field is the moment to ask whether it can carry topology.
  assert.deepEqual(Object.keys(runnerIdentity({}, LINUX_BOX)).sort(), ["arch", "id", "label", "platform"]);
});

test("platform and arch survive, because they are what makes a number interpretable", () => {
  // An M-series result and an ROCm result are not comparable, and a reader needs to see that.
  const mac = runnerIdentity({}, APPLE_MAC);
  assert.equal(mac.platform, "darwin");
  assert.equal(mac.arch, "arm64");
});

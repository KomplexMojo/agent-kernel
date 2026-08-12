const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const os = require("node:os");

const GENERATED_AT = "2026-07-13T12:00:00.000Z";

async function load() {
  const [core, scenarios, loader] = await Promise.all([
    import("../../tools/adaptive-workflow-benchmark/agent-benchmark.mjs"),
    import("../../tools/adaptive-workflow-benchmark/scenarios.mjs"),
    import("../../packages/adapters-cli/src/adapters/adaptive-workflow/benchmark-evidence-loader.js"),
  ]);
  return { ...core, ...scenarios, ...loader };
}

// Canned model output that satisfies each scenario's required keys.
function cannedFor(scenario) {
  const value = { rooms: [{ id: "room-1" }], actors: [] };
  if (scenario.requiredKeys.includes("actors")) value.actors = [{ id: "delver-1" }];
  return { response: JSON.stringify(value) };
}

test("agent benchmark completes every scenario on valid fixture output", async () => {
  const { runAgentBenchmark, AGENT_BENCHMARK_SCENARIOS } = await load();
  const modelFactory = (scenario) => ({ generate: async () => cannedFor(scenario) });
  const report = await runAgentBenchmark({ scenarios: AGENT_BENCHMARK_SCENARIOS, modelName: "fixture-model", modelFactory, runs: 3, generatedAt: GENERATED_AT });
  assert.equal(report.results.length, AGENT_BENCHMARK_SCENARIOS.length * 3);
  const nonComplete = report.results.filter((r) => r.outcome !== "complete");
  assert.equal(nonComplete.length, 0, JSON.stringify(nonComplete));
  assert.equal(report.aggregate.execOk.pass, report.aggregate.execOk.total);
  assert.equal(report.aggregate.toolCallOk.pass, report.aggregate.toolCallOk.total);
  assert.equal(report.aggregate.avgScore, 100);
  assert.ok(report.results.every((r) => r.strategyId === "flagship_full_context_v1"));
});

test("failed validation lowers exec-ok and average score without throwing", async () => {
  const { runAgentBenchmark, AGENT_BENCHMARK_SCENARIOS } = await load();
  const modelFactory = () => ({ generate: async () => ({ response: JSON.stringify({ nope: true }) }) });
  const report = await runAgentBenchmark({ scenarios: AGENT_BENCHMARK_SCENARIOS.slice(0, 2), modelName: "fixture-model", modelFactory, runs: 1, generatedAt: GENERATED_AT });
  assert.ok(report.results.every((r) => r.outcome !== "complete"));
  assert.equal(report.aggregate.execOk.pass, 0);
  assert.ok(report.aggregate.avgScore < 100);
});

test("a model that throws is recorded as an error outcome, not a crash", async () => {
  const { runAgentBenchmark, AGENT_BENCHMARK_SCENARIOS } = await load();
  const modelFactory = () => ({ generate: async () => { throw new Error("boom"); } });
  const report = await runAgentBenchmark({ scenarios: AGENT_BENCHMARK_SCENARIOS.slice(0, 1), modelName: "fixture-model", modelFactory, runs: 1, generatedAt: GENERATED_AT });
  assert.equal(report.results.length, 1);
  assert.notEqual(report.results[0].outcome, "complete");
});

test("rendered summary round-trips through the M10 benchmark-evidence loader", async () => {
  const { runAgentBenchmark, renderSummary, AGENT_BENCHMARK_SCENARIOS, loadBenchmarkEvidenceFromSummary } = await load();
  const modelFactory = (scenario) => ({ generate: async () => cannedFor(scenario) });
  const report = await runAgentBenchmark({ scenarios: AGENT_BENCHMARK_SCENARIOS, modelName: "qwen3-coder:30b", modelFactory, runs: 3, generatedAt: GENERATED_AT });
  const md = renderSummary(report, { route: "external", generatedAt: GENERATED_AT });
  const dir = mkdtempSync(join(os.tmpdir(), "agent-bench-"));
  const file = join(dir, "summary.md");
  writeFileSync(file, md);
  const loaded = loadBenchmarkEvidenceFromSummary(file, { strategyIdByProfile: { agent: "flagship_full_context_v1" }, asOf: "2026-07-14T00:00:00.000Z" });
  assert.equal(loaded.generatedAt, GENERATED_AT);
  assert.equal(loaded.evidence[0].sampleSize, AGENT_BENCHMARK_SCENARIOS.length * 3);
  assert.equal(loaded.evidence[0].averageScore, 100);
  assert.equal(loaded.classifications[0].status, "accepted");
});

// Canonical output that satisfies each hard scenario's structured constraint.
function goodHardFor(scenario) {
  const byId = {
    "exactly-three-rooms": { rooms: [{ id: "r1" }, { id: "r2" }, { id: "r3" }], actors: [] },
    "two-delvers": { rooms: [{ id: "r1" }], actors: [{ id: "d1" }, { id: "d2" }] },
    "mixed-roster": { rooms: [{ id: "r1" }, { id: "r2" }], actors: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] },
    "local-sectional-layout": { phase: "layout_only", layout: { floorTiles: 4, hallwayTiles: 2 }, rooms: [{ id: "r1" }], missing: [] },
  };
  return { response: JSON.stringify(byId[scenario.id]) };
}

test("hard scenarios all complete when the model satisfies each constraint", async () => {
  const { runAgentBenchmark, AGENT_BENCHMARK_HARD_SCENARIOS } = await load();
  const modelFactory = (scenario) => ({ generate: async () => goodHardFor(scenario) });
  const report = await runAgentBenchmark({ scenarios: AGENT_BENCHMARK_HARD_SCENARIOS, modelName: "fixture-model", modelFactory, runs: 1, generatedAt: GENERATED_AT });
  const nonComplete = report.results.filter((r) => r.outcome !== "complete");
  assert.equal(nonComplete.length, 0, JSON.stringify(nonComplete));
  // The local-sectional scenario must route to the budget-loop strategy.
  const sectional = report.results.find((r) => r.scenarioId === "local-sectional-layout");
  assert.equal(sectional.strategyId, "local_sectional_repair_v1");
});

test("hard scenarios discriminate: generic output fails the structured constraints", async () => {
  const { runAgentBenchmark, AGENT_BENCHMARK_HARD_SCENARIOS } = await load();
  // Generic minimal output: one room, one actor, no hazards, no layout.
  const modelFactory = () => ({ generate: async () => ({ response: JSON.stringify({ rooms: [{ id: "x" }], actors: [{ id: "y" }] }) }) });
  const report = await runAgentBenchmark({ scenarios: AGENT_BENCHMARK_HARD_SCENARIOS, modelName: "fixture-model", modelFactory, runs: 1, generatedAt: GENERATED_AT });
  const byId = Object.fromEntries(report.results.map((r) => [r.scenarioId, r.outcome]));
  assert.notEqual(byId["exactly-three-rooms"], "complete");
  assert.notEqual(byId["two-delvers"], "complete");
  assert.notEqual(byId["mixed-roster"], "complete");
  assert.ok(report.aggregate.execOk.pass < report.aggregate.execOk.total, "generic output must not pass every hard scenario");
});

// ## TODO: Test Permutations
// - partial completion (fail at verify) yields a mid-range score
// - mixed pass/fail runs across scenarios produce a fractional exec-ok
// - --scenario-ids filtering selects a subset deterministically

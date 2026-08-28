const assert = require("node:assert/strict");
const {
  DEFAULT_POLICY, classify, selectScenarios,
} = require("../../tools/remote-ollama-control/scripts/lib/scenario-selection");

const rows = (spec) => spec.map(([i, rate, avgScore = 90]) => ({ i, tier: "t", n: 2, pass: 0, rate, avgScore }));

// Selection is on MEASURED pass rate, never on the tier label. Measured 2026-08-24, four of six
// configurations were non-monotonic across tiers -- qwen3-coder:30b scored 1.00 on `complex` and
// 0.48 on `constrained` -- so a tier-driven selector would skip the wrong scenarios.
test("scenarios are banded by measured pass rate, not by tier", () => {
  const p = DEFAULT_POLICY;
  assert.equal(classify({ rate: 0.0, avgScore: 10 }, p), "failing");
  assert.equal(classify({ rate: 0.5, avgScore: 50 }, p), "discriminating");
  assert.equal(classify({ rate: 1.0, avgScore: 40 }, p), "marginal", "a high pass rate with a poor score is about to break");
  assert.equal(classify({ rate: 1.0, avgScore: 95 }, p), "healthy");
});

test("everything informative is selected and the settled majority is not", () => {
  const r = selectScenarios(rows([[1, 0], [2, 0.5], [3, 1.0, 40], [4, 1.0, 95], [5, 1.0, 95]]), { runOrdinal: 1 });
  for (const i of [1, 2, 3]) assert.ok(r.selected.includes(i), `scenario ${i} is informative and must be run`);
  assert.ok(r.selected.length < 5, "a run that selects everything has selected nothing");
});

// Running only what fails is how a suite goes blind: the set self-selects toward the hard cases and
// nothing notices the day a change breaks something that used to work.
test("healthy scenarios rotate so every one is exercised across a period", () => {
  const catalog = rows(Array.from({ length: 20 }, (_, n) => [n + 1, 1.0, 95]));
  const seen = new Set();
  for (let run = 0; run < DEFAULT_POLICY.rotationPeriod; run += 1) {
    for (const i of selectScenarios(catalog, { runOrdinal: run }).selected) seen.add(i);
  }
  assert.equal(seen.size, 20,
    "every healthy scenario must be covered within one rotation, or regressions in the passing set go undetected");
});

test("selection is deterministic — the same inputs give the same subset", () => {
  const catalog = rows([[1, 0], [2, 0.5], [3, 1.0], [4, 1.0], [5, 1.0]]);
  const a = selectScenarios(catalog, { runOrdinal: 2 });
  const b = selectScenarios(catalog, { runOrdinal: 2 });
  assert.deepEqual(a.selected, b.selected);
  assert.equal(a.scenarioSubsetHash, b.scenarioSubsetHash);
});

// A subset is not the catalog. Naming its identity `scenarioSetHash` would let a reader compare a
// selected run against a full baseline, which is comparing different questions.
test("a subset carries its own identity, never a scenarioSetHash", () => {
  const r = selectScenarios(rows([[1, 0], [2, 0.5]]), {});
  assert.ok(r.scenarioSubsetHash, "a subset run must be identifiable");
  assert.ok(!("scenarioSetHash" in r), "a subset must never present itself as a full catalog identity");
  const other = selectScenarios(rows([[1, 0], [2, 0.5], [3, 0.4]]), {});
  assert.notEqual(r.scenarioSubsetHash, other.scenarioSubsetHash, "different subsets must be distinguishable");
});

// No silent caps: what was left out travels with what was selected.
test("what was excluded is reported, not dropped", () => {
  const r = selectScenarios(rows([[1, 0], [2, 1.0, 95], [3, 1.0, 95]]), { runOrdinal: 0 });
  const accounted = r.selected.length + r.excluded.length;
  assert.equal(accounted, 3, "every scenario must be either selected or explicitly excluded");
  for (const e of r.excluded) assert.equal(typeof e.rate, "number", "an exclusion states the rate that justified it");
});

/**
 * PX.6 — the config a build consumes is the one the Configurator locked.
 *
 * `orchestrateBuild` used to write its own results back INTO
 * `spec.configurator.inputs` — affinity rules, motivation rules, and the actor list after
 * budget maximization and position normalization — at four sites, all of them AFTER the
 * Configurator's round had closed. The artifact recorded as the build's causal input was
 * therefore partly a product of the build.
 *
 * Nothing failed, and nothing could: the mutated shape is still schema-valid, the goldens
 * were regenerated from the mutated output, and every consumer read the same field either
 * way. What was lost is the ability to answer "what did the Configurator actually approve?"
 * after the fact — which is the whole point of recording a causal input.
 *
 * ═══ WHAT HAS TEETH ════════════════════════════════════════════════════════════
 *
 * Asserting that `resolved` exists proves nothing about the defect — the write-backs could
 * still be there beside it. The gate is the DIFFERENTIAL: deep-freeze the inputs before the
 * build and assert the build completes anyway. A frozen object makes every write either
 * throw (strict mode) or silently no-op, so a build that still mutates cannot produce the
 * same output. The second gate compares the inputs before and after by value, which catches
 * the silent-no-op case that freezing alone would hide.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}

async function buildFromFixture({ freezeInputs = false } = {}) {
  const [{ normalizeSummary }, { mapSummaryToPool }, { buildBuildSpecFromSummary }, { orchestrateBuild }] =
    await Promise.all([
      import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js"),
      import("../../packages/runtime/src/personas/director/pool-mapper.js"),
      import("../../packages/runtime/src/personas/director/buildspec-assembler.js"),
      import("../../packages/runtime/src/build/orchestrate-build.js"),
    ]);

  const summaryFixture = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/e2e/summary-v1-basic.json"), "utf8"),
  );
  const catalog = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/pool/catalog-basic.json"), "utf8"),
  );

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true, "fixture summary normalizes");
  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true, "fixture summary maps to a pool");

  const built = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: mapped.selections,
    runId: "run_px6_immutability",
    createdAt: "2026-08-06T00:00:00.000Z",
    source: "px6-test",
    clock: () => "2026-08-06T00:00:00.000Z",
  });
  assert.equal(built.ok, true, "fixture summary assembles a BuildSpec");

  const before = JSON.parse(JSON.stringify(built.spec.configurator.inputs));
  if (freezeInputs) deepFreeze(built.spec.configurator.inputs);

  const result = await orchestrateBuild({ spec: built.spec, producedBy: "px6-test" });
  return { result, before };
}

test("a build completes with the Configurator's locked inputs frozen", async () => {
  // The differential. Freezing turns any surviving write-back into a throw (the modules are
  // ESM, so strict mode applies) — a build that still mutates its causal input cannot pass.
  const { result } = await buildFromFixture({ freezeInputs: true });

  assert.ok(result.simConfig, "the build still produces a SimConfig with its inputs frozen");
  assert.ok(Array.isArray(result.initialState?.actors), "and an initial state");
});

test("the inputs the build was given are byte-identical afterwards", async () => {
  // Freezing alone is not enough: a non-strict write would no-op silently and the test above
  // would pass while the intent was violated. Compare by value as well.
  const { result, before } = await buildFromFixture();

  // ⚠️ BOTH SIDES round-tripped through JSON, and the reason is a trap this test fell into
  // first: `buildBuildSpecFromSummary` declares optional keys as `delverConfigs: ... :
  // undefined`, so the KEY EXISTS with an undefined value. `JSON.stringify` drops those,
  // which made a snapshot-vs-live comparison report four "added" keys the build never
  // touched. Comparing a normalized snapshot against a normalized result is the honest
  // check; comparing one of each measures the serializer.
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.spec.configurator.inputs)),
    before,
    "orchestrateBuild mutated the artifact recorded as its causal input — affinityRules, "
      + "motivationRules and actors used to be written back here after the Configurator's "
      + "round closed",
  );
});

test("what the build resolved is published as output, not folded into the input", async () => {
  const { result } = await buildFromFixture();
  const resolvedConfig = result.spec.configurator.resolved;

  assert.ok(resolvedConfig, "the build publishes what it resolved");
  assert.ok(Array.isArray(resolvedConfig.actors), "including the actor list it settled on");
  assert.ok(resolvedConfig.affinityRules, "and the expanded affinity rules");
  assert.ok(resolvedConfig.motivationRules, "and the motivation rules");

  // The distinction is only meaningful if the two can actually differ. If the build never
  // changed anything, this test would pass on a spec that had been mutated in place too.
  assert.notEqual(
    resolvedConfig.affinityRules,
    result.spec.configurator.inputs.affinityRules,
    "resolved is a separate record from inputs, not an alias of it",
  );
});

// ## TODO: Test Permutations

/**
 * D8.1 — the derived `levelGen` is unchanged by breaking the Director↔Configurator cycle.
 *
 * `guidance-level-builder.js` used to obtain level geometry by building a throwaway Director
 * BuildSpec and reading `spec.configurator.inputs.levelGen` back out, with a near-duplicate of
 * the Director's sizing formula as its fallback. Both are gone: the Director now publishes
 * `deriveLevelGen`, and the Configurator asks.
 *
 * The fixture is the evidence that the swap changed nothing. It is not decoration — replaying
 * it during the refactor caught a real regression: `budgetScaffold` and `hazards` are decorated
 * onto `levelGen` AFTER derivation inside `buildBuildSpecFromSummary`, so the old round-trip
 * picked them up and the first extraction silently dropped them (19/21). Two well-formed
 * geometries that differ by a field nothing downstream validates is exactly the failure this
 * repo keeps finding.
 *
 * ⚠️ If a case fails, the derived geometry changed. Do NOT re-record the fixture to make it
 * pass — that discards the only record of where it used to land.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const FIXTURE = join(
  __dirname, "..", "..", "fixtures", "configurator", "guidance-levelgen-characterization.json",
);

test("the derived levelGen matches what the BuildSpec round-trip used to produce", async () => {
  const { deriveLevelGenFromGuidanceSummary } = await import(
    "../../../packages/runtime/src/personas/configurator/guidance-level-builder.js"
  );
  const { createDirectorPersona } = await import(
    "../../../packages/runtime/src/personas/director/persona.js"
  );
  // Wire the Director's PUBLIC surface, as production does. A stub here would be the second
  // sizing formula that D8.1 just deleted.
  const deriveLevelGen = createDirectorPersona({
    clock: () => "1970-01-01T00:00:00.000Z",
  }).deriveLevelGen;

  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.ok(fixture.cases.length > 0, "the characterization fixture must not be empty");

  const drifted = [];
  for (const { input, output } of fixture.cases) {
    let actual;
    try {
      actual = { value: deriveLevelGenFromGuidanceSummary(input, deriveLevelGen) ?? null, threw: null };
    } catch (error) {
      actual = { value: null, threw: `${error.name}: ${error.message}` };
    }
    if (JSON.stringify(actual) !== JSON.stringify(output)) {
      drifted.push({ input, expected: output, actual });
    }
  }

  assert.deepEqual(
    drifted,
    [],
    `${drifted.length} of ${fixture.cases.length} summaries now derive different level geometry`,
  );
});

// The Configurator must REFUSE rather than guess when the Director's deriver is absent.
// Perturbed when written: returning a guessed geometry instead of null fails this.
test("without the Director's deriver, only the card path answers — the rest refuse", async () => {
  const { deriveLevelGenFromGuidanceSummary, buildLevelPreviewFromGuidanceSummary } = await import(
    "../../../packages/runtime/src/personas/configurator/guidance-level-builder.js"
  );

  // A layout-only summary has no card set, so nothing Configurator-native can answer it.
  const layoutOnly = { layout: { floorTiles: 120 } };
  assert.equal(
    deriveLevelGenFromGuidanceSummary(layoutOnly, undefined),
    null,
    "deriving geometry without the Director would be the deleted duplicate formula returning",
  );

  const preview = buildLevelPreviewFromGuidanceSummary(layoutOnly, {});
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, "missing_level_gen");
});

// ## TODO: Test Permutations
// - summaries carrying both a cardSet and a prebuilt levelGen (card path must win)
// - hazard entries with partial vitals, to pin the normalizeSummaryHazards allowlist
// - roomDesign shapes whose pattern is unrecognized

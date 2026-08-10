/**
 * CR.4 M5b.2f — `assessLayoutFeasibility` replays what `validateFeasibility` decided.
 *
 * The function moved out of `personas/orchestrator/llm-budget-loop.js` on 2026-08-08. What
 * licenses that move is this fixture: 185 cases captured from the pre-move implementation at
 * commit 708a22c1, spanning valid layouts, invalid tile counts, empty layouts, the
 * absent-layout branch, and — the part nothing else in the suite reaches — both sides of the
 * `MAX_EXACT_LAYOUT_FEASIBILITY_TILES` threshold.
 *
 * ⚠️ IF A CASE FAILS, DO NOT RE-RECORD THE FIXTURE. That deletes the only evidence the
 * verdicts did not shift. A drifted approximation still returns a well-formed
 * `{ ok, errors }`, still under the same schema, so no guard, golden or contract test would
 * report it — the same reason `allocator-layout-fit.test.js` pins 660 cases for the auto-fit
 * search.
 *
 * PERTURBATION-VERIFIED 2026-08-08 — four restorations, each caught:
 *   - threshold 1_000_000 → 1_000                    → DETECTED (verdicts flip on mid layouts)
 *   - `walkableTiles >` → `>=` at the threshold      → DETECTED (see the near-miss below)
 *   - drop `!hasInvalidCounts` from the branch guard → DETECTED (invalid counts above 1M)
 *   - `floorTiles <` → `<=` in the approximation     → DETECTED (off-by-one on the actor fit)
 *
 * 🔴 THE `>=` PERTURBATION SURVIVED THE FIRST VERSION OF THIS FIXTURE, and the reason is the
 * lesson. Below-threshold layouts materialize a grid, so the first capture ran 82 seconds and
 * was trimmed. The trim kept a boundary case — but the one it kept (`floorTiles == threshold`
 * with ONE actor) returns `{ ok: true }` down either path, so it pinned the boundary's
 * location without pinning its comparison. The discriminating case needs an actor count the
 * two paths answer differently: at exactly the threshold the exact path double-reports
 * `insufficient_floor_tiles` and the approximation reports it once.
 * ⇒ *A case that crosses a boundary is not the same as a case that can SEE the boundary.*
 * The trim was measured in seconds saved and never in discrimination lost; only re-running
 * the perturbation afterwards revealed it. **Re-perturb after trimming a fixture, always.**
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixturePath = resolve(
  __dirname,
  "../../fixtures/configurator/layout-feasibility-characterization.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

async function loadFeasibility() {
  return import("../../../packages/runtime/src/personas/configurator/feasibility.js");
}

test("the fixture is not vacuous: it has cases on both sides of the threshold", async () => {
  assert.ok(fixture.cases.length >= 185, `expected 180+ cases, got ${fixture.cases.length}`);
  assert.equal(fixture.thresholdTiles, 1_000_000);

  const walkable = (layout) => {
    if (!layout || typeof layout !== "object") return null;
    const floor = layout.floorTiles;
    const hall = layout.hallwayTiles ?? 0;
    if (!Number.isInteger(floor) || !Number.isInteger(hall)) return null;
    return floor + hall;
  };
  const above = fixture.cases.filter((c) => (walkable(c.input.layout) ?? 0) > fixture.thresholdTiles);
  const below = fixture.cases.filter((c) => {
    const w = walkable(c.input.layout);
    return w !== null && w > 0 && w <= fixture.thresholdTiles;
  });
  const absent = fixture.cases.filter((c) => !c.input.layout);
  assert.ok(above.length > 0, "no case exercises the approximate branch");
  assert.ok(below.length > 0, "no case exercises the exact branch");
  assert.ok(absent.length > 0, "no case exercises the absent-layout branch");

  // Both verdicts occur, or the fixture would pass against a function that always agrees.
  const verdicts = new Set(fixture.cases.map((c) => c.output.result.ok));
  assert.deepEqual([...verdicts].sort(), [false, true]);
});

test("assessLayoutFeasibility replays every captured verdict", async () => {
  const { assessLayoutFeasibility } = await loadFeasibility();
  const { deriveLevelGen: derive } = await import(
    "../../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );

  const mismatches = [];
  fixture.cases.forEach((testCase, index) => {
    const { layout, actorCount, roomCount } = testCase.input;
    // The capture ran the loop's `validateFeasibility`, which derived the levelGen from
    // `roomCount` itself. That derivation is the Director's and stayed there, so the replay
    // does what the Director now does: derive, then ask.
    const levelGen = layout ? undefined : derive({ roomCount });
    const actual = assessLayoutFeasibility({ layout, levelGen, actorCount });
    const expected = testCase.output.result;
    try {
      assert.deepEqual(actual, expected);
    } catch {
      mismatches.push({ index, input: testCase.input, expected, actual });
    }
  });

  assert.deepEqual(
    mismatches.slice(0, 5),
    [],
    `${mismatches.length}/${fixture.cases.length} cases drifted — DO NOT re-record the fixture`,
  );
});

test("the threshold selects the approximation, and the approximation is coarser", async () => {
  const { assessLayoutFeasibility, MAX_EXACT_LAYOUT_FEASIBILITY_TILES } = await loadFeasibility();
  assert.equal(MAX_EXACT_LAYOUT_FEASIBILITY_TILES, 1_000_000);

  // Above the threshold, feasibility is decided from tile COUNTS: enough floor tiles for the
  // actors and nothing else. This is the policy that used to live in the Orchestrator.
  const huge = { floorTiles: MAX_EXACT_LAYOUT_FEASIBILITY_TILES + 1, hallwayTiles: 0 };
  assert.deepEqual(
    assessLayoutFeasibility({ layout: huge, actorCount: 5 }),
    { ok: true, errors: [] },
  );
  assert.equal(
    assessLayoutFeasibility({
      layout: huge,
      actorCount: MAX_EXACT_LAYOUT_FEASIBILITY_TILES + 2,
    }).errors[0].code,
    "insufficient_floor_tiles",
  );

  // Invalid counts must NOT take the approximate branch even when the numbers are large:
  // the guard is `!hasInvalidCounts`, and dropping it would let a malformed layout through
  // on a cheap check that never looks at the malformed field.
  const malformed = { floorTiles: MAX_EXACT_LAYOUT_FEASIBILITY_TILES + 10, hallwayTiles: -1 };
  const verdict = assessLayoutFeasibility({ layout: malformed, actorCount: 1 });
  assert.equal(verdict.ok, false);
  assert.deepEqual(
    verdict.errors,
    [{ field: "layout.hallwayTiles", code: "invalid_tile_count", detail: -1 }],
  );
});

/**
 * ⚠️ THE THRESHOLD IS COUNTED IN FLOOR TILES ONLY, WHICH IS NOT WHAT ITS NAME SUGGESTS.
 *
 * `sumLayoutTiles` deliberately returns `floorTiles` alone — hallway tiles are walkable and
 * are charged, but they are not room area, so they do not count toward
 * `MAX_EXACT_LAYOUT_FEASIBILITY_TILES`. A level with 1,000,000 floor and 500,000 hallway
 * tiles takes the EXACT path; one with 1,000,001 floor tiles and no hallway takes the
 * approximation. This asymmetry came across the move untouched and is pinned here because
 * "walkableTiles" reads as if it included them.
 */
test("the threshold counts floor tiles only — hallway tiles never push a layout over it", async () => {
  const { assessLayoutFeasibility, MAX_EXACT_LAYOUT_FEASIBILITY_TILES } = await loadFeasibility();

  // A layout whose hallway count is well past the threshold but whose floor count is not:
  // `sumLayoutTiles` returns floor tiles only, so this takes the EXACT path. Kept small
  // enough to materialize cheaply — the point is which branch is selected, and the boundary
  // itself is pinned by the fixture.
  const hallwayHeavy = { floorTiles: 4, hallwayTiles: 60 };
  assert.deepEqual(
    assessLayoutFeasibility({ layout: hallwayHeavy, actorCount: 0 }),
    { ok: true, errors: [] },
  );

  // WHICH path ran is observable without materializing a huge grid: the exact path emits
  // `insufficient_floor_tiles` TWICE — `validateLayoutCountsAndActors` pushes it, then
  // delegates to `validateLayoutAndActors`, which pushes it again — while the approximation
  // emits it once. That duplication is pre-existing behavior carried across the move, not
  // something this milestone introduced.
  const exactErrors = assessLayoutFeasibility({
    layout: { floorTiles: 4, hallwayTiles: 0 },
    actorCount: 9,
  }).errors;
  assert.equal(exactErrors.length, 2, "the exact path double-reports; pinned as-is");
  assert.ok(exactErrors.every((e) => e.code === "insufficient_floor_tiles"));

  const approximateErrors = assessLayoutFeasibility({
    layout: { floorTiles: MAX_EXACT_LAYOUT_FEASIBILITY_TILES + 1, hallwayTiles: 0 },
    actorCount: MAX_EXACT_LAYOUT_FEASIBILITY_TILES + 5,
  }).errors;
  assert.equal(approximateErrors.length, 1, "the approximation reports once");
  assert.equal(approximateErrors[0].code, "insufficient_floor_tiles");
});

// ## TODO: Test Permutations

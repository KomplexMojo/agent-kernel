/**
 * CR.4 M5b.2c — the auto-fit search converges exactly where it always did.
 *
 * `fitLayoutToBudget` moved out of `personas/orchestrator/llm-budget-loop.js` and into the
 * Allocator, where deciding which tile a token is best spent on belongs. The move was
 * verbatim, and this file is what says so.
 *
 * Why a 660-case fixture rather than a handful of assertions: a revision loop that changes
 * behavior does not fail loudly. It returns a well-formed layout, still under budget, just a
 * DIFFERENT one — so no schema rejects it, no architecture guard sees it, and no golden
 * covers it (nothing in `tests/fixtures/goldens` drives this path with an over-budget
 * layout). The only thing that can catch a drifted search is a record of where it used to
 * land. `tests/fixtures/allocator/auto-fit-search-characterization.json` is that record,
 * captured from the pre-move implementation.
 *
 * ⚠️ If a case here fails, the search's OUTPUT changed. Do not re-record the fixture to make
 * it pass — that deletes the only evidence. Establish first whether the change was intended.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const FIXTURE = join(__dirname, "..", "..", "fixtures", "allocator", "auto-fit-search-characterization.json");

async function loadFit() {
  const mod = await import(
    "../../../packages/runtime/src/personas/allocator/layout-fit.js"
  );
  return mod.fitLayoutToBudget;
}

// The fixture is JSON, and JSON drops `undefined` keys — `adjusted` is absent rather than
// undefined on the refusal paths. Round-tripping the live result through JSON gives both
// sides identical serialization semantics, so a diff means a real behavior change and not a
// difference between "missing" and "undefined".
function actualOutput(result) {
  return JSON.parse(JSON.stringify({
    ok: result.ok,
    adjusted: result.adjusted,
    layout: result.layout ?? null,
    spentTokens: result.layoutSpend?.spentTokens ?? null,
    remainingBudgetTokens: result.layoutSpend?.remainingBudgetTokens ?? null,
    overBudget: result.layoutSpend?.overBudget ?? null,
    threw: result.threw ?? null,
  }));
}

test("the auto-fit search reproduces every recorded case after moving to the Allocator", async () => {
  const fitLayoutToBudget = await loadFit();
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

  assert.ok(fixture.cases.length > 0, "the characterization fixture must not be empty");

  const drifted = [];
  for (const { input, output } of fixture.cases) {
    let actual;
    try {
      actual = actualOutput(fitLayoutToBudget({
        layout: input.layout,
        remainingBudgetTokens: input.remainingBudgetTokens,
        priceList: undefined,
        layoutCosts: input.layoutCosts,
      }));
    } catch (error) {
      // A throw is recorded behavior too — `layoutCosts: {}` with no priceList raises
      // AllocatorTilePriceError by design (CR.1: no silent default price).
      actual = actualOutput({ threw: `${error.name}: ${error.message}` });
    }
    try {
      assert.deepEqual(actual, output);
    } catch {
      drifted.push({ input, expected: output, actual });
    }
  }

  assert.deepEqual(
    drifted,
    [],
    `${drifted.length} of ${fixture.cases.length} auto-fit cases converged somewhere new`,
  );
});

// The fixture is only as good as the branches it reaches. A sweep that never triggered a
// revision would pass trivially after the search was replaced with `return { ok: false }`.
test("the characterization actually exercises the search, not just its refusals", async () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const revised = fixture.cases.filter((c) => c.output.adjusted === true);
  const accepted = fixture.cases.filter((c) => c.output.ok === true && c.output.adjusted === false);
  const refused = fixture.cases.filter((c) => c.output.ok === false);

  assert.ok(revised.length >= 100, `expected the revision loop to run in many cases, got ${revised.length}`);
  assert.ok(accepted.length >= 50, `expected many already-affordable layouts, got ${accepted.length}`);
  assert.ok(refused.length >= 50, `expected many unfittable layouts, got ${refused.length}`);

  // Every revised case must land under budget with at least one tile — the search's whole
  // contract. Asserted independently of the recorded values so a wholesale re-record of the
  // fixture cannot quietly legalise a search that returns over-budget layouts.
  for (const { output } of revised) {
    assert.equal(output.overBudget, false, "a revised layout must not remain over budget");
    assert.ok(output.layout && output.layout.floorTiles > 0, "a revised layout must keep a walkable tile");
  }
});

/**
 * Z7.0 — classify the fixture before Z7.1 changes the primary search.
 *
 * Exact legacy destinations remain the fallback contract above. This second view asks which
 * INPUT class each case represents and whether the greedy destination is an exact retained-tile
 * optimum. It prevents a later implementation from calling all 660 destinations requirements:
 * four valid searches refuse a feasible model and fifty more leave retainable tiles behind.
 */
function classifyBudgetFitCase({ input }) {
  const { layout, layoutCosts, remainingBudgetTokens } = input;
  if (!Number.isInteger(remainingBudgetTokens) || remainingBudgetTokens < 0) {
    return "invalid_budget";
  }
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return "invalid_layout";
  }
  if (layoutCosts && (
    !Number.isInteger(layoutCosts.floorTiles)
    || layoutCosts.floorTiles <= 0
    || !Number.isInteger(layoutCosts.hallwayTiles)
    || layoutCosts.hallwayTiles <= 0
  )) {
    return "invalid_prices";
  }
  const floorTiles = Number.isInteger(layout.floorTiles) && layout.floorTiles >= 0
    ? layout.floorTiles
    : 0;
  const hallwayTiles = Number.isInteger(layout.hallwayTiles) && layout.hallwayTiles >= 0
    ? layout.hallwayTiles
    : 0;
  if (floorTiles < 1) return "missing_floor";
  const floorCost = layoutCosts?.floorTiles ?? 1;
  const hallwayCost = layoutCosts?.hallwayTiles ?? 1;
  if (floorCost > remainingBudgetTokens) return "minimum_floor_unaffordable";
  if ((floorTiles * floorCost) + (hallwayTiles * hallwayCost) <= remainingBudgetTokens) {
    return "already_fits";
  }
  return "search";
}

function maximumRetainedTileCount({ input }) {
  const requestedFloor = input.layout.floorTiles;
  const requestedHallway = input.layout.hallwayTiles ?? 0;
  const floorCost = input.layoutCosts?.floorTiles ?? 1;
  const hallwayCost = input.layoutCosts?.hallwayTiles ?? 1;
  let maximum = 0;
  for (let floorTiles = 1; floorTiles <= requestedFloor; floorTiles += 1) {
    const affordableHallway = Math.floor(
      (input.remainingBudgetTokens - (floorTiles * floorCost)) / hallwayCost,
    );
    if (affordableHallway < 0) continue;
    maximum = Math.max(maximum, floorTiles + Math.min(requestedHallway, affordableHallway));
  }
  return maximum;
}

test("Z7.0 classifies all 660 legacy cases and proves the greedy defects", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const classes = {};
  for (const testCase of fixture.cases) {
    const classification = classifyBudgetFitCase(testCase);
    classes[classification] = (classes[classification] || 0) + 1;
  }
  assert.deepEqual(classes, {
    invalid_budget: 60,
    invalid_layout: 50,
    missing_floor: 120,
    invalid_prices: 110,
    minimum_floor_unaffordable: 48,
    already_fits: 152,
    search: 120,
  });

  const searches = fixture.cases.filter((testCase) => classifyBudgetFitCase(testCase) === "search");
  const feasibleButRefused = searches.filter((testCase) => testCase.output.ok !== true);
  const strictlySuboptimal = searches.filter((testCase) => {
    if (testCase.output.ok !== true) return false;
    const retained = testCase.output.layout.floorTiles + testCase.output.layout.hallwayTiles;
    return retained < maximumRetainedTileCount(testCase);
  });

  assert.equal(feasibleButRefused.length, 4);
  assert.equal(strictlySuboptimal.length, 50);
  assert.equal(searches.length - feasibleButRefused.length - strictlySuboptimal.length, 66);

  const smallest = strictlySuboptimal.find((testCase) => (
    testCase.input.layout.floorTiles === 5
    && testCase.input.layout.hallwayTiles === 5
    && testCase.input.remainingBudgetTokens === 2
    && testCase.input.layoutCosts?.floorTiles === 1
    && testCase.input.layoutCosts?.hallwayTiles === 9
  ));
  assert.deepEqual(smallest?.output.layout, { floorTiles: 1, hallwayTiles: 0 });
  assert.equal(maximumRetainedTileCount(smallest), 2);
});

// ## TODO: Test Permutations
// - tile-cost maps where every field costs more than the entire budget
// - hallway-only layouts at budgets that admit exactly one floor tile
// - budgets that sit exactly on a tile-cost boundary (spend === budget)

/**
 * Z10 Phase 0 — the quantitative half of the solver-benefit gate.
 *
 * THE GATE ALREADY EXISTS, AND THIS DOES NOT REPLACE IT.
 * `~/vault/decisions/2026-08-14-solver-adoption-where-it-replaces-a-rule-cage.md`
 * applies one question per site: is the code SEARCHING (best legal option from a
 * combinatorial space, hand-rolled version greedy/incomplete/exploding) or
 * EVALUATING (a total function over bounded inputs)? That is a QUALITATIVE gate
 * answered by reading the source, and it produced 3 adoptions and 4 refusals.
 *
 * It cannot answer the next question: for a site that passed, does the search
 * ACTUALLY WIN, and how often? This module answers that one, in the same
 * vocabulary, by sweeping a bounded domain and comparing three answers per point:
 *
 *   solver   the production persona surface with the real Z3 hybrid adapter wired
 *   greedy   the same surface with an adapter that defers — which is EXACTLY the
 *            shipped default, since `AK_SOLVER_ENGINE` unset yields a stub
 *            declaring `domains: []`
 *   oracle   exhaustive brute force (`logic-oracles.mjs`)
 *
 * A LEDGER THAT CANNOT RETURN A NEGATIVE VERDICT IS ADVOCACY. If
 * `solverStrictlyBetterThanGreedy` is negligible across a domain's real operating
 * range, that is a finding, and the correct response is to un-adopt the domain —
 * not to widen the bounds until the solver looks useful.
 *
 * Out of the test gate by construction: this drives real Z3 thousands of times.
 * Run it with `pnpm run logic-sweep`.
 */
import { enumerateOrderingScenarios, orderingDivergence } from "./logic-actor-ordering.mjs";
import {
  bestRoute,
  enumerateBoards,
  enumerateHazardBoards,
  runPolicy,
  safetyFirstRun,
  walkable,
} from "./logic-lookahead.mjs";
import {
  allocatorObjectiveRank,
  compareRank,
  pathExistsOracle,
  solveActorSelectionExhaustive,
  solveAllocatorBudgetFitExhaustive,
  solveObjectPlacementExhaustive,
} from "./logic-oracles.mjs";

const FIXED_CLOCK = () => "2026-09-04T00:00:00.000Z";
const MAX_RECORDED_EXAMPLES = 12;

/**
 * An adapter that declares the domain but always defers. This is the shipped
 * default's behavior reproduced exactly: the host sees a capability it can route
 * to, the solver answers nothing, and the persona takes its characterized
 * fallback. Using this rather than calling the legacy fitter directly means the
 * ledger measures the real production path, including the host glue.
 */
function createDeferringAdapter(domain) {
  return {
    kind: "ledger-deferring",
    capabilities: { domains: [domain], deterministic: true },
    solve: async () => ({ status: "deferred", reason: "ledger_forced_deferral" }),
  };
}

function newCounters() {
  return {
    points: 0,
    bypass: 0,
    solverMatchesOracle: 0,
    greedyMatchesOracle: 0,
    solverStrictlyBetterThanGreedy: 0,
    greedyStrictlyBetterThanSolver: 0,
    agree: 0,
    solverDeferred: 0,
    solverError: 0,
    solverUnsat: 0,
    oracleUnsat: 0,
    solverContradictsOracle: 0,
  };
}

// ---------------------------------------------------------------------------
// allocator_budget_fit
// ---------------------------------------------------------------------------

/**
 * THE DECISION BAND — the only budgets where the Allocator has a choice to make.
 *
 * A first cut swept every budget from 0 upward and was almost entirely wasted: of
 * 20 points, 7 were already affordable (the Allocator short-circuits with
 * `status: "bypass"` and never poses a problem) and 13 could not afford even one
 * floor tile (`unsat` for both implementations). Zero points had two possible
 * answers, so the sweep compared nothing while still paying for the solver.
 *
 * For a requested layout at given prices there are exactly three regions:
 *
 *   budget <  costFloor              unsat   — the minimum floor is unaffordable
 *   budget in [costFloor, full-1]    DECIDE  — over budget, but something fits
 *   budget >= fullCost               bypass  — already affordable, no problem posed
 *
 * The outer regions are counted arithmetically below rather than solved, so the
 * ledger still reports true operating-range fractions while spending Z3 only where
 * a decision exists. Narrowing the band is not narrowing the claim: a point with
 * one legal answer cannot distinguish two implementations.
 */
export function allocatorRegions({ floorTiles, hallwayTiles, costFloor, costHall }) {
  const fullCost = (floorTiles * costFloor) + (hallwayTiles * costHall);
  const unsatPoints = costFloor;                                  // budgets 0 .. costFloor-1
  const decisionPoints = Math.max(0, fullCost - costFloor);       // budgets costFloor .. fullCost-1
  return { fullCost, unsatPoints, decisionPoints, bypassAtOrAbove: fullCost };
}

function* enumerateAllocatorPoints({ maxFloor, maxHallway, maxCost }) {
  for (let floorTiles = 1; floorTiles <= maxFloor; floorTiles += 1) {
    for (let hallwayTiles = 0; hallwayTiles <= maxHallway; hallwayTiles += 1) {
      for (let costFloor = 1; costFloor <= maxCost; costFloor += 1) {
        for (let costHall = 1; costHall <= maxCost; costHall += 1) {
          const region = allocatorRegions({ floorTiles, hallwayTiles, costFloor, costHall });
          for (let budget = costFloor; budget < region.fullCost; budget += 1) {
            yield {
              point: {
                layout: { floorTiles, hallwayTiles },
                layoutCosts: { floorTiles: costFloor, hallwayTiles: costHall },
                remainingBudgetTokens: budget,
              },
              region,
            };
          }
        }
      }
    }
  }
}

/** Region sizes across the whole domain, counted without solving anything. */
function summarizeAllocatorRegions({ maxFloor, maxHallway, maxCost }) {
  let unsatRegion = 0;
  let decisionRegion = 0;
  let combos = 0;
  for (let floorTiles = 1; floorTiles <= maxFloor; floorTiles += 1) {
    for (let hallwayTiles = 0; hallwayTiles <= maxHallway; hallwayTiles += 1) {
      for (let costFloor = 1; costFloor <= maxCost; costFloor += 1) {
        for (let costHall = 1; costHall <= maxCost; costHall += 1) {
          const region = allocatorRegions({ floorTiles, hallwayTiles, costFloor, costHall });
          combos += 1;
          unsatRegion += region.unsatPoints;
          decisionRegion += region.decisionPoints;
        }
      }
    }
  }
  return { combos, unsatRegion, decisionRegion };
}

function outcomeRank(result, requestedLayout) {
  if (!result?.ok || !result.layout) return null;
  return allocatorObjectiveRank(result.layout, requestedLayout);
}

/** Merge chunked allocator ledger parts. Chunking is the normal case for the wide profile. */
export function mergeAllocatorLedgers(parts) {
  const counters = newCounters();
  const gains = [];
  const examples = { solverBetter: [], greedyBetter: [], solverContradictsOracle: [] };
  let elapsedMs = 0;
  for (const part of parts) {
    for (const key of Object.keys(part.counters)) counters[key] += part.counters[key];
    elapsedMs += part.elapsedMs;
    gains.push(...(part.gainSamples || []));
    for (const key of Object.keys(examples)) {
      const room = MAX_RECORDED_EXAMPLES - examples[key].length;
      if (room > 0) examples[key].push(...part.examples[key].slice(0, room));
    }
  }
  return finalizeAllocatorLedger({
    bounds: parts[0]?.bounds,
    regions: parts[0]?.regions ?? { combos: 0, unsatRegion: 0, decisionRegion: 0 },
    counters, gains, examples, elapsedMs,
  });
}

function finalizeAllocatorLedger({ bounds, regions, counters, gains, examples, elapsedMs }) {
  const solved = counters.points - counters.bypass;
  return {
    domain: "allocator_budget_fit",
    bounds,
    elapsedMs,
    counters,
    regions,
    gainSamples: gains,
    derived: {
      solvedPoints: solved,
      decisionBandFraction: (regions.unsatRegion + regions.decisionRegion) === 0
        ? 0 : regions.decisionRegion / (regions.unsatRegion + regions.decisionRegion),
      unexpectedBypass: counters.bypass,
      solverBetterFractionOfSolved: solved === 0 ? 0 : counters.solverStrictlyBetterThanGreedy / solved,
      greedyOptimalFractionOfSolved: solved === 0 ? 0 : counters.greedyMatchesOracle / solved,
      solverOptimalFractionOfSolved: solved === 0 ? 0 : counters.solverMatchesOracle / solved,
      greedyFalseRefusalsRecovered: gains.filter((entry) => entry.greedyRefused).length,
      medianRetainedTilesGained: median(gains.map((entry) => entry.retainedTilesGained)),
      maxRetainedTilesGained: gains.reduce((max, entry) => Math.max(max, entry.retainedTilesGained), 0),
    },
    examples,
  };
}

async function runAllocatorLedger({ bounds, limit, log, offset = 0 }) {
  const [{ createAllocatorPersona }, { createHostedLayoutBudgetFitter }, { createHybridConstraintSolverAdapter }] =
    await Promise.all([
      import("../../packages/runtime/src/personas/allocator/persona.js"),
      import("../../packages/runtime/src/commands/solver-host.js"),
      import("../../packages/adapters-cli/src/adapters/z3/index.js"),
    ]);

  const allocator = createAllocatorPersona({ clock: FIXED_CLOCK });
  const hosted = (adapter) => createHostedLayoutBudgetFitter({
    prepare: allocator.prepareLayoutBudgetFit,
    complete: allocator.completeLayoutBudgetFit,
    adapter,
    clock: FIXED_CLOCK,
  });
  const solverFit = hosted(createHybridConstraintSolverAdapter());
  const greedyFit = hosted(createDeferringAdapter("allocator_budget_fit"));

  const counters = newCounters();
  const examples = { solverBetter: [], greedyBetter: [], solverContradictsOracle: [] };
  const gains = [];
  const startedAt = Date.now();

  let seen = 0;
  for (const { point } of enumerateAllocatorPoints(bounds)) {
    seen += 1;
    if (seen <= offset) continue;
    if (limit && counters.points >= limit) break;
    counters.points += 1;
    if (log && counters.points % 500 === 0) {
      log(`  … ${counters.points} decision points (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    }

    const oracle = solveAllocatorBudgetFitExhaustive({
      requestedLayout: point.layout,
      tileCosts: point.layoutCosts,
      budgetTokens: point.remainingBudgetTokens,
    });
    if (oracle.status === "error") continue; // invalid input never reaches an adapter

    // The band math says this cannot be a bypass. Counting it rather than assuming
    // it keeps a wrong band visible instead of silently shrinking the sweep.
    const prepared = allocator.prepareLayoutBudgetFit(point);
    if (prepared.status === "bypass") {
      counters.bypass += 1;
      continue;
    }

    const [solver, greedy] = await Promise.all([solverFit(point), greedyFit(point)]);

    if (solver.status === "deferred") counters.solverDeferred += 1;
    if (solver.status === "error") counters.solverError += 1;
    if (solver.status === "unsat") counters.solverUnsat += 1;
    if (oracle.status === "unsat") counters.oracleUnsat += 1;

    const solverRank = outcomeRank(solver, point.layout);
    const greedyRank = outcomeRank(greedy, point.layout);
    const oracleRank = oracle.status === "fulfilled" ? oracle.rank : null;

    // Match the oracle: both feasible with the identical rank, or both infeasible.
    const solverMatches = oracleRank === null
      ? solverRank === null
      : (solverRank !== null && compareRank(solverRank, oracleRank) === 0);
    const greedyMatches = oracleRank === null
      ? greedyRank === null
      : (greedyRank !== null && compareRank(greedyRank, oracleRank) === 0);
    if (solverMatches) counters.solverMatchesOracle += 1;
    if (greedyMatches) counters.greedyMatchesOracle += 1;

    // A solver answer STRICTLY BETTER than the oracle is impossible; if it happens
    // the oracle or the objective encoding is wrong, and that must be loud.
    if (solverRank !== null && oracleRank !== null && compareRank(solverRank, oracleRank) > 0) {
      counters.solverContradictsOracle += 1;
      if (examples.solverContradictsOracle.length < MAX_RECORDED_EXAMPLES) {
        examples.solverContradictsOracle.push({ point, solver: solver.layout, oracle: oracle.model });
      }
    }

    let verdict;
    if (solverRank === null && greedyRank === null) verdict = 0;
    else if (solverRank === null) verdict = -1;
    else if (greedyRank === null) verdict = 1;
    else verdict = compareRank(solverRank, greedyRank);

    if (verdict > 0) {
      counters.solverStrictlyBetterThanGreedy += 1;
      gains.push({
        retainedTilesGained: (solverRank?.[0] ?? 0) - (greedyRank?.[0] ?? 0),
        greedyRefused: greedyRank === null,
      });
      if (examples.solverBetter.length < MAX_RECORDED_EXAMPLES) {
        examples.solverBetter.push({
          point,
          solver: solver.ok ? solver.layout : { refused: solver.reason ?? solver.status },
          greedy: greedy.ok ? greedy.layout : { refused: greedy.reason ?? "ok:false" },
          oracle: oracle.status === "fulfilled" ? oracle.model : oracle.reason,
        });
      }
    } else if (verdict < 0) {
      counters.greedyStrictlyBetterThanSolver += 1;
      if (examples.greedyBetter.length < MAX_RECORDED_EXAMPLES) {
        examples.greedyBetter.push({
          point,
          solver: solver.ok ? solver.layout : { refused: solver.reason ?? solver.status },
          greedy: greedy.ok ? greedy.layout : { refused: greedy.reason ?? "ok:false" },
          oracle: oracle.status === "fulfilled" ? oracle.model : oracle.reason,
        });
      }
    } else {
      counters.agree += 1;
    }
  }

  return finalizeAllocatorLedger({
    bounds,
    regions: summarizeAllocatorRegions(bounds),
    counters, gains, examples,
    elapsedMs: Date.now() - startedAt,
  });
}

/** Total decision points in a domain, counted without solving any of them. */
export function countAllocatorDecisionPoints(bounds) {
  return summarizeAllocatorRegions(bounds).decisionRegion;
}

// ---------------------------------------------------------------------------
// actor_action_selection
//
// ⚠️ NO LONGER A `CONSTRAINT_DOMAINS` MEMBER. This ledger measured it at 0.0% divergence
// from a plain stable sort over 819 permutations with 0 Z3 initializations, and the domain
// was RETIRED on that evidence (maintainer ruling, 2026-09-05).
//
// IT STAYS HERE, AND DELETING IT WOULD BE THE MISTAKE. This measurement is the argument for
// the retirement; removing it would leave the ruling resting on a number nobody can re-run.
// It is also the only thing that would notice a silent re-adoption, and the shape a future
// re-adoption would have to argue against. A gate, exactly like `actor_lookahead` and
// `actor_ordering` below -- neither of which is an adopted domain either.
// ---------------------------------------------------------------------------

function* enumerateActorPoints({ maxCandidates, rankArity, rankMax }) {
  const tuples = [];
  const build = (prefix) => {
    if (prefix.length === rankArity) {
      tuples.push([...prefix]);
      return;
    }
    for (let value = 0; value <= rankMax; value += 1) build([...prefix, value]);
  };
  build([]);

  for (let count = 1; count <= maxCandidates; count += 1) {
    const indices = new Array(count).fill(0);
    for (;;) {
      yield {
        candidateIds: indices.map((_, position) => `cand_${position}`),
        ranks: indices.map((tupleIndex) => tuples[tupleIndex]),
      };
      let cursor = count - 1;
      while (cursor >= 0) {
        indices[cursor] += 1;
        if (indices[cursor] < tuples.length) break;
        indices[cursor] = 0;
        cursor -= 1;
      }
      if (cursor < 0) break;
    }
  }
}

async function runActorLedger({ bounds, limit, log }) {
  const { createHybridConstraintSolverAdapter } = await import(
    "../../packages/adapters-cli/src/adapters/z3/index.js"
  );

  // The Z10 prediction is that the Actor path never initializes Z3. Counting init
  // calls is how the ledger proves that rather than asserting it: `init` throws, so
  // any attempt is both counted and fatal to that point.
  let initCalls = 0;
  const adapter = createHybridConstraintSolverAdapter({
    init: async () => {
      initCalls += 1;
      throw new Error("actor_action_selection initialized Z3");
    },
  });

  const counters = { points: 0, agree: 0, diverge: 0, adapterError: 0 };
  const examples = [];
  const startedAt = Date.now();
  const order = Array.from({ length: bounds.rankArity }, (_, index) => `o${index}`);

  for (const point of enumerateActorPoints(bounds)) {
    if (limit && counters.points >= limit) break;
    counters.points += 1;
    if (log && counters.points % 5000 === 0) log(`  … ${counters.points} points`);

    const result = await adapter.solve({
      problem: {
        data: {
          contract: "runtime-decision-v1",
          candidateActions: point.candidateIds.map((id) => ({ id, action: { kind: "wait" } })),
          objectives: {
            actorDecision: {
              contract: "actor-decision-objective-v1",
              order,
              candidates: point.candidateIds.map((id, index) => ({
                candidateActionId: id,
                rank: point.ranks[index],
                features: {},
                rationaleTags: [id],
              })),
            },
          },
        },
      },
    });
    if (result.status !== "fulfilled") {
      counters.adapterError += 1;
      continue;
    }
    const oracle = solveActorSelectionExhaustive(point);
    if (result.model.selectedActionId === oracle.model.selectedActionId) {
      counters.agree += 1;
    } else {
      counters.diverge += 1;
      if (examples.length < MAX_RECORDED_EXAMPLES) {
        examples.push({ point, adapter: result.model.selectedActionId, oracle: oracle.model.selectedActionId });
      }
    }
  }

  return {
    domain: "actor_action_selection",
    bounds,
    elapsedMs: Date.now() - startedAt,
    counters: { ...counters, z3InitCalls: initCalls },
    derived: {
      divergenceFraction: counters.points === 0 ? 0 : counters.diverge / counters.points,
      // The whole finding, as a boolean: no search happened.
      neverInitializedZ3: initCalls === 0,
    },
    examples,
  };
}

// ---------------------------------------------------------------------------
// configurator_satisfiability — object placement
// ---------------------------------------------------------------------------

/**
 * THE VALUE HYPOTHESIS HERE IS NOT OPTIMALITY, IT IS FEASIBILITY.
 *
 * Both implementations want the same thing — each object on the lowest-indexed
 * walkable cell it can take, in authored order — so on an open grid they agree
 * trivially. They differ in what they know: `placeObjectsLegacy` is a row-major
 * first-fit that never reconsiders, and is entirely blind to reachability. The
 * authored problem carries a unit-flow constraint that keeps spawn connected to exit
 * around anything declaring `blocking: true`.
 *
 * So the question this domain answers is not "how much better is the layout" but
 * "how often does the greedy path emit a level you cannot finish". A grid with a
 * one-tile corridor is where that bites, which is why the domain enumerates wall
 * masks rather than open rooms: an open room cannot be severed, and a sweep over
 * open rooms would report a comfortable zero and mean nothing.
 */
function* enumerateWallMasks(interior, maxWalls) {
  yield [];
  const combine = (start, current) => {
    if (current.length > 0) results.push([...current]);
    if (current.length === maxWalls) return;
    for (let index = start; index < interior.length; index += 1) {
      current.push(interior[index]);
      combine(index + 1, current);
      current.pop();
    }
  };
  const results = [];
  combine(0, []);
  yield* results;
}

function buildGridLayout({ width, height, walls }) {
  const kinds = Array.from({ length: height }, (_, y) => (
    Array.from({ length: width }, (_, x) => (walls.has(`${x},${y}`) ? 1 : 0))
  ));
  return {
    data: {
      kinds,
      spawn: { x: 0, y: 0 },
      exit: { x: width - 1, y: height - 1 },
      rooms: [],
    },
  };
}

function* enumerateConfiguratorPoints({ width, height, maxWalls, objectSets }) {
  const interior = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x === 0 && y === 0) || (x === width - 1 && y === height - 1)) continue;
      interior.push(`${x},${y}`);
    }
  }
  for (const mask of enumerateWallMasks(interior, maxWalls)) {
    const walls = new Set(mask);
    const layout = buildGridLayout({ width, height, walls });
    for (const objects of objectSets) {
      yield { layout, hazards: clone(objects.hazards), resources: clone(objects.resources) };
    }
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Positions actually assigned, keyed by object id, from a placement result. */
function placementOf(result) {
  const data = result?.layout?.data || result?.layout;
  if (!data) return null;
  const entries = [
    ...(Array.isArray(data.hazards) ? data.hazards : []),
    ...(Array.isArray(data.resources) ? data.resources : []),
  ];
  return Object.fromEntries(entries
    .filter((entry) => entry?.id && entry.position)
    .map((entry) => [entry.id, `${entry.position.x},${entry.position.y}`]));
}

/** Does this placement leave spawn able to reach exit? The question greedy never asks. */
function placementKeepsPathOpen(prepared, placement) {
  if (!placement) return false;
  const blocked = new Set(prepared.blocking);
  prepared.pending.forEach((object) => {
    if (object.value?.blocking === true && placement[object.id]) blocked.add(placement[object.id]);
  });
  return pathExistsOracle(prepared.cells, prepared.spawn, prepared.exit, blocked);
}

async function runConfiguratorLedger({ bounds, limit, log, offset = 0 }) {
  const [{ createConfiguratorPersona }, { createHostedObjectPlacer }, { createHybridConstraintSolverAdapter }] =
    await Promise.all([
      import("../../packages/runtime/src/personas/configurator/persona.js"),
      import("../../packages/runtime/src/commands/solver-host.js"),
      import("../../packages/adapters-cli/src/adapters/z3/index.js"),
    ]);

  const configurator = createConfiguratorPersona({ clock: FIXED_CLOCK });
  const hosted = (adapter) => createHostedObjectPlacer({
    prepare: configurator.prepareObjectPlacement,
    complete: configurator.completeObjectPlacement,
    adapter,
    clock: FIXED_CLOCK,
  });
  const solverPlace = hosted(createHybridConstraintSolverAdapter());
  const greedyPlace = hosted(createDeferringAdapter("configurator_satisfiability"));

  const counters = {
    points: 0, notReady: 0,
    solverOk: 0, greedyOk: 0, greedyThrew: 0,
    solverMatchesOracle: 0, greedyMatchesOracle: 0,
    solverPathBlocked: 0, greedyPathBlocked: 0,
    solverFeasibleGreedyNot: 0, greedyFeasibleSolverNot: 0,
    oracleUnsat: 0, agree: 0,
  };
  const examples = { greedyPathBlocked: [], solverPathBlocked: [], disagree: [] };
  const startedAt = Date.now();
  let seen = 0;

  for (const point of enumerateConfiguratorPoints(bounds)) {
    seen += 1;
    if (seen <= offset) continue;
    if (limit && counters.points >= limit) break;
    counters.points += 1;
    if (log && counters.points % 200 === 0) {
      log(`  … ${counters.points} points (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    }

    const prepared = configurator.prepareObjectPlacement(point);
    // Only "ready" points pose a problem at all; the rest are unsat or bypass before
    // either implementation gets a choice, and counting them as agreement would
    // inflate the result with cases nobody decided.
    if (prepared.status !== "ready") {
      counters.notReady += 1;
      continue;
    }

    const oracle = solveObjectPlacementExhaustive({ prepared });
    if (oracle.status === "unsat") counters.oracleUnsat += 1;

    const solver = await solverPlace(point);
    let greedy;
    try {
      greedy = await greedyPlace(point);
    } catch (error) {
      counters.greedyThrew += 1;
      greedy = { ok: false, threw: error?.message };
    }

    const solverPlacement = solver?.ok ? placementOf(solver) : null;
    const greedyPlacement = greedy?.ok ? placementOf(greedy) : null;
    if (solver?.ok) counters.solverOk += 1;
    if (greedy?.ok) counters.greedyOk += 1;

    const solverOpen = solverPlacement ? placementKeepsPathOpen(prepared, solverPlacement) : false;
    const greedyOpen = greedyPlacement ? placementKeepsPathOpen(prepared, greedyPlacement) : false;
    if (solverPlacement && !solverOpen) {
      counters.solverPathBlocked += 1;
      if (examples.solverPathBlocked.length < MAX_RECORDED_EXAMPLES) {
        examples.solverPathBlocked.push({ point, placement: solverPlacement });
      }
    }
    if (greedyPlacement && !greedyOpen) {
      counters.greedyPathBlocked += 1;
      if (examples.greedyPathBlocked.length < MAX_RECORDED_EXAMPLES) {
        examples.greedyPathBlocked.push({
          point: { kinds: point.layout.data.kinds, hazards: point.hazards, resources: point.resources },
          greedy: greedyPlacement,
          solver: solverPlacement,
          oracle: oracle.status === "fulfilled" ? oracle.model : oracle.reason,
        });
      }
    }

    const oracleModel = oracle.status === "fulfilled" ? JSON.stringify(oracle.model) : null;
    if (oracleModel !== null) {
      if (JSON.stringify(solverPlacement) === oracleModel) counters.solverMatchesOracle += 1;
      if (JSON.stringify(greedyPlacement) === oracleModel) counters.greedyMatchesOracle += 1;
    }

    const solverUsable = Boolean(solverPlacement) && solverOpen;
    const greedyUsable = Boolean(greedyPlacement) && greedyOpen;
    if (solverUsable && !greedyUsable) counters.solverFeasibleGreedyNot += 1;
    else if (greedyUsable && !solverUsable) counters.greedyFeasibleSolverNot += 1;
    else if (JSON.stringify(solverPlacement) === JSON.stringify(greedyPlacement)) counters.agree += 1;
    else if (examples.disagree.length < MAX_RECORDED_EXAMPLES) {
      examples.disagree.push({ solver: solverPlacement, greedy: greedyPlacement, oracle: oracle.model });
    }
  }

  const decided = counters.points - counters.notReady;
  return {
    domain: "configurator_satisfiability",
    bounds,
    elapsedMs: Date.now() - startedAt,
    counters,
    derived: {
      decidedPoints: decided,
      solverOptimalFractionOfDecided: decided === 0 ? 0 : counters.solverMatchesOracle / decided,
      greedyOptimalFractionOfDecided: decided === 0 ? 0 : counters.greedyMatchesOracle / decided,
      greedyPathBlockedFraction: decided === 0 ? 0 : counters.greedyPathBlocked / decided,
      solverPathBlockedFraction: decided === 0 ? 0 : counters.solverPathBlocked / decided,
      solverRescuedGreedy: counters.solverFeasibleGreedyNot,
    },
    examples,
  };
}

// ---------------------------------------------------------------------------
// actor_lookahead — Stage C benefit gate (NOT an adopted constraint domain)
// ---------------------------------------------------------------------------

/**
 * DOES LOOKAHEAD BEAT ONE STEP? Asked before any solver is written, and with none in it.
 *
 * This is not a `CONSTRAINT_DOMAINS` member and must not become one on the strength of a
 * number alone. It measures whether there is anything for a search to win, which is the
 * question nobody asked before `actor_action_selection` was adopted -- and the answer
 * there, measured, was 0.0%, which is why that domain was retired on 2026-09-05. Asking
 * this question first is the whole point of the gate; adopting first is what had to be
 * undone.
 *
 * THREE WAYS ARE COMPARED, and the third is what makes this a gate rather than an advert:
 *
 *   policy       the REAL Actor persona, driven a tick at a time
 *   safetyFirst  a one-step chooser that weighs safety above progress -- the CONTROL
 *   oracle       exhaustive enumeration of every route within the horizon
 *
 * Without the control this domain would report the current policy losing to an optimal
 * router and read as proof that search is needed. It is not: the Actor's tuple compares
 * lexicographically and `intentClass` dominates `fieldSafety`, so an actor crosses hazards
 * that lie on the way to the exit. Some of that gap is an ORDERING defect, and ordering is
 * far cheaper than search. Only points that defeat BOTH orderings are evidence for a
 * horizon, and `bothWorse` is the number this domain exists to produce.
 *
 * Boards come from enumerated wall masks rather than hand-drawn maps: an earlier probe
 * hand-built a corridor "obviously" fatal to a myopic actor and the policy walked around
 * it cleanly, because with eight-way movement and Chebyshev distance "exit progress" is a
 * wide class with room for safety to operate inside it.
 */
async function runLookaheadLedger({ bounds, limit, log, offset = 0 }) {
  const { width, height, maxWalls, hazardCounts, horizon, harm } = bounds;
  const start = { x: 1, y: 1 };
  const exit = { x: width - 2, y: height - 2 };

  // PRECONDITION, not a test. Both movers must reach the exit on an empty board or their
  // failures are their own bugs rather than evidence about lookahead. Two driver defects
  // were caught exactly here, each of which had produced confident fictional numbers: an
  // invalid motivation kind that silently downgraded the actor to the compatibility tuple,
  // and a driver that supplied its own proposals -- which an actor ranks at intentClass
  // 600, above its own exit-seeking candidates at 300.
  const openBoard = [...enumerateBoards({ width, height, maxWalls: 0, start, exit })][0];
  const sanityPolicy = await runPolicy({ tiles: openBoard, fields: [], start, exit, horizon, grants: [] });
  const sanityControl = safetyFirstRun({ tiles: openBoard, fields: [], start, exit, horizon });
  if (!sanityPolicy.reached || !sanityControl.reached) {
    throw new Error(
      "lookahead precondition failed: on a board with no hazards the "
      + `${!sanityPolicy.reached ? "policy" : "control"} did not reach the exit. Every `
      + "divergence below would be measuring that bug, not the Actor.",
    );
  }

  const counters = {
    points: 0, unreachable: 0,
    policyWorse: 0, safetyWorse: 0, bothWorse: 0, reorderFixes: 0,
    policyFailedToReach: 0, safetyFailedToReach: 0, agree: 0,
  };
  // `policyFailedToReach` gets examples of its own. It had a counter and nothing else, which
  // made the 190 cases it reported at sweep bounds un-diagnosable: a number that cannot be
  // turned back into a board is a number you can only argue about.
  const examples = { bothWorse: [], reorderFixes: [], policyFailedToReach: [] };
  const gaps = [];
  const startedAt = Date.now();
  let seen = 0;

  for (const tiles of enumerateBoards({ width, height, maxWalls, start, exit })) {
    for (const hazardCount of hazardCounts) {
      for (const fields of enumerateHazardBoards({ tiles, start, exit, hazardCount, harm })) {
        seen += 1;
        if (seen <= offset) continue;
        if (limit && counters.points >= limit) break;

        const oracle = bestRoute({ tiles, fields, start, exit, horizon, observer: null });
        // A board the exit cannot be reached on within the horizon asks nobody a question.
        if (!oracle || !oracle.reached) { counters.unreachable += 1; continue; }
        counters.points += 1;
        if (log && counters.points % 250 === 0) {
          log(`  … ${counters.points} points (${Math.round((Date.now() - startedAt) / 1000)}s)`);
        }

        const policy = await runPolicy({ tiles, fields, start, exit, horizon, grants: [] });
        const safety = safetyFirstRun({ tiles, fields, start, exit, horizon });

        const policyWorse = !policy.reached || policy.harm > oracle.harm;
        const safetyWorse = !safety.reached || safety.harm > oracle.harm;
        if (!policy.reached) {
          counters.policyFailedToReach += 1;
          if (examples.policyFailedToReach.length < MAX_RECORDED_EXAMPLES) {
            examples.policyFailedToReach.push({
              tiles,
              hazards: fields.map((f) => ({ ...f.position, kind: f.kind, magnitude: f.magnitude })),
              policyPath: policy.path || null,
              policyHarm: policy.harm,
              oracleHarm: oracle.harm,
              safetyReached: safety.reached,
            });
          }
        }
        if (!safety.reached) counters.safetyFailedToReach += 1;
        if (policyWorse) counters.policyWorse += 1;
        if (safetyWorse) counters.safetyWorse += 1;
        if (policyWorse && !safetyWorse) counters.reorderFixes += 1;
        if (policyWorse && safetyWorse) {
          counters.bothWorse += 1;
          gaps.push(policy.harm - oracle.harm);
          if (examples.bothWorse.length < MAX_RECORDED_EXAMPLES) {
            examples.bothWorse.push({ tiles, hazards: fields.map((f) => f.position), policy, safety, oracle });
          }
        }
        if (!policyWorse && !safetyWorse) counters.agree += 1;
      }
    }
  }

  const points = counters.points;
  return {
    domain: "actor_lookahead",
    bounds,
    elapsedMs: Date.now() - startedAt,
    counters,
    derived: {
      policyWorseFraction: points === 0 ? 0 : counters.policyWorse / points,
      safetyWorseFraction: points === 0 ? 0 : counters.safetyWorse / points,
      // The only figure that argues for a horizon: no one-step ordering reaches these.
      lookaheadOnlyFraction: points === 0 ? 0 : counters.bothWorse / points,
      reorderFixesFractionOfPolicyGap: counters.policyWorse === 0
        ? 0 : counters.reorderFixes / counters.policyWorse,
      medianHarmGap: median(gaps),
      maxHarmGap: gaps.reduce((max, value) => Math.max(max, value), 0),
    },
    examples,
  };
}

// ---------------------------------------------------------------------------
// actor_ordering — benefit gate (NOT an adopted constraint domain)
// ---------------------------------------------------------------------------

/**
 * DOES WHO-GOES-FIRST CHANGE THE OUTCOME? Asked with no solver in it, before one is written.
 *
 * Actor order is currently the alphabetical sort of actor ids (`runtime-fsm.mjs:194`), so
 * renaming an attacker from `delver_1` to `zealot_1` moves it behind a warden. Core exposes
 * no initiative, priority or turn concept. The charter assigns ordering to the Moderator so
 * that "tick semantics are policy, not accidents of the runner loop", and
 * `moderator/tick-ordering.js` does own the order of the seven PERSONAS — but actor order is
 * a different subject sharing a name, and is owned by nobody.
 *
 * ⚠️ THE CHARTER'S "tick ordering" REFUSAL DOES NOT COVER THIS. That refusal is correct about
 * persona order, which really is a fixed sort. Actor order is a scheduling question over a
 * shared, mutually exclusive resource, which is the shape a sort cannot answer.
 *
 * Decisions are order-invariant — actors choose independently — so only APPLICATION order
 * varies here, each permutation against a freshly built core. Real core rules resolve it.
 */
async function runActorOrderingLedger({ bounds, limit, log, offset = 0 }) {
  const counters = { scenarios: 0, orderDependent: 0, orderIrrelevant: 0, maxDistinctOutcomes: 1 };
  const byKind = {};
  const examples = [];
  const startedAt = Date.now();
  let seen = 0;

  for (const scenario of enumerateOrderingScenarios(bounds)) {
    seen += 1;
    if (seen <= offset) continue;
    if (limit && counters.scenarios >= limit) break;
    counters.scenarios += 1;
    if (log && counters.scenarios % 200 === 0) {
      log(`  … ${counters.scenarios} scenarios (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    }

    const result = await orderingDivergence(scenario);
    byKind[scenario.kind] ||= { total: 0, dependent: 0 };
    byKind[scenario.kind].total += 1;
    counters.maxDistinctOutcomes = Math.max(counters.maxDistinctOutcomes, result.distinctOutcomes);
    if (result.distinctOutcomes > 1) {
      counters.orderDependent += 1;
      byKind[scenario.kind].dependent += 1;
      if (examples.length < MAX_RECORDED_EXAMPLES) {
        examples.push({
          kind: scenario.kind,
          actors: scenario.actors,
          actions: scenario.actions,
          outcomes: [...result.outcomes.entries()].map(([state, orders]) => ({ state, orders })),
        });
      }
    } else {
      counters.orderIrrelevant += 1;
    }
  }

  return {
    domain: "actor_ordering",
    bounds,
    elapsedMs: Date.now() - startedAt,
    counters,
    byKind,
    derived: {
      orderDependentFraction: counters.scenarios === 0 ? 0 : counters.orderDependent / counters.scenarios,
    },
    examples,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export const LEDGER_DOMAINS = Object.freeze({
  allocator_budget_fit: {
    run: runAllocatorLedger,
    bounds: {
      gate: { maxFloor: 4, maxHallway: 4, maxCost: 4 },
      sweep: { maxFloor: 8, maxHallway: 8, maxCost: 6 },
    },
  },
  configurator_satisfiability: {
    run: runConfiguratorLedger,
    bounds: {
      // A 4x3 grid is the smallest that admits a one-tile corridor, which is the
      // only shape where a path-blind placer can sever the level.
      gate: {
        width: 4,
        height: 3,
        maxWalls: 3,
        objectSets: [
          { hazards: [{ id: "h1", blocking: true }], resources: [] },
          { hazards: [{ id: "h1", blocking: true }], resources: [{ id: "r1" }] },
          { hazards: [{ id: "h1", blocking: true }, { id: "h2", blocking: true }], resources: [] },
          { hazards: [{ id: "h1", blocking: false }], resources: [{ id: "r1" }] },
        ],
      },
      sweep: {
        width: 5,
        height: 3,
        maxWalls: 4,
        objectSets: [
          { hazards: [{ id: "h1", blocking: true }], resources: [] },
          { hazards: [{ id: "h1", blocking: true }], resources: [{ id: "r1" }] },
          { hazards: [{ id: "h1", blocking: true }, { id: "h2", blocking: true }], resources: [] },
          { hazards: [{ id: "h1", blocking: true }, { id: "h2", blocking: false }], resources: [{ id: "r1" }] },
        ],
      },
    },
  },
  actor_ordering: {
    run: runActorOrderingLedger,
    bounds: {
      gate: { width: 5, height: 5, damages: [3, 6], healths: [5, 10] },
      sweep: { width: 6, height: 5, damages: [2, 4, 6, 10], healths: [4, 6, 10] },
    },
  },
  actor_lookahead: {
    run: runLookaheadLedger,
    bounds: {
      gate: { width: 7, height: 5, maxWalls: 1, hazardCounts: [2], horizon: 6, harm: 5 },
      sweep: { width: 7, height: 5, maxWalls: 2, hazardCounts: [1, 2, 3], horizon: 7, harm: 5 },
    },
  },
  actor_action_selection: {
    run: runActorLedger,
    bounds: {
      gate: { maxCandidates: 3, rankArity: 2, rankMax: 2 },
      sweep: { maxCandidates: 4, rankArity: 3, rankMax: 2 },
    },
  },
});

export async function runLedger(domainId, { profile = "gate", limit = 0, log = null, offset = 0 } = {}) {
  const domain = LEDGER_DOMAINS[domainId];
  if (!domain) throw new Error(`unknown ledger domain: ${domainId}`);
  const bounds = domain.bounds[profile];
  if (!bounds) throw new Error(`unknown bounds profile: ${profile}`);
  return domain.run({ bounds, limit, log, offset });
}

export { median };

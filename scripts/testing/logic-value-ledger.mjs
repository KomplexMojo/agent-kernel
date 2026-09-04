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
import {
  allocatorObjectiveRank,
  compareRank,
  solveActorSelectionExhaustive,
  solveAllocatorBudgetFitExhaustive,
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

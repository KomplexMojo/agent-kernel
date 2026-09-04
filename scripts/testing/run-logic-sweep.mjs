#!/usr/bin/env node
/**
 * Z10 Phase 0 — CLI for the solver value ledger.
 *
 * Out of the default test gate on purpose, mirroring `run-configuration-permutation-sweep.mjs`:
 * this drives real Z3 thousands of times, and the repo's only gate is local.
 *
 *   pnpm run logic-sweep                                  # every domain, gate bounds
 *   pnpm run logic-sweep -- --domain allocator_budget_fit # one domain
 *   pnpm run logic-sweep -- --profile sweep               # wide bounds
 *   pnpm run logic-sweep -- --limit 500                   # cap points per domain
 *   pnpm run logic-sweep:dry-run                          # print the plan, solve nothing
 */
import {
  LEDGER_DOMAINS,
  countAllocatorDecisionPoints,
  mergeAllocatorLedgers,
  runLedger,
} from "./logic-value-ledger.mjs";
import { ROOT, writeJson } from "./shared.mjs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * WHY THIS FORKS INSTEAD OF LOOPING.
 *
 * z3-solver never frees a Context: the WASM linear heap it allocates cannot be
 * returned, so a long-lived process accumulates it no matter how the adapter
 * recycles. The adapter's bounded reuse raised the ceiling from roughly 400 solves
 * to roughly 11,500, which is ample for production -- a build does tens of solves and
 * the longest budget loop does hundreds -- but the wide sweep profile is 68,040.
 *
 * So the sweep runs in chunks, each in its own process that exits and returns its
 * heap. This is a property of the tool's scale, not a workaround for a defect: no
 * production path solves anywhere near this many times in one process.
 */
const CHUNK_SIZE = 2000;
const MIN_SPAN_SIZE = 1;
const SELF = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = {
    domains: [], profile: "gate", limit: 0, dryRun: false, out: null,
    workerOffset: null, workerLimit: null, noChunk: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") args.dryRun = true;
    else if (token === "--domain") args.domains.push(argv[index += 1]);
    else if (token === "--profile") args.profile = argv[index += 1];
    else if (token === "--limit") args.limit = Number.parseInt(argv[index += 1], 10) || 0;
    else if (token === "--out") args.out = argv[index += 1];
    else if (token === "--worker-offset") args.workerOffset = Number.parseInt(argv[index += 1], 10);
    else if (token === "--worker-limit") args.workerLimit = Number.parseInt(argv[index += 1], 10);
    else if (token === "--no-chunk") args.noChunk = true;
    else if (token.startsWith("--")) throw new Error(`unknown flag: ${token}`);
  }
  if (args.domains.length === 0) args.domains = Object.keys(LEDGER_DOMAINS);
  for (const domain of args.domains) {
    if (!LEDGER_DOMAINS[domain]) {
      throw new Error(`unknown domain "${domain}". Known: ${Object.keys(LEDGER_DOMAINS).join(", ")}`);
    }
  }
  return args;
}

function percent(value) {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function reportAllocator(result) {
  const { counters: c, derived: d } = result;
  console.log(`  domain: ${result.regions.combos} layout/price combos  ·  decision band is ${percent(d.decisionBandFraction)} of the budget range`);
  console.log(`  decision points solved ${d.solvedPoints}${c.bypass ? `  ·  UNEXPECTED bypass ${c.bypass} (band math is wrong)` : ""}`);
  console.log(`  optimal vs oracle:      solver ${percent(d.solverOptimalFractionOfSolved)}  ·  greedy ${percent(d.greedyOptimalFractionOfSolved)}`);
  console.log(`  solver strictly better: ${c.solverStrictlyBetterThanGreedy} (${percent(d.solverBetterFractionOfSolved)} of solved)`);
  console.log(`  greedy strictly better: ${c.greedyStrictlyBetterThanSolver}`);
  console.log(`  greedy false refusals recovered: ${d.greedyFalseRefusalsRecovered}`);
  console.log(`  retained tiles gained:  median ${d.medianRetainedTilesGained}  ·  max ${d.maxRetainedTilesGained}`);
  console.log(`  unsat: solver ${c.solverUnsat} / oracle ${c.oracleUnsat}  ·  deferred ${c.solverDeferred}  ·  error ${c.solverError}`);
  if (c.solverContradictsOracle > 0) {
    console.log(`  ⚠️  SOLVER BEAT THE ORACLE ${c.solverContradictsOracle}× — the oracle or the objective encoding is wrong.`);
  }
}

function reportConfigurator(result) {
  const { counters: c, derived: d } = result;
  console.log(`  points ${c.points}  ·  posed a problem ${d.decidedPoints}  ·  unsat/bypass before the choice ${c.notReady}`);
  console.log(`  optimal vs oracle:      solver ${percent(d.solverOptimalFractionOfDecided)}  ·  greedy ${percent(d.greedyOptimalFractionOfDecided)}`);
  console.log(`  PATH SEVERED:           solver ${c.solverPathBlocked} (${percent(d.solverPathBlockedFraction)})  ·  greedy ${c.greedyPathBlocked} (${percent(d.greedyPathBlockedFraction)})`);
  console.log(`  solver usable where greedy was not: ${d.solverRescuedGreedy}  ·  greedy threw ${c.greedyThrew}`);
  console.log(`  identical placements ${c.agree}  ·  oracle unsat ${c.oracleUnsat}`);
  if (c.solverPathBlocked > 0) {
    console.log("  ⚠️  THE SOLVER SEVERED A LEVEL — its path constraint is not doing what it claims.");
  }
}

function reportLookahead(result) {
  const { counters: c, derived: d } = result;
  console.log(`  points ${c.points}  ·  boards where the exit was unreachable ${c.unreachable}`);
  console.log(`  current policy suboptimal : ${c.policyWorse} (${percent(d.policyWorseFraction)})`);
  console.log(`  safety-first CONTROL      : ${c.safetyWorse} (${percent(d.safetyWorseFraction)})`);
  console.log(`  a reorder alone fixes     : ${c.reorderFixes}/${c.policyWorse} (${percent(d.reorderFixesFractionOfPolicyGap)} of the gap)`);
  console.log(`  LOOKAHEAD-ONLY            : ${c.bothWorse} (${percent(d.lookaheadOnlyFraction)}) — defeat BOTH orderings`);
  console.log(`  harm gap on those: median ${d.medianHarmGap} · max ${d.maxHarmGap}`);
  console.log(`  failed to reach: policy ${c.policyFailedToReach} · control ${c.safetyFailedToReach}  ·  both optimal ${c.agree}`);
}

function reportActor(result) {
  const { counters: c, derived: d } = result;
  console.log(`  points ${c.points}  ·  agree ${c.agree}  ·  diverge ${c.diverge} (${percent(d.divergenceFraction)})`);
  console.log(`  adapter errors ${c.adapterError}  ·  z3 init calls ${c.z3InitCalls}  ·  never initialized Z3: ${d.neverInitializedZ3}`);
}

/** Run one chunk in a child process and return its parsed ledger part. */
function runChunk(domain, profile, offset, limit) {
  const stdout = execFileSync(process.execPath, [
    SELF, "--domain", domain, "--profile", profile,
    "--worker-offset", String(offset), "--worker-limit", String(limit),
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
  const start = stdout.indexOf("{");
  if (start === -1) throw new Error(`chunk at offset ${offset} produced no JSON:\n${stdout}`);
  return JSON.parse(stdout.slice(start));
}

/**
 * Walk the enumeration in spans, shrinking the span size when a worker process dies.
 *
 * WHY THE SIZE IS DISCOVERED RATHER THAN CONFIGURED. How many solves a process
 * survives depends on the SIZE of the problems in that span, not their count: larger
 * tile counts and prices make Z3 rewrite bigger pseudo-boolean constraints, so early
 * spans of 2000 complete while later ones abort. Measured on this domain, a span at
 * offset 16000 survived 60 solves and died at 125.
 *
 * THE FLOOR IS 1, AND THAT IS THE WHOLE POINT. An earlier version floored at 125 on
 * the theory that "below this, a crash is a defect rather than a span-size problem."
 * That theory was wrong and it failed the sweep: 60 points at the same offset ran
 * fine, so 125 was still just too big. The only span size that distinguishes a defect
 * from a capacity limit is ONE -- if a single problem aborts the process, no amount of
 * subdividing helps and something is genuinely wrong. Any larger floor is a guess
 * dressed as a diagnosis.
 *
 * The size shrinks and does not grow back. Re-discovering the ceiling once per span
 * costs a crashed process each time, and every crash throws away that span's work.
 */
function runChunked(domain, profile, log) {
  const total = countAllocatorDecisionPoints(LEDGER_DOMAINS[domain].bounds[profile]);
  const parts = [];
  let spanSize = CHUNK_SIZE;
  let offset = 0;
  let shrinks = 0;

  while (offset < total) {
    const limit = Math.min(spanSize, total - offset);
    try {
      parts.push(runChunk(domain, profile, offset, limit));
      offset += limit;
      if (parts.length % 10 === 0 || limit === total - offset) {
        log(`  ${offset}/${total} points  ·  span ${spanSize}  ·  ${parts.length} workers`);
      }
    } catch (error) {
      if (limit <= MIN_SPAN_SIZE) {
        throw new Error(
          `a SINGLE problem at offset ${offset} crashed the solver process. Subdividing cannot `
          + `help below one point, so this is a genuine defect rather than a capacity limit.\n`
          + `${error.message}`,
        );
      }
      spanSize = Math.max(MIN_SPAN_SIZE, Math.floor(limit / 2));
      shrinks += 1;
      log(`  span too large at offset ${offset}; shrinking to ${spanSize} (shrink #${shrinks})`);
    }
  }
  log(`  done: ${parts.length} workers, final span ${spanSize}, ${shrinks} shrinks`);
  return mergeAllocatorLedgers(parts);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Worker mode: solve one slice, emit JSON, exit. The parent owns reporting.
  if (args.workerOffset !== null) {
    const result = await runLedger(args.domains[0], {
      profile: args.profile,
      limit: args.workerLimit,
      offset: args.workerOffset,
    });
    process.stdout.write(JSON.stringify(result));
    return;
  }
  console.log(`[logic-sweep] profile=${args.profile}${args.limit ? ` limit=${args.limit}` : ""} domains=${args.domains.join(", ")}`);

  if (args.dryRun) {
    for (const domain of args.domains) {
      console.log(`  ${domain}: bounds ${JSON.stringify(LEDGER_DOMAINS[domain].bounds[args.profile])}`);
    }
    console.log("[logic-sweep] dry run — nothing solved.");
    return;
  }

  const results = [];
  for (const domain of args.domains) {
    console.log(`\n[${domain}]`);
    const chunkable = domain === "allocator_budget_fit" && !args.noChunk && !args.limit;
    const result = chunkable
      ? runChunked(domain, args.profile, (line) => console.log(line))
      : await runLedger(domain, {
        profile: args.profile,
        limit: args.limit,
        log: (line) => console.log(line),
      });
    if (domain === "allocator_budget_fit") reportAllocator(result);
    else if (domain === "configurator_satisfiability") reportConfigurator(result);
    else if (domain === "actor_lookahead") reportLookahead(result);
    else if (domain === "actor_action_selection") reportActor(result);
    console.log(`  elapsed ${(result.elapsedMs / 1000).toFixed(1)}s`);
    results.push(result);
  }

  const outPath = resolve(ROOT, args.out || "local-codex/solver-value-ledger.json");
  writeJson(outPath, {
    generatedAt: new Date().toISOString(),
    profile: args.profile,
    limit: args.limit || null,
    results,
  });
  console.log(`\n[logic-sweep] wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

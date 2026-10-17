/**
 * The shared solver-vs-fallback ledger (#298).
 *
 * A domain is adopted, kept or un-adopted on measurement, never on the expectation that a
 * search must beat a heuristic. Each earlier ledger (`scripts/testing/logic-value-ledger.mjs`)
 * was written one-off; this is the one harness the next domains use.
 *
 * A domain supplies:
 *   cases      an iterable of problems (enumerated or seeded; never live services)
 *   fallback   async (case) => answer   the persona's answer with the solver deferred
 *   solver     async (case) => answer   the persona's answer through the real host path
 *   rank       (answer, case) => number[] | null   lexicographic quality, higher is better;
 *              null means the answer refused (or is unusable)
 *   oracle     optional (case) => number[] | null   the best possible rank, for small cases
 *   gap        optional (solverRank, fallbackRank) => number   the quality difference
 *
 * THE VERDICT RULE IS AN ARGUMENT, NOT AN AFTERTHOUGHT. `runSolverLedger` refuses to run
 * without one, so the margin a solver must win by is written down before any number is
 * seen. A ledger that cannot return "reject" is advocacy.
 */

export function compareRank(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function timeSummary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? null };
}

function assertVerdictRule(rule) {
  if (!rule || typeof rule !== "object"
    || !Number.isFinite(rule.minSolverBetterFraction)
    || !Number.isInteger(rule.maxFallbackBetter)) {
    throw new Error("runSolverLedger needs a verdictRule { minSolverBetterFraction, maxFallbackBetter } "
      + "stated before the run; the margin is not chosen after the numbers.");
  }
}

/**
 * Run one domain's ledger and return its counters, derived rates and verdict.
 * `now` is injectable so timing can be stubbed; timings are reported, never asserted.
 */
export async function runSolverLedger({
  domain,
  cases,
  fallback,
  solver,
  rank,
  oracle = null,
  gap = null,
  verdictRule,
  now = () => performance.now(),
} = {}) {
  assertVerdictRule(verdictRule);
  if (typeof fallback !== "function" || typeof solver !== "function" || typeof rank !== "function") {
    throw new Error("runSolverLedger needs fallback, solver and rank functions.");
  }

  const counters = {
    points: 0,
    agree: 0,
    solverBetter: 0,
    fallbackBetter: 0,
    solverOptimal: 0,
    fallbackOptimal: 0,
    oracleChecked: 0,
    solverBeatsOracle: 0,
    refusalsRecovered: 0,
    refusalsIntroduced: 0,
  };
  const gaps = [];
  const solverMs = [];
  const fallbackMs = [];

  for (const problem of cases) {
    counters.points += 1;
    let started = now();
    const fallbackAnswer = await fallback(problem);
    fallbackMs.push(now() - started);
    started = now();
    const solverAnswer = await solver(problem);
    solverMs.push(now() - started);

    const fallbackRank = rank(fallbackAnswer, problem);
    const solverRank = rank(solverAnswer, problem);
    const verdict = compareRank(solverRank, fallbackRank);
    if (verdict > 0) {
      counters.solverBetter += 1;
      if (fallbackRank === null) counters.refusalsRecovered += 1;
      if (gap) gaps.push(gap(solverRank, fallbackRank));
    } else if (verdict < 0) {
      counters.fallbackBetter += 1;
      if (solverRank === null) counters.refusalsIntroduced += 1;
    } else {
      counters.agree += 1;
    }

    if (oracle) {
      const best = oracle(problem);
      counters.oracleChecked += 1;
      if (compareRank(solverRank, best) === 0) counters.solverOptimal += 1;
      if (compareRank(fallbackRank, best) === 0) counters.fallbackOptimal += 1;
      // Better than exhaustive search is impossible: the oracle or the encoding is wrong.
      if (compareRank(solverRank, best) > 0) counters.solverBeatsOracle += 1;
    }
  }

  const rate = (count) => (counters.points === 0 ? 0 : count / counters.points);
  const derived = {
    divergenceRate: rate(counters.solverBetter + counters.fallbackBetter),
    solverBetterFraction: rate(counters.solverBetter),
    fallbackBetterFraction: rate(counters.fallbackBetter),
    solverOptimalFraction: counters.oracleChecked === 0 ? null : counters.solverOptimal / counters.oracleChecked,
    fallbackOptimalFraction: counters.oracleChecked === 0 ? null : counters.fallbackOptimal / counters.oracleChecked,
    medianGap: gaps.length === 0 ? null : timeSummary(gaps).median,
    maxGap: gaps.length === 0 ? null : Math.max(...gaps),
  };

  const reasons = [];
  if (counters.points === 0) reasons.push("no cases were measured");
  if (counters.solverBeatsOracle > 0) reasons.push(`solver beat the oracle ${counters.solverBeatsOracle} times`);
  if (counters.fallbackBetter > verdictRule.maxFallbackBetter) {
    reasons.push(`fallback was better ${counters.fallbackBetter} times (allowed ${verdictRule.maxFallbackBetter})`);
  }
  if (derived.solverBetterFraction < verdictRule.minSolverBetterFraction) {
    reasons.push(`solver was better on ${(derived.solverBetterFraction * 100).toFixed(1)}% `
      + `(needs ${(verdictRule.minSolverBetterFraction * 100).toFixed(1)}%)`);
  }

  return {
    domain,
    verdictRule,
    counters,
    derived,
    timingMs: { solver: timeSummary(solverMs), fallback: timeSummary(fallbackMs) },
    verdict: reasons.length === 0 ? "adopt" : "reject",
    reasons,
  };
}

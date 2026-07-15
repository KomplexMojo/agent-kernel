import { createBenchmarkEvidenceV1 } from "./profiles.js";
import { classifyBenchmarkEvidence, createStrategyPolicyV1 } from "./strategy-policy.js";

export { classifyBenchmarkEvidence, createBenchmarkEvidenceV1 };

export const BENCHMARK_PROMOTION_SOURCE = "benchmark-promotion";

// Turns explicitly chosen benchmark promotions into a NEW versioned strategy
// policy. The source policy is never mutated: benchmark evidence only changes
// routing when an operator promotes it here, keeping promotion auditable.
export function promoteBenchmarkPolicy({ policy = createStrategyPolicyV1(), promotions = [], asOf } = {}) {
  if (!Array.isArray(promotions) || promotions.length === 0) {
    throw new Error("promoteBenchmarkPolicy requires at least one promotion.");
  }
  const base = JSON.parse(JSON.stringify(policy));
  if (!Array.isArray(base.strategies) || base.strategies.length === 0) {
    throw new Error("promoteBenchmarkPolicy requires a valid StrategyPolicyV1.");
  }
  const strategyIds = new Set(base.strategies.map((strategy) => strategy.id));
  const byStrategy = new Map();
  for (const promotion of promotions) {
    if (!promotion || !strategyIds.has(promotion.strategyId)) {
      throw new Error(`Unknown strategy for benchmark promotion: ${promotion?.strategyId}`);
    }
    if (promotion.required !== undefined && typeof promotion.required !== "boolean") {
      throw new Error("Benchmark promotion 'required' must be boolean.");
    }
    if (promotion.minAverageScore !== undefined && !Number.isFinite(promotion.minAverageScore)) {
      throw new Error("Benchmark promotion 'minAverageScore' must be a finite number.");
    }
    byStrategy.set(promotion.strategyId, promotion);
  }

  const strategies = base.strategies.map((strategy) => {
    const promotion = byStrategy.get(strategy.id);
    if (!promotion) return strategy;
    const benchmark = {};
    if (promotion.required !== undefined) benchmark.required = promotion.required;
    if (promotion.minAverageScore !== undefined) benchmark.minAverageScore = promotion.minAverageScore;
    return { ...strategy, benchmark };
  });

  const promotedVersion = `${base.policyVersion}+benchmark:${text(asOf) ? asOf : "unversioned"}`;
  return createStrategyPolicyV1({
    strategies,
    fallbackOrder: base.fallbackOrder,
    thresholds: base.thresholds,
    context: base.context,
    policyVersion: promotedVersion,
    source: BENCHMARK_PROMOTION_SOURCE,
  });
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * #422 — level difficulty grades, H (easiest) to S (ultra hard).
 *
 * A grade is a total budget and the share of it the dungeon side gets; the delver side
 * gets the rest. The numbers are base-costs.json's (`levelGradeBudgetTokens`,
 * `levelGradeDungeonPercent`); this module only reads them and applies the split to a
 * build's pool weights, so the Allocator's own pools carry it.
 */
import BASE_COSTS from "./base-costs.json" with { type: "json" };

/** Grades in order, easiest first. */
export const LEVEL_GRADES = Object.freeze(Object.keys(BASE_COSTS.levelGradeBudgetTokens));

/** The delver-side pool; every other pool is the dungeon's. */
const DELVER_POOL_ID = "delver";

export function resolveLevelGrade(grade) {
  const id = typeof grade === "string" ? grade.trim().toUpperCase() : "";
  if (!LEVEL_GRADES.includes(id)) {
    throw new Error(`unknown level grade "${grade}"; known grades: ${LEVEL_GRADES.join(", ")}`);
  }
  const dungeonPercent = BASE_COSTS.levelGradeDungeonPercent[id];
  return Object.freeze({ grade: id, budgetTokens: BASE_COSTS.levelGradeBudgetTokens[id],
    dungeonPercent, delverPercent: 100 - dungeonPercent });
}

/** A grade as a build reports it; a build budget other than the grade's is an override. */
export function reportLevelGrade(grade, builtTokens) {
  const resolved = resolveLevelGrade(grade);
  return Number.isInteger(builtTokens) && builtTokens !== resolved.budgetTokens
    ? { ...resolved, budgetOverride: builtTokens } : { ...resolved };
}

/**
 * Re-weight a build's pools so the delver pool holds the grade's delver share and the
 * dungeon pools share the rest in their own proportions. A side with no pool keeps the
 * weights as they are: there is nothing to give its share to.
 */
export function applyLevelGradePoolWeights(poolWeights, grade) {
  const { dungeonPercent, delverPercent } = resolveLevelGrade(grade);
  const pools = Array.isArray(poolWeights) ? poolWeights : [];
  const dungeonTotal = pools.filter(({ id }) => id !== DELVER_POOL_ID).reduce((sum, { weight }) => sum + weight, 0);
  const delverTotal = pools.filter(({ id }) => id === DELVER_POOL_ID).reduce((sum, { weight }) => sum + weight, 0);
  if (dungeonTotal <= 0 || delverTotal <= 0) return pools.map((pool) => ({ ...pool }));
  return pools.map((pool) => ({ ...pool, weight: pool.id === DELVER_POOL_ID
    ? (pool.weight / delverTotal) * (delverPercent / 100)
    : (pool.weight / dungeonTotal) * (dungeonPercent / 100) }));
}

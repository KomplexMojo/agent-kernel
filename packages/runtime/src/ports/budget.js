import { resolveBudgetCategoryId } from "../contracts/budget-categories.js";

export function applyBudgetCaps(core, simConfig) {
  const caps = simConfig?.constraints?.categoryCaps?.caps;
  if (!caps || !core?.setBudget) {
    return [];
  }

  const applied = [];
  for (const [category, cap] of Object.entries(caps)) {
    const categoryId = resolveBudgetCategoryId(category);
    if (categoryId === null) {
      continue;
    }
    const numericCap = Number(cap);
    if (!Number.isFinite(numericCap)) {
      continue;
    }
    core.setBudget(categoryId, numericCap);
    applied.push({ category, categoryId, cap: numericCap });
  }

  return applied;
}

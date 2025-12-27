export const BUDGET_CATEGORY_IDS = Object.freeze({
  movement: 0,
  cognition: 1,
  structure: 2,
  effects: 3,
  solver: 4,
  custom: 5,
});

export function resolveBudgetCategoryId(name) {
  if (typeof name === "number" && Number.isFinite(name)) {
    return name;
  }
  if (typeof name !== "string") {
    return null;
  }
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  return BUDGET_CATEGORY_IDS[normalized] ?? null;
}

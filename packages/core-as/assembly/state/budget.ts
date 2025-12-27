const MAX_BUDGET_CATEGORIES: i32 = 8;
const UNLIMITED_CAP: i32 = -1;

let caps = new StaticArray<i32>(MAX_BUDGET_CATEGORIES);
let spent = new StaticArray<i32>(MAX_BUDGET_CATEGORIES);

export function resetBudgets(): void {
  for (let i = 0; i < MAX_BUDGET_CATEGORIES; i += 1) {
    caps[i] = UNLIMITED_CAP;
    spent[i] = 0;
  }
}

export function setBudgetCap(category: i32, cap: i32): void {
  if (category < 0 || category >= MAX_BUDGET_CATEGORIES) {
    return;
  }
  caps[category] = cap;
}

export function getBudgetCap(category: i32): i32 {
  if (category < 0 || category >= MAX_BUDGET_CATEGORIES) {
    return UNLIMITED_CAP;
  }
  return unchecked(caps[category]);
}

export function getBudgetSpent(category: i32): i32 {
  if (category < 0 || category >= MAX_BUDGET_CATEGORIES) {
    return 0;
  }
  return unchecked(spent[category]);
}

export function chargeBudget(category: i32, amount: i32): i32 {
  if (category < 0 || category >= MAX_BUDGET_CATEGORIES) {
    return -1;
  }
  if (amount <= 0) {
    return unchecked(spent[category]);
  }
  const nextSpent = unchecked(spent[category]) + amount;
  spent[category] = nextSpent;
  return nextSpent;
}

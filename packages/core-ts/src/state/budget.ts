const MAX_BUDGET_CATEGORIES = 8;
const UNLIMITED_CAP = -1;

export function createBudgetState() {
  const caps = new Int32Array(MAX_BUDGET_CATEGORIES);
  const spent = new Int32Array(MAX_BUDGET_CATEGORIES);

  function resetBudgets(): void {
    for (let i = 0; i < MAX_BUDGET_CATEGORIES; i += 1) {
      caps[i] = UNLIMITED_CAP;
      spent[i] = 0;
    }
  }

  function setBudgetCap(category: number, cap: number): void {
    if (category < 0 || category >= MAX_BUDGET_CATEGORIES) {
      return;
    }
    caps[category] = cap;
  }

  function getBudgetCap(category: number): number {
    if (category < 0 || category >= MAX_BUDGET_CATEGORIES) {
      return UNLIMITED_CAP;
    }
    return caps[category];
  }

  function getBudgetSpent(category: number): number {
    if (category < 0 || category >= MAX_BUDGET_CATEGORIES) {
      return 0;
    }
    return spent[category];
  }

  function chargeBudget(category: number, amount: number): number {
    if (category < 0 || category >= MAX_BUDGET_CATEGORIES) {
      return -1;
    }
    if (amount <= 0) {
      return spent[category];
    }
    const nextSpent = spent[category] + amount;
    spent[category] = nextSpent;
    return nextSpent;
  }

  return {
    resetBudgets,
    setBudgetCap,
    getBudgetCap,
    getBudgetSpent,
    chargeBudget,
  };
}

export const BudgetConstants = {
  MAX_BUDGET_CATEGORIES,
  UNLIMITED_CAP,
} as const;

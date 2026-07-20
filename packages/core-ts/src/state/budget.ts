const MAX_BUDGET_CATEGORIES = 8;
const UNLIMITED_CAP = -1;

/**
 * Canonical budget category codebook. **Core owns these ids** (maintainer
 * decision 2026-07-20); runtime maps human-facing names onto them and must
 * never invent its own numbering.
 *
 * `Default` is every action that is not an external request — moves, logs,
 * telemetry, counters. It is deliberately NOT called "movement": core charges
 * far more than movement to it.
 */
export const BudgetCategory = {
  Default: 0,
  Effects: 1,
} as const;

const MAX_ACTION_KINDS = 16;
/**
 * Unit cost charged for an action whose price nobody injected. Counting one
 * action as one unit is enforcement mechanics, not pricing — any premium
 * (e.g. a solver request costing more than a log) is Allocator policy and
 * must be injected via setActionCost.
 */
const DEFAULT_ACTION_COST = 1;

export function createBudgetState() {
  const caps = new Int32Array(MAX_BUDGET_CATEGORIES);
  const spent = new Int32Array(MAX_BUDGET_CATEGORIES);
  const actionCosts = new Int32Array(MAX_ACTION_KINDS).fill(DEFAULT_ACTION_COST);

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

  /**
   * Per-action-kind cost. Deliberately NOT cleared by resetBudgets: caps and
   * spend are per-run accumulator state, but costs are injected policy and
   * core.init() calls resetBudgets after the runtime has injected them.
   */
  function setActionCost(kind: number, cost: number): number {
    if (kind < 0 || kind >= MAX_ACTION_KINDS) {
      return 0;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      return 0;
    }
    actionCosts[kind] = cost;
    return 1;
  }

  function getActionCost(kind: number): number {
    if (kind < 0 || kind >= MAX_ACTION_KINDS) {
      return DEFAULT_ACTION_COST;
    }
    return actionCosts[kind];
  }

  return {
    resetBudgets,
    setBudgetCap,
    getBudgetCap,
    getBudgetSpent,
    chargeBudget,
    setActionCost,
    getActionCost,
  };
}

export const BudgetConstants = {
  MAX_BUDGET_CATEGORIES,
  UNLIMITED_CAP,
} as const;

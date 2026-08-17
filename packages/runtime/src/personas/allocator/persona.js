export * from "./controller.js";

// Z.2 — the Allocator poses `allocator_budget_fit`. Published here because the
// budget maximizer is reached through this barrel, and because pricing stays
// with the Allocator: the solver searches over prices it supplies.
export {
  buildBudgetFitProblem,
  resolveSelectionFromConstraintResult,
} from "./constraint-problems.js";

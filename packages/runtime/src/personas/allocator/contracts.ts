// Local contracts for the Allocator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type AllocatorState = "idle" | "budgeting" | "allocating" | "monitoring" | "rebalancing";

export interface PriceListInput {
  /** Reference to an externally sourced price list artifact. */
  priceListRef: {
    id: string;
    schema: string;
    schemaVersion: number;
  };
}

export interface SpendProposalItem {
  id: string;
  kind: string;
  quantity?: number;
}

export interface SpendProposal {
  items: SpendProposalItem[];
}

export interface AllocatorContext {
  state: AllocatorState;
  priceList?: PriceListInput;
  lastEvent: string | null;
  updatedAt: string;
  lastBudgetCount: number;
  lastSignalCount: number;
  budgetRemaining?: number;
  lastSolverRequest?: unknown;
}

export interface AllocatorView {
  state: AllocatorState;
  context: AllocatorContext;
}

export interface AllocatorAdvanceParams {
  phase?: string;
  event?: string;
  payload?: Record<string, unknown>;
  tick?: number;
}

export interface AllocatorAdvanceResult extends AllocatorView {
  tick?: number;
  actions: unknown[];
  effects: unknown[];
  telemetry: unknown;
}

// ── Service surface (P1.1) — the single entry point for pricing and spend ──
// Charter: "Economy — Allocator Authority". State-gated: registerBudget
// (idle→budgeting) before validateSpend (→allocating). The tick loop then
// drives allocating→monitoring with the "monitor" event. Pricing is read-only
// policy, available in any state.

export interface PriceListItem {
  id: string;
  kind: string;
  unitCost: number;
  formula?: "linear" | "quadratic";
  description?: string;
}

export interface MotivationQuote {
  cost: number;
  lineItems: Array<{
    category: "motivation";
    id: string;
    motivationKind: string;
    family: string | null;
    label: string;
    quantity: number;
    unitCostTokens: number;
    spendTokens: number;
  }>;
}

export interface AllocatorPricingSurface {
  priceList(): unknown;
  priceMap(): Map<string, PriceListItem>;
  unitCosts(): Map<string, number>;
  quoteMotivations(motivations: Array<{ kind: string; intensity?: number }>): MotivationQuote;
}

export interface SpendValidationResult {
  receipt: {
    schema: "agent-kernel/BudgetReceiptArtifact";
    schemaVersion: 1;
    status: "approved" | "partial" | "denied";
    totalCost: number;
    remaining: number;
    lineItems: unknown[];
    [key: string]: unknown;
  };
  errors?: string[];
}

/** Thrown (code "allocator_state") when a spend operation is attempted in a state that does not permit it. */
export interface AllocatorStateErrorShape extends Error {
  code: "allocator_state";
}

export interface AllocatorServiceSurface {
  pricing: AllocatorPricingSurface;
  registerBudget(budget: unknown): { state: AllocatorState };
  validateSpend(args: {
    proposal: SpendProposal;
    allocation?: unknown;
    meta?: unknown;
    budgetRef?: unknown;
    priceListRef?: unknown;
    proposalRef?: unknown;
  }): SpendValidationResult;
  evaluateLayoutSpend(args: Record<string, unknown>): unknown;
  evaluateRoomCardLayoutSpend(args: Record<string, unknown>): unknown;
  scenarioSpendReport(args: Record<string, unknown>): unknown;
}

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

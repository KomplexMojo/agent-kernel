import {
  BUDGET_RECEIPT_ARTIFACT_SCHEMA,
  type ArtifactMeta,
  type RuntimeBudgetReceiptArtifact,
} from "../../contracts/artifacts.ts";

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

// ── Reconciliation (P5.5) — what REBALANCING gates ────────────────────────────
// Charter: the Allocator owns "reconciliation". The ledger is the issued caps
// beside the spend core actually charged; the verdict is this persona's.

export type ReconciliationDisposition = "unlimited" | "within" | "at_limit" | "exceeded";

export interface BudgetLedgerRow {
  category: string;
  categoryId?: number;
  /** The cap as issued to core. -1 is core's "no cap set" sentinel. */
  issued: number;
  /** What core has charged against that category. */
  spent: number;
}

export interface BudgetLedger {
  categories: BudgetLedgerRow[];
}

export interface ReconciliationCategory extends BudgetLedgerRow {
  /** null when the category is uncapped — there is no headroom to report. */
  remaining: number | null;
  disposition: ReconciliationDisposition;
}

export interface ReconciliationAdjustment {
  kind: "reduce_scope" | "hold";
  category: string | null;
  /** Present only on reduce_scope. */
  overspend?: number;
}

export interface ReconciliationVerdict {
  /** The WORST category's disposition, not an average. */
  disposition: ReconciliationDisposition;
  categories: ReconciliationCategory[];
  adjustments: ReconciliationAdjustment[];
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
  /**
   * Absent until a reconciliation happens — deliberately not `null`, because a
   * replayed view carrying `reconciliation: null` reads as "reconciled, found
   * nothing", which is a claim this persona has not made.
   */
  reconciliation?: ReconciliationVerdict;
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

export interface RuntimeActionCosts {
  unit: "runtimeBudgetUnits";
  source: "allocator_runtime_action_price_v1";
  default: number;
  wait: number;
  attack: number;
  castAffinity: number;
  requestSolver: number;
  move: number;
}

/** Unit-free runtime application fact supplied by runtime to the Allocator. */
export interface RuntimeBudgetOutcome {
  actorId?: string | null;
  tick: number;
  actionKind: string;
  outcome: "accepted" | "rejected";
  reason?: string;
}

export interface AllocatorPricingSurface {
  priceList(): unknown;
  priceMap(): Map<string, PriceListItem>;
  unitCosts(): Map<string, number>;
  quoteMotivations(motivations: Array<{ kind: string; intensity?: number }>): MotivationQuote;
  runtimeActionCosts(): RuntimeActionCosts;
}

export interface SpendValidationResult {
  receipt: {
    schema: typeof BUDGET_RECEIPT_ARTIFACT_SCHEMA;
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
  issueRuntimeBudgetReceipt(args: {
    outcomes: RuntimeBudgetOutcome[];
    meta: ArtifactMeta;
  }): RuntimeBudgetReceiptArtifact;
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
  /**
   * P5.5. State-gated to monitoring|rebalancing, unlike the pricing surface: a
   * reconciliation cannot exist before the Allocator is watching a run, the same
   * way a receipt cannot exist without a registered budget. Throws
   * `allocator_reconciliation_input_required` when handed no ledger.
   */
  reconcile(args: { ledger?: BudgetLedger }): ReconciliationVerdict;
}

// Local contracts for the Allocator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type AllocatorState = "idle";

export interface PriceListInput {
  /** Reference to an externally sourced price list artifact. */
  priceListRef: {
    id: string;
    schema: string;
    schemaVersion: number;
  };
}

export interface AllocatorContext {
  state: AllocatorState;
  priceList?: PriceListInput;
}

export interface SpendProposalItem {
  id: string;
  kind: string;
  quantity?: number;
}

export interface SpendProposal {
  items: SpendProposalItem[];
}

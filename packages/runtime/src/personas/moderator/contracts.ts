// Local contracts for the Moderator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type ModeratorState = "initializing" | "ticking" | "pausing" | "stopping";

export interface ModeratorOrderedProposal {
  actorId: string;
  candidateId?: string;
  actionKind: string;
  priority?: number;
  batchId?: string;
  params?: Record<string, unknown>;
}

export interface ModeratorOrderingFrame {
  tick: number;
  strategy: "deterministic_sort" | "deterministic_batch";
  proposals: ModeratorOrderedProposal[];
}

export interface ModeratorAuthorityBoundary {
  actorDecides: "proposal_generation_from_sensed_context";
  moderatorOrders: "deterministic_sequence_or_batch";
  coreDecides: "authoritative_legality_and_resolved_interaction_outcomes";
}

export interface ModeratorContext {
  state: ModeratorState;
  lastEvent: string | null;
  updatedAt: string;
  lastSolverRequest?: unknown;
  lastOrderingFrame?: ModeratorOrderingFrame | null;
}

export interface ModeratorView {
  state: ModeratorState;
  context: ModeratorContext;
}

export interface ModeratorAdvanceParams {
  phase?: string;
  event?: string;
  payload?: Record<string, unknown> & {
    tick?: number;
    proposals?: ModeratorOrderedProposal[];
    orderingFrame?: ModeratorOrderingFrame;
  };
  tick?: number;
}

export interface ModeratorAdvanceResult extends ModeratorView {
  tick?: number;
  actions: unknown[];
  effects: unknown[];
  telemetry: unknown;
}

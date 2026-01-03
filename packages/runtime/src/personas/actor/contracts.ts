// Local contracts for the Actor persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type ActorState = "idle" | "observing" | "deciding" | "proposing" | "cooldown";

export interface ActorContext {
  state: ActorState;
  lastEvent: string | null;
  updatedAt: string;
  lastProposalCount: number;
  budgetRemaining?: number;
}

export interface ActorView {
  state: ActorState;
  context: ActorContext;
}

export interface ActorAdvanceParams {
  phase?: string;
  event?: string;
  payload?: Record<string, unknown>;
  tick?: number;
}

export interface ActorAdvanceResult extends ActorView {
  tick?: number;
  actions: unknown[];
  effects: unknown[];
  telemetry: unknown;
}

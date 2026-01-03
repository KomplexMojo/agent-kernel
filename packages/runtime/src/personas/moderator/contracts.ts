// Local contracts for the Moderator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type ModeratorState = "initializing" | "ticking" | "pausing" | "stopping";

export interface ModeratorContext {
  state: ModeratorState;
  lastEvent: string | null;
  updatedAt: string;
  lastSolverRequest?: unknown;
}

export interface ModeratorView {
  state: ModeratorState;
  context: ModeratorContext;
}

export interface ModeratorAdvanceParams {
  phase?: string;
  event?: string;
  payload?: Record<string, unknown>;
  tick?: number;
}

export interface ModeratorAdvanceResult extends ModeratorView {
  tick?: number;
  actions: unknown[];
  effects: unknown[];
  telemetry: unknown;
}

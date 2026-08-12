// Local contracts for the Director persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type DirectorState = "uninitialized" | "intake" | "draft_plan" | "refine" | "ready" | "stale";

export interface DirectorContext {
  state: DirectorState;
  intentRef: string | null;
  planRef: string | null;
  lastEvent: string | null;
  updatedAt: string;
  lastSolverRequest?: unknown;
}

export interface DirectorView {
  state: DirectorState;
  context: DirectorContext;
}

export interface DirectorAdvanceParams {
  phase?: string;
  event?: string;
  payload?: Record<string, unknown>;
  tick?: number;
}

export interface DirectorAdvanceResult extends DirectorView {
  tick?: number;
  actions: unknown[];
  effects: unknown[];
  telemetry: unknown;
}

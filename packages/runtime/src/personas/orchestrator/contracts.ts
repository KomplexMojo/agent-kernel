// Local contracts for the Orchestrator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type OrchestratorState = "idle" | "planning" | "running" | "replaying" | "completed" | "errored";

export interface OrchestratorContext {
  state: OrchestratorState;
  planRef: string | null;
  lastEvent: string | null;
  updatedAt: string;
  lastSolverRequest?: unknown;
}

export interface OrchestratorView {
  state: OrchestratorState;
  context: OrchestratorContext;
}

export interface OrchestratorAdvanceParams {
  phase?: string;
  event?: string;
  payload?: Record<string, unknown>;
  tick?: number;
}

export interface OrchestratorAdvanceResult extends OrchestratorView {
  tick?: number;
  actions: unknown[];
  effects: unknown[];
  telemetry: unknown;
}

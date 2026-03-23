// Local contracts for the Director persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

import type { SolverRequestV1 } from "../../contracts/artifacts.js";

export type DirectorState = "uninitialized" | "intake" | "draft_plan" | "refine" | "ready" | "stale";

export interface DirectorContext {
  state: DirectorState;
  intentRef: string | null;
  planRef: string | null;
  lastEvent: string | null;
  updatedAt: string;
  lastSolverRequest?: SolverRequestV1 | null;
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

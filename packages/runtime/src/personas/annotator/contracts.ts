// Local contracts for the Annotator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type AnnotatorState = "idle" | "recording" | "summarizing";

export interface AnnotatorContext {
  state: AnnotatorState;
  lastEvent: string | null;
  updatedAt: string;
  lastObservationCount: number;
}

export interface AnnotatorView {
  state: AnnotatorState;
  context: AnnotatorContext;
}

export interface AnnotatorAdvanceParams {
  phase?: string;
  event?: string;
  payload?: Record<string, unknown>;
  tick?: number;
}

export interface AnnotatorAdvanceResult extends AnnotatorView {
  tick?: number;
  actions: unknown[];
  effects: unknown[];
  telemetry: unknown;
}

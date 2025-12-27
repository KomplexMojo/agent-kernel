// Local contracts for the Annotator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type AnnotatorState = "idle";

export interface AnnotatorContext {
  state: AnnotatorState;
}

// Local contracts for the Director persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type DirectorState = "idle";

export interface DirectorContext {
  state: DirectorState;
}

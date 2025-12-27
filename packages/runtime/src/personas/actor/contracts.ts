// Local contracts for the Actor persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type ActorState = "idle";

export interface ActorContext {
  state: ActorState;
}

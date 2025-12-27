// Local contracts for the Moderator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type ModeratorState = "idle";

export interface ModeratorContext {
  state: ModeratorState;
}

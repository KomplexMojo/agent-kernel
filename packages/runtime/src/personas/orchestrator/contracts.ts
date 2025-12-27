// Local contracts for the Orchestrator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type OrchestratorState = "idle";

export interface OrchestratorContext {
  state: OrchestratorState;
}

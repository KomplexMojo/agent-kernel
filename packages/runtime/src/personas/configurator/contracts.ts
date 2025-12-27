// Local contracts for the Configurator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type ConfiguratorState = "idle";

export interface ConfiguratorContext {
  state: ConfiguratorState;
}

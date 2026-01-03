// Local contracts for the Configurator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type ConfiguratorState = "uninitialized" | "pending_config" | "configured" | "locked";

export interface ConfiguratorContext {
  state: ConfiguratorState;
  lastEvent: string | null;
  updatedAt: string;
  lastConfigRef: string | null;
}

export type LevelGenProfile = "rectangular" | "sparse_islands" | "clustered_islands";

export interface LevelGenShapeInput {
  profile: LevelGenProfile;
  density?: number;
  clusterSize?: number;
}

export interface LevelGenConstraintInput {
  edgeBias?: boolean;
  minDistance?: number;
}

export interface LevelGenConnectivityInput {
  requirePath?: boolean;
}

export type TrapAffinityKind = "fire" | "water" | "earth" | "wind" | "life" | "decay" | "corrode" | "dark";
export type TrapAffinityExpression = "push" | "pull" | "emit";

export interface LevelGenTrapAffinityInput {
  kind: TrapAffinityKind;
  expression?: TrapAffinityExpression;
  stacks?: number;
}

export interface LevelGenTrapVitalInput {
  current: number;
  max: number;
  regen: number;
}

export interface LevelGenTrapVitalsInput {
  mana?: LevelGenTrapVitalInput;
  durability?: LevelGenTrapVitalInput;
}

export interface LevelGenTrapInput {
  x: number;
  y: number;
  blocking?: boolean;
  affinity: LevelGenTrapAffinityInput;
  vitals?: LevelGenTrapVitalsInput;
}

export interface NormalizedLevelGenTrapAffinityInput {
  kind: TrapAffinityKind;
  expression: TrapAffinityExpression;
  stacks: number;
}

export interface NormalizedLevelGenTrapInput {
  x: number;
  y: number;
  blocking: boolean;
  affinity: NormalizedLevelGenTrapAffinityInput;
  vitals?: LevelGenTrapVitalsInput;
}

export interface LevelGenInput {
  width: number;
  height: number;
  seed?: number;
  theme?: string;
  shape?: LevelGenShapeInput;
  spawn?: LevelGenConstraintInput;
  exit?: LevelGenConstraintInput;
  connectivity?: LevelGenConnectivityInput;
  traps?: LevelGenTrapInput[];
}

export interface NormalizedLevelGenInput {
  width: number;
  height: number;
  seed?: number;
  theme?: string;
  shape: LevelGenShapeInput;
  spawn: Required<LevelGenConstraintInput>;
  exit: Required<LevelGenConstraintInput>;
  connectivity: Required<LevelGenConnectivityInput>;
  traps: NormalizedLevelGenTrapInput[];
}

export interface ConfiguratorInputs {
  levelGen: LevelGenInput;
}

export interface NormalizedConfiguratorInputs {
  levelGen: NormalizedLevelGenInput;
}

export interface ConfiguratorView {
  state: ConfiguratorState;
  context: ConfiguratorContext;
}

export interface ConfiguratorAdvanceParams {
  phase?: string;
  event?: string;
  payload?: Record<string, unknown>;
  tick?: number;
}

export interface ConfiguratorAdvanceResult extends ConfiguratorView {
  tick?: number;
  actions: unknown[];
  effects: unknown[];
  telemetry: unknown;
}

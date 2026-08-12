// Local contracts for the Configurator persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type ConfiguratorState = "uninitialized" | "pending_config" | "configured" | "locked";

export interface ConfiguratorContext {
  state: ConfiguratorState;
  lastEvent: string | null;
  updatedAt: string;
  lastConfigRef: string | null;
}

export interface LevelGenShapeInput {
  roomCount?: number;
  roomMinSize?: number;
  roomMaxSize?: number;
  corridorWidth?: number;
  pattern?: "none" | "grid" | "diagonal_grid" | "concentric_circles";
  patternSpacing?: number;
  patternLineWidth?: number;
  patternGapEvery?: number;
  patternInset?: number;
  patternInfillPercent?: number;
}

export interface LevelGenConstraintInput {
  edgeBias?: boolean;
  minDistance?: number;
}

export interface LevelGenConnectivityInput {
  requirePath?: boolean;
}

export type HazardAffinityKind = "fire" | "water" | "earth" | "wind" | "life" | "decay" | "corrode" | "fortify" | "light" | "dark";
export type HazardAffinityExpression = "push" | "pull" | "emit" | "draw";
export type HazardAffinityTargetType = "self" | "ally" | "enemy" | "area" | "barrier" | "floor";

export interface LevelGenHazardAffinityInput {
  kind: HazardAffinityKind;
  expression?: HazardAffinityExpression;
  stacks?: number;
  targetType?: HazardAffinityTargetType;
}

export interface LevelGenHazardVitalInput {
  current: number;
  max: number;
  regen: number;
}

export interface LevelGenHazardVitalsInput {
  mana?: LevelGenHazardVitalInput;
  durability?: LevelGenHazardVitalInput;
}

export interface LevelGenHazardInput {
  x: number;
  y: number;
  blocking?: boolean;
  affinity: LevelGenHazardAffinityInput;
  vitals?: LevelGenHazardVitalsInput;
}

export interface NormalizedLevelGenHazardAffinityInput {
  kind: HazardAffinityKind;
  expression: HazardAffinityExpression;
  stacks: number;
  targetType: HazardAffinityTargetType;
}

export interface NormalizedLevelGenHazardInput {
  x: number;
  y: number;
  blocking: boolean;
  affinity: NormalizedLevelGenHazardAffinityInput;
  vitals?: LevelGenHazardVitalsInput;
}

export interface LevelGenInput {
  width: number;
  height: number;
  walkableTilesTarget?: number;
  seed?: number;
  theme?: string;
  shape?: LevelGenShapeInput;
  spawn?: LevelGenConstraintInput;
  exit?: LevelGenConstraintInput;
  connectivity?: LevelGenConnectivityInput;
  hazards?: LevelGenHazardInput[];
}

export interface NormalizedLevelGenInput {
  width: number;
  height: number;
  walkableTilesTarget?: number;
  seed?: number;
  theme?: string;
  shape: LevelGenShapeInput;
  spawn: Required<LevelGenConstraintInput>;
  exit: Required<LevelGenConstraintInput>;
  connectivity: Required<LevelGenConnectivityInput>;
  hazards: NormalizedLevelGenHazardInput[];
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

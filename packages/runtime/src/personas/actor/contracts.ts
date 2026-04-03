// Local contracts for the Actor persona state machine.
// Cross-persona artifacts live in packages/runtime/src/contracts/artifacts.ts.

export type ActorState = "idle" | "observing" | "deciding" | "proposing" | "cooldown";

export interface ActorSensedPosition {
  x: number;
  y: number;
}

export interface ActorSensedVital {
  current: number;
  max: number;
  regen: number;
}

export interface ActorSensedAffinityState {
  kind: string;
  expression: string;
  stacks: number;
  targetType?: string;
}

export interface ActorSensedEntity {
  id: string;
  kind?: string | number;
  role?: string;
  position?: ActorSensedPosition;
  vitals?: {
    health?: ActorSensedVital;
    mana?: ActorSensedVital;
    stamina?: ActorSensedVital;
    durability?: ActorSensedVital;
  };
  affinities?: ActorSensedAffinityState[];
}

export interface ActorSensedHazard {
  id: string;
  kind: string;
  position: ActorSensedPosition;
  affinity?: string;
  expression?: string;
  stacks?: number;
}

export interface ActorScopedSensedContext {
  actorId: string;
  tick: number;
  actor?: ActorSensedEntity;
  visibleActors?: ActorSensedEntity[];
  tileActors?: ActorSensedEntity[];
  hazards?: ActorSensedHazard[];
  tiles?: {
    width?: number;
    height?: number;
    kinds?: number[][];
    baseTiles?: string[];
  };
  exit?: ActorSensedPosition;
}

export interface ActorAffinityActionProposal {
  candidateId?: string;
  kind: string;
  params?: Record<string, unknown>;
  affinity?: {
    kind?: string;
    expression?: string;
    stacks?: number;
    targetType?: string;
  };
  costKind?: string;
  costId?: string;
}

export interface ActorProposalEnvelope {
  actorId: string;
  tick: number;
  sensed: ActorScopedSensedContext;
  proposals: ActorAffinityActionProposal[];
}

export interface ActorAuthorityBoundary {
  actorDecides: "sensed_observation_and_proposals";
  moderatorOrders: "proposal_ordering_and_batching";
  coreDecides: "legality_and_outcome_resolution";
}

export interface ActorContext {
  state: ActorState;
  lastEvent: string | null;
  updatedAt: string;
  lastProposalCount: number;
  budgetRemaining?: number;
  lastSensedContext?: ActorScopedSensedContext | null;
  lastProposalEnvelope?: ActorProposalEnvelope | null;
}

export interface ActorView {
  state: ActorState;
  context: ActorContext;
}

export interface ActorAdvanceParams {
  phase?: string;
  event?: string;
  payload?: Record<string, unknown> & {
    actorId?: string;
    observation?: Record<string, unknown>;
    observations?: Record<string, unknown>[];
    proposals?: ActorAffinityActionProposal[];
    hazards?: ActorSensedHazard[];
  };
  tick?: number;
}

export interface ActorAdvanceResult extends ActorView {
  tick?: number;
  actions: unknown[];
  effects: unknown[];
  telemetry: unknown;
}

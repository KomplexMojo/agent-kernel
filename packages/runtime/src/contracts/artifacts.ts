/**
 * Runtime Contracts: Canonical Artifacts
 * -------------------------------------
 * This module defines the stable, versioned artifacts used to hand off work between
 * personas (Orchestrator, Director, Configurator, Allocator, Actor, Moderator, Annotator) and
 * the simulation core (`core-as` via bindings).
 *
 * Design goals:
 * - Explicit, serializable artifacts (easy to log, replay, compare).
 * - Versioned schemas with discriminated unions.
 * - Minimal fields that can evolve without breaking determinism.
 *
 * IMPORTANT:
 * - These types describe *data*, not behavior.
 * - `core-as` consumes configuration/state/action inputs and emits events/effects/snapshots.
 * - Personas operate in `runtime` and communicate using these artifacts.
 */

// -------------------------
// Shared traceability types
// -------------------------

/** ISO-8601 timestamp in UTC (e.g. 2025-12-26T03:14:15.000Z). */
export type IsoUtcTimestamp = string;

/**
 * Minimal metadata carried by all top-level artifacts.
 * `id` should be globally unique within a run; `runId` ties artifacts to a simulation run.
 */
export interface ArtifactMeta {
  /** Unique identifier for this artifact (UUID/ULID/etc.). */
  id: string;
  /** Identifier for the run this artifact belongs to (UUID/ULID/etc.). */
  runId: string;
  /** Creation timestamp (UTC). */
  createdAt: IsoUtcTimestamp;

  /** Originating persona/module (e.g., "orchestrator", "director", "allocator"). */
  producedBy: string;

  /** Optional correlation id for external systems (e.g., request id). */
  correlationId?: string;

  /** Optional human/AI readable note for debugging. */
  note?: string;
}

/** A stable reference to another artifact. */
export interface ArtifactRef {
  id: string;
  schema: string;
  schemaVersion: number;
}

export type Phase = "intake" | "plan" | "allocate" | "configure" | "execute" | "annotate" | "publish";

// -------------------------
// Orchestrator → Director
// -------------------------

export const INTENT_ENVELOPE_SCHEMA = "agent-kernel/IntentEnvelope";

/**
 * Normalized request envelope created at the boundary (UI/CLI/API/automation).
 * This is a runtime artifact only; `core-as` never consumes it directly.
 */
export interface IntentEnvelopeV1 {
  schema: typeof INTENT_ENVELOPE_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Where this request came from (e.g., "ui-web", "cli", "api", "automation"). */
  source: string;

  /**
   * High-level intent payload. Keep this intentionally loose.
   * Director is responsible for structuring this into a PlanArtifact.
   */
  intent: {
    /** Freeform goal description or command string. */
    goal: string;
    /** Optional tags that may influence planning (theme, difficulty, etc.). */
    tags?: string[];
    /** Optional structured hints (kept minimal and permissive). */
    hints?: Record<string, unknown>;
  };

  /** Optional external context captured as immutable inputs (never fetched during replay). */
  context?: {
    /** Any files, prompts, or external blobs captured at intake time. */
    capturedInputs?: Array<{ name: string; contentType?: string; dataRef?: ArtifactRef }>;
  };
}

export type IntentEnvelope = IntentEnvelopeV1;

// -------------------------
// Director → Configurator
// -------------------------

export const PLAN_ARTIFACT_SCHEMA = "agent-kernel/PlanArtifact";

/**
 * Structured plan produced by Director. This is still *not* executable configuration.
 * Configurator transforms this into SimConfigArtifact + InitialStateArtifact.
 */
export interface PlanArtifactV1 {
  schema: typeof PLAN_ARTIFACT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Reference to the originating intent. */
  intentRef: ArtifactRef;

  /**
   * What should be attempted (goals, priorities, constraints at the plan level).
   * Avoid layout specifics here.
   */
  plan: {
    objectives: Array<{
      id: string;
      description: string;
      priority: number; // lower = higher priority
    }>;

    /** Thematic guidance (optional, non-binding). */
    theme?: {
      name?: string;
      tags?: string[];
    };

    /** High-level constraints to be respected downstream (non-physics). */
    constraints?: Record<string, unknown>;
  };

  /**
   * Optional plan-to-persona directives (still not implementation details).
   * Examples: "prefer exploration", "keep actor count low", etc.
   */
  directives?: Record<string, unknown>;
}

export type PlanArtifact = PlanArtifactV1;

// -------------------------
// Budgeting (Director/Configurator/Actor → Allocator)
// -------------------------

export const BUDGET_REQUEST_SCHEMA = "agent-kernel/BudgetRequest";
export const BUDGET_RECEIPT_SCHEMA = "agent-kernel/BudgetReceipt";
export const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";

export interface BudgetCategoryCaps {
  /**
   * Category caps (e.g., "movement", "cognition", "structure", "effects").
   * Canonical location for caps is SimConfigArtifactV1.constraints.categoryCaps.
   */
  caps: Record<string, number>;
}

/**
 * Request for budget evaluation. The Allocator returns a receipt describing
 * caps/limits that downstream systems must respect.
 */
export interface BudgetRequestV1 {
  schema: typeof BUDGET_REQUEST_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** The plan being evaluated (if applicable). */
  planRef?: ArtifactRef;

  /**
   * Proposed complexity inputs. Keep numeric where possible so evaluation is deterministic.
   * Examples: actorCount, layoutComplexity, maxMotivationsPerActor, solverDepth.
   */
  proposal: Record<string, number>;

  /** Optional requested caps (Allocator may accept/override). */
  requestedCaps?: BudgetCategoryCaps;

  /** Optional rationale for trace/debug. */
  rationale?: string;
}

export interface BudgetReceiptV1 {
  schema: typeof BUDGET_RECEIPT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Reference to the request being answered. */
  requestRef: ArtifactRef;

  /** Decision outcome. */
  decision: "approved" | "rejected" | "approved_with_constraints";

  /** Effective caps/limits to be enforced downstream (policy-free enforcement happens in `core-as`). */
  effectiveCaps: BudgetCategoryCaps;

  /**
   * Additional hard constraints/limits (counts, sizes, horizons) expressed as numbers.
   * Configurator should embed these into executable configuration.
   */
  limits?: Record<string, number>;

  /** Diagnostics for rejection or constrained approvals. */
  diagnostics?: {
    reasons: string[];
    suggestions?: Array<{
      key: string;
      /** Suggested new value for the proposal key. */
      value: number;
      note?: string;
    }>;
  };
}

export type BudgetRequest = BudgetRequestV1;
export type BudgetReceipt = BudgetReceiptV1;

// -------------------------
// Price list (Orchestrator → Allocator)
// -------------------------

export interface PriceListItemV1 {
  key: string;
  /** Cost in tokens for one unit of the item. */
  unitCost: number;
  /** Optional unit label (e.g., "hp", "tick", "actor"). */
  unit?: string;
  /** Optional description for clarity/audit. */
  description?: string;
}

export interface PriceListArtifactV1 {
  schema: typeof PRICE_LIST_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Source reference (e.g., IPFS CID) captured for replay. */
  sourceRef?: string;

  /** Price list entries keyed by stable identifiers. */
  items: PriceListItemV1[];
}

export type PriceListArtifact = PriceListArtifactV1;

// -------------------------
// Configurator → core-as inputs (via bindings)
// -------------------------

export const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
export const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";

export const EXECUTION_POLICY_SCHEMA = "agent-kernel/ExecutionPolicy";

export interface ExecutionPolicyV1 {
  schema: typeof EXECUTION_POLICY_SCHEMA;
  schemaVersion: 1;

  /**
   * Ordering strategy used by the Moderator.
   * - round_robin: iterate actors in a stable order
   * - priority: use explicit priority numbers (lower = higher priority)
   * - random_seeded: deterministic shuffle based on run seed and tick
   * - custom: interpreted by runtime using fully captured params
   */
  ordering: "round_robin" | "priority" | "random_seeded" | "custom";

  /**
   * Optional parameters for the strategy. Must be deterministic and fully captured.
   * Examples:
   * - actorSortKey: "id"
   * - prioritiesByActorId: { "a1": 0, "a2": 10 }
   * - batchSize: 16
   */
  params?: Record<string, unknown>;
}

/**
 * Executable simulation configuration. Immutable once execution begins.
 * This is consumed by the runtime runner and supplied to `core-as` at initialization.
 */
export interface SimConfigArtifactV1 {
  schema: typeof SIM_CONFIG_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** References that led to this config for traceability. */
  planRef: ArtifactRef;
  budgetReceiptRef?: ArtifactRef;

  /** Deterministic seed for the run. */
  seed: number;

  /**
   * Optional execution policy used by the Moderator to transform unordered action proposals
   * into an ordered execution sequence. This is pure data and must be fully captured for replay.
   */
  executionPolicy?: ExecutionPolicyV1;

  /** Feature toggles (must be deterministic and fully captured here). */
  flags?: Record<string, boolean>;

  /**
   * Static layout representation. Keep it data-only; interpretation is done by core rules.
   * Structure is intentionally flexible for now.
   */
  layout: {
    kind: "grid" | "graph" | "custom";
    data: Record<string, unknown>;
  };

  /**
   * Externally supplied caps/limits for core enforcement.
   * Typically copied from BudgetReceipt.effectiveCaps and limits.
   * These values initialize the core budget ledger before execution.
   */
  constraints?: {
    categoryCaps?: BudgetCategoryCaps;
    limits?: Record<string, number>;
  };
}

// -------------------------
// Budget enforcement reporting
// -------------------------

export interface BudgetEventDataV1 {
  category: string;
  cap: number;
  spent: number;
  available: number;
  /** Optional delta applied for this event. */
  delta?: number;
}

export interface BudgetLedgerViewV1 {
  caps: Record<string, number>;
  spent: Record<string, number>;
  available: Record<string, number>;
}

/**
 * Initial state description for a run. This is distinct from SimConfig to allow
 * scenario templating and state initialization policies to evolve independently.
 */
export interface InitialStateArtifactV1 {
  schema: typeof INITIAL_STATE_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Reference to the executable config. */
  simConfigRef: ArtifactRef;

  /**
   * Actor instantiation data. Keep it minimal and serializable.
   * `core-as` will validate legality and enforce semantics.
   */
  actors: Array<{
    id: string;
    /** "stationary" vs "ambulatory" as per Actor persona docs. */
    kind: "stationary" | "ambulatory";
    /** Optional archetype/tag for content selection. */
    archetype?: string;
    /** Starting position (shape depends on layout kind; keep generic). */
    position?: Record<string, number>;
    /** Initial stats/traits (data-only). */
    traits?: Record<string, number | boolean | string>;
  }>;
}

export type SimConfigArtifact = SimConfigArtifactV1;
export type InitialStateArtifact = InitialStateArtifactV1;

// -------------------------
// Solver artifacts (runtime adapters)
// -------------------------

export const SOLVER_REQUEST_SCHEMA = "agent-kernel/SolverRequest";
export const SOLVER_RESULT_SCHEMA = "agent-kernel/SolverResult";

export interface SolverRequestV1 {
  schema: typeof SOLVER_REQUEST_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Optional references for traceability. */
  intentRef?: ArtifactRef;
  planRef?: ArtifactRef;
  simConfigRef?: ArtifactRef;

  /**
   * Problem description to solve. Keep deterministic and fully captured here.
   * `language: "smt2"` expects a serialized SMT-LIB string.
   */
  problem: {
    language: "smt2" | "custom";
    data: string | Record<string, unknown>;
  };

  /** Optional solver configuration (captured for replay). */
  options?: {
    engine?: "z3" | "custom";
    version?: string;
    params?: Record<string, unknown>;
  };
}

export interface SolverResultV1 {
  schema: typeof SOLVER_RESULT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Reference back to the request. */
  requestRef: ArtifactRef;

  /** Solver outcome. */
  status: "sat" | "unsat" | "unknown" | "error";

  /** Optional model or solution payload. */
  model?: Record<string, unknown>;

  /** Optional diagnostics for trace/debug. */
  diagnostics?: string[];
}

export type SolverRequest = SolverRequestV1;
export type SolverResult = SolverResultV1;

// -------------------------
// Runtime ↔ core-as execution contracts
// -------------------------

export const ACTION_SCHEMA = "agent-kernel/Action";
export const OBSERVATION_SCHEMA = "agent-kernel/Observation";
export const EVENT_SCHEMA = "agent-kernel/Event";
export const EFFECT_SCHEMA = "agent-kernel/Effect";

/** Effect fulfillment category used by the Moderator to route effects deterministically. */
export type EffectFulfillment = "deterministic" | "deferred";
export const SNAPSHOT_SCHEMA = "agent-kernel/Snapshot";
export const DEBUG_DUMP_SCHEMA = "agent-kernel/DebugDump";

export const TICK_FRAME_SCHEMA = "agent-kernel/TickFrame";

export interface EffectFulfillmentRecordV1 {
  effect: EffectV1;
  status: "fulfilled" | "deferred";
  /** Deterministic outputs captured for replay. */
  result?: Record<string, unknown>;
  /** Reason for deferral or failure. */
  reason?: string;
}

/**
 * An action chosen by an Actor policy (human/script/heuristic/AI).
 * Supplied to `core-as` which decides legality and outcomes.
 *
 * Schema stability rules:
 * - Additive fields must be optional and backward compatible.
 * - Breaking changes require a schemaVersion bump.
 * - Do not embed internal memory layouts.
 */
export interface ActionV1 {
  schema: typeof ACTION_SCHEMA;
  schemaVersion: 1;

  /** Actor that is attempting the action. */
  actorId: string;

  /** A monotonic tick/step index (assigned by runner). */
  tick: number;

  /** Discriminated action kind. Extend by adding new kinds (version if breaking). */
  kind:
    | "wait"
    | "move"
    | "interact"
    | "use_item"
    | "custom";

  /**
   * Action parameters. Keep this minimal; core-as should validate and interpret.
   * Use primitive JSON values where possible for portability.
   */
  params?: Record<string, unknown>;
}

/**
 * Observation derived from simulation state for a specific actor.
 * Produced by `core-as` (or by runtime via core APIs), consumed by Actor policies.
 *
 * Schema stability rules:
 * - Additive fields must be optional and backward compatible.
 * - Breaking changes require a schemaVersion bump.
 * - Do not embed internal memory layouts.
 */
export interface ObservationV1 {
  schema: typeof OBSERVATION_SCHEMA;
  schemaVersion: 1;

  actorId: string;
  tick: number;

  /**
   * Minimal world view. Keep generic; do not leak internal core state layouts.
   * Consider versioning snapshots separately if you need richer inspector views.
   */
  view: Record<string, unknown>;
}

/**
 * Facts emitted by `core-as` after applying actions (or advancing ticks).
 * Annotator consumes these as read-only inputs.
 *
 * Schema stability rules:
 * - Additive fields must be optional and backward compatible.
 * - Breaking changes require a schemaVersion bump.
 * - Do not embed internal memory layouts.
 */
export interface EventV1 {
  schema: typeof EVENT_SCHEMA;
  schemaVersion: 1;

  tick: number;

  /** Stable event kind. */
  kind:
    | "action_applied"
    | "action_rejected"
    | "init_invalid"
    | "config_invalid"
    | "actor_moved"
    | "state_changed"
    | "limit_reached"
    | "limit_violated"
    | "custom";

  /** Entity ids relevant to the event. */
  actorId?: string;

  /**
   * Event payload (data-only).
   * For limit_reached/limit_violated, use BudgetEventDataV1.
   */
  data?: Record<string, unknown>;
}

/**
 * Effects/requests emitted by `core-as` when interaction beyond pure simulation is required.
 * These are fulfilled by runtime/adapters; core-as never performs IO.
 *
 * Schema stability rules:
 * - Additive fields must be optional and backward compatible.
 * - Breaking changes require a schemaVersion bump.
 * - Do not embed internal memory layouts.
 */
export interface EffectV1 {
  schema: typeof EFFECT_SCHEMA;
  schemaVersion: 1;

  tick: number;

  /**
   * Indicates whether this effect may be fulfilled during `phase: "execute"` by deterministic
   * providers (no IO), or must be deferred to the Orchestrator/adapters after execution.
   */
  fulfillment: EffectFulfillment;

  kind:
    | "need_random"
    | "need_external_fact"
    | "persist_required"
    | "publish_required"
    | "limit_violation"
    | "custom";

  /**
   * Effect payload (data-only).
   * For need_external_fact, include a deterministic sourceRef if fulfillment is deterministic.
   */
  data?: Record<string, unknown>;

  /**
   * Optional source reference for deterministic fulfillment (e.g., ArtifactRef or captured input id).
   * If absent for need_external_fact, fulfillment must be deferred.
   */
  sourceRef?: ArtifactRef;
}

/**
 * Optional minimal snapshot emitted for debugging/inspection/replay acceleration.
 * Keep this minimal and stable; avoid leaking internal memory layouts.
 *
 * Schema stability rules:
 * - Additive fields must be optional and backward compatible.
 * - Breaking changes require a schemaVersion bump.
 * - Do not embed internal memory layouts.
 */
export interface SnapshotV1 {
  schema: typeof SNAPSHOT_SCHEMA;
  schemaVersion: 1;

  tick: number;

  /** Reference to the config this snapshot belongs to. */
  simConfigRef?: ArtifactRef;

  /** Minimal, stable state view for inspectors (NOT the full internal state). */
  view: Record<string, unknown>;

  /** Optional budget ledger view (caps/spend/available) for inspection. */
  budgetLedger?: BudgetLedgerViewV1;
}

/**
 * Debug-only full state dump. Not stable and not guaranteed for determinism or replay.
 * Use for troubleshooting only; do not depend on this in UI or runtime logic.
 */
export interface DebugDumpV1 {
  schema: typeof DEBUG_DUMP_SCHEMA;
  schemaVersion: 1;

  tick: number;

  /** Full internal state; format is intentionally opaque and unstable. */
  state: Record<string, unknown>;

  /** Explicit warning to prevent misuse. */
  warning: "debug_only_not_for_replay";
}

/**
 * Moderator-owned execution frame for a single tick/step.
 * This makes execution sequencing and pre-core rejections explicit and replayable.
 */
export interface TickFrameV1 {
  schema: typeof TICK_FRAME_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Monotonic tick/step index (owned by Moderator). */
  tick: number;

  /** Execution phase at the time this frame was recorded. */
  phase: Phase;
  /** Optional sub-phase within the execution phase (e.g., observe/collect/apply/emit). */
  phaseDetail?: string;

  /**
   * Actions accepted for this tick in the exact order they were submitted to `core-as`.
   * These should already have `tick` set to this frame's tick.
   */
  acceptedActions: ActionV1[];

  /**
   * Actions rejected or deferred before reaching `core-as` (procedural reasons only).
   * Legality rejections belong to `core-as` and appear as events.
   */
  preCoreRejections?: Array<{
    action: ActionV1;
    reason: string;
    deferred?: boolean;
  }>;

  /**
   * Optional authoritative outputs captured for convenience.
   * These are facts emitted by `core-as` and may also be recorded elsewhere.
   */
  emittedEvents?: EventV1[];
  emittedEffects?: EffectV1[];
  fulfilledEffects?: EffectFulfillmentRecordV1[];
  emittedSnapshot?: SnapshotV1;

  /** Optional references to externally stored logs/chunks for this tick. */
  refs?: {
    eventsLog?: ArtifactRef;
    effectsLog?: ArtifactRef;
    snapshotLog?: ArtifactRef;
  };
}

export type Action = ActionV1;
export type Observation = ObservationV1;
export type Event = EventV1;
export type BudgetEventData = BudgetEventDataV1;
export type BudgetLedgerView = BudgetLedgerViewV1;
export type Effect = EffectV1;
export type EffectFulfillmentRecord = EffectFulfillmentRecordV1;
export type Snapshot = SnapshotV1;
export type DebugDump = DebugDumpV1;
export type TickFrame = TickFrameV1;

// -------------------------
// Annotator outputs
// -------------------------

export const TELEMETRY_RECORD_SCHEMA = "agent-kernel/TelemetryRecord";
export const RUN_SUMMARY_SCHEMA = "agent-kernel/RunSummary";

/**
 * Canonical telemetry record emitted by Annotator. These can be streamed or stored.
 * Telemetry must never affect simulation outcomes.
 */
export interface TelemetryRecordV1 {
  schema: typeof TELEMETRY_RECORD_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** What this record is about (e.g., "tick", "phase", "persona", "run"). */
  scope: "tick" | "phase" | "persona" | "run";

  /** Tick is optional depending on scope. */
  tick?: number;

  /** Persona name if scope is "persona". */
  persona?: string;

  /** Structured telemetry payload (stable and queryable). */
  data: Record<string, unknown>;
}

/**
 * Run-level summary emitted by Annotator at end of run.
 */
export interface RunSummaryV1 {
  schema: typeof RUN_SUMMARY_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** References to primary run inputs. */
  intentRef?: ArtifactRef;
  planRef?: ArtifactRef;
  simConfigRef?: ArtifactRef;
  budgetReceiptRef?: ArtifactRef;

  /** Outcome classification (intentionally minimal). */
  outcome: "success" | "failure" | "aborted" | "unknown";

  /** Key metrics for comparison. */
  metrics?: Record<string, number>;

  /** Optional human-readable highlights (kept short). */
  highlights?: string[];

  /** Optional pointers to stored logs/snapshots. */
  artifacts?: Array<ArtifactRef>;
}

export type TelemetryRecord = TelemetryRecordV1;
export type RunSummary = RunSummaryV1;

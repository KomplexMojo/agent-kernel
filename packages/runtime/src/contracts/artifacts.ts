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

  /** Optional cost context linking this artifact to the run's canonical receipt/proposal. */
  cost?: ArtifactCostContextV1;
}

/** A stable reference to another artifact. */
export interface ArtifactRef {
  id: string;
  schema: string;
  schemaVersion: number;
}

/**
 * Lightweight cost traceability context attached to ArtifactMeta.
 * Every generated artifact may carry this to link back to the canonical
 * receipt/proposal for the run without duplicating full receipt payloads.
 * All numeric fields are non-negative tokens (base unit: 1 health point = 1 token).
 */
export interface ArtifactCostContextV1 {
  /** Tokens attributable to this artifact alone. */
  selfTokens?: number;
  /** Running total tokens spent across the full run at the time this artifact was emitted. */
  runTotalTokens?: number;
  /** Total token budget for the run. */
  budgetTokens?: number;
  /** Spend category this artifact belongs to (e.g. "rooms", "hazards", "delvers"). */
  category?: string;
  /** Reference to the canonical BudgetReceiptArtifact for this run. */
  receiptRef?: ArtifactRef;
  /** Reference to the SpendProposal for this run. */
  proposalRef?: ArtifactRef;
  /** Stable line-item IDs from the proposal/receipt that cover this artifact's cost. */
  lineItemIds?: string[];
}

export type Phase = "intake" | "plan" | "allocate" | "configure" | "execute" | "annotate" | "publish";

// -------------------------
// Visualization snapshot
// -------------------------

export const VISUALIZATION_SNAPSHOT_SCHEMA = "agent-kernel/VisualizationSnapshot";

export interface VisualizationActorDetail {
  id: string;
  kind: "delver" | "warden";
  position: { x: number; y: number };
  affinities: Array<{ name: string; stacks: number; expression: string }>;
  vitals: Record<string, unknown>;
  motivation: string;
}

export interface VisualizationSnapshotAsciiV1 {
  schema: typeof VISUALIZATION_SNAPSHOT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  mode: "ascii";
  tick: number;
  runId: string;
  ascii: string;
  layers: {
    layout: string;
    hazards: string;
    resources: string;
    delvers: string;
    wardens: string;
  };
  actorDetails: VisualizationActorDetail[];
}

export interface VisualizationSnapshotImageV1 {
  schema: typeof VISUALIZATION_SNAPSHOT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  mode: "image";
  tick: number;
  runId: string;
  visualizationDataUri: string | null;
  actorDetails: VisualizationActorDetail[];
}

export type VisualizationSnapshot = VisualizationSnapshotAsciiV1 | VisualizationSnapshotImageV1;

// -------------------------
// Captured inputs (adapters)
// -------------------------

export const CAPTURED_INPUT_SCHEMA = "agent-kernel/CapturedInputArtifact";

export interface CapturedInputRefV1 {
  /** Path to an on-disk payload (adapter output). */
  path?: string;
  /** Reference to another artifact containing the payload. */
  artifactRef?: ArtifactRef;
}

export interface CapturedInputArtifactV1 {
  schema: typeof CAPTURED_INPUT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Adapter source that captured the payload (ipfs/blockchain/llm/etc). */
  source: {
    adapter: string;
    requestId?: string;
    request?: Record<string, unknown>;
  };

  /** Content type for the payload (e.g., application/json, text/plain). */
  contentType: string;

  /** Inline payload for small JSON/text captures. */
  payload?: unknown;

  /** Reference for large/binary payloads. */
  payloadRef?: CapturedInputRefV1;
}

export type CapturedInputArtifact = CapturedInputArtifactV1;

// -------------------------
// Agent authoring contract
// -------------------------

export const AGENT_COMMAND_REQUEST_SCHEMA = "agent-kernel/AgentCommandRequestArtifact";

export type AgentCommandAction = "author" | "configure";
export type AgentCommandObjectKind =
  | "room"
  | "floor_tile"
  | "trap"
  | "hazard"
  | "resource"
  | "delver"
  | "warden"
  | "shared_config";
export type AgentCommandCompileTarget =
  | "build_spec_intent"
  | "build_spec_plan"
  | "build_spec_configurator"
  | "artifact_extension";
export type AgentCommandDirectiveSource = "text" | "flag" | "object_flag" | "budget_artifact";
export type AgentCommandOptimizationPriority = "low" | "medium" | "high";
export type AgentCommandOptimizationScope = AgentCommandObjectKind | "shared_config";
export type AgentCommandOptimizationGoalKind =
  | "maximize_budget_spend"
  | "maximize_vital_max"
  | "maximize_vital_regen";
export type AgentCommandValidationOutcome =
  | "valid"
  | "invalid_requirements"
  | "conflicting_requirements"
  | "insufficient_budget";

export interface AgentCommandHardConstraintSetV1 {
  /** Total token budget is a hard cap; later fulfillment must not exceed it. */
  hardBudget?: {
    totalTokens: number;
    sources?: AgentCommandDirectiveSource[];
  };
}

export interface AgentCommandOptimizationGoalV1 {
  /** Canonical optimization direction for later deterministic fulfillment. */
  kind: AgentCommandOptimizationGoalKind;
  /** Target authored object scope for this optimization direction. */
  scope: AgentCommandOptimizationScope;
  /** Optional qualitative priority for later tie-breaking. */
  priority?: AgentCommandOptimizationPriority;
  /** Optional vital target when optimizing actor vitals or regen. */
  vital?: "health" | "mana" | "stamina" | "durability";
  /** Where the optimization direction came from. */
  source?: AgentCommandDirectiveSource;
}

export interface AgentCommandValidationIssueV1 {
  /** Stable machine-readable failure code. */
  code: string;
  /** Human-readable deterministic explanation. */
  message: string;
  /** Optional dot/bracket path for the blocking field or authored object. */
  path?: string;
}

export interface AgentCommandValidationV1 {
  /** Aggregate outcome for the request or compiled spec. */
  outcome: AgentCommandValidationOutcome;
  /** Stable user-facing summary for the overall validation result. */
  summary: string;
  /** Ordered blocking issues that explain the outcome. */
  issues: AgentCommandValidationIssueV1[];
}

export interface AgentCommandObjectRequestV1 {
  /** Canonical authored object kind. */
  kind: AgentCommandObjectKind;
  /** Original text span or normalized object prompt for this authored object. */
  prompt: string;
  /** Optional stable id for updates/reconfiguration flows. */
  id?: string;
  /** Optional object multiplicity for additive authoring. */
  count?: number;
  /** Optional object-specific structured attributes. */
  attributes?: Record<string, unknown>;
  /** Optional optimization directions for this authored object. */
  optimizationGoals?: AgentCommandOptimizationGoalV1[];
}

export interface AgentCommandCompilationRouteV1 {
  /** Downstream compilation target for this object kind. */
  target: AgentCommandCompileTarget;
  /** Dot path in BuildSpec/configurator payloads when target is build_spec_* . */
  path?: string;
  /** Schema name for additive artifacts when target is artifact_extension. */
  artifactSchema?: string;
  /** Existing additive flow that already satisfies this route. */
  legacyFlow?: string;
}

export interface AgentCommandCompilationRuleV1 {
  /** Authored object kind governed by this rule. */
  kind: AgentCommandObjectKind;
  /** Ordered compilation routes for this kind. */
  compileTo: AgentCommandCompilationRouteV1[];
  /** Optional implementor notes for later parser/mapper work. */
  notes?: string[];
}

export interface AgentCommandSharedConfigV1 extends Record<string, unknown> {
  dungeonAffinity?: string;
  budgetTokens?: number;
  dungeonBudgetTokens?: number;
  delverBudgetTokens?: number;
  levelSize?: string;
  roomCount?: number;
  constraints?: AgentCommandHardConstraintSetV1;
  optimizationGoals?: AgentCommandOptimizationGoalV1[];
}

export interface AgentCommandCompatibilityV1 {
  /** Contract is additive and must preserve existing direct commands. */
  preserveExistingCommands?: boolean;
  /** Existing commands/flows that remain supported during rollout. */
  supportedLegacyFlows?: string[];
  /** Optional notes for migration/backward compatibility. */
  notes?: string[];
}

export interface AgentCommandRequestArtifactV1 {
  schema: typeof AGENT_COMMAND_REQUEST_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Canonical agent-originated authoring command. */
  command: {
    action: AgentCommandAction;
    text: string;
    source: string;
    taxonomyVersion: 1;
  };

  /** Normalized authored objects extracted from the command text. */
  objects: AgentCommandObjectRequestV1[];

  /** Optional shared configuration that applies across authored objects. */
  sharedConfig?: AgentCommandSharedConfigV1;

  /** Optional deterministic validation result for rejected authoring requests. */
  validation?: AgentCommandValidationV1;

  /** Explicit compilation mapping for each authored object kind. */
  compilation: {
    rules: AgentCommandCompilationRuleV1[];
  };

  /** Explicit backward compatibility expectations for current flows. */
  compatibility?: AgentCommandCompatibilityV1;
}

export type AgentCommandRequestArtifact = AgentCommandRequestArtifactV1;

// -------------------------
// Build spec intake (CLI/UI)
// -------------------------

export const BUILD_SPEC_SCHEMA = "agent-kernel/BuildSpec";

export interface BuildSpecMeta {
  /** Unique identifier for this spec. */
  id: string;
  /** Identifier for the run this spec belongs to (UUID/ULID/etc.). */
  runId: string;
  /** Creation timestamp (UTC). */
  createdAt: IsoUtcTimestamp;
  /** Source system for this spec (e.g., "ui-web", "cli-agent"). */
  source: string;
  /** Optional correlation id for external systems (e.g., request id). */
  correlationId?: string;
  /** Optional human/AI readable note for debugging. */
  note?: string;
}

export interface BuildSpecAdapterCaptureV1 {
  /** Adapter name to invoke (e.g., "ipfs", "blockchain", "llm"). */
  adapter: string;
  /** Adapter request payload; shape is adapter-specific. */
  request?: Record<string, unknown>;
  /** Optional content type override for captured payload. */
  contentType?: string;
  /** Optional fixture path for adapter responses. */
  fixturePath?: string;
  /** Optional reference for captured output. */
  outputRef?: ArtifactRef;
}

export interface BuildSpecRoomHintV1 {
  affinity?: string;
  trap?: string;
  trapAffinity?: string;
}

export interface BuildSpecActorHintV1 {
  role?: string;
  count?: number;
  affinity?: string;
  motivation?: string;
  motivations?: string[];
  strength?: number;
}

export interface BuildSpecActorGroupHintV1 {
  role?: string;
  count?: number;
}

export interface BuildSpecAgentHintsV1 extends Record<string, unknown> {
  budgetTokens?: number;
  /** Optional separate budget cap for dungeon-side objects (rooms, tiles, traps, hazards). */
  dungeonBudgetTokens?: number;
  /** Optional separate budget cap for delver-side objects (delvers, wardens). */
  delverBudgetTokens?: number;
  levelSize?: string;
  levelAffinity?: string;
  roomCount?: number;
  rooms?: BuildSpecRoomHintV1[];
  actors?: BuildSpecActorHintV1[];
  actorGroups?: BuildSpecActorGroupHintV1[];
}

export interface BuildSpecAuthoringV1 {
  /** Optional reference to the canonical agent command request. */
  requestRef?: ArtifactRef;
  /** Optional inline request for self-contained build specs. */
  request?: AgentCommandRequestArtifact;
  /** Canonical object kinds represented by this spec. */
  objectKinds?: AgentCommandObjectKind[];
  /** Explicit hard constraints extracted from authoring inputs. */
  constraints?: AgentCommandHardConstraintSetV1;
  /** Explicit optimization directions extracted from authoring inputs. */
  optimizationGoals?: AgentCommandOptimizationGoalV1[];
  /** Optional deterministic validation result for rejected authoring requests. */
  validation?: AgentCommandValidationV1;
}

/**
 * Agent-facing build spec that feeds the CLI/UI.
 * The agent translates informal prompts into this structured format.
 */
export interface BuildSpecV1 {
  schema: typeof BUILD_SPEC_SCHEMA;
  schemaVersion: 1;
  meta: BuildSpecMeta;

  /** High-level intent for the Director to translate. */
  intent: {
    goal: string;
    tags?: string[];
    hints?: BuildSpecAgentHintsV1;
  };

  /** Optional plan hints to seed the Director. */
  plan?: {
    hints?: Record<string, unknown>;
  };

  /** Optional configurator inputs (implementation-specific). */
  configurator?: {
    inputs?: BuildSpecAgentHintsV1;
  };

  /** Optional normalized authoring provenance for agent-authored requests. */
  authoring?: BuildSpecAuthoringV1;

  /** Optional budget inputs (refs or inline artifacts). */
  budget?: {
    budgetRef?: ArtifactRef;
    priceListRef?: ArtifactRef;
    receiptRef?: ArtifactRef;
    budget?: BudgetArtifact;
    priceList?: PriceList;
    receipt?: BudgetReceiptArtifact;
  };

  /** Optional adapter capture requests. */
  adapters?: {
    capture?: BuildSpecAdapterCaptureV1[];
  };
}

export type BuildSpec = BuildSpecV1;

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
// Director → downstream (hazard seeding)
// -------------------------

/**
 * Effect emitted by the Director for each affinity-tagged room in the intent.
 * Downstream consumers (Configurator, Allocator) use this to auto-seed hazards.
 * This is effect data only — not a boundary-crossing artifact.
 */
export interface HazardProposalEffect {
  kind: "hazard_proposal";
  /** Affinity that the hazard should carry (e.g. "fire", "frost", "poison"). */
  affinity: string;
  /** Index / stable reference for the originating room hint (0-based). */
  roomIndex: number;
  /** Token budget ceiling for this hazard, derived from the layout pool share. */
  budgetCeiling: number;
  /** Originating persona. */
  personaRef: string;
  /** Reference to the plan artifact this proposal belongs to. */
  planRef?: ArtifactRef;
}

// -------------------------
// Budgeting (Director/Configurator/Actor → Allocator)
// -------------------------

export const BUDGET_REQUEST_SCHEMA = "agent-kernel/BudgetRequest";
export const BUDGET_RECEIPT_SCHEMA = "agent-kernel/BudgetReceipt";
export const BUDGET_ARTIFACT_SCHEMA = "agent-kernel/BudgetArtifact";
export const BUDGET_RECEIPT_ARTIFACT_SCHEMA = "agent-kernel/BudgetReceiptArtifact";
export const SPEND_PROPOSAL_SCHEMA = "agent-kernel/SpendProposal";
export const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";
export const BUDGET_ALLOCATION_SCHEMA = "agent-kernel/BudgetAllocationArtifact";
export const BUDGET_LEDGER_ARTIFACT_SCHEMA = "agent-kernel/BudgetLedgerArtifact";

export interface BudgetCategoryCaps {
  /**
   * Category caps (e.g., "movement", "cognition", "structure", "effects").
   * Canonical location for caps is SimConfigArtifactV1.constraints.categoryCaps.
   */
  caps: Record<string, number>;
}

/**
 * Legacy request contract for budget evaluation.
 * Live build/runtime flows use BudgetArtifact + PriceList + BudgetReceiptArtifact,
 * but this schema is retained for compatibility and fixture coverage.
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
/** Legacy receipt contract retained for compatibility with older fixtures and refs. */
export type BudgetReceipt = BudgetReceiptV1;

// -------------------------
// Token budgets (Orchestrator → Director → Configurator → Allocator)
// -------------------------

export interface BudgetArtifactV1 {
  schema: typeof BUDGET_ARTIFACT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  budget: {
    /** Total budget in tokens. */
    tokens: number;
    /** Optional owner reference (e.g., player, wallet, or scenario). */
    ownerRef?: ArtifactRef;
    /** Optional notes for audit/trace. */
    notes?: string;
  };
}

export interface ScenarioCategorySpend {
  actual: number;
  target: number;
  usagePercent: number;
}

export interface BudgetReceiptLineItemV1 {
  id: string;
  kind: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  status: "approved" | "denied" | "partial";
}

export interface BudgetReceiptArtifactV1 {
  schema: typeof BUDGET_RECEIPT_ARTIFACT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  budgetRef: ArtifactRef;
  priceListRef: ArtifactRef;
  proposalRef?: ArtifactRef;
  status: "approved" | "denied" | "partial";
  totalCost: number;
  remaining: number;
  lineItems: BudgetReceiptLineItemV1[];
  scenarioSpendReport?: {
    budget: number;
    totalSpend: number;
    remainingBudget: number;
    overBudget: boolean;
    categories: {
      rooms: ScenarioCategorySpend;
      floor_tiles: ScenarioCategorySpend;
      traps: ScenarioCategorySpend;
      hazards: ScenarioCategorySpend;
      resources: ScenarioCategorySpend;
      delvers: ScenarioCategorySpend;
      wardens: ScenarioCategorySpend;
      shared_system: ScenarioCategorySpend;
    };
    totalBudgetUsagePercent: number;
    incentive: {
      actualRatio: number;
      targetRatio: number;
      mismatch: number;
      multiplier: number;
    };
  };
}

export type BudgetArtifact = BudgetArtifactV1;
export type BudgetReceiptArtifact = BudgetReceiptArtifactV1;

export interface BudgetAllocationPoolV1 {
  id: string;
  tokens: number;
  notes?: string;
}

export interface BudgetAllocationPolicyV1 {
  reserveTokens?: number;
  maxActorSpend?: number;
}

export interface BudgetAllocationArtifactV1 {
  schema: typeof BUDGET_ALLOCATION_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  budgetRef: ArtifactRef;
  priceListRef: ArtifactRef;
  pools: BudgetAllocationPoolV1[];
  policy?: BudgetAllocationPolicyV1;
}

export type BudgetAllocationArtifact = BudgetAllocationArtifactV1;

export interface BudgetSpendEventV1 {
  id: string;
  kind: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface BudgetLedgerArtifactV1 {
  schema: typeof BUDGET_LEDGER_ARTIFACT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  budgetRef: ArtifactRef;
  receiptRef?: ArtifactRef;
  remaining: number;
  spendEvents: BudgetSpendEventV1[];
}

export type BudgetLedgerArtifact = BudgetLedgerArtifactV1;

export type SpendProposalCategory =
  | "rooms"
  | "floor_tiles"
  | "traps"
  | "hazards"
  | "resources"
  | "delvers"
  | "wardens"
  | "shared_system";

export interface SpendProposalItemV1 {
  id: string;
  kind: string;
  quantity?: number;
  /** Canonical spend category for attribution and reporting. */
  category?: SpendProposalCategory;
  /** Per-unit token cost (base: 1 health point = 1 token). */
  unitCost?: number;
  /** Total token cost for this line item (unitCost × quantity). */
  totalCost?: number;
  /** Approval status from the Allocator. */
  status?: "approved" | "denied" | "partial";
  /** Reference to the generated artifact this line item funded. */
  artifactRef?: ArtifactRef;
  /** Reference to the subject entity (e.g. a specific actor or tile) this item covers. */
  subjectRef?: ArtifactRef;
  /** Optional free-form attribution detail for audit/trace. */
  detail?: unknown;
}

export interface SpendProposalV1 {
  schema: typeof SPEND_PROPOSAL_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  items: SpendProposalItemV1[];
}

export type SpendProposal = SpendProposalV1;

// -------------------------
// Price list (Orchestrator → Allocator)
// -------------------------

export interface PriceListItemLegacyV1 {
  key: string;
  /** Cost in tokens for one unit of the item. */
  unitCost: number;
  /** Optional unit label (e.g., "hp", "tick", "actor"). */
  unit?: string;
  /** Optional description for clarity/audit. */
  description?: string;
}

export interface PriceListItemTokenV1 {
  id: string;
  kind: string;
  /** Cost in tokens for one unit of the item. */
  costTokens: number;
  /** Optional description for clarity/audit. */
  notes?: string;
}

export type PriceListItemV1 = PriceListItemLegacyV1 | PriceListItemTokenV1;

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
   * Typically copied from a prior budgeting stage before execution.
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
    /** Optional vitals snapshot for actor-centric initialization. */
    vitals?: {
      health: VitalRecordV1;
      mana: VitalRecordV1;
      stamina: VitalRecordV1;
      durability: VitalRecordV1;
    };
    /** Optional capability parameters for core-as (movement/action costs). */
    capabilities?: CapabilityRecordV1;
  }>;
}

export type SimConfigArtifact = SimConfigArtifactV1;
export type InitialStateArtifact = InitialStateArtifactV1;

// -------------------------
// Configurator affinity/loadout artifacts
// -------------------------

export const AFFINITY_PRESET_SCHEMA = "agent-kernel/AffinityPresetArtifact";
export const ACTOR_LOADOUT_SCHEMA = "agent-kernel/ActorLoadoutArtifact";
export const AFFINITY_SUMMARY_SCHEMA = "agent-kernel/AffinitySummary";

export type AffinityKind = "fire" | "water" | "earth" | "wind" | "life" | "decay" | "corrode" | "fortify" | "light" | "dark";
export type AffinityExpression = "push" | "pull" | "emit" | "draw";
export type AffinityTargetType = "self" | "ally" | "enemy" | "area" | "barrier" | "floor";
export type AffinityStackScaling = "linear" | "multiplier";
export type AffinityAbilityKind = "attack" | "buff" | "area";

export interface AffinityEffectV1 {
  id: string;
  potency: number;
}

export interface VitalModifierV1 {
  current: number;
  max: number;
  regen: number;
}

export interface VitalModifiersV1 {
  health?: VitalModifierV1;
  mana?: VitalModifierV1;
  stamina?: VitalModifierV1;
  durability?: VitalModifierV1;
}

export interface AffinityAbilityV1 {
  id: string;
  kind: AffinityAbilityKind;
  affinityKind: AffinityKind;
  potency: number;
  manaCost?: number;
  expression?: AffinityExpression;
  targetType?: AffinityTargetType;
}

export interface AffinityPresetV1 {
  id: string;
  kind: AffinityKind;
  expression: AffinityExpression;
  manaCost: number;
  effects: {
    attack?: AffinityEffectV1;
    buff?: AffinityEffectV1;
    area?: AffinityEffectV1;
  };
  vitalsModifiers?: VitalModifiersV1;
  abilities?: AffinityAbilityV1[];
  stack: {
    max: number;
    scaling: AffinityStackScaling;
  };
}

export interface AffinityPresetArtifactV1 {
  schema: typeof AFFINITY_PRESET_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  presets: AffinityPresetV1[];
}

export interface ActorLoadoutAffinityV1 {
  presetId: string;
  kind: AffinityKind;
  expression: AffinityExpression;
  stacks: number;
  targetType?: AffinityTargetType;
}

export interface AffinityResolvedEffectV1 {
  id: string;
  category: "vital" | "environment";
  operation: string;
  sourceType: "actor" | "trap" | "static_trap";
  sourceId?: string;
  kind: AffinityKind;
  expression: AffinityExpression;
  stacks: number;
  targetType: AffinityTargetType;
  targetVital?: "health" | "mana" | "stamina" | "durability";
  potency?: number;
  manaReserve?: number;
  minimumStacks?: number;
}

export interface ActorLoadoutV1 {
  actorId: string;
  affinities: ActorLoadoutAffinityV1[];
}

export interface ActorLoadoutArtifactV1 {
  schema: typeof ACTOR_LOADOUT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  loadouts: ActorLoadoutV1[];
}

export type AffinityPresetArtifact = AffinityPresetArtifactV1;
export type ActorLoadoutArtifact = ActorLoadoutArtifactV1;

export interface AffinitySummaryActorV1 {
  actorId: string;
  vitals: {
    health: VitalRecordV1;
    mana: VitalRecordV1;
    stamina: VitalRecordV1;
    durability: VitalRecordV1;
  };
  abilities: AffinityAbilityV1[];
  affinityStacks: Record<string, number>;
  affinityTargets?: Record<string, number>;
  resolvedEffects?: AffinityResolvedEffectV1[];
}

export interface AffinitySummaryTrapV1 {
  position: { x: number; y: number };
  vitals: {
    health: VitalRecordV1;
    mana: VitalRecordV1;
    stamina: VitalRecordV1;
    durability: VitalRecordV1;
  };
  abilities: AffinityAbilityV1[];
  affinityStacks: Record<string, number>;
  affinityTargets?: Record<string, number>;
  resolvedEffects?: AffinityResolvedEffectV1[];
}

export interface AffinitySummaryV1 {
  schema: typeof AFFINITY_SUMMARY_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  presetsRef?: ArtifactRef;
  loadoutsRef?: ArtifactRef;
  simConfigRef?: ArtifactRef;
  initialStateRef?: ArtifactRef;
  actors: AffinitySummaryActorV1[];
  traps: AffinitySummaryTrapV1[];
}

export type AffinitySummary = AffinitySummaryV1;

// -------------------------
// Core Actor State (core-as)
// -------------------------

export const ACTOR_STATE_SCHEMA = "agent-kernel/ActorState";

export interface VitalRecordV1 {
  current: number;
  max: number;
  regen: number;
}

export interface CapabilityRecordV1 {
  movementCost?: number;
  actionCostMana?: number;
  actionCostStamina?: number;
}

export interface ActorStateV1 {
  schema: typeof ACTOR_STATE_SCHEMA;
  schemaVersion: 1;
  actor: {
    id: string;
    kind: "stationary" | "barrier" | "motivated";
    position: { x: number; y: number };
    vitals: {
      health: VitalRecordV1;
      mana: VitalRecordV1;
      stamina: VitalRecordV1;
      durability: VitalRecordV1;
    };
    capabilities?: CapabilityRecordV1;
  };
}

export type ActorState = ActorStateV1;

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
    | "emit_log"
    | "emit_telemetry"
    | "request_external_fact"
    | "request_solver"
    | "fulfill_request"
    | "defer_request"
    | "destroy_barrier"
    | "raise_barrier"
    | "arm_static_trap"
    | "disarm_static_trap"
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
    | "actor_blocked"
    | "durability_changed"
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
export type EffectKind =
  | "log"
  | "telemetry"
  | "solver_request"
  | "need_external_fact"
  | "effect_fulfilled"
  | "effect_deferred"
  | "need_random"
  | "persist_required"
  | "publish_required"
  | "limit_violation"
  | "custom";

export interface EffectV1 {
  schema: typeof EFFECT_SCHEMA;
  schemaVersion: 1;

  /**
   * Deterministic effect identifier derived from state + action inputs (no clocks/random).
   * Used by adapters and personas to fulfill/track responses idempotently.
   */
  id: string;

  tick: number;

  /**
   * Indicates whether this effect may be fulfilled during `phase: "execute"` by deterministic
   * providers (no IO), or must be deferred to the Orchestrator/adapters after execution.
   */
  fulfillment: EffectFulfillment;

  kind: EffectKind;

  /**
   * Effect payload (data-only).
   * Examples:
   * - log: { message, counter, severity }
   * - telemetry: { metrics }
   * - solver_request: { intent, plan, problem }
   * - need_external_fact: { query, scope }
   */
  data?: Record<string, unknown>;

  /**
   * Optional source reference for deterministic fulfillment (e.g., ArtifactRef or captured input id).
   * If absent for need_external_fact, fulfillment must be deferred.
   */
  sourceRef?: ArtifactRef;

  /** Idempotent request identifier used to correlate fulfill/defer responses. */
  requestId?: string;

  /** Hint for routing to a specific adapter (e.g., "fixtures", "ipfs", "ollama"). */
  targetAdapter?: string;

  /** Severity for log-like effects. */
  severity?: "debug" | "info" | "warn" | "error";

  /** Persona or module that originated this effect (core often supplies "core"). */
  personaRef?: string;

  /** Optional tags for telemetry/log filtering. */
  tags?: string[];

  /** Optional correlation id for external systems. */
  correlationId?: string;
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
export const NARRATIVE_ARTIFACT_SCHEMA = "agent-kernel/NarrativeArtifact";

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

export interface NarrativeCastEntryV1 {
  id: string;
  label: string;
  kind: "stationary" | "ambulatory";
  archetype?: string;
}

export interface NarrativeTurnV1 {
  tick: number;
  title: string;
  summary: string;
  lines: string[];
  stats: {
    frames: number;
    actions: number;
    events: number;
    effects: number;
  };
}

export interface NarrativeArtifactV1 {
  schema: typeof NARRATIVE_ARTIFACT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Source summary used to derive the narrative without re-running the simulation. */
  source: {
    initialStateRef?: ArtifactRef;
    frames: number;
    ticks: number;
  };

  /** Stable cast list for UI/CLI consumers to map ids to readable labels. */
  cast: NarrativeCastEntryV1[];

  /** High-level summary of the generated story. */
  summary: string;

  /** Human-readable multiline story string spanning all turns. */
  story: string;

  /** Deterministic per-turn breakdown used to render readable narratives. */
  turns: NarrativeTurnV1[];
}

export type NarrativeCastEntry = NarrativeCastEntryV1;
export type NarrativeTurn = NarrativeTurnV1;
export type NarrativeArtifact = NarrativeArtifactV1;

// -------------------------
// Resource Bundle (rendering)
// -------------------------

export const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";

/**
 * Visual resource bundle for rendering simulation state.
 * V1 uses IPFS references; V2 includes embedded data URIs and relative paths.
 */
export interface ResourceBundleAssetV1 {
  id: string;
  kind: "tile" | "actor" | "card" | "overlay" | "affinity" | "motivation" | "expression" | "icon";
  label: string;
  ipfsUri: string;
  mimeType: string;
  width: number;
  height: number;
  /** V2+: Embedded data URI for offline rendering. */
  dataUri?: string;
  /** V2+: Relative path for file export. */
  relativePath?: string;
}

export interface ResourceBundleMappingsV1 {
  tiles: Record<string, string>;
  actors: Record<string, string> & {
    byRoleAndAffinity?: Record<string, Record<string, string>>;
  };
  cards: Record<string, string>;
  affinities?: Record<string, string>;
  motivations?: Record<string, string>;
  expressions?: Record<string, string>;
  overlays?: {
    affinities?: Record<string, string>;
    expressions?: Record<string, string>;
    stackTiers?: Record<string, string>;
    motivations?: Record<string, string>;
    darknessMask?: string;
  };
  icons?: {
    types?: Record<string, string>;
    affinities?: Record<string, string>;
    expressions?: Record<string, string>;
    motivations?: Record<string, string>;
    vitals?: Record<string, string>;
    ui?: Record<string, string>;
  };
}

export interface ResourceBundleArtifactV1 {
  schema: typeof RESOURCE_BUNDLE_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  bundleId: string;
  bundleVersion: number;
  tileWidth: number;
  tileHeight: number;
  gatewayBaseUrl: string;
  assets: ResourceBundleAssetV1[];
  mappings: ResourceBundleMappingsV1;
}

export interface ResourceBundleArtifactV2 {
  schema: typeof RESOURCE_BUNDLE_SCHEMA;
  schemaVersion: 2;
  meta: ArtifactMeta;
  bundleId: string;
  bundleVersion: number;
  tileWidth: number;
  tileHeight: number;
  gatewayBaseUrl: string;
  assets: ResourceBundleAssetV1[];
  mappings: ResourceBundleMappingsV1;
}

export type ResourceBundleArtifact = ResourceBundleArtifactV1 | ResourceBundleArtifactV2;

// -------------------------
// Resource artifacts
// -------------------------

export const RESOURCE_ARTIFACT_SCHEMA = "agent-kernel/ResourceArtifact";

/** Stats that a resource artifact can affect. */
export type ResourceStat =
  | "vitalMax"
  | "vitalRegen"
  | "affinity"
  | "affinityStack"
  | "pushExpression";

/** Tier of a resource artifact. */
export type ResourceTier = "level" | "permanent";

/**
 * A single entry in a frequency table describing how often a resource artifact drops.
 * `dropRate` is expressed as 1-in-N (e.g. 10 = 1-in-10 chance per eligible drop).
 */
export interface ArtifactFrequencyEntry {
  artifactId: string;
  dropRate: number; // positive integer: 1-in-N
}

export interface ResourceArtifactV1 {
  schema: typeof RESOURCE_ARTIFACT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;

  /** Whether the artifact persists only for the current level or permanently. */
  tier: ResourceTier;

  /** The stat this artifact modifies. */
  stat: ResourceStat;

  /** Signed delta applied to the stat (may be negative for debuffs). */
  delta: number;

  /**
   * Drop rate expressed as 1-in-N integer (e.g. 5 = drops once per 5 eligible encounters on average).
   * Must be a positive integer.
   */
  dropRate: number;
}

/** Vital keys that a resource artifact can grant (subset of actor vitals). */
export type ResourceVitalKey = "health" | "mana" | "stamina";

/** A single vital grant within a ResourceArtifactV2. */
export interface ResourceVitalGrant {
  key: ResourceVitalKey;
  /** Amount added to the vital's max. */
  delta: number;
  /** Amount added to the vital's regen rate (optional). */
  regen?: number;
}

export interface ResourceArtifactV2 {
  schema: typeof RESOURCE_ARTIFACT_SCHEMA;
  schemaVersion: 2;
  meta: ArtifactMeta;
  /** One or more vital grants this artifact provides. */
  vitals: ResourceVitalGrant[];
  /** When true the artifact persists permanently (~10× token cost). */
  permanent: boolean;
}

/** Three permanence modes for resource artifacts. */
export type ResourcePermanenceMode = "consumable" | "level" | "permanent";

/** V3: replaces `permanent: boolean` with explicit three-way permanenceMode. */
export interface ResourceArtifactV3 {
  schema: typeof RESOURCE_ARTIFACT_SCHEMA;
  schemaVersion: 3;
  meta: ArtifactMeta;
  vitals: ResourceVitalGrant[];
  permanenceMode: ResourcePermanenceMode;
}

export type ResourceArtifact = ResourceArtifactV1 | ResourceArtifactV2 | ResourceArtifactV3;

// -------------------------
// Hazard artifacts
// -------------------------

export const HAZARD_ARTIFACT_SCHEMA = "agent-kernel/HazardArtifact";

export type HazardVitalKind = "mana" | "durability"; // V1 only; V2 restricts to "mana"

export interface HazardVitalOneTimeV1 {
  kind: "one-time";
  amount: number;
}

export interface HazardVitalRegenV1 {
  kind: "regen";
  current: number;
  max: number;
  regen: number;
}

export type HazardVitalV1 = HazardVitalOneTimeV1 | HazardVitalRegenV1;

export interface HazardArtifactV1 {
  schema: typeof HAZARD_ARTIFACT_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  affinity: AffinityKind;
  expression: AffinityExpression;
  mana: HazardVitalV1;
  durability: HazardVitalV1;
}

/** V2: durability removed — hazards have mana + mana regen only. */
export interface HazardArtifactV2 {
  schema: typeof HAZARD_ARTIFACT_SCHEMA;
  schemaVersion: 2;
  meta: ArtifactMeta;
  affinity: AffinityKind;
  expression: AffinityExpression;
  mana: HazardVitalV1;
}

export type HazardArtifact = HazardArtifactV1 | HazardArtifactV2;

// -------------------------
// RoomTileActorConfig
// -------------------------

export const ROOM_TILE_CONFIG_SCHEMA = "agent-kernel/RoomTileActorConfig";

/**
 * Authored configuration for a room tile actor.
 * Room tiles are inanimate: no health, mana, stamina, or affinity expressions.
 * Allowed: affinities, motivations, durability.
 */
export interface RoomTileActorConfigV1 {
  schema: typeof ROOM_TILE_CONFIG_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  affinity?: AffinityKind;
  affinityStacks?: number;
  motivation?: string;
  durability?: HazardVitalV1;
}

export type RoomTileActorConfig = RoomTileActorConfigV1;

// -------------------------
// TickCursorArtifact
// -------------------------

export const TICK_CURSOR_SCHEMA = "agent-kernel/TickCursor";

/**
 * Session artifact tracking the current interactive tick position for a run.
 * Written to artifacts/runs/<runId>/session/cursor.json.
 */
export interface TickCursorArtifactV1 {
  schema: typeof TICK_CURSOR_SCHEMA;
  schemaVersion: 1;
  meta: ArtifactMeta;
  runId: string;
  tick: number;
  maxTick: number;
}

export type TickCursorArtifact = TickCursorArtifactV1;

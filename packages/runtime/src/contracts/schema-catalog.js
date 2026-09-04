// PX.3 extended beyond personas: this module defaulted its clock to
// `() => new Date().toISOString()`, the exact pattern require-clock.js removed from
// every persona. The rule was enforced on personas/ only, so five modules kept the
// default and nothing objected. UNUSED_CLOCK is the repo's deterministic marker: a
// caller that forgets to inject now gets a reproducible value, not wall-clock time.
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import {
  ACTION_SCHEMA,
  ACTION_SEQUENCE_SCHEMA,
  ACTOR_ARTIFACT_SCHEMA,
  ACTOR_LOADOUT_SCHEMA,
  ADAPTIVE_WORKFLOW_BENCHMARK_EVIDENCE_SCHEMA,
  ADAPTIVE_WORKFLOW_CLI_REQUEST_SCHEMA,
  ADAPTIVE_WORKFLOW_CLI_RUN_INPUT_SCHEMA,
  ADAPTIVE_WORKFLOW_CONFIGURATION_SCHEMA,
  ADAPTIVE_WORKFLOW_CONTEXT_BUDGET_SCHEMA,
  ADAPTIVE_WORKFLOW_EXECUTION_EVENT_SCHEMA,
  ADAPTIVE_WORKFLOW_EXECUTION_RECEIPT_SCHEMA,
  ADAPTIVE_WORKFLOW_FAILURE_SCHEMA,
  ADAPTIVE_WORKFLOW_IDEMPOTENCY_RECORD_SCHEMA,
  ADAPTIVE_WORKFLOW_METRICS_SCHEMA,
  ADAPTIVE_WORKFLOW_PATCH_RECEIPT_SCHEMA,
  ADAPTIVE_WORKFLOW_PATCH_REQUEST_SCHEMA,
  ADAPTIVE_WORKFLOW_PLAN_SCHEMA,
  ADAPTIVE_WORKFLOW_POLICY_SCHEMA,
  ADAPTIVE_WORKFLOW_REPLAY_SCHEMA,
  ADAPTIVE_WORKFLOW_RUNTIME_PROFILE_SCHEMA,
  ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA,
  ADAPTIVE_WORKFLOW_SELECTED_STRATEGY_SCHEMA,
  ADAPTIVE_WORKFLOW_STRATEGY_POLICY_SCHEMA,
  ADAPTIVE_WORKFLOW_VALIDATION_RESULT_SCHEMA,
  AFFINITY_PRESET_SCHEMA,
  AFFINITY_RULES_ARTIFACT_SCHEMA,
  AFFINITY_SUMMARY_SCHEMA,
  AGENT_COMMAND_REQUEST_SCHEMA,
  BUDGET_ALLOCATION_SCHEMA,
  BUDGET_ARTIFACT_SCHEMA,
  BUDGET_ENVELOPE_SCHEMA,
  BUDGET_RECEIPT_ARTIFACT_SCHEMA,
  RUNTIME_BUDGET_RECEIPT_SCHEMA,
  BUILD_SPEC_SCHEMA,
  CAPTURED_INPUT_SCHEMA,
  CONFIGURATION_CANDIDATE_SCHEMA,
  EFFECT_SCHEMA,
  EXECUTION_POLICY_SCHEMA,
  GAMEPLAY_BUNDLE_SCHEMA,
  HAZARD_ARTIFACT_SCHEMA,
  INITIAL_STATE_SCHEMA,
  INTENT_ENVELOPE_SCHEMA,
  LAYOUT_ARTIFACT_SCHEMA,
  LLM_REQUEST_SCHEMA,
  LLM_RESPONSE_SCHEMA,
  MOTIVATION_RULES_ARTIFACT_SCHEMA,
  NARRATIVE_ARTIFACT_SCHEMA,
  PERSONA_INVOCATION_SCHEMA,
  PERSONA_RESULT_SCHEMA,
  PLAN_ARTIFACT_SCHEMA,
  POOL_CATALOG_SCHEMA,
  PRICE_LIST_SCHEMA,
  RESOURCE_ARTIFACT_SCHEMA,
  RESOURCE_BUNDLE_SCHEMA,
  ROOM_TILE_CONFIG_SCHEMA,
  RUN_SUMMARY_SCHEMA,
  WORLD_STATE_SCHEMA,
  ACTOR_INTENTION_SCHEMA,
  CONSTRAINT_PROBLEM_SCHEMA,
  CONSTRAINT_RESULT_SCHEMA,
  SANDBOX_SESSION_SCHEMA,
  SIM_CONFIG_SCHEMA,
  SOLVER_REQUEST_SCHEMA,
  SOLVER_RESULT_SCHEMA,
  SPEND_PROPOSAL_SCHEMA,
  SPEND_VERDICT_SCHEMA,
  TELEMETRY_RECORD_SCHEMA,
  TICK_CURSOR_SCHEMA,
  TICK_FRAME_SCHEMA,
  VISUALIZATION_SNAPSHOT_SCHEMA,
} from "./artifacts.ts";

/**
 * PA.5a — what KIND of thing each `agent-kernel/*` schema actually is.
 *
 * 🔴 THE PROBLEM THIS SOLVES IS A MEASUREMENT ONE. The maintainer's 2026-07-22 review
 * intent was "artifacts.ts defines 48 distinct schemas, that is too many — consolidate".
 * The PA.5 census (2026-08-13) found the surface at **65**, that **nothing is dead**
 * (every schema has a live reference, so the PA.1–PA.4 drop pass is exhausted), and —
 * the useful part — that the count conflates three different kinds of thing. "65
 * schemas" was never 65 artifacts.
 *
 *   persisted_artifact — declares `meta: ArtifactMeta`, gets written to disk, has
 *                        fixtures and goldens. The thing the word "artifact" means.
 *   protocol_message   — `schema` + `schemaVersion`, NO meta, never persisted, zero
 *                        goldens. In-process contracts between two personas. See the
 *                        note at artifacts.ts's BudgetEnvelope: a delver round exchanges
 *                        hundreds of candidates inside one pure search, and stamping each
 *                        with an id and `createdAt` would need a clock the charter
 *                        forbids reading, to mint identifiers nothing reads.
 *   untyped            — a constant with NO envelope interface in artifacts.ts. M8
 *                        relocated seven such constants deliberately ("inventing seven
 *                        interfaces would be new contract surface rather than a move");
 *                        two of them, ActorArtifact and LayoutArtifact, are not artifacts
 *                        at all — they are the type half of a `subjectRef`, naming what a
 *                        spend line is about, and are never constructed.
 *
 * ⚠️ **THIS TABLE IS A MIRROR, NOT AN ORIGIN.** The truth is artifacts.ts's own
 * structure, and `tests/architecture/schema-catalog-coverage.test.js` derives the kind
 * from that file and fails when this map disagrees, when a schema is missing from it, or
 * when a key here names a schema that no longer exists. The same shape as the persona
 * README/registry mirror (P5.3), and for the same reason: a doc that restates rather than
 * mirrors is a second origin, and this branch has watched every kind of doc rot it has.
 *
 * ⚠️ Classifying the AdaptiveWorkflow cluster here is NOT a keep/merge/drop call on it.
 * Those contracts remain P4.1's (maintainer, 2026-07-22), and the exclusion is read as
 * the DIRECTORY `packages/runtime/src/adaptive-workflow/`, not the name prefix — the name
 * filter had already been outgrown by `SelectedStrategy`, `BenchmarkEvidence` and
 * `ContextBudget`, which live in that directory without carrying the prefix in their
 * schema value. Labelling changes no contract; leaving 20 of 65 unlabelled would simply
 * reopen the recount this table exists to end.
 */
export const SCHEMA_KINDS = Object.freeze({
  PERSISTED_ARTIFACT: "persisted_artifact",
  PROTOCOL_MESSAGE: "protocol_message",
  UNTYPED: "untyped",
});

export const SCHEMA_KIND_BY_SCHEMA = Object.freeze({
  // ── persisted artifacts (37) ───────────────────────────────────────────────
  [ACTOR_LOADOUT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [ADAPTIVE_WORKFLOW_EXECUTION_EVENT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [ADAPTIVE_WORKFLOW_FAILURE_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [ADAPTIVE_WORKFLOW_PATCH_RECEIPT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [ADAPTIVE_WORKFLOW_PATCH_REQUEST_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [ADAPTIVE_WORKFLOW_POLICY_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [ADAPTIVE_WORKFLOW_RUNTIME_PROFILE_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [ADAPTIVE_WORKFLOW_RUN_STATE_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [ADAPTIVE_WORKFLOW_VALIDATION_RESULT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [AFFINITY_PRESET_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [AFFINITY_SUMMARY_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [AGENT_COMMAND_REQUEST_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [BUDGET_ALLOCATION_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [BUDGET_ARTIFACT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [BUDGET_RECEIPT_ARTIFACT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [RUNTIME_BUDGET_RECEIPT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [CAPTURED_INPUT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [HAZARD_ARTIFACT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [INITIAL_STATE_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [INTENT_ENVELOPE_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [NARRATIVE_ARTIFACT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [PERSONA_INVOCATION_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [PERSONA_RESULT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [PLAN_ARTIFACT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [PRICE_LIST_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [RESOURCE_ARTIFACT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [RESOURCE_BUNDLE_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [ROOM_TILE_CONFIG_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [RUN_SUMMARY_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [WORLD_STATE_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [CONSTRAINT_PROBLEM_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [CONSTRAINT_RESULT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [SANDBOX_SESSION_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [SIM_CONFIG_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [SOLVER_REQUEST_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [SOLVER_RESULT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [SPEND_PROPOSAL_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [TELEMETRY_RECORD_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [TICK_CURSOR_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [TICK_FRAME_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,
  [VISUALIZATION_SNAPSHOT_SCHEMA]: SCHEMA_KINDS.PERSISTED_ARTIFACT,

  // ── in-process protocol messages (9) ───────────────────────────────────────
  // In-tick only: an intention is consumed by the Moderator in the same tick that produced
  // it and is never written to disk, so it is a protocol message rather than a record.
  [ACTOR_INTENTION_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,
  [ACTION_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,
  [BUDGET_ENVELOPE_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,
  [BUILD_SPEC_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,
  [CONFIGURATION_CANDIDATE_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,
  [EFFECT_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,
  [EXECUTION_POLICY_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,
  [LLM_REQUEST_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,
  [LLM_RESPONSE_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,
  [SPEND_VERDICT_SCHEMA]: SCHEMA_KINDS.PROTOCOL_MESSAGE,

  // ── constants with no envelope interface in artifacts.ts (19) ──────────────
  // The seven non-AdaptiveWorkflow entries are M8's relocations. ActorArtifact and
  // LayoutArtifact are the two that are not artifacts at all: `spend-proposal.js`
  // uses them only as `buildSubjectRef(id, SCHEMA)`, naming what a spend line is
  // about. ActorArtifact's 116 fixtures and 28 goldens are that string inside spend
  // ledgers — which is why a footprint count alone cannot tell an artifact from a tag.
  [ACTION_SEQUENCE_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ACTOR_ARTIFACT_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_BENCHMARK_EVIDENCE_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_CLI_REQUEST_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_CLI_RUN_INPUT_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_CONFIGURATION_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_CONTEXT_BUDGET_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_EXECUTION_RECEIPT_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_IDEMPOTENCY_RECORD_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_METRICS_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_PLAN_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_REPLAY_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_SELECTED_STRATEGY_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [ADAPTIVE_WORKFLOW_STRATEGY_POLICY_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [AFFINITY_RULES_ARTIFACT_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [GAMEPLAY_BUNDLE_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [LAYOUT_ARTIFACT_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [MOTIVATION_RULES_ARTIFACT_SCHEMA]: SCHEMA_KINDS.UNTYPED,
  [POOL_CATALOG_SCHEMA]: SCHEMA_KINDS.UNTYPED,
});

/** The kind of one schema, or null when it is not classified (which the guard forbids). */
export function schemaKindOf(schema) {
  return SCHEMA_KIND_BY_SCHEMA[schema] ?? null;
}

export const SCHEMA_CATEGORIES = Object.freeze({
  CANONICAL_BUILD_INPUT: "canonical_build_input",
  SUPPORTING_INPUT: "supporting_input",
  CANONICAL_RUNTIME_HANDOFF: "canonical_runtime_handoff",
  INTERMEDIATE: "intermediate",
  OBSERVABILITY: "observability",
  COMPATIBILITY: "compatibility",
  EXPERIMENTAL: "experimental",
});

export const CANONICAL_BUILD_INPUT_SCHEMAS = Object.freeze([
  { schema: BUILD_SPEC_SCHEMA, schemaVersion: 1 },
]);

export const CANONICAL_RUNTIME_HANDOFF_SCHEMAS = Object.freeze([
  { schema: SIM_CONFIG_SCHEMA, schemaVersion: 1 },
  { schema: INITIAL_STATE_SCHEMA, schemaVersion: 1 },
  { schema: RESOURCE_BUNDLE_SCHEMA, schemaVersion: 2 },
]);

const CATALOG = [
  {
    schema: AGENT_COMMAND_REQUEST_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Agent-authored command provenance and object taxonomy before BuildSpec normalization.",
    fields: ["meta", "command", "objects", "sharedConfig", "compilation", "compatibility"],
  },
  {
    schema: CAPTURED_INPUT_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Captured external adapter payload inputs.",
    fields: ["meta", "source", "contentType", "payload", "payloadRef"],
  },
  {
    schema: BUILD_SPEC_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.CANONICAL_BUILD_INPUT,
    description: "Canonical build intake artifact for authoring and orchestration.",
    fields: ["meta", "intent", "plan", "configurator", "authoring", "budget", "adapters"],
  },
  {
    schema: INTENT_ENVELOPE_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Normalized intake intent for Director.",
    fields: ["meta", "source", "intent", "context"],
  },
  {
    schema: PLAN_ARTIFACT_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Structured plan produced by Director.",
    fields: ["meta", "intentRef", "plan", "directives"],
  },
  {
    schema: BUDGET_ARTIFACT_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Token budget input.",
  },
  {
    schema: BUDGET_RECEIPT_ARTIFACT_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Canonical budget receipt contract for live build/runtime spend decisions.",
  },
  {
    schema: SPEND_PROPOSAL_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Configurator spend proposal.",
  },
  {
    schema: PRICE_LIST_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Price list for token budgeting.",
  },
  {
    schema: BUDGET_ALLOCATION_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Allocator pool allocation output.",
  },
  {
    schema: EXECUTION_POLICY_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Moderator execution ordering policy.",
  },
  {
    schema: SIM_CONFIG_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.CANONICAL_RUNTIME_HANDOFF,
    description: "Canonical executable simulation configuration.",
    fields: ["meta", "planRef", "budgetReceiptRef", "seed", "executionPolicy", "layout", "constraints"],
  },
  {
    schema: INITIAL_STATE_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.CANONICAL_RUNTIME_HANDOFF,
    description: "Canonical initial actor state for a run.",
    fields: ["meta", "simConfigRef", "actors"],
  },
  {
    schema: AFFINITY_PRESET_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Affinity preset catalog.",
  },
  {
    schema: ACTOR_LOADOUT_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Actor affinity loadouts.",
  },
  {
    schema: AFFINITY_SUMMARY_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Resolved affinity/hazard summary.",
  },
  {
    schema: SOLVER_REQUEST_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Solver request artifact.",
  },
  {
    schema: SOLVER_RESULT_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Solver result artifact.",
  },
  {
    schema: ACTION_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Core action proposal.",
  },
  {
    schema: EFFECT_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Core effect record.",
  },
  {
    schema: TICK_FRAME_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Moderator tick frame output.",
  },
  {
    schema: TELEMETRY_RECORD_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Annotator telemetry record.",
    fields: ["meta", "scope", "tick", "persona", "data"],
  },
  {
    schema: RUN_SUMMARY_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Run summary output.",
    fields: ["meta", "intentRef", "planRef", "simConfigRef", "budgetReceiptRef", "outcome"],
  },
  {
    schema: CONSTRAINT_PROBLEM_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.PROTOCOL,
    description: "Constraint problem posed to a solver by its owning persona.",
    fields: ["meta", "domain", "posedBy", "variables", "constraints", "objective", "context"],
  },
  {
    schema: CONSTRAINT_RESULT_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.PROTOCOL,
    description: "Normalized solver answer to a constraint problem.",
    fields: ["meta", "domain", "status", "model", "reason"],
  },
  {
    schema: WORLD_STATE_SCHEMA,
    schemaVersion: 2,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "World state at a tick: actor positions, vitals and affinity grants, hazard state, and resources still on the map.",
    fields: ["meta", "simConfigRef", "tick", "dimensions", "actors", "hazards", "resources"],
  },
  {
    schema: NARRATIVE_ARTIFACT_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Human-readable turn-by-turn story derived from tick frames.",
    fields: ["meta", "source", "cast", "summary", "story", "turns"],
  },
  {
    schema: RESOURCE_BUNDLE_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.CANONICAL_RUNTIME_HANDOFF,
    description: "Legacy visual resource bundle for rendering.",
    fields: ["meta", "bundleId", "bundleVersion", "tileWidth", "tileHeight", "gatewayBaseUrl", "assets", "mappings"],
  },
  {
    schema: RESOURCE_BUNDLE_SCHEMA,
    schemaVersion: 2,
    category: SCHEMA_CATEGORIES.CANONICAL_RUNTIME_HANDOFF,
    description: "Canonical visual resource bundle with embedded data URIs, sprite variants, and Phaser-ready tile effect overlays.",
    fields: ["meta", "bundleId", "bundleVersion", "tileWidth", "tileHeight", "gatewayBaseUrl", "assets", "mappings"],
  },
  {
    schema: SANDBOX_SESSION_SCHEMA,
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Session envelope for a standalone Phaser sandbox. Indexes SimConfig, InitialState, ResourceBundle, and BudgetReceipt artifact references. Foundation for the primary Phaser game surface.",
    fields: ["meta", "rooms", "artifacts", "entityCategories"],
  },
];

/**
 * ⚠️ PA.5a DELIBERATELY DOES NOT ADD `kind` TO THE EMITTED CATALOG, and the goldens are
 * why.
 *
 * The first attempt attached it here, which looked free — one derived field, single
 * origin, no hand-maintained copies. Four golden manifests failed immediately:
 * `createSchemaCatalog`'s output is EMBEDDED in the build manifest, so every entry's
 * shape is a persisted, golden-pinned artifact. Adding a field to it is a
 * `schemaVersion` question about the manifest, not a classification detail — and doing
 * it as a side effect of a labelling exercise is exactly the silent contract change the
 * charter forbids.
 *
 * ⇒ The classification is available to code through `SCHEMA_KIND_BY_SCHEMA` and
 * `schemaKindOf()`, and to readers through the table above. Nothing that gets written
 * to disk changed. *The falsifiable prediction ("goldens byte-identical") failed once
 * here and was worth more than the field it rejected.*
 */
function sortSchemas(entries) {
  return entries.slice().sort((a, b) => a.schema.localeCompare(b.schema));
}

function schemaKey(schema, schemaVersion) {
  return `${schema}@${schemaVersion}`;
}

export function filterSchemaCatalogEntries({ schemaRefs, entries = CATALOG } = {}) {
  if (!Array.isArray(schemaRefs) || schemaRefs.length === 0) {
    return sortSchemas(entries);
  }
  const allowed = new Set();
  schemaRefs.forEach((ref) => {
    if (!ref || typeof ref !== "object") {
      return;
    }
    const schema = ref.schema;
    const schemaVersion = Number.isFinite(ref.schemaVersion) ? ref.schemaVersion : 1;
    if (typeof schema !== "string" || schema.length === 0) {
      return;
    }
    allowed.add(schemaKey(schema, schemaVersion));
  });
  return sortSchemas(entries.filter((entry) => allowed.has(schemaKey(entry.schema, entry.schemaVersion))));
}

export function createSchemaCatalog({ clock = UNUSED_CLOCK, schemaRefs } = {}) {
  const schemas = filterSchemaCatalogEntries({ schemaRefs });
  return {
    generatedAt: clock(),
    schemas,
  };
}

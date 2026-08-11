import {
  ACTION_SCHEMA,
  ACTOR_LOADOUT_SCHEMA,
  AFFINITY_PRESET_SCHEMA,
  AFFINITY_SUMMARY_SCHEMA,
  AGENT_COMMAND_REQUEST_SCHEMA,
  BUDGET_ALLOCATION_SCHEMA,
  BUDGET_ARTIFACT_SCHEMA,
  BUDGET_RECEIPT_ARTIFACT_SCHEMA,
  BUILD_SPEC_SCHEMA,
  CAPTURED_INPUT_SCHEMA,
  EFFECT_SCHEMA,
  EXECUTION_POLICY_SCHEMA,
  INITIAL_STATE_SCHEMA,
  INTENT_ENVELOPE_SCHEMA,
  NARRATIVE_ARTIFACT_SCHEMA,
  PLAN_ARTIFACT_SCHEMA,
  PRICE_LIST_SCHEMA,
  RESOURCE_BUNDLE_SCHEMA,
  RUN_SUMMARY_SCHEMA,
  SANDBOX_SESSION_SCHEMA,
  SIM_CONFIG_SCHEMA,
  SOLVER_REQUEST_SCHEMA,
  SOLVER_RESULT_SCHEMA,
  SPEND_PROPOSAL_SCHEMA,
  TELEMETRY_RECORD_SCHEMA,
  TICK_FRAME_SCHEMA,
} from "./artifacts.ts";

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

export function createSchemaCatalog({ clock = () => new Date().toISOString(), schemaRefs } = {}) {
  const schemas = filterSchemaCatalogEntries({ schemaRefs });
  return {
    generatedAt: clock(),
    schemas,
  };
}

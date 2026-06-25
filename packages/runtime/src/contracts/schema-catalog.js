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
  { schema: "agent-kernel/BuildSpec", schemaVersion: 1 },
]);

export const CANONICAL_RUNTIME_HANDOFF_SCHEMAS = Object.freeze([
  { schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
  { schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1 },
  { schema: "agent-kernel/ResourceBundleArtifact", schemaVersion: 2 },
]);

const CATALOG = [
  {
    schema: "agent-kernel/AgentCommandRequestArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Agent-authored command provenance and object taxonomy before BuildSpec normalization.",
    fields: ["meta", "command", "objects", "sharedConfig", "compilation", "compatibility"],
  },
  {
    schema: "agent-kernel/CapturedInputArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Captured external adapter payload inputs.",
    fields: ["meta", "source", "contentType", "payload", "payloadRef"],
  },
  {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.CANONICAL_BUILD_INPUT,
    description: "Canonical build intake artifact for authoring and orchestration.",
    fields: ["meta", "intent", "plan", "configurator", "authoring", "budget", "adapters"],
  },
  {
    schema: "agent-kernel/IntentEnvelope",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Normalized intake intent for Director.",
    fields: ["meta", "source", "intent", "context"],
  },
  {
    schema: "agent-kernel/PlanArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Structured plan produced by Director.",
    fields: ["meta", "intentRef", "plan", "directives"],
  },
  {
    schema: "agent-kernel/BudgetRequest",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.EXPERIMENTAL,
    description: "Experimental allocator policy request contract retained for fixtures and compatibility review.",
  },
  {
    schema: "agent-kernel/BudgetReceipt",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.COMPATIBILITY,
    description: "Legacy budget policy receipt retained for compatibility; live build/runtime flows use BudgetReceiptArtifact.",
  },
  {
    schema: "agent-kernel/BudgetArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Token budget input.",
  },
  {
    schema: "agent-kernel/BudgetReceiptArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Canonical budget receipt contract for live build/runtime spend decisions.",
  },
  {
    schema: "agent-kernel/SpendProposal",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Configurator spend proposal.",
  },
  {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Price list for token budgeting.",
  },
  {
    schema: "agent-kernel/BudgetAllocationArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Allocator pool allocation output.",
  },
  {
    schema: "agent-kernel/BudgetLedgerArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Budget ledger of spend events.",
  },
  {
    schema: "agent-kernel/ExecutionPolicy",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Moderator execution ordering policy.",
  },
  {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.CANONICAL_RUNTIME_HANDOFF,
    description: "Canonical executable simulation configuration.",
    fields: ["meta", "planRef", "budgetReceiptRef", "seed", "executionPolicy", "layout", "constraints"],
  },
  {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.CANONICAL_RUNTIME_HANDOFF,
    description: "Canonical initial actor state for a run.",
    fields: ["meta", "simConfigRef", "actors"],
  },
  {
    schema: "agent-kernel/AffinityPresetArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Affinity preset catalog.",
  },
  {
    schema: "agent-kernel/ActorLoadoutArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.SUPPORTING_INPUT,
    description: "Actor affinity loadouts.",
  },
  {
    schema: "agent-kernel/AffinitySummary",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Resolved affinity/trap summary.",
  },
  {
    schema: "agent-kernel/ActorState",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.EXPERIMENTAL,
    description: "Experimental actor-state contract retained for fixtures and contract exploration.",
  },
  {
    schema: "agent-kernel/SolverRequest",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Solver request artifact.",
  },
  {
    schema: "agent-kernel/SolverResult",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Solver result artifact.",
  },
  {
    schema: "agent-kernel/Action",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Core action proposal.",
  },
  {
    schema: "agent-kernel/Observation",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.EXPERIMENTAL,
    description: "Experimental observation contract; live bindings expose observations without persisting this schema.",
  },
  {
    schema: "agent-kernel/Event",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Core event record.",
  },
  {
    schema: "agent-kernel/Effect",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.INTERMEDIATE,
    description: "Core effect record.",
  },
  {
    schema: "agent-kernel/Snapshot",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.EXPERIMENTAL,
    description: "Experimental snapshot contract retained for fixtures and inspector experiments.",
  },
  {
    schema: "agent-kernel/DebugDump",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.EXPERIMENTAL,
    description: "Debug-only dump artifact retained for manual diagnostics.",
  },
  {
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Moderator tick frame output.",
  },
  {
    schema: "agent-kernel/TelemetryRecord",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Annotator telemetry record.",
    fields: ["meta", "scope", "tick", "persona", "data"],
  },
  {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Run summary output.",
    fields: ["meta", "intentRef", "planRef", "simConfigRef", "budgetReceiptRef", "outcome"],
  },
  {
    schema: "agent-kernel/NarrativeArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.OBSERVABILITY,
    description: "Human-readable turn-by-turn story derived from tick frames.",
    fields: ["meta", "source", "cast", "summary", "story", "turns"],
  },
  {
    schema: "agent-kernel/ResourceBundleArtifact",
    schemaVersion: 1,
    category: SCHEMA_CATEGORIES.CANONICAL_RUNTIME_HANDOFF,
    description: "Legacy visual resource bundle for rendering.",
    fields: ["meta", "bundleId", "bundleVersion", "tileWidth", "tileHeight", "gatewayBaseUrl", "assets", "mappings"],
  },
  {
    schema: "agent-kernel/ResourceBundleArtifact",
    schemaVersion: 2,
    category: SCHEMA_CATEGORIES.CANONICAL_RUNTIME_HANDOFF,
    description: "Canonical visual resource bundle with embedded data URIs, sprite variants, and Phaser-ready tile effect overlays.",
    fields: ["meta", "bundleId", "bundleVersion", "tileWidth", "tileHeight", "gatewayBaseUrl", "assets", "mappings"],
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

const CATALOG = [
  {
    schema: "agent-kernel/CapturedInputArtifact",
    schemaVersion: 1,
    description: "Captured external adapter payload inputs.",
    fields: ["meta", "source", "contentType", "payload", "payloadRef"],
  },
  {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    description: "Agent-facing build specification.",
    fields: ["meta", "intent", "plan", "configurator", "budget", "adapters"],
  },
  {
    schema: "agent-kernel/IntentEnvelope",
    schemaVersion: 1,
    description: "Normalized intake intent for Director.",
    fields: ["meta", "source", "intent", "context"],
  },
  {
    schema: "agent-kernel/PlanArtifact",
    schemaVersion: 1,
    description: "Structured plan produced by Director.",
    fields: ["meta", "intentRef", "plan", "directives"],
  },
  {
    schema: "agent-kernel/BudgetRequest",
    schemaVersion: 1,
    description: "Request for allocator budget evaluation.",
  },
  {
    schema: "agent-kernel/BudgetReceipt",
    schemaVersion: 1,
    description: "Allocator decision on requested caps/limits.",
  },
  {
    schema: "agent-kernel/BudgetArtifact",
    schemaVersion: 1,
    description: "Token budget input.",
  },
  {
    schema: "agent-kernel/BudgetReceiptArtifact",
    schemaVersion: 1,
    description: "Token spend receipt output.",
  },
  {
    schema: "agent-kernel/SpendProposal",
    schemaVersion: 1,
    description: "Configurator spend proposal.",
  },
  {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    description: "Price list for token budgeting.",
  },
  {
    schema: "agent-kernel/BudgetAllocationArtifact",
    schemaVersion: 1,
    description: "Allocator budget allocation output.",
  },
  {
    schema: "agent-kernel/BudgetLedgerArtifact",
    schemaVersion: 1,
    description: "Budget ledger of spend events.",
  },
  {
    schema: "agent-kernel/ExecutionPolicy",
    schemaVersion: 1,
    description: "Moderator execution ordering policy.",
  },
  {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    description: "Executable simulation configuration.",
    fields: ["meta", "planRef", "budgetReceiptRef", "seed", "executionPolicy", "layout", "constraints"],
  },
  {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    description: "Initial actor state for a run.",
    fields: ["meta", "simConfigRef", "actors"],
  },
  {
    schema: "agent-kernel/AffinityPresetArtifact",
    schemaVersion: 1,
    description: "Affinity preset catalog.",
  },
  {
    schema: "agent-kernel/ActorLoadoutArtifact",
    schemaVersion: 1,
    description: "Actor affinity loadouts.",
  },
  {
    schema: "agent-kernel/AffinitySummary",
    schemaVersion: 1,
    description: "Resolved affinity/trap summary.",
  },
  {
    schema: "agent-kernel/ActorState",
    schemaVersion: 1,
    description: "Canonical actor state.",
  },
  {
    schema: "agent-kernel/SolverRequest",
    schemaVersion: 1,
    description: "Solver request artifact.",
  },
  {
    schema: "agent-kernel/SolverResult",
    schemaVersion: 1,
    description: "Solver result artifact.",
  },
  {
    schema: "agent-kernel/Action",
    schemaVersion: 1,
    description: "Core action proposal.",
  },
  {
    schema: "agent-kernel/Observation",
    schemaVersion: 1,
    description: "Core observation record.",
  },
  {
    schema: "agent-kernel/Event",
    schemaVersion: 1,
    description: "Core event record.",
  },
  {
    schema: "agent-kernel/Effect",
    schemaVersion: 1,
    description: "Core effect record.",
  },
  {
    schema: "agent-kernel/Snapshot",
    schemaVersion: 1,
    description: "Core snapshot record.",
  },
  {
    schema: "agent-kernel/DebugDump",
    schemaVersion: 1,
    description: "Debug-only dump artifact.",
  },
  {
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    description: "Moderator tick frame output.",
  },
  {
    schema: "agent-kernel/TelemetryRecord",
    schemaVersion: 1,
    description: "Annotator telemetry record.",
    fields: ["meta", "scope", "tick", "persona", "data"],
  },
  {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    description: "Run summary output.",
    fields: ["meta", "intentRef", "planRef", "simConfigRef", "budgetReceiptRef", "outcome"],
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

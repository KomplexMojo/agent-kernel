const assert = require("node:assert/strict");

const catalogModule = "../../packages/runtime/src/contracts/schema-catalog.js";

test("schema catalog includes core runtime schemas", async () => {
  const {
    createSchemaCatalog,
    SCHEMA_CATEGORIES,
    CANONICAL_BUILD_INPUT_SCHEMAS,
    CANONICAL_RUNTIME_HANDOFF_SCHEMAS,
  } = await import(catalogModule);
  const catalog = createSchemaCatalog({ clock: () => "2000-01-01T00:00:00.000Z" });
  assert.equal(catalog.generatedAt, "2000-01-01T00:00:00.000Z");
  const names = catalog.schemas.map((entry) => entry.schema);
  const sorted = [...names].sort();
  assert.deepEqual(names, sorted);

  const required = [
    "agent-kernel/AgentCommandRequestArtifact",
    "agent-kernel/IntentEnvelope",
    "agent-kernel/PlanArtifact",
    "agent-kernel/BuildSpec",
    "agent-kernel/SimConfigArtifact",
    "agent-kernel/InitialStateArtifact",
    "agent-kernel/ResourceBundleArtifact",
    "agent-kernel/NarrativeArtifact",
    "agent-kernel/TelemetryRecord",
  ];
  required.forEach((schema) => assert.ok(names.includes(schema), "Missing " + schema));

  const byKey = new Map(catalog.schemas.map((entry) => [`${entry.schema}@${entry.schemaVersion}`, entry]));
  CANONICAL_BUILD_INPUT_SCHEMAS.forEach((entry) => {
    const resolved = byKey.get(`${entry.schema}@${entry.schemaVersion}`);
    assert.equal(resolved?.category, SCHEMA_CATEGORIES.CANONICAL_BUILD_INPUT);
  });
  CANONICAL_RUNTIME_HANDOFF_SCHEMAS.forEach((entry) => {
    const resolved = byKey.get(`${entry.schema}@${entry.schemaVersion}`);
    assert.equal(resolved?.category, SCHEMA_CATEGORIES.CANONICAL_RUNTIME_HANDOFF);
  });

  assert.equal(
    byKey.get("agent-kernel/BudgetReceipt@1")?.category,
    SCHEMA_CATEGORIES.COMPATIBILITY,
  );
  // PA.1 dropped Observation and DebugDump (no producer, no consumer). Snapshot remains
  // EXPERIMENTAL pending PA.4, which is gated on a TickFrameV1 field decision.
  ["agent-kernel/Snapshot@1"].forEach((key) => {
    assert.equal(byKey.get(key)?.category, SCHEMA_CATEGORIES.EXPERIMENTAL);
  });

  // Dropped schemas must stay out of the catalog.
  ["agent-kernel/Observation@1", "agent-kernel/DebugDump@1", "agent-kernel/BudgetRequest@1"].forEach((key) => {
    assert.equal(byKey.get(key), undefined, `${key} was dropped and must not reappear in the catalog`);
  });
});

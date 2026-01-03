const test = require("node:test");
const assert = require("node:assert/strict");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const catalogModule = moduleUrl("packages/runtime/src/contracts/schema-catalog.js");

const script = `
import assert from "node:assert/strict";
import { createSchemaCatalog } from ${JSON.stringify(catalogModule)};

const catalog = createSchemaCatalog({ clock: () => "2000-01-01T00:00:00.000Z" });
assert.equal(catalog.generatedAt, "2000-01-01T00:00:00.000Z");
const names = catalog.schemas.map((entry) => entry.schema);
const sorted = [...names].sort();
assert.deepEqual(names, sorted);

const required = [
  "agent-kernel/IntentEnvelope",
  "agent-kernel/PlanArtifact",
  "agent-kernel/BuildSpec",
  "agent-kernel/SimConfigArtifact",
  "agent-kernel/InitialStateArtifact",
  "agent-kernel/TelemetryRecord",
];
required.forEach((schema) => assert.ok(names.includes(schema), "Missing " + schema));
`;

test("schema catalog includes core runtime schemas", () => {
  runEsm(script);
});

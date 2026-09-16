/**
 * Hazard/affinity cell-array arming was removed. The production loader rejects
 * layout.hazards and loads hazard actors from initial state instead.
 */
const assert = require("node:assert/strict");

test("initializeCoreFromArtifacts rejects layout.hazards", async () => {
  const { initializeCoreFromArtifacts } = await import(
    "../../packages/runtime/src/runner/core-setup.mjs"
  );
  assert.throws(() => initializeCoreFromArtifacts({
    simConfig: {
      schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1, meta: { id: "cfg" },
      layout: { kind: "grid", data: { width: 1, height: 1, terrain: ["floor"], hazards: [{}] } },
    },
    initialState: {
      schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1, meta: { id: "st" },
      simConfigRef: { id: "cfg", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
      actors: [], presentation: {},
    },
  }), /category storage/);
});

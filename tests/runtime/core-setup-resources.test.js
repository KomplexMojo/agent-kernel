/**
 * Resource cell-array placement was removed. The production loader rejects
 * layout.resources and loads resource actors from initial state instead.
 */
const assert = require("node:assert/strict");

test("initializeCoreFromArtifacts rejects layout.resources", async () => {
  const { initializeCoreFromArtifacts } = await import(
    "../../packages/runtime/src/runner/core-setup.mjs"
  );
  assert.throws(() => initializeCoreFromArtifacts({
    simConfig: {
      schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1, meta: { id: "cfg" },
      layout: { kind: "grid", data: { width: 1, height: 1, terrain: ["floor"], resources: [{}] } },
    },
    initialState: {
      schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1, meta: { id: "st" },
      simConfigRef: { id: "cfg", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
      actors: [], presentation: {},
    },
  }), /category storage/);
});

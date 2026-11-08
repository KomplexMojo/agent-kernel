/**
 * #408 (Darren, 2026-10-24): a leader pays mana upkeep each turn for each living minion, priced
 * by the Allocator from a named rate, never a constant in glue. The run loader hands it to core.
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/";
const CLOCK = () => "2026-11-08T00:00:00.000Z";

test("the Allocator names the minion upkeep: 1 mana per minion per turn", async () => {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const allocator = createAllocatorPersona({ clock: CLOCK });
  assert.equal(allocator.pricing.minionUpkeepMana(), 1);
});

test("the run loader hands core the Allocator's rate with the level's action costs", async () => {
  const { initializeCoreFromArtifacts } = await import("../../../packages/runtime/src/runner/core-setup.mjs");
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { buildSimConfigArtifact, buildInitialStateArtifact } = await import(`${P}configurator/artifact-builders.js`);
  const meta = { id: "upkeep-run", runId: "r", createdAt: CLOCK(), producedBy: "test" };
  const simConfig = buildSimConfigArtifact({ meta, planRef: { id: "p", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout: { width: 3, height: 1, terrain: ["floor", "floor", "floor"] }, movementStamina: {} });
  const initialState = buildInitialStateArtifact({ meta: { ...meta, id: "upkeep-state" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 3, height: 1 }, terrain: ["floor", "floor", "floor"], actors: [] });
  const { costs } = initializeCoreFromArtifacts({ simConfig, initialState });
  assert.equal(costs.minionUpkeep, createAllocatorPersona({ clock: CLOCK }).pricing.minionUpkeepMana());
});

// ## TODO: Test Permutations
// - a retuned base-costs rate (2) reaches core's charge unchanged

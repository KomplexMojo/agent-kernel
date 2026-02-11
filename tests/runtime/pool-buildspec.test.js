const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const catalogPath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");

test("summary + catalog produces a valid BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const summary = {
    dungeonAffinity: "fire",
    budgetTokens: 800,
    rooms: [{ motivation: "stationary", affinity: "fire", count: 1, tokenHint: 200 }],
    actors: [{ motivation: "attacking", affinity: "fire", count: 1, tokenHint: 200 }],
    tags: ["test"],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    catalog,
    runId: "pool_test_run",
    createdAt: "2024-01-01T00:00:00Z",
    source: "director-pool-test",
  });

  assert.equal(result.ok, true);
  assert.ok(result.spec);
  assert.equal(result.spec.meta.runId, "pool_test_run");
  assert.equal(result.spec.intent.goal.includes("fire"), true);
  assert.equal(result.spec.configurator.inputs.actors.length, 1);
  assert.equal(result.spec.configurator.inputs.actorGroups[0].count, 1);
  assert.equal(result.spec.configurator.inputs.actors[0].tokenCost, 200);
  assert.equal(result.spec.configurator.inputs.actors[0].vitals.health.current, 1);
  assert.equal(result.spec.configurator.inputs.actors[0].traits.affinities.fire, 1);
});

test("summary without catalog still produces actor configuration via shared selection mapper", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "water",
    budgetTokens: 900,
    rooms: [{ motivation: "stationary", affinity: "water", count: 1 }],
    actors: [{
      motivation: "defending",
      affinity: "water",
      count: 1,
      vitals: {
        health: { current: 5, max: 5, regen: 0 },
        mana: { current: 2, max: 2, regen: 0 },
      },
      affinities: [{ kind: "water", expression: "emit", stacks: 2 }],
    }],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    runId: "pool_summary_only_run",
    createdAt: "2024-01-01T00:00:00Z",
    source: "director-pool-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.spec.configurator.inputs.actors.length, 1);
  assert.equal(result.spec.configurator.inputs.actors[0].affinity, "water");
  assert.equal(result.spec.configurator.inputs.actors[0].vitals.health.current, 5);
  assert.equal(result.spec.configurator.inputs.actors[0].traits.affinities.water, 2);
});

test("summary roomDesign drives rooms level profile in BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "fire",
    budgetTokens: 1000,
    layout: { wallTiles: 80, floorTiles: 240, hallwayTiles: 80 },
    roomDesign: {
      rooms: [
        { id: "R1", size: "large", width: 10, height: 10 },
        { id: "R2", size: "medium", width: 20, height: 3 },
        { id: "R3", size: "small", width: 5, height: 5 },
      ],
      connections: [
        { from: "R1", to: "R2", type: "hallway" },
        { from: "R2", to: "R3", type: "hallway" },
      ],
      hallways: "R1-R2-R3 spine hallway",
    },
    rooms: [{ motivation: "stationary", affinity: "fire", count: 1 }],
    actors: [{ motivation: "defending", affinity: "fire", count: 1 }],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    runId: "pool_room_design_run",
    createdAt: "2024-01-01T00:00:00Z",
    source: "director-pool-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.spec.configurator.inputs.levelGen.width, 20);
  assert.equal(result.spec.configurator.inputs.levelGen.height, 20);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.profile, "rooms");
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomCount, 3);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMinSize, 3);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMaxSize, 18);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.corridorWidth, 1);
});

test("summary roomDesign profile drives non-rectangular level shape in BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "water",
    budgetTokens: 900,
    layout: { wallTiles: 120, floorTiles: 180, hallwayTiles: 40 },
    roomDesign: {
      profile: "sparse_islands",
      density: 0.28,
      hallways: "Islands connected by narrow bridges.",
    },
    rooms: [{ motivation: "stationary", affinity: "water", count: 1 }],
    actors: [{ motivation: "defending", affinity: "water", count: 1 }],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    runId: "pool_sparse_profile_run",
    createdAt: "2024-01-01T00:00:00Z",
    source: "director-pool-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.profile, "sparse_islands");
  assert.equal(result.spec.configurator.inputs.levelGen.shape.density, 0.28);
});

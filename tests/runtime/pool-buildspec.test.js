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
    attackerCount: 2,
    attackerConfigs: [
      {
        setupMode: "user",
        vitalsRegen: { mana: 2 },
      },
      {
        setupMode: "hybrid",
        vitalsRegen: { mana: 1 },
      },
    ],
    attackerConfig: {
      setupMode: "user",
      vitalsRegen: { mana: 2 },
    },
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
  assert.equal(result.spec.configurator.inputs.actors[0].setupMode, "user");
  assert.equal(result.spec.configurator.inputs.actors[0].traits.affinities.water, 2);
  assert.equal(result.spec.intent.hints.attackerCount, 2);
  assert.equal(result.spec.plan.hints.attackerCount, 2);
  assert.equal(result.spec.configurator.inputs.attackerCount, 2);
  assert.equal(result.spec.configurator.inputs.attackerConfigs.length, 2);
  assert.equal(result.spec.configurator.inputs.attackerConfig.setupMode, "user");
});

test("summary roomDesign drives connected-room level shape in BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "fire",
    budgetTokens: 1000,
    layout: { floorTiles: 240, hallwayTiles: 80 },
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
  assert.equal(result.spec.configurator.inputs.levelGen.width, 28);
  assert.equal(result.spec.configurator.inputs.levelGen.height, 28);
  assert.equal(result.spec.configurator.inputs.levelGen.walkableTilesTarget, 320);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomCount, 3);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMinSize, 3);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMaxSize, 20);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.corridorWidth, 1);
});

test("summary roomDesign numeric hints drive level shape in BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "water",
    budgetTokens: 900,
    layout: { floorTiles: 180, hallwayTiles: 40 },
    roomDesign: {
      roomCount: 5,
      roomMinSize: 3,
      roomMaxSize: 7,
      corridorWidth: 2,
      hallways: "Islands connected by narrow bridges.",
    },
    rooms: [{ motivation: "stationary", affinity: "water", count: 1 }],
    actors: [{ motivation: "defending", affinity: "water", count: 1 }],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    runId: "pool_room_shape_run",
    createdAt: "2024-01-01T00:00:00Z",
    source: "director-pool-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.spec.configurator.inputs.levelGen.width, 23);
  assert.equal(result.spec.configurator.inputs.levelGen.height, 23);
  assert.equal(result.spec.configurator.inputs.levelGen.walkableTilesTarget, 220);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomCount, 5);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMinSize, 3);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMaxSize, 7);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.corridorWidth, 2);
});

test("summary hallway overlay hints propagate to level shape in BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "earth",
    budgetTokens: 800,
    layout: { floorTiles: 160, hallwayTiles: 40 },
    roomDesign: {
      roomCount: 5,
      roomMinSize: 3,
      roomMaxSize: 8,
      corridorWidth: 2,
      pattern: "diagonal_grid",
      patternLineWidth: 2,
      patternInfillPercent: 75,
      patternGapEvery: 4,
      patternInset: 1,
    },
    rooms: [{ motivation: "stationary", affinity: "earth", count: 1 }],
    actors: [{ motivation: "defending", affinity: "earth", count: 1 }],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    runId: "pool_hallway_overlay_run",
    createdAt: "2024-01-01T00:00:00Z",
    source: "director-pool-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.pattern, "diagonal_grid");
  assert.equal(result.spec.configurator.inputs.levelGen.shape.patternLineWidth, 2);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.patternInfillPercent, 75);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.patternGapEvery, 4);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.patternInset, 1);
});

test("room bounds and total fields drive level shape without explicit layout", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "wind",
    budgetTokens: 1200,
    roomDesign: {
      totalRooms: 3,
      totalFloorTilesUsed: 180,
      rooms: [
        { id: "R1", startX: 2, startY: 2, endX: 11, endY: 7 },
        { id: "R2", startX: 14, startY: 3, endX: 21, endY: 9 },
        { id: "R3", startX: 6, startY: 12, endX: 13, endY: 18 },
      ],
    },
    rooms: [{ motivation: "stationary", affinity: "wind", count: 1 }],
    actors: [{ motivation: "defending", affinity: "wind", count: 1 }],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    runId: "pool_room_bounds_run",
    createdAt: "2024-01-01T00:00:00Z",
    source: "director-pool-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.spec.configurator.inputs.levelGen.walkableTilesTarget, 180);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomCount, 3);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMinSize, 6);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMaxSize, 10);
});

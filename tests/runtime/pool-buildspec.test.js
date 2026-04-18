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
    delverCount: 2,
    delverConfigs: [
      {
        setupMode: "user",
        vitalsRegen: { mana: 2 },
      },
      {
        setupMode: "hybrid",
        vitalsRegen: { mana: 1 },
      },
    ],
    delverConfig: {
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
  assert.equal(result.spec.configurator.inputs.actors[0].setupMode, "auto");
  assert.equal(result.spec.configurator.inputs.actors[0].traits.affinities.water, 2);
  assert.equal(result.spec.intent.hints.delverCount, 2);
  assert.equal(result.spec.plan.hints.delverCount, 2);
  assert.equal(result.spec.configurator.inputs.delverCount, 2);
  assert.equal(result.spec.configurator.inputs.delverConfigs.length, 2);
  assert.equal(result.spec.configurator.inputs.delverConfig.setupMode, "user");
});

test("hazard cards become configurator levelGen hazards in BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "fire",
    budgetTokens: 600,
    rooms: [{ motivation: "stationary", affinity: "fire", count: 1 }],
    actors: [{ motivation: "defending", affinity: "earth", count: 1 }],
    cardSet: [
      {
        id: "R-TEST01",
        type: "room",
        source: "room",
        count: 1,
        affinity: "fire",
        roomSize: "medium",
        affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
      },
      {
        id: "H-TEST01",
        type: "hazard",
        source: "hazard",
        count: 1,
        affinity: "fire",
        affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
        proximityRadius: 2,
        mana: { kind: "regen", current: 4, max: 4, regen: 1 },
        tokenHint: 25,
      },
    ],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    runId: "hazard_card_buildspec",
    createdAt: "2026-04-15T00:00:00Z",
    source: "runtime-test",
  });

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.spec.configurator.inputs.levelGen.hazards));
  assert.equal(result.spec.configurator.inputs.levelGen.hazards.length, 1);
  assert.deepEqual(result.spec.configurator.inputs.levelGen.hazards[0], {
    id: "H-TEST01",
    affinity: "fire",
    expression: "emit",
    proximityRadius: 2,
    mana: { kind: "regen", current: 4, max: 4, regen: 1 },
  });
});

test("summary roomDesign drives connected-room level shape in BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "fire",
    budgetTokens: 1000,
    layout: { floorTiles: 240, connectorFloorTiles: 80, billableFloorTiles: 160 },
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
  assert.equal(result.spec.configurator.inputs.levelGen.width, 24);
  assert.equal(result.spec.configurator.inputs.levelGen.height, 24);
  assert.equal(result.spec.configurator.inputs.levelGen.walkableTilesTarget, 240);
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
    layout: { floorTiles: 180, connectorFloorTiles: 40, billableFloorTiles: 140 },
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
  assert.equal(result.spec.configurator.inputs.levelGen.width, 21);
  assert.equal(result.spec.configurator.inputs.levelGen.height, 21);
  assert.equal(result.spec.configurator.inputs.levelGen.walkableTilesTarget, 180);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomCount, 5);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMinSize, 3);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomMaxSize, 7);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.corridorWidth, 2);
});

test("summary roomDesign rooms with counts map to level roomCount", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "dark",
    budgetTokens: 1000,
    layout: { floorTiles: 192, connectorFloorTiles: 48, billableFloorTiles: 144 },
    roomDesign: {
      roomMinSize: 3,
      roomMaxSize: 12,
      corridorWidth: 1,
      rooms: [
        { id: "R-DARK-S", size: "small", count: 3 },
        { id: "R-DARK-L", size: "large", count: 1 },
      ],
    },
    rooms: [{ motivation: "stationary", affinity: "dark", count: 1 }],
    actors: [{ motivation: "defending", affinity: "light", count: 1 }],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    runId: "pool_room_counted_cards_run",
    createdAt: "2024-01-01T00:00:00Z",
    source: "director-pool-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.roomCount, 4);
  assert.equal(result.spec.configurator.inputs.levelGen.shape.corridorWidth, 1);
});

test("summary hallway overlay hints propagate to level shape in BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const summary = {
    dungeonAffinity: "earth",
    budgetTokens: 800,
    layout: { floorTiles: 160, connectorFloorTiles: 40, billableFloorTiles: 120 },
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

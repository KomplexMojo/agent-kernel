const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { configuratorRoomGeometry } = require("../helpers/configurator-capabilities.js");

const ROOT = resolve(__dirname, "../..");
const specBasicPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-basic.json");
const specConfiguratorPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json");
const scenarioPath = resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json");

test("orchestrateBuild uses runtime modules for solver and configurator", async () => {
  const { orchestrateBuild } = await import(
    "../../packages/runtime/src/build/orchestrate-build.js"
  );

  const specBasic = JSON.parse(readFileSync(specBasicPath, "utf8"));
  const specConfigurator = JSON.parse(readFileSync(specConfiguratorPath, "utf8"));

  const solverAdapter = {
    async solve(request) {
      return { status: "fulfilled", result: { note: "fixture" } };
    }
  };

  const resultBasic = await orchestrateBuild({
    spec: specBasic,
    producedBy: "runtime-test",
    solver: { adapter: solverAdapter, scenario: "scenario", options: { kind: "basic" }, clock: () => specBasic.meta.createdAt },
  });

  assert.equal(resultBasic.intent.schema, "agent-kernel/IntentEnvelope");
  assert.equal(resultBasic.plan.schema, "agent-kernel/PlanArtifact");
  assert.equal(resultBasic.plan.intentRef.id, resultBasic.intent.meta.id);
  assert.equal(resultBasic.solverRequest.schema, "agent-kernel/SolverRequest");
  assert.equal(resultBasic.solverResult.schema, "agent-kernel/SolverResult");
  assert.equal(resultBasic.solverResult.meta.createdAt, specBasic.meta.createdAt);

  const resultConfigurator = await orchestrateBuild({
    spec: specConfigurator,
    producedBy: "runtime-test",
  });

  assert.equal(resultConfigurator.simConfig.schema, "agent-kernel/SimConfigArtifact");
  assert.equal(resultConfigurator.initialState.schema, "agent-kernel/InitialStateArtifact");
  assert.equal(resultConfigurator.resourceBundle.schema, "agent-kernel/ResourceBundleArtifact");
  assert.equal(resultConfigurator.resourceBundle.schemaVersion, 2);
  assert.ok(Array.isArray(resultConfigurator.resourceBundle.assets));
  assert.ok(resultConfigurator.resourceBundle.assets.length > 0);
  assert.match(resultConfigurator.resourceBundle.assets[0].dataUri, /^data:image\/png;base64,/);
});

test("orchestrateBuild aligns actors to walkable layout positions", async () => {
  const { orchestrateBuild } = await import(
    "../../packages/runtime/src/build/orchestrate-build.js"
  );
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const { mapSummaryToPool } = await import(
    "../../packages/runtime/src/personas/director/pool-mapper.js"
  );
  const { normalizeSummary } = await import(
    "../../packages/runtime/src/personas/orchestrator/prompt-contract.js"
  );

  const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
  const summary = JSON.parse(readFileSync(resolve(ROOT, scenario.summaryPath), "utf8"));
  const catalog = JSON.parse(readFileSync(resolve(ROOT, scenario.catalogPath), "utf8"));

  const normalized = normalizeSummary(summary);
  assert.equal(normalized.ok, true);

  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);

  const result = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: mapped.selections,
    runId: "run_spawn_check",
    createdAt: "2025-01-01T00:00:00Z",
    source: "runtime-test",
  });
  assert.equal(result.ok, true);

  const buildResult = await orchestrateBuild({ spec: result.spec, producedBy: "runtime-test" });
  const spawnApproach = buildResult.simConfig.layout.data.spawnApproach;
  const exitApproach = buildResult.simConfig.layout.data.exitApproach;
  const terrain = buildResult.simConfig.layout.data.terrain;
  const width = buildResult.simConfig.layout.data.width;
  assert.ok(spawnApproach);
  assert.ok(exitApproach);

  const actors = buildResult.initialState.actors;
  assert.ok(actors.length > 0);

  const used = new Set();
  actors.forEach((actor) => {
    const { x, y } = actor.position;
    assert.notEqual(terrain[y * width + x], "spawn");
    assert.notEqual(terrain[y * width + x], "exit");
    assert.notEqual(terrain[y * width + x], "wall");
    const key = `${x},${y}`;
    assert.equal(used.has(key), false);
    used.add(key);
  });
});

test("orchestrateBuild places delvers at entry and wardens inside rooms", async () => {
  const { orchestrateBuild } = await import(
    "../../packages/runtime/src/build/orchestrate-build.js"
  );
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const { mapSummaryToPool } = await import(
    "../../packages/runtime/src/personas/director/pool-mapper.js"
  );

  const catalog = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/pool/catalog-basic.json"), "utf8"));

  const summary = {
    dungeonAffinity: "fire",
    budgetTokens: 1400,
    layout: { floorTiles: 240, hallwayTiles: 80 },
    roomDesign: {
      rooms: [
        { id: "R1", size: "large", width: 10, height: 10 },
        { id: "R2", size: "medium", width: 8, height: 8 },
        { id: "R3", size: "small", width: 5, height: 5 }
      ],
      connections: [
        { from: "R1", to: "R2", type: "hallway" },
        { from: "R2", to: "R3", type: "hallway" }
      ]
    },
    rooms: [{ motivation: "stationary", affinity: "fire", count: 1, tokenHint: 200 }],
    actors: [
      { motivation: "attacking", affinity: "fire", count: 2, tokenHint: 200 },
      { motivation: "defending", affinity: "earth", count: 4, tokenHint: 120 },
      { motivation: "patrolling", affinity: "wind", count: 2, tokenHint: 80 }
    ]
  };

  const mapped = mapSummaryToPool({ summary, catalog });
  assert.equal(mapped.ok, true);

  const buildSpecResult = buildBuildSpecFromSummary({
    summary,
    catalog,
    selections: mapped.selections,
    runId: "run_grouping_check",
    createdAt: "2025-01-01T00:00:00Z",
    source: "runtime-test",
  });
  assert.equal(buildSpecResult.ok, true);

  const buildResult = await orchestrateBuild({ spec: buildSpecResult.spec, producedBy: "runtime-test" });
  const actors = buildResult.initialState.actors;
  // PX.6: what the build RESOLVED is published as output; `inputs` is the causal record
  // the Configurator locked and is no longer mutated by the build.
  const actorConfig = buildResult.spec.configurator.resolved.actors;
  assert.equal(actors.length, 8);

  const data = buildResult.simConfig.layout.data;
  const entryRoomId = String(data.entryRoomId || "");
  const exitRoomId = String(data.exitRoomId || "");
  assert.ok(entryRoomId.length > 0);
  assert.ok(exitRoomId.length > 0);
  const roomsById = new Map((data.rooms || []).map((room, index) => {
    const id = typeof room.id === "string" && room.id.trim() ? room.id.trim() : `R${index + 1}`;
    return [id, room];
  }));
  const entryRoom = roomsById.get(entryRoomId);
  const exitRoom = roomsById.get(exitRoomId);
  assert.ok(entryRoom);
  assert.ok(exitRoom);

  const inRoom = (pos, room) => (
    pos.x >= room.x
    && pos.x < room.x + room.width
    && pos.y >= room.y
    && pos.y < room.y + room.height
  );
  const inAnyRoom = (pos) => (data.rooms || []).some((room) => inRoom(pos, room));
  const actorById = new Map(actorConfig.map((actor) => [actor.id, actor]));
  const isDelver = (actorId) => {
    const base = actorById.get(actorId);
    if (!base) return false;
    const values = [];
    if (Array.isArray(base.motivations)) values.push(...base.motivations);
    if (typeof base.motivation === "string") values.push(base.motivation);
    return values.join(" ").toLowerCase().includes("attack");
  };

  assert.equal(Array.isArray(data.terrain), true);
  assert.equal(data.terrain.length, data.width * data.height);
  const positionKeys = new Set();
  actors.forEach((actor) => {
    const key = `${actor.position.x},${actor.position.y}`;
    assert.equal(positionKeys.has(key), false);
    positionKeys.add(key);
    // Unified layouts carry terrain (#210); barriers are actors, so the
    // distinct-position check above already keeps actors off them.
    const cell = data.terrain[actor.position.y * data.width + actor.position.x];
    assert.ok(cell && cell !== "wall", `${actor.id} must stand on walkable terrain, got ${cell}`);
    if (isDelver(actor.id)) {
      assert.equal(inRoom(actor.position, entryRoom), true, `delver ${actor.id} should be in entry room`);
    } else {
      assert.equal(inAnyRoom(actor.position), true, `warden ${actor.id} should be in a room`);
    }
  });
});

test("orchestrateBuild translates cardSet delvers/wardens and applies strategic placement", async () => {
  const { orchestrateBuild } = await import(
    "../../packages/runtime/src/build/orchestrate-build.js"
  );
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );

  const summary = {
    dungeonAffinity: "dark",
    budgetTokens: 900,
    cardSet: [
      {
        id: "R-DARK01",
        type: "room",
        source: "room",
        count: 1,
        affinity: "dark",
        affinities: [{ kind: "dark", expression: "emit", stacks: 2 }],
        roomSize: "medium",
      },
      {
        id: "R-WATER01",
        type: "room",
        source: "room",
        count: 1,
        affinity: "water",
        affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
        roomSize: "medium",
      },
      {
        id: "A-FIRE01",
        type: "delver",
        source: "actor",
        count: 1,
        affinity: "fire",
        motivations: ["attacking"],
        affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 2, max: 2, regen: 0 },
          stamina: { current: 2, max: 2, regen: 0 },
          durability: { current: 2, max: 2, regen: 0 },
        },
      },
      {
        id: "D-WATER01",
        type: "warden",
        source: "actor",
        count: 1,
        affinity: "water",
        motivations: ["defending"],
        affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 2, max: 2, regen: 0 },
          stamina: { current: 2, max: 2, regen: 0 },
          durability: { current: 2, max: 2, regen: 0 },
        },
      },
    ],
  };

  const buildSpecResult = buildBuildSpecFromSummary({
    summary,
    roomGeometry: await configuratorRoomGeometry(),
    runId: "run_cardset_translation_placement",
    createdAt: "2025-01-01T00:00:00Z",
    source: "runtime-test",
  });
  assert.equal(buildSpecResult.ok, true);

  const actorConfig = buildSpecResult.spec.configurator.inputs.actors;
  assert.equal(actorConfig.length, 2);
  const byRole = actorConfig.reduce((acc, actor) => {
    const bag = [
      ...(Array.isArray(actor?.motivations) ? actor.motivations : []),
      typeof actor?.motivation === "string" ? actor.motivation : "",
    ].join(" ").toLowerCase();
    if (bag.includes("attack")) acc.delvers.push(actor.id);
    else acc.wardens.push(actor.id);
    return acc;
  }, { delvers: [], wardens: [] });
  assert.equal(byRole.delvers.length, 1);
  assert.equal(byRole.wardens.length, 1);

  const buildResult = await orchestrateBuild({ spec: buildSpecResult.spec, producedBy: "runtime-test" });
  const actors = buildResult.initialState.actors;
  assert.equal(actors.length, 2);

  const data = buildResult.simConfig.layout.data;
  const roomsById = new Map((data.rooms || []).map((room, index) => {
    const id = typeof room.id === "string" && room.id.trim() ? room.id.trim() : `R${index + 1}`;
    return [id, room];
  }));
  const entryRoomId = String(data.entryRoomId || "");
  const exitRoomId = String(data.exitRoomId || "");
  const entryRoom = roomsById.get(entryRoomId);
  const exitRoom = roomsById.get(exitRoomId);
  assert.ok(entryRoom);
  assert.ok(exitRoom);

  const inRoom = (pos, room) => (
    pos.x >= room.x
    && pos.x < room.x + room.width
    && pos.y >= room.y
    && pos.y < room.y + room.height
  );
  const roomHasAffinity = (room, kind, hazards) => {
    const roomHazards = (hazards || []).filter((hazard) => inRoom({ x: hazard.x, y: hazard.y }, room));
    return roomHazards.some((hazard) => hazard?.affinity?.kind === kind);
  };

  const delver = actors.find((actor) => byRole.delvers.includes(actor.id));
  const warden = actors.find((actor) => byRole.wardens.includes(actor.id));
  assert.ok(delver);
  assert.ok(warden);
  assert.equal(inRoom(delver.position, entryRoom), true);

  const hazards = data.hazards || [];
  const affinityRoom = (data.rooms || []).find((room) => roomHasAffinity(room, "water", hazards));
  const wardenInAffinityRoom = affinityRoom ? inRoom(warden.position, affinityRoom) : false;
  const wardenInExitRoom = inRoom(warden.position, exitRoom);
  assert.equal(wardenInAffinityRoom || wardenInExitRoom, true);
});

test("orchestrateBuild keeps spawn and actor placements distinct", async () => {
  const { orchestrateBuild } = await import(
    "../../packages/runtime/src/build/orchestrate-build.js"
  );

  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "spec_spawn_order",
      runId: "run_spawn_order",
      createdAt: "2025-01-01T00:00:00Z",
      source: "runtime-test",
    },
    intent: {
      goal: "spawn ordering check",
      tags: ["spawn", "ordering"],
    },
    plan: {},
    configurator: {
      inputs: {
        levelGen: { width: 8, height: 8, walkableTilesTarget: 36, seed: 1 },
        actors: [
          { id: "z_strong", tokenCost: 100, kind: "ambulatory", motivations: ["attacking"], affinity: "fire", position: { x: 0, y: 0 },
            vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 4, max: 4, regen: 0 }, stamina: { current: 10, max: 10, regen: 0 } } },
          { id: "a_support", tokenCost: 10, kind: "ambulatory", motivations: ["defending"], affinity: "water", position: { x: 1, y: 0 },
            vitals: { health: { current: 6, max: 6, regen: 0 }, mana: { current: 4, max: 4, regen: 0 }, stamina: { current: 6, max: 6, regen: 0 } } },
          { id: "b_support", tokenCost: 10, kind: "ambulatory", motivations: ["patrolling"], affinity: "earth", position: { x: 2, y: 0 },
            vitals: { health: { current: 6, max: 6, regen: 0 }, mana: { current: 4, max: 4, regen: 0 }, stamina: { current: 6, max: 6, regen: 0 } } },
        ],
        actorGroups: [{ role: "attacking", count: 1 }, { role: "defending", count: 2 }],
      },
    },
  };

  const buildResult = await orchestrateBuild({ spec, producedBy: "runtime-test" });
  const spawnApproach = buildResult.simConfig.layout.data.spawnApproach;
  const terrain = buildResult.simConfig.layout.data.terrain;
  const width = buildResult.simConfig.layout.data.width;
  const actors = buildResult.initialState.actors;

  assert.ok(spawnApproach);
  assert.equal(actors.length, 3);
  const delver = actors.find((actor) => actor.id === "z_strong");
  assert.ok(delver);
  assert.notEqual(terrain[delver.position.y * width + delver.position.x], "spawn");

  const spawnCells = actors.filter((actor) => terrain[actor.position.y * width + actor.position.x] === "spawn");
  assert.equal(spawnCells.length, 0);

  const used = new Set();
  actors.forEach((actor) => {
    const key = `${actor.position.x},${actor.position.y}`;
    assert.equal(used.has(key), false);
    used.add(key);
  });
});

test("orchestrateBuild prevents environmental objects and actors from overlaying reserved cells", async () => {
  const { orchestrateBuild } = await import(
    "../../packages/runtime/src/build/orchestrate-build.js"
  );

  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "spec_environmental_placement",
      runId: "run_environmental_placement",
      createdAt: "2025-01-01T00:00:00Z",
      source: "runtime-test",
    },
    intent: {
      goal: "environmental placement check",
      tags: ["placement"],
    },
    plan: {},
    configurator: {
      inputs: {
        levelGen: {
          width: 9,
          height: 9,
          walkableTilesTarget: 42,
          seed: 2,
          hazards: [
            { id: "hazard_spawn", affinity: "fire", expression: "emit", stacks: 1, position: { x: 0, y: 0 } },
            { id: "hazard_auto", affinity: "water", expression: "emit", stacks: 1 },
          ],
        },
        resources: [
          { id: "resource_spawn", permanenceMode: "level", vitals: [{ key: "stamina", delta: 5 }], position: { x: 0, y: 0 } },
          { id: "resource_auto", permanenceMode: "level", vitals: [{ key: "stamina", delta: 5 }] },
        ],
        actors: [
          { id: "delver_1", kind: "ambulatory", motivations: ["attacking"], position: { x: 0, y: 0 } },
          { id: "warden_1", kind: "ambulatory", motivations: ["defending"], position: { x: 0, y: 0 } },
        ],
        actorGroups: [{ role: "attacking", count: 1 }, { role: "defending", count: 1 }],
      },
    },
  };

  const buildResult = await orchestrateBuild({ spec, producedBy: "runtime-test" });
  const data = buildResult.simConfig.layout.data;
  const spawnIndex = Array.isArray(data.terrain) ? data.terrain.indexOf("spawn") : -1;
  const exitIndex = Array.isArray(data.terrain) ? data.terrain.indexOf("exit") : -1;
  assert.ok(spawnIndex >= 0, "unified layout must keep a spawn terrain cell");
  assert.ok(exitIndex >= 0, "unified layout must keep an exit terrain cell");
  const spawnKey = `${spawnIndex % data.width},${Math.floor(spawnIndex / data.width)}`;
  const exitKey = `${exitIndex % data.width},${Math.floor(exitIndex / data.width)}`;
  const occupied = new Set([spawnKey, exitKey]);

  for (const actor of buildResult.initialState.actors) {
    const key = `${actor.position.x},${actor.position.y}`;
    assert.notEqual(key, spawnKey);
    assert.notEqual(key, exitKey);
    assert.equal(occupied.has(key), false, `duplicate placement at ${key}`);
    occupied.add(key);
  }
});

test("orchestrateBuild maps room affinities to warden placement and tile emit hazards", async () => {
  const { orchestrateBuild } = await import(
    "../../packages/runtime/src/build/orchestrate-build.js"
  );

  function inRoom(pos, room) {
    return (
      pos.x >= room.x
      && pos.x < room.x + room.width
      && pos.y >= room.y
      && pos.y < room.y + room.height
    );
  }

  function roomHasAffinity(room, kind, actors) {
    return (actors || []).some((actor) => inRoom(actor.position, room)
      && actor.affinities?.some((affinity) => affinity.kind === kind));
  }

  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "spec_room_affinity",
      runId: "run_room_affinity",
      createdAt: "2025-01-01T00:00:00Z",
      source: "runtime-test",
    },
    intent: {
      goal: "room affinity placement and hazard emission",
      tags: ["affinity", "rooms"],
    },
    plan: {},
    configurator: {
      inputs: {
        levelAffinity: "fire",
        levelGen: {
          width: 18,
          height: 18,
          seed: 11,
          shape: { roomCount: 2, roomMinSize: 4, roomMaxSize: 6, corridorWidth: 1 },
          connectivity: { requirePath: true },
        },
        delverCount: 1,
        cardSet: [
          {
            id: "R-FIRE",
            type: "room",
            source: "room",
            count: 1,
            affinity: "fire",
            affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
            roomSize: "medium",
          },
          {
            id: "R-WATER",
            type: "room",
            source: "room",
            count: 1,
            affinity: "water",
            affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
            roomSize: "medium",
          },
        ],
        actors: [
          {
            id: "delver_1",
            kind: "ambulatory",
            motivations: ["attacking"],
            affinity: "earth",
            affinities: [{ kind: "earth", expression: "push", stacks: 1 }],
            position: { x: 0, y: 0 },
            vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 4, max: 4, regen: 0 }, stamina: { current: 10, max: 10, regen: 0 } },
          },
          {
            id: "def_fire",
            kind: "ambulatory",
            motivations: ["defending"],
            affinity: "fire",
            affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
            position: { x: 1, y: 0 },
            vitals: { health: { current: 6, max: 6, regen: 0 }, mana: { current: 4, max: 4, regen: 0 }, stamina: { current: 6, max: 6, regen: 0 } },
          },
          {
            id: "def_water",
            kind: "ambulatory",
            motivations: ["defending"],
            affinity: "water",
            affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
            position: { x: 2, y: 0 },
            vitals: { health: { current: 6, max: 6, regen: 0 }, mana: { current: 4, max: 4, regen: 0 }, stamina: { current: 6, max: 6, regen: 0 } },
          },
        ],
        actorGroups: [{ role: "attacking", count: 1 }, { role: "defending", count: 2 }],
      },
    },
  };

  const first = await orchestrateBuild({ spec: JSON.parse(JSON.stringify(spec)), producedBy: "runtime-test" });
  const second = await orchestrateBuild({ spec: JSON.parse(JSON.stringify(spec)), producedBy: "runtime-test" });

  const layout = first.simConfig.layout.data;
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : [];
  const hazardActors = first.initialState.actors.filter((actor) => first.initialState.presentation?.[actor.id]?.category === "hazard"
    || actor.capabilities?.canMove === false);
  assert.ok(rooms.length >= 2);
  assert.ok(rooms.some((room) => roomHasAffinity(room, "fire", hazardActors)));
  assert.ok(rooms.some((room) => roomHasAffinity(room, "water", hazardActors)));

  const fireRoom = rooms.find((room) => roomHasAffinity(room, "fire", hazardActors));
  const waterRoom = rooms.find((room) => roomHasAffinity(room, "water", hazardActors));
  assert.ok(fireRoom);
  assert.ok(waterRoom);

  const actors = first.initialState.actors;
  const fireWarden = actors.find((actor) => actor.id === "def_fire");
  const waterWarden = actors.find((actor) => actor.id === "def_water");
  assert.ok(fireWarden);
  assert.ok(waterWarden);
  // #397: the first warden guards the exit beside its approach, never on it.
  assert.notDeepEqual(fireWarden.position, layout.exitApproach);
  assert.ok(Math.max(Math.abs(fireWarden.position.x - layout.exitApproach.x),
    Math.abs(fireWarden.position.y - layout.exitApproach.y)) <= 1);
  assert.equal(inRoom(waterWarden.position, waterRoom), true);

  const generatedHazards = hazardActors.filter((actor) => actor.id !== "def_fire" && actor.id !== "def_water" && actor.id !== "delver_1");
  assert.ok(generatedHazards.length > 0);
  assert.equal(generatedHazards.every((actor) => actor.affinities?.some((affinity) => affinity.expression === "emit")), true);

  // Hazards now preserve their stacks from the room affinity
  const fireHazards = generatedHazards.filter((actor) => actor.affinities?.some((affinity) => affinity.kind === "fire"));
  const waterHazards = generatedHazards.filter((actor) => actor.affinities?.some((affinity) => affinity.kind === "water"));
  assert.ok(fireHazards.length > 0);
  assert.ok(waterHazards.length > 0);

  assert.equal(fireHazards.every((actor) => actor.affinities?.some((affinity) => affinity.kind === "fire" && affinity.stacks === 2)), true);
  assert.equal(fireHazards.every((actor) => actor.vitals?.mana?.current === 12), true);
  assert.equal(fireHazards.every((actor) => actor.vitals?.mana?.max === 12), true);
  assert.equal(fireHazards.every((actor) => actor.vitals?.mana?.regen === 4), true);

  assert.equal(waterHazards.every((actor) => actor.affinities?.some((affinity) => affinity.kind === "water" && affinity.stacks === 1)), true);
  assert.equal(waterHazards.every((actor) => actor.vitals?.mana?.current === 9), true);
  assert.equal(waterHazards.every((actor) => actor.vitals?.mana?.max === 9), true);
  assert.equal(waterHazards.every((actor) => actor.vitals?.mana?.regen === 3), true);

  const hazardKey = (actor) => [
    actor.position.x,
    actor.position.y,
    actor.affinities?.[0]?.kind,
    actor.affinities?.[0]?.expression,
    actor.affinities?.[0]?.stacks,
    actor.vitals?.mana?.current,
    actor.vitals?.mana?.max,
    actor.vitals?.mana?.regen,
  ].join(":");
  const firstHazardKeys = generatedHazards.map(hazardKey).sort();
  const secondHazardActors = second.initialState.actors.filter((actor) => second.initialState.presentation?.[actor.id]?.category === "hazard"
    || (actor.capabilities?.canMove === false && !["def_fire", "def_water", "delver_1"].includes(actor.id)));
  const secondHazardKeys = secondHazardActors.map(hazardKey).sort();
  assert.deepEqual(secondHazardKeys, firstHazardKeys);
});

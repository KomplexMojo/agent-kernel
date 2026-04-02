const test = require("node:test");
const { runEsm, moduleUrl, ROOT } = require("../helpers/esm-runner");
const { resolve } = require("node:path");

const orchestratorModule = moduleUrl("packages/runtime/src/build/orchestrate-build.js");
const specBasicPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-basic.json");
const specConfiguratorPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json");
const scenarioPath = resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json");

const script = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};

const specBasic = JSON.parse(readFileSync(${JSON.stringify(specBasicPath)}, "utf8"));
const specConfigurator = JSON.parse(readFileSync(${JSON.stringify(specConfiguratorPath)}, "utf8"));

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
assert.match(resultConfigurator.resourceBundle.assets[0].dataUri, /^data:image\\/png;base64,/);
`;

const actorPlacementScript = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};
import { buildBuildSpecFromSummary } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js"))};
import { mapSummaryToPool } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/director/pool-mapper.js"))};
import { normalizeSummary } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js"))};

const ROOT = ${JSON.stringify(ROOT)};
const scenario = JSON.parse(readFileSync(${JSON.stringify(scenarioPath)}, "utf8"));
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
const spawn = buildResult.simConfig.layout.data.spawn;
const tiles = buildResult.simConfig.layout.data.tiles;
assert.ok(spawn);

const actors = buildResult.initialState.actors;
assert.ok(actors.length > 0);
assert.deepEqual(actors[0].position, spawn);

const used = new Set();
actors.forEach((actor) => {
  const { x, y } = actor.position;
  const row = String(tiles[y] ?? "");
  const char = row[x];
  assert.ok(char && char !== "#" && char !== "B");
  const key = \`\${x},\${y}\`;
  assert.equal(used.has(key), false);
  used.add(key);
});
`;

const strategicPlacementScript = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};
import { buildBuildSpecFromSummary } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js"))};
import { mapSummaryToPool } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/director/pool-mapper.js"))};

const ROOT = ${JSON.stringify(ROOT)};
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
const actorConfig = buildResult.spec.configurator.inputs.actors;
assert.equal(actors.length, 8);

const data = buildResult.simConfig.layout.data;
const entryRoomId = String(data.entryRoomId || "");
const exitRoomId = String(data.exitRoomId || "");
assert.ok(entryRoomId.length > 0);
assert.ok(exitRoomId.length > 0);
const roomsById = new Map((data.rooms || []).map((room, index) => {
  const id = typeof room.id === "string" && room.id.trim() ? room.id.trim() : \`R\${index + 1}\`;
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

const positionKeys = new Set();
actors.forEach((actor) => {
  const key = \`\${actor.position.x},\${actor.position.y}\`;
  assert.equal(positionKeys.has(key), false);
  positionKeys.add(key);
  const row = String(data.tiles[actor.position.y] ?? "");
  const cell = row[actor.position.x];
  assert.ok(cell && cell !== "#" && cell !== "B");
  if (isDelver(actor.id)) {
    assert.equal(inRoom(actor.position, entryRoom), true, \`delver \${actor.id} should be in entry room\`);
  } else {
    assert.equal(inAnyRoom(actor.position), true, \`warden \${actor.id} should be in a room\`);
  }
});
`;

const cardSetStrategicPlacementScript = `
import assert from "node:assert/strict";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};
import { buildBuildSpecFromSummary } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js"))};

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
  const id = typeof room.id === "string" && room.id.trim() ? room.id.trim() : \`R\${index + 1}\`;
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
const roomHasAffinity = (room, kind) => (
  Array.isArray(room?.affinities)
  && room.affinities.some((entry) => entry?.kind === kind)
);

const delver = actors.find((actor) => byRole.delvers.includes(actor.id));
const warden = actors.find((actor) => byRole.wardens.includes(actor.id));
assert.ok(delver);
assert.ok(warden);
assert.equal(inRoom(delver.position, entryRoom), true);

const affinityRoom = (data.rooms || []).find((room) => roomHasAffinity(room, "water"));
const wardenInAffinityRoom = affinityRoom ? inRoom(warden.position, affinityRoom) : false;
const wardenInExitRoom = inRoom(warden.position, exitRoom);
assert.equal(wardenInAffinityRoom || wardenInExitRoom, true);
`;

const spawnOrderingScript = `
import assert from "node:assert/strict";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};

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
        { id: "z_strong", tokenCost: 100, kind: "ambulatory", motivations: ["attacking"], affinity: "fire", position: { x: 0, y: 0 } },
        { id: "a_support", tokenCost: 10, kind: "ambulatory", motivations: ["defending"], affinity: "water", position: { x: 1, y: 0 } },
        { id: "b_support", tokenCost: 10, kind: "ambulatory", motivations: ["patrolling"], affinity: "earth", position: { x: 2, y: 0 } },
      ],
      actorGroups: [{ role: "attacking", count: 1 }, { role: "defending", count: 2 }],
    },
  },
};

const buildResult = await orchestrateBuild({ spec, producedBy: "runtime-test" });
const spawn = buildResult.simConfig.layout.data.spawn;
const actors = buildResult.initialState.actors;

assert.ok(spawn);
assert.equal(actors.length, 3);
const delver = actors.find((actor) => actor.id === "z_strong");
assert.ok(delver);
assert.deepEqual(delver.position, spawn);

const spawnOccupants = actors.filter((actor) => actor.position.x === spawn.x && actor.position.y === spawn.y);
assert.equal(spawnOccupants.length, 1);
`;

const roomAffinityPlacementScript = `
import assert from "node:assert/strict";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};

function inRoom(pos, room) {
  return (
    pos.x >= room.x
    && pos.x < room.x + room.width
    && pos.y >= room.y
    && pos.y < room.y + room.height
  );
}

function roomHasAffinity(room, kind) {
  const affinities = Array.isArray(room?.affinities) ? room.affinities : [];
  return affinities.some((entry) => entry?.kind === kind);
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
    goal: "room affinity placement and trap emission",
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
        },
        {
          id: "def_fire",
          kind: "ambulatory",
          motivations: ["defending"],
          affinity: "fire",
          affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
          position: { x: 1, y: 0 },
        },
        {
          id: "def_water",
          kind: "ambulatory",
          motivations: ["defending"],
          affinity: "water",
          affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
          position: { x: 2, y: 0 },
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
assert.ok(rooms.length >= 2);
assert.ok(rooms.some((room) => roomHasAffinity(room, "fire")));
assert.ok(rooms.some((room) => roomHasAffinity(room, "water")));

const fireRoom = rooms.find((room) => roomHasAffinity(room, "fire"));
const waterRoom = rooms.find((room) => roomHasAffinity(room, "water"));
assert.ok(fireRoom);
assert.ok(waterRoom);

const actors = first.initialState.actors;
const fireWarden = actors.find((actor) => actor.id === "def_fire");
const waterWarden = actors.find((actor) => actor.id === "def_water");
assert.ok(fireWarden);
assert.ok(waterWarden);
assert.equal(inRoom(fireWarden.position, fireRoom), true);
assert.equal(inRoom(waterWarden.position, waterRoom), true);

const generatedTraps = (layout.traps || []).filter((trap) => trap?.source === "room_affinity_tile");
assert.ok(generatedTraps.length > 0);
assert.equal(generatedTraps.every((trap) => trap?.affinity?.expression === "emit"), true);
assert.equal(generatedTraps.every((trap) => trap?.affinity?.stacks === 1), true);

const fireTraps = generatedTraps.filter((trap) => trap?.affinity?.kind === "fire");
assert.ok(fireTraps.length > 0);
assert.equal(fireTraps.every((trap) => trap?.vitals?.mana?.current === 20), true);

const trapKey = (trap) => [
  trap.x,
  trap.y,
  trap.affinity?.kind,
  trap.affinity?.expression,
  trap.vitals?.mana?.current,
].join(":");
const firstTrapKeys = generatedTraps.map(trapKey).sort();
const secondTrapKeys = (second.simConfig.layout.data.traps || [])
  .filter((trap) => trap?.source === "room_affinity_tile")
  .map(trapKey)
  .sort();
assert.deepEqual(secondTrapKeys, firstTrapKeys);
`;

const mixedRoomCompositionScript = `
import assert from "node:assert/strict";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};

function inRoom(pos, room) {
  return (
    pos.x >= room.x
    && pos.x < room.x + room.width
    && pos.y >= room.y
    && pos.y < room.y + room.height
  );
}

function buildSpec({ id, runId, roomTemplateId, seed }) {
  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id,
      runId,
      createdAt: "2025-01-01T00:00:00Z",
      source: "runtime-test",
    },
    intent: {
      goal: "mixed room composition",
      tags: ["affinity", "mixed-room"],
    },
    plan: {},
    configurator: {
      inputs: {
        levelGen: {
          width: 14,
          height: 14,
          seed,
          shape: { roomCount: 1, roomMinSize: 6, roomMaxSize: 6, corridorWidth: 1 },
          connectivity: { requirePath: true },
        },
        cardSet: [
          {
            id: roomTemplateId,
            type: "room",
            source: "room",
            count: 1,
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
          },
        ],
      },
    },
  };
}

const neutral = await orchestrateBuild({
  spec: buildSpec({
    id: "spec_mixed_room_neutral",
    runId: "run_mixed_room_neutral",
    roomTemplateId: "neutral_room_with_localized_traps",
    seed: 41,
  }),
  producedBy: "runtime-test",
});

const neutralLayout = neutral.simConfig.layout.data;
const neutralRoom = Array.isArray(neutralLayout.rooms) ? neutralLayout.rooms[0] : null;
assert.ok(neutralRoom);
assert.equal(neutralRoom?.mixedRoomComposition?.templateId, "neutral_room_with_localized_traps");
assert.equal(neutralRoom?.mixedRoomComposition?.roomWideOverlay, undefined);
const neutralTraps = (neutralLayout.traps || []).filter((entry) => entry?.source === "mixed_room_template");
assert.ok(neutralTraps.length > 0);
assert.equal((neutralLayout.traps || []).some((entry) => entry?.source === "room_affinity_tile"), false);
neutralTraps.forEach((trap) => {
  assert.equal(inRoom({ x: trap.x, y: trap.y }, neutralRoom), true);
});

const mixed = await orchestrateBuild({
  spec: buildSpec({
    id: "spec_mixed_room_overlay",
    runId: "run_mixed_room_overlay",
    roomTemplateId: "mixed_overlay_and_traps",
    seed: 43,
  }),
  producedBy: "runtime-test",
});

const mixedLayout = mixed.simConfig.layout.data;
const mixedRoom = Array.isArray(mixedLayout.rooms) ? mixedLayout.rooms[0] : null;
assert.ok(mixedRoom);
assert.equal(mixedRoom?.mixedRoomComposition?.templateId, "mixed_overlay_and_traps");
assert.equal(mixedRoom?.mixedRoomComposition?.roomWideOverlay?.kind, "light");
assert.equal(Array.isArray(mixedRoom?.affinities), true);
assert.equal(mixedRoom.affinities.some((entry) => entry?.kind === "light"), true);
const mixedTraps = (mixedLayout.traps || []).filter((entry) => entry?.source === "mixed_room_template");
assert.ok(mixedTraps.length > 0);
assert.equal((mixedLayout.traps || []).some((entry) => entry?.source === "room_affinity_tile"), false);
mixedTraps.forEach((trap) => {
  assert.equal(inRoom({ x: trap.x, y: trap.y }, mixedRoom), true);
});

const spend = mixedRoom?.mixedRoomComposition?.tokenSpend;
assert.ok(spend);
assert.equal(
  spend.total,
  spend.defaultTiles + spend.localizedTiles + spend.roomWideOverlay + spend.localizedTraps,
);
`;

test("orchestrateBuild uses runtime modules for solver and configurator", () => {
  runEsm(script);
});

test("orchestrateBuild aligns actors to walkable layout positions", () => {
  runEsm(actorPlacementScript);
});

test("orchestrateBuild places delvers at entry and wardens inside rooms", () => {
  runEsm(strategicPlacementScript);
});

test("orchestrateBuild translates cardSet delvers/wardens and applies strategic placement", () => {
  runEsm(cardSetStrategicPlacementScript);
});

test("orchestrateBuild keeps the inferred delver on spawn", () => {
  runEsm(spawnOrderingScript);
});

test("orchestrateBuild maps room affinities to warden placement and tile emit traps", () => {
  runEsm(roomAffinityPlacementScript);
});

test("orchestrateBuild supports mixed-room templates with localized traps and optional overlays", () => {
  runEsm(mixedRoomCompositionScript);
});

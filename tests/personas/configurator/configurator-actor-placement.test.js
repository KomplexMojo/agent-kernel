/**
 * RB2.0 — byte characterization of actor role inference and strategic placement.
 */
"use strict";

const assert = require("node:assert/strict");

function buildSpec({ actors, delverCount = 2 } = {}) {
  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "rb2_actor_characterization",
      runId: "rb2_actor_characterization",
      createdAt: "2026-08-30T00:00:00.000Z",
      source: "runtime-test",
    },
    intent: { goal: "characterize actor placement" },
    plan: {},
    configurator: {
      inputs: {
        levelAffinity: "earth",
        levelGen: {
          width: 20,
          height: 18,
          seed: 41,
          shape: { roomCount: 3, roomMinSize: 4, roomMaxSize: 6, corridorWidth: 1 },
          connectivity: { requirePath: true },
        },
        delverCount,
        cardSet: [
          {
            id: "R-FIRE",
            type: "room",
            source: "room",
            count: 2,
            affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
          },
          {
            id: "R-WATER",
            type: "room",
            source: "room",
            count: 1,
            affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
          },
        ],
        resources: [{ id: "resource_reserved",
          vitals: { durability: { current: 1, max: 1, regen: 0 } }, holdings: [] }],
        actors, movementStamina: {},
      },
    },
  };
}

const vital = () => ({ health: { current: 10, max: 10, regen: 0 } });
const ACTORS = Object.freeze([
  { id: "guard_water", category: "warden", motivations: ["defending"], vitals: vital(),
    affinities: [{ kind: "water", expression: "emit", stacks: 1 }], activeAffinityKey: "water:emit" },
  { id: "mystery_beta", category: "warden", motivations: [], vitals: vital() },
  { id: "raider_alpha", category: "delver", motivations: ["exploring"], vitals: vital() },
  { id: "guard_fire", category: "warden", motivations: ["defending"], vitals: vital(),
    affinities: [{ kind: "fire", expression: "emit", stacks: 1 }], activeAffinityKey: "fire:emit" },
  { id: "mystery_alpha", category: "delver", motivations: [], vitals: vital() },
]);

function projectPlacement(result) {
  const data = result.simConfig.layout.data;
  const pointFor = (kind) => {
    const index = data.terrain.indexOf(kind);
    return { x: index % data.width, y: Math.floor(index / data.width) };
  };
  const actorCategory = (actor) => result.initialState.presentation[actor.id]?.category;
  return {
    spawn: pointFor("spawn"),
    exit: pointFor("exit"),
    entryRoomId: data.entryRoomId,
    exitRoomId: data.exitRoomId,
    rooms: (data.rooms || []).map(({ id, x, y, width, height, templateId }) => ({
      id, x, y, width, height, templateId,
    })),
    reservedObjectKeys: result.initialState.actors
      .filter((actor) => ["hazard", "resource"].includes(actorCategory(actor)))
      .map(({ position }) => `${position.x},${position.y}`).sort(),
    resolvedActors: (result.spec.configurator.resolved.actors || [])
      .filter((actor) => ["delver", "warden"].includes(actorCategory(actor)))
      .map(({ id, position }) => ({ id, position })),
    initialActorIds: result.initialState.actors
      .filter((actor) => ["delver", "warden"].includes(actorCategory(actor))).map(({ id }) => id),
  };
}

test("orchestrateBuild byte-characterizes role classification, preferences, occupancy, and order", async () => {
  const { orchestrateBuild } = await import(
    "../../../packages/runtime/src/build/orchestrate-build.js"
  );
  const result = await orchestrateBuild({
    spec: buildSpec({ actors: ACTORS.map((actor) => ({ ...actor })) }),
    producedBy: "runtime-test",
  });
  const actual = projectPlacement(result);

  assert.deepEqual(actual.resolvedActors.map(({ id }) => id), ACTORS.map(({ id }) => id));
  const reserved = new Set([
    `${actual.spawn.x},${actual.spawn.y}`,
    `${actual.exit.x},${actual.exit.y}`,
    ...actual.reservedObjectKeys,
  ]);
  assert.equal(
    actual.resolvedActors.some(({ position }) => reserved.has(`${position.x},${position.y}`)),
    false,
  );
  assert.deepEqual(actual, {
    spawn: { x: 6, y: 1 },
    exit: { x: 15, y: 9 },
    entryRoomId: "R1",
    exitRoomId: "R2",
    rooms: [
      { id: "R1", x: 3, y: 2, width: 6, height: 4, templateId: "R-WATER" },
      { id: "R2", x: 10, y: 10, width: 6, height: 4, templateId: "R-FIRE" },
      { id: "R3", x: 3, y: 10, width: 4, height: 6, templateId: "R-FIRE" },
    ],
    reservedObjectKeys: ["14,10", "3,15", "3,2", "3,4"],
    resolvedActors: [
      { id: "guard_water", position: { x: 15, y: 11 } },
      { id: "mystery_beta", position: { x: 13, y: 10 } },
      { id: "raider_alpha", position: { x: 5, y: 2 } },
      { id: "guard_fire", position: { x: 15, y: 10 } },
      { id: "mystery_alpha", position: { x: 6, y: 2 } },
    ],
    initialActorIds: [
      "guard_fire", "guard_water", "mystery_alpha", "mystery_beta", "raider_alpha",
    ],
  });
});

test("orchestrateBuild preserves the current typed placement failure", async () => {
  const { orchestrateBuild } = await import(
    "../../../packages/runtime/src/build/orchestrate-build.js"
  );
  const actors = Array.from({ length: 200 }, (_, index) => ({
    id: `delver_${String(index + 1).padStart(3, "0")}`,
    category: "delver", motivations: ["exploring"], vitals: vital(),
  }));

  await assert.rejects(
    () => orchestrateBuild({
      // A budget big enough for 200 delvers, so the Allocator approves and placement is what fails
      // (#276: an unbudgeted build is priced against the 2,500 reference budget).
      spec: {
        ...buildSpec({ actors, delverCount: actors.length }),
        budget: { budget: {
          schema: "agent-kernel/BudgetArtifact", schemaVersion: 1,
          meta: { id: "rb2_budget", runId: "rb2_actor_characterization", createdAt: "2026-08-30T00:00:00.000Z", producedBy: "runtime-test" },
          budget: { tokens: 1000000 },
        } },
      },
      producedBy: "runtime-test",
    }),
    /configurator inputs could not place actors: insufficient entry-room tiles for delver \d+ of 200 \(\d+ entry-room tiles, \d+ already occupied\)\./,
  );
});

// ## TODO: Test Permutations
// - characterize role inference when actor fields contain conflicting delver and warden keywords
// - characterize the legacy group-anchor fallback when a supported layout omits room metadata

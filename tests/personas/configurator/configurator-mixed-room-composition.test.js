/**
 * RB2.0 — byte characterization of the reachable card-affinity room path.
 *
 * The dormant mixedRoomComposition template branch is deliberately not used as an oracle: the
 * current default rules publish no template catalog. This test locks what orchestrateBuild actually
 * produces today so RB2.1 can move it without redesigning it.
 */
"use strict";

const assert = require("node:assert/strict");

function buildSpec() {
  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "rb2_room_characterization",
      runId: "rb2_room_characterization",
      createdAt: "2026-08-30T00:00:00.000Z",
      source: "runtime-test",
    },
    intent: { goal: "characterize seeded room affinity composition" },
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
        delverCount: 1,
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
        actors: [{ id: "delver_seed", motivations: ["attacking"] }],
      },
    },
  };
}

function projectRoomComposition(result) {
  const data = result.simConfig.layout.data;
  return {
    rooms: (data.rooms || []).map((room) => ({
      id: room.id,
      x: room.x,
      y: room.y,
      width: room.width,
      height: room.height,
      templateId: room.templateId,
      templateInstanceId: room.templateInstanceId,
    })),
    hazards: (data.hazards || [])
      .filter((hazard) => hazard.source === "room_affinity_tile")
      .map((hazard) => ({
        id: hazard.id,
        x: hazard.x,
        y: hazard.y,
        blocking: hazard.blocking,
        source: hazard.source,
        roomId: hazard.roomId,
        affinity: hazard.affinity,
        vitals: hazard.vitals,
      })),
  };
}

test("orchestrateBuild byte-characterizes seeded room profiles and generated emit hazards", async () => {
  const { orchestrateBuild } = await import(
    "../../../packages/runtime/src/build/orchestrate-build.js"
  );
  const first = await orchestrateBuild({ spec: buildSpec(), producedBy: "runtime-test" });
  const second = await orchestrateBuild({ spec: buildSpec(), producedBy: "runtime-test" });
  const actual = projectRoomComposition(first);

  assert.deepEqual(projectRoomComposition(second), actual, "same seed must repeat byte-for-byte");
  assert.deepEqual(actual, {
    rooms: [
      {
        id: "R1", x: 3, y: 2, width: 6, height: 4,
        templateId: "R-WATER", templateInstanceId: "R-WATER-1",
      },
      {
        id: "R2", x: 10, y: 10, width: 6, height: 4,
        templateId: "R-FIRE", templateInstanceId: "R-FIRE-1",
      },
      {
        id: "R3", x: 3, y: 10, width: 4, height: 6,
        templateId: "R-FIRE", templateInstanceId: "R-FIRE-2",
      },
    ],
    hazards: [
      {
        id: "fire_emit_1", x: 14, y: 10, blocking: false,
        source: "room_affinity_tile", roomId: "R2",
        affinity: { kind: "fire", expression: "emit", stacks: 2, targetType: "floor" },
        vitals: {
          mana: { current: 12, max: 12, regen: 4 },
          durability: { current: 10, max: 10, regen: 0 },
        },
      },
      {
        id: "fire_emit_2", x: 3, y: 15, blocking: false,
        source: "room_affinity_tile", roomId: "R3",
        affinity: { kind: "fire", expression: "emit", stacks: 2, targetType: "floor" },
        vitals: {
          mana: { current: 12, max: 12, regen: 4 },
          durability: { current: 10, max: 10, regen: 0 },
        },
      },
      {
        id: "water_emit_0", x: 8, y: 3, blocking: false,
        source: "room_affinity_tile", roomId: "R1",
        affinity: { kind: "water", expression: "emit", stacks: 1, targetType: "floor" },
        vitals: {
          mana: { current: 9, max: 9, regen: 3 },
          durability: { current: 5, max: 5, regen: 0 },
        },
      },
    ],
  });
});

// ## TODO: Test Permutations
// - characterize a card with multiple emitted affinities without changing profile order
// - characterize a generated hazard candidate blocked by spawn, exit, or an earlier hazard

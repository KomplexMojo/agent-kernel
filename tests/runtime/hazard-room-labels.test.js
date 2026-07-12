const assert = require("node:assert/strict");

test("hazard room label ignores room affinity and uses contained fire hazards", async () => {
  const { summarizeMixedRoomAssemblies } = await import(
    "../../packages/runtime/src/build/mixed-room-summary.js"
  );

  const [room] = summarizeMixedRoomAssemblies([
    {
      id: "R-fire",
      affinity: "water",
      mixedRoomComposition: {
        localizedHazards: [
          { id: "H-fire-1", affinity: "fire" },
          { id: "H-fire-2", affinity: { kind: "fire", expression: "emit", stacks: 1 } },
        ],
      },
    },
  ]);

  assert.equal(room.affinityRoomLabel, "fire affinity room");
  assert.deepEqual(room.hazardAffinityKinds, ["fire"]);
  assert.equal(room.roomAffinity, undefined);
});

test("corrode hazards display as a corrosion affinity room", async () => {
  const { summarizeMixedRoomAssemblies } = await import(
    "../../packages/runtime/src/build/mixed-room-summary.js"
  );

  const [room] = summarizeMixedRoomAssemblies([
    {
      id: "R-corrode",
      hazards: [
        { id: "H-corrode-1", kind: "corrode" },
        { id: "H-corrode-2", affinities: [{ kind: "corrode", expression: "emit", stacks: 1 }] },
      ],
    },
  ]);

  assert.equal(room.affinityRoomLabel, "corrosion affinity room");
  assert.deepEqual(room.hazardAffinityKinds, ["corrode"]);
});

test("fire plus water hazards display as a mixed affinity room", async () => {
  const { summarizeMixedRoomAssemblies } = await import(
    "../../packages/runtime/src/build/mixed-room-summary.js"
  );

  const [room] = summarizeMixedRoomAssemblies([
    {
      id: "R-mixed",
      mixedRoomComposition: {
        localizedHazards: [
          { id: "H-fire", affinity: { kind: "fire", expression: "emit", stacks: 1 } },
          { id: "H-water", affinity: { kind: "water", expression: "emit", stacks: 1 } },
        ],
      },
    },
  ]);

  assert.equal(room.affinityRoomLabel, "mixed affinity room");
  assert.deepEqual(room.hazardAffinityKinds, ["fire", "water"]);
});

test("rooms with no contained hazards remain unlabeled", async () => {
  const { summarizeMixedRoomAssemblies } = await import(
    "../../packages/runtime/src/build/mixed-room-summary.js"
  );

  const [room] = summarizeMixedRoomAssemblies([
    {
      id: "R-empty",
      affinity: "fire",
      mixedRoomComposition: {
        roomWideOverlay: { kind: "fire", expression: "emit", stacks: 1 },
      },
    },
  ]);

  assert.equal(room.affinityRoomLabel, "unlabeled room");
  assert.deepEqual(room.hazardAffinityKinds, []);
  assert.deepEqual(room.affinityKinds, ["fire"]);
});

test("CLI lines include the hazard-derived room label", async () => {
  const {
    formatMixedRoomAssembliesCliLines,
    summarizeMixedRoomAssemblies,
  } = await import("../../packages/runtime/src/build/mixed-room-summary.js");

  const assemblies = summarizeMixedRoomAssemblies([
    {
      id: "R-cli",
      mixedRoomComposition: {
        hazards: [{ id: "H-fire", affinity: "fire" }],
      },
    },
  ]);
  const lines = formatMixedRoomAssembliesCliLines(assemblies);

  assert.ok(lines.some((line) => line.includes('label="fire affinity room"')));
});

// ## TODO: Test Permutations
// - A room with a hazard missing affinity should be labeled as a mixed affinity room.
// - A room with overlay affinity plus hazards of another affinity should label from hazards only.
// - Localized hazards and canonical hazards in the same room should combine into one hazard composition.

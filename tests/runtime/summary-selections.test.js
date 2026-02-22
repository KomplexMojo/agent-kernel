const test = require("node:test");
const assert = require("node:assert/strict");

test("buildSelectionsFromSummary creates deterministic actor and room selections", async () => {
  const { buildSelectionsFromSummary } = await import(
    "../../packages/runtime/src/personas/director/summary-selections.js"
  );

  const summary = {
    dungeonAffinity: "water",
    attackerConfig: {
      setupMode: "user",
      vitalsMax: { health: 6, mana: 3 },
      vitalsRegen: { mana: 2 },
    },
    rooms: [{ motivation: "stationary", count: 1 }],
    actors: [{
      role: "defending",
      count: 2,
      vitals: {
        health: { current: 3, max: 4, regen: 0 },
        mana: { current: 2, max: 2, regen: 1 },
        stamina: { current: 3, max: 3, regen: 1 },
        durability: { current: 1, max: 1, regen: 0 },
      },
    }],
  };

  const selections = buildSelectionsFromSummary(summary);
  assert.equal(selections.length, 2);

  const room = selections.find((entry) => entry.kind === "room");
  assert.equal(room.requested.affinity, "water");
  assert.deepEqual(room.requested.affinities, [{ kind: "water", expression: "push", stacks: 1 }]);

  const actor = selections.find((entry) => entry.kind === "actor");
  assert.equal(actor.instances.length, 2);
  assert.equal(actor.instances[0].vitals.health.current, 6);
  assert.equal(actor.instances[0].vitals.mana.regen, 1);
  assert.equal(actor.instances[0].setupMode, "user");
  assert.deepEqual(actor.instances[0].affinities, [{ kind: "water", expression: "push", stacks: 1 }]);
});

test("normalizeSummaryPick maps actor-set role/source fields", async () => {
  const { normalizeSummaryPick } = await import(
    "../../packages/runtime/src/personas/director/summary-selections.js"
  );

  const actorPick = normalizeSummaryPick(
    { role: "attacking", count: 1 },
    { dungeonAffinity: "fire", source: "actor" },
  );
  assert.equal(actorPick.motivation, "attacking");
  assert.equal(actorPick.affinity, "fire");
  assert.equal(actorPick.setupMode, "auto");
  assert.ok(actorPick.vitals);

  const roomPick = normalizeSummaryPick(
    { motivation: "stationary", affinity: "earth", count: 1 },
    { dungeonAffinity: "fire", source: "room" },
  );
  assert.equal(roomPick.motivation, "stationary");
  assert.equal(roomPick.affinity, "earth");
  assert.equal(roomPick.vitals, undefined);
});

test("buildSelectionsFromSummary supports attackerConfigs array", async () => {
  const { buildSelectionsFromSummary } = await import(
    "../../packages/runtime/src/personas/director/summary-selections.js"
  );

  const selections = buildSelectionsFromSummary({
    dungeonAffinity: "fire",
    attackerConfigs: [
      { setupMode: "user", vitalsMax: { mana: 3 } },
      { setupMode: "hybrid", vitalsMax: { mana: 5 } },
    ],
    rooms: [],
    actors: [
      { motivation: "attacking", count: 1 },
      { motivation: "defending", count: 1 },
    ],
  });

  const actorSelections = selections.filter((entry) => entry.kind === "actor");
  assert.equal(actorSelections.length, 2);
  assert.equal(actorSelections[0].instances[0].setupMode, "user");
  assert.equal(actorSelections[0].instances[0].vitals.mana.max, 3);
  assert.equal(actorSelections[1].instances[0].setupMode, "hybrid");
  assert.equal(actorSelections[1].instances[0].vitals.mana.max, 5);
});

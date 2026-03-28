const test = require("node:test");
const assert = require("node:assert/strict");

test("buildSelectionsFromSummary creates deterministic actor and room selections", async () => {
  const { buildSelectionsFromSummary } = await import(
    "../../packages/runtime/src/personas/director/summary-selections.js"
  );

  const summary = {
    dungeonAffinity: "water",
    delverConfig: {
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
  assert.equal(room.requested.affinity, "dark");
  assert.deepEqual(room.requested.affinities, [{ kind: "dark", expression: "emit", stacks: 2 }]);

  const actor = selections.find((entry) => entry.kind === "actor");
  assert.equal(actor.instances.length, 2);
  assert.equal(actor.instances[0].vitals.health.current, 3);
  assert.equal(actor.instances[0].vitals.mana.regen, 1);
  assert.equal(actor.instances[0].setupMode, "auto");
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

test("normalizeCardEntry removes contradictory motivations from shared exclusive groups", async () => {
  const { normalizeCardEntry } = await import(
    "../../packages/runtime/src/personas/director/summary-selections.js"
  );

  const card = normalizeCardEntry({
    id: "card_conflict",
    type: "delver",
    affinity: "fire",
    motivations: ["attacking", "defending", "stationary", "patrolling"],
  }, {
    dungeonAffinity: "fire",
  });

  assert.deepEqual(card.motivations, ["attacking", "stationary"]);
});

test("buildSelectionsFromSummary supports delverConfigs array", async () => {
  const { buildSelectionsFromSummary } = await import(
    "../../packages/runtime/src/personas/director/summary-selections.js"
  );

  const selections = buildSelectionsFromSummary({
    dungeonAffinity: "fire",
    delverConfigs: [
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
  assert.equal(actorSelections[1].instances[0].setupMode, "auto");
});

test("extractSummaryFromCardSet keeps delver and warden cards as distinct actor picks", async () => {
  const { extractSummaryFromCardSet } = await import(
    "../../packages/runtime/src/personas/director/summary-selections.js"
  );

  const summary = extractSummaryFromCardSet({
    dungeonAffinity: "fire",
    cardSet: [
      {
        id: "A-TEST01",
        type: "delver",
        source: "actor",
        count: 2,
        affinity: "fire",
        motivations: ["attacking"],
        affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
      },
      {
        id: "D-TEST01",
        type: "warden",
        source: "actor",
        count: 1,
        affinity: "earth",
        motivations: ["defending"],
        affinities: [{ kind: "earth", expression: "emit", stacks: 1 }],
      },
    ],
  });

  assert.ok(Array.isArray(summary.actors));
  assert.equal(summary.actors.length, 2);
  const attacking = summary.actors.find((entry) => entry.motivation === "attacking");
  const defending = summary.actors.find((entry) => entry.motivation === "defending");
  assert.ok(attacking);
  assert.ok(defending);
  assert.equal(attacking.count, 2);
  assert.equal(defending.count, 1);
  assert.equal(summary.delverCount, 2);
  assert.ok(Array.isArray(summary.delverConfigs));
  assert.equal(summary.delverConfigs.length, 2);
});

test("buildCardSetFromSummary maps attacking actors to delver cards", async () => {
  const { buildCardSetFromSummary } = await import(
    "../../packages/runtime/src/personas/director/summary-selections.js"
  );

  const cardSet = buildCardSetFromSummary({
    dungeonAffinity: "wind",
    actors: [
      { motivation: "attacking", affinity: "fire", count: 2 },
      { motivation: "defending", affinity: "earth", count: 1 },
    ],
  });

  assert.ok(Array.isArray(cardSet));
  const delverCard = cardSet.find((entry) => entry.type === "delver");
  const wardenCard = cardSet.find((entry) => entry.type === "warden");
  assert.ok(delverCard);
  assert.ok(wardenCard);
  assert.equal(delverCard.count, 2);
  assert.equal(wardenCard.count, 1);
});

test("buildSelectionsFromSummary derives instance ids from card template ids", async () => {
  const { buildSelectionsFromSummary } = await import(
    "../../packages/runtime/src/personas/director/summary-selections.js"
  );

  const selections = buildSelectionsFromSummary({
    dungeonAffinity: "fire",
    cardSet: [
      {
        id: "A-2RB89Z",
        type: "delver",
        source: "actor",
        count: 2,
        affinity: "fire",
        motivations: ["attacking"],
        affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
      },
      {
        id: "D-5JH2QW",
        type: "warden",
        source: "actor",
        count: 1,
        affinity: "water",
        motivations: ["defending"],
        affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
      },
    ],
  });

  const actorSelections = selections.filter((entry) => entry.kind === "actor");
  const instanceIds = actorSelections
    .flatMap((entry) => entry.instances || [])
    .map((entry) => entry.id)
    .sort();
  assert.deepEqual(instanceIds, ["A-2RB89Z-1", "A-2RB89Z-2", "D-5JH2QW-1"]);
});

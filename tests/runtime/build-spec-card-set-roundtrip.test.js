const assert = require("node:assert/strict");

async function loadSelections() {
  return import("../../packages/runtime/src/personas/director/summary-selections.js");
}

async function loadAssembler() {
  return import("../../packages/runtime/src/personas/director/buildspec-assembler.js");
}

// --- Hazard V2: no durability in card or round-trip ---

test("normalizeCardEntry: hazard card has no durability field", async () => {
  const { normalizeCardEntry } = await loadSelections();
  const card = normalizeCardEntry({
    type: "hazard",
    source: "hazard",
    affinity: "fire",
    affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
    expression: "emit",
    proximityRadius: 2,
    mana: { kind: "regen", current: 4, max: 4, regen: 1 },
  });
  assert.equal(card.durability, undefined, "hazard card must not carry durability");
  assert.ok(card.mana, "hazard card must carry mana");
});

test("extractSummaryFromCardSet: hazard in cardSet round-trips without durability", async () => {
  const { extractSummaryFromCardSet } = await loadSelections();
  const summary = {
    dungeonAffinity: "fire",
    cardSet: [
      {
        id: "card_hazard_1",
        type: "hazard",
        source: "hazard",
        affinity: "fire",
        affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
        expressions: ["emit"],
        proximityRadius: 2,
        mana: { kind: "regen", current: 4, max: 4, regen: 1 },
        count: 1,
        motivations: [],
        setupMode: "auto",
        flipped: false,
      },
    ],
  };
  const resolved = extractSummaryFromCardSet(summary);
  assert.ok(Array.isArray(resolved.hazards) && resolved.hazards.length === 1);
  assert.equal(resolved.hazards[0].durability, undefined, "extracted hazard must not have durability");
  assert.ok(resolved.hazards[0].mana, "extracted hazard must retain mana");
});

// --- Resource V3: permanenceMode + vitals survive the round-trip ---

test("normalizeCardEntry: resource card carries permanenceMode and vitals", async () => {
  const { normalizeCardEntry } = await loadSelections();
  const card = normalizeCardEntry({
    type: "resource",
    source: "resource",
    permanenceMode: "consumable",
    vitals: [{ key: "health", delta: 10 }],
  });
  assert.equal(card.permanenceMode, "consumable", "must carry permanenceMode");
  assert.ok(Array.isArray(card.vitals) && card.vitals.length === 1, "must carry vitals array");
  assert.equal(card.vitals[0].key, "health");
  assert.equal(card.vitals[0].delta, 10);
});

test("normalizeCardEntry: resource card carries permanenceMode=permanent", async () => {
  const { normalizeCardEntry } = await loadSelections();
  const card = normalizeCardEntry({
    type: "resource",
    source: "resource",
    permanenceMode: "permanent",
    vitals: [{ key: "mana", delta: 5 }],
  });
  assert.equal(card.permanenceMode, "permanent");
  assert.equal(card.vitals[0].key, "mana");
});

test("extractSummaryFromCardSet: V3 resource in cardSet is extracted to summary.resources", async () => {
  const { extractSummaryFromCardSet } = await loadSelections();
  const summary = {
    dungeonAffinity: "fire",
    cardSet: [
      {
        id: "card_resource_1",
        type: "resource",
        source: "resource",
        affinity: "fire",
        affinities: [],
        expressions: [],
        motivations: [],
        count: 1,
        permanenceMode: "consumable",
        vitals: [{ key: "health", delta: 10 }],
        setupMode: "auto",
        flipped: false,
      },
    ],
  };
  const resolved = extractSummaryFromCardSet(summary);
  assert.ok(Array.isArray(resolved.resources) && resolved.resources.length === 1,
    "resources must be extracted from cardSet");
  assert.equal(resolved.resources[0].permanenceMode, "consumable");
  assert.equal(resolved.resources[0].vitals[0].key, "health");
});

test("buildBuildSpecFromSummary: V3 resources appear in plan.hints and configurator.inputs", async () => {
  const { buildBuildSpecFromSummary } = await loadAssembler();
  const summary = {
    dungeonAffinity: "fire",
    goal: "test",
    cardSet: [
      {
        id: "card_resource_1",
        type: "resource",
        source: "resource",
        affinity: "fire",
        affinities: [],
        expressions: [],
        motivations: [],
        count: 1,
        permanenceMode: "level",
        vitals: [{ key: "stamina", delta: 3 }],
        setupMode: "auto",
        flipped: false,
      },
    ],
  };
  const { spec } = buildBuildSpecFromSummary({ summary });
  assert.ok(spec, "spec must be produced");
  const planResources = spec.plan?.hints?.resources;
  assert.ok(Array.isArray(planResources) && planResources.length === 1,
    "plan.hints.resources must contain the resource");
  assert.equal(planResources[0].permanenceMode, "level");
  const configResources = spec.configurator?.inputs?.resources;
  assert.ok(Array.isArray(configResources) && configResources.length === 1,
    "configurator.inputs.resources must contain the resource");
  assert.equal(configResources[0].vitals[0].key, "stamina");
});

test("buildBuildSpecFromSummary: V2 hazard in cardSet has no durability in plan.hints", async () => {
  const { buildBuildSpecFromSummary } = await loadAssembler();
  const summary = {
    dungeonAffinity: "fire",
    goal: "test",
    cardSet: [
      {
        id: "card_hazard_1",
        type: "hazard",
        source: "hazard",
        affinity: "fire",
        affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
        expressions: ["emit"],
        motivations: [],
        count: 1,
        proximityRadius: 2,
        mana: { kind: "regen", current: 4, max: 4, regen: 1 },
        setupMode: "auto",
        flipped: false,
      },
    ],
  };
  const { spec } = buildBuildSpecFromSummary({ summary });
  const planHazards = spec.plan?.hints?.hazards;
  assert.ok(Array.isArray(planHazards) && planHazards.length === 1);
  assert.equal(planHazards[0].durability, undefined, "plan.hints hazard must not have durability");
});

test("buildBuildSpecFromSummary: actor card instances keep role and unique positions", async () => {
  const { buildBuildSpecFromSummary } = await loadAssembler();
  const summary = {
    dungeonAffinity: "water",
    goal: "actor placement test",
    cardSet: [
      {
        id: "A-ROLE",
        type: "delver",
        source: "actor",
        affinity: "water",
        count: 2,
        motivations: ["attacking"],
      },
      {
        id: "D-ROLE",
        type: "warden",
        source: "actor",
        affinity: "fire",
        count: 3,
        motivations: ["defending"],
      },
    ],
  };

  const { spec } = buildBuildSpecFromSummary({ summary });
  const actors = spec.configurator.inputs.actors;
  assert.equal(actors.length, 5);
  assert.deepEqual(actors.map((actor) => actor.archetype), [
    "delver",
    "delver",
    "warden",
    "warden",
    "warden",
  ]);
  assert.equal(new Set(actors.map((actor) => `${actor.position.x},${actor.position.y}`)).size, 5);
});

/*
## TODO: Test Permutations
- hazard with mana kind="one-time" round-trips preserving amount
- resource with permanenceMode="permanent" and multiple vitals survives round-trip
- empty cardSet produces empty resources/hazards arrays in resolved summary
- cardSet with mixed resource/hazard/delver entries: each type appears in its own extracted field
- room tile card with durability field survives normalizeCardEntry
- buildBuildSpecFromSummary with no resources produces no resources key in plan.hints (not empty array)
*/

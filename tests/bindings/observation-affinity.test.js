const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("bindings observation includes affinity metadata when provided", async () => {
  const { createCore, readObservation } = await import(
    "../../packages/core-ts/src/index.ts"
  );

  const fixture = JSON.parse(
    fs.readFileSync(path.resolve("tests/fixtures/personas/affinity-resolution-v1-basic.json"), "utf8"),
  );

  const core = createCore();
  core.init(1337);
  core.loadMvpScenario();

  const baseObs = readObservation(core);
  assert.deepEqual(baseObs.actors[0].affinities, []);
  assert.deepEqual(baseObs.actors[0].abilities, []);
  assert.equal(baseObs.hazards, undefined);

  const obs = readObservation(core, { affinityEffects: fixture.expected });
  assert.deepEqual(obs.actors[0].affinities, [
    { kind: "fire", expression: "push", targetType: "enemy", stacks: 2 },
    { kind: "life", expression: "pull", targetType: "self", stacks: 1 },
  ]);
  assert.deepEqual(obs.actors[0].abilities, fixture.expected.actors[0].abilities);
  assert.equal(obs.hazards.length, 1);
  assert.deepEqual(obs.hazards[0].position, fixture.expected.hazards[0].position);
  assert.deepEqual(obs.hazards[0].affinities, [
    { kind: "fire", expression: "push", targetType: "floor", stacks: 2 },
  ]);
  assert.deepEqual(obs.hazards[0].abilities, fixture.expected.hazards[0].abilities);
  assert.deepEqual(obs.hazards[0].vitals, fixture.expected.hazards[0].vitals);
});

test("bindings observation includes the actor's live affinity grant pools", async () => {
  const { createCore, readObservation } = await import(
    "../../packages/core-ts/src/index.ts"
  );

  const core = createCore();
  core.init(1337);
  core.loadMvpScenario();
  assert.equal(core.grantMotivatedActorAffinity(0, 2, 3, 2, 7, 12, 1), 1);

  const observation = readObservation(core);
  assert.deepEqual(observation.actors[0].affinityGrants, [
    {
      kind: "water",
      expression: "emit",
      stacks: 2,
      mana: 7,
      manaMax: 12,
      manaRegen: 1,
    },
  ]);
});

test("bindings observation exposes canonical post-cancellation affinity field records", async () => {
  const [{ createCore, readObservation }, { AffinityExpression, AffinityKind, getAffinityVitalEffect }, { VitalKind }] = await Promise.all([
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/core-ts/src/state/affinity.ts"),
    import("../../packages/core-ts/src/state/vitals.ts"),
  ]);

  const core = createCore();
  core.configureGrid(5, 5);
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) core.setTileAt(x, y, 1);
  }
  core.armStaticHazardAt(2, 2, AffinityKind.Fire, AffinityExpression.Emit, 2, 5);
  core.computeAffinityField();

  const observation = readObservation(core);
  const field = observation.affinityFields.find((entry) => (
    entry.position.x === 2 && entry.position.y === 2 && entry.kind === AffinityKind.Fire
  ));

  assert.deepEqual(field, {
    position: { x: 2, y: 2 },
    kind: AffinityKind.Fire,
    expression: AffinityExpression.Emit,
    stacks: core.getAffinityFieldStacksAt(2, 2, AffinityKind.Fire),
    intensity: core.getAffinityFieldIntensityAt(2, 2, AffinityKind.Fire),
    contributionCount: core.getAffinityFieldContributionCountAt(2, 2, AffinityKind.Fire),
    vitalEffects: [
      {
        vital: VitalKind.Health,
        effect: getAffinityVitalEffect(
          AffinityKind.Fire,
          AffinityExpression.Emit,
          VitalKind.Health,
          core.getAffinityFieldStacksAt(2, 2, AffinityKind.Fire),
        ),
      },
    ],
  });
});

test("bindings observation omits field records canceled by an opposite affinity", async () => {
  const [{ createCore, readObservation }, { AffinityExpression, AffinityKind }] = await Promise.all([
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/core-ts/src/state/affinity.ts"),
  ]);

  const core = createCore();
  core.configureGrid(9, 7);
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 9; x += 1) core.setTileAt(x, y, 1);
  }
  core.armStaticHazardAt(2, 3, AffinityKind.Fire, AffinityExpression.Emit, 3, 5);
  core.armStaticHazardAt(6, 3, AffinityKind.Water, AffinityExpression.Emit, 3, 5);
  core.computeAffinityField();

  const fieldsAtOverlap = readObservation(core).affinityFields.filter((entry) => (
    entry.position.x === 4 && entry.position.y === 3
  ));
  assert.deepEqual(
    fieldsAtOverlap,
    [],
    "the observation must expose core's post-cancellation field, not the two pre-cancellation sources",
  );
});

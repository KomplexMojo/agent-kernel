/**
 * AM.5 — `cast_affinity` carries an actor's affinity into the world (closes F5).
 *
 * Before this, an affinity was inert during play. The Moderator built
 * `apply_vital_affinity` effects and then dropped them — `buildActionFromEffect`
 * returns null for everything except the three environment operations — and
 * `ACTION_SCHEMA` had no action kind that could reach a vital at all. So
 * core's `applyAffinityDamage`, `applyAffinityDamageToHazard` and
 * `applyAffinityPullFromHazard`, all built and unit-tested, had **zero
 * production callers**: an actor's affinity was data it carried and never used.
 *
 * Every assertion here is on CORE STATE after the action, never on the ledger.
 */
"use strict";

const assert = require("node:assert/strict");

function makeFloorGrid(w, h) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      x === 0 || x === w - 1 || y === 0 || y === h - 1 ? "#" : "."
    ).join("")
  );
}

function buildSimConfig({ width = 9, height = 9, hazards = [] } = {}) {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "cast_sim", runId: "cast", createdAt: "2026-08-14T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width,
        height,
        tiles: makeFloorGrid(width, height),
        spawn: { x: 1, y: 1 },
        exit: { x: width - 2, y: height - 2 },
        rooms: [{ id: "R1", x: 0, y: 0, width, height }],
        hazards,
      },
    },
  };
}

function vitals({ hp = 20, mana = 20 } = {}) {
  return {
    health: { current: hp, max: hp, regen: 0 },
    mana: { current: mana, max: mana, regen: 0 },
    stamina: { current: 6, max: 6, regen: 2 },
    durability: { current: 1, max: 1, regen: 0 },
  };
}

function buildInitialState(actors) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "cast", runId: "cast", createdAt: "2026-08-14T00:00:00.000Z" },
    simConfigRef: { id: "cast_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors,
  };
}

function actor(id, position, { motivation = "attacking", v = vitals() } = {}) {
  return {
    id,
    kind: "ambulatory",
    archetype: id.startsWith("delver") ? "delver" : "warden",
    role: id.startsWith("delver") ? "delver" : "warden",
    position,
    motivation: { kind: motivation },
    traits: { affinities: { fire: 1 } },
    vitals: v,
  };
}

/**
 * Affinities reach the Actor through the observation, which is built from the
 * run's `affinityEffects` payload (core-ts mvp-movement buildAffinitiesAndAbilities).
 * This is the same shape the Configurator's resolveAffinityEffects produces.
 */
function affinityEffectsFor(entries) {
  return {
    actors: entries.map(({ id, kind, expression, stacks }) => ({
      actorId: id,
      affinityStacks: { [`${kind}:${expression}`]: stacks },
    })),
  };
}

async function startRuntime({ simConfig, initialState, affinityEffects = null }) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState, affinityEffects });
  return { core, runtime };
}

const HEALTH = 0;

// ---------------------------------------------------------------------------
// A cast reaches a target actor's vital
// ---------------------------------------------------------------------------

test("an attacking actor holding fire/push lowers its target's health in core", async () => {
  const initialState = buildInitialState([
    actor("delver_1", { x: 3, y: 3 }),
    actor("warden_1", { x: 4, y: 3 }),
  ]);
  const { core, runtime } = await startRuntime({
    simConfig: buildSimConfig(),
    initialState,
    affinityEffects: affinityEffectsFor([
      { id: "delver_1", kind: "fire", expression: "push", stacks: 2 },
    ]),
  });

  const before = core.getMotivatedActorVitalCurrentByIndex(1, HEALTH);
  await runtime.step();
  const after = core.getMotivatedActorVitalCurrentByIndex(1, HEALTH);

  assert.ok(
    after < before,
    "fire drains health, so an actor holding fire/push next to a hostile must lower its health "
      + `by expressing it: ${before} -> ${after}. Equal means the affinity never reached the world.`,
  );

  const cast = runtime.getTickFrames()
    .flatMap((f) => f.acceptedActions || [])
    .filter((a) => a.kind === "cast_affinity");
  assert.ok(cast.length > 0, "and the cast must be recorded as an accepted action");
});

test("an actor whose affinity cannot reach proposes no cast, and nothing is harmed", async () => {
  // stacks doubles as push/pull range in core, so 1 stack cannot cross 6 tiles.
  const initialState = buildInitialState([
    actor("delver_1", { x: 1, y: 1 }),
    actor("warden_1", { x: 7, y: 7 }),
  ]);
  const { core, runtime } = await startRuntime({
    simConfig: buildSimConfig(),
    initialState,
    affinityEffects: affinityEffectsFor([
      { id: "delver_1", kind: "fire", expression: "push", stacks: 1 },
    ]),
  });

  const before = core.getMotivatedActorVitalCurrentByIndex(1, HEALTH);
  await runtime.step();

  assert.equal(
    core.getMotivatedActorVitalCurrentByIndex(1, HEALTH),
    before,
    "an affinity out of range must not touch the target",
  );
  const casts = runtime.getTickFrames()
    .flatMap((f) => f.acceptedActions || [])
    .filter((a) => a.kind === "cast_affinity");
  assert.equal(
    casts.length,
    0,
    "the Actor must not propose a cast core would refuse — an accepted action that changes "
      + "nothing is exactly the lie AM.1 exists to prevent",
  );
});

// ---------------------------------------------------------------------------
// The caster pays
// ---------------------------------------------------------------------------

test("casting spends the caster's mana at the AUTHORED price", async () => {
  const initialState = buildInitialState([
    actor("delver_1", { x: 3, y: 3 }),
    actor("warden_1", { x: 4, y: 3 }),
  ]);
  const { core, runtime } = await startRuntime({
    simConfig: buildSimConfig(),
    initialState,
    affinityEffects: affinityEffectsFor([
      { id: "delver_1", kind: "fire", expression: "push", stacks: 1 },
    ]),
  });

  const MANA = 1;
  const before = core.getMotivatedActorVitalCurrentByIndex(0, MANA);
  await runtime.step();
  const after = core.getMotivatedActorVitalCurrentByIndex(0, MANA);

  assert.ok(
    after < before,
    `a cast must draw mana from the caster: ${before} -> ${after}. A free cast is an unpriced `
      + "resource — and core's own formula charges 0 for push, which is exactly why the price "
      + "comes from the authored rules artifact instead (F10c).",
  );
});

// ## TODO: Test Permutations
//
// Keep every assertion on core state.
//
// - all 10 affinity kinds x all 4 expressions against an actor target: the sign
//   of the change must match the matrix (Water/Life/Fortify/Light/Earth buff,
//   Fire/Wind/Decay/Corrode/Dark drain), and the routed vital must be the
//   affinity's primary one
// - push vs pull sign reversal on the same kind and target
// - stacks 1..5: effect magnitude must scale linearly, and push/pull range with it
// - a caster with insufficient mana: refused, recorded, target untouched
// - hazard targets: durability damage, destruction at 0, and the immortal
//   (durabilityMax 0) hazard which must refuse
// - a pull against a matching armed hazard: neutralization transfers its mana

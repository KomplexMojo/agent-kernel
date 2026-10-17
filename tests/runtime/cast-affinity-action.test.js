/**
 * AM.5 — `cast_affinity` carries an actor's affinity into the world (closes F5).
 *
 * Every assertion here is on REGISTRY STATE after the action, never on the ledger.
 */
"use strict";

const assert = require("node:assert/strict");

async function artifacts(actors, { width = 9, height = 9 } = {}) {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const terrain = boxedTerrain(width, height);
  terrain[width + 1] = "spawn";
  terrain[(height - 2) * width + (width - 2)] = "exit";
  return buildUnifiedArtifacts({
    width,
    height,
    terrain,
    runId: "cast",
    clock: "2026-08-14T00:00:00.000Z",
    actors,
  });
}

function actor(id, position, { motivation, stacks = 2 } = {}) {
  const category = id.startsWith("delver") ? "delver" : "warden";
  const attacking = category === "delver";
  return {
    id,
    category,
    position,
    motivations: [motivation ?? (attacking ? "attacking" : "stationary")],
    affinities: attacking ? [{ kind: "fire", expression: "push", stacks }] : [],
    activeAffinityKey: attacking ? "fire:push" : null,
    vitals: {
      health: { current: 20, max: 20, regen: 0 },
      mana: { current: 20, max: 20, regen: 0 },
      stamina: { current: 6, max: 6, regen: 0 },
    },
  };
}

async function startRuntime(actors) {
  const { simConfig, initialState } = await artifacts(actors);
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  return runtime;
}

function vital(runtime, id, key) {
  return runtime.getActorSnapshot().actors.find((entry) => entry.id === id).vitals[key].current;
}

test("an attacking actor holding fire/push lowers its target's health in core", async () => {
  const runtime = await startRuntime([
    actor("delver_1", { x: 3, y: 3 }),
    actor("warden_1", { x: 4, y: 3 }),
  ]);

  const before = vital(runtime, "warden_1", "health");
  await runtime.step();
  const after = vital(runtime, "warden_1", "health");

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
  const runtime = await startRuntime([
    actor("delver_1", { x: 1, y: 1 }, { stacks: 1 }),
    actor("warden_1", { x: 7, y: 7 }),
  ]);

  const before = vital(runtime, "warden_1", "health");
  await runtime.step();

  assert.equal(
    vital(runtime, "warden_1", "health"),
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

test("casting spends the caster's mana at the AUTHORED price", async () => {
  const runtime = await startRuntime([
    actor("delver_1", { x: 3, y: 3 }, { stacks: 1 }),
    actor("warden_1", { x: 4, y: 3 }),
  ]);

  const before = vital(runtime, "delver_1", "mana");
  await runtime.step();
  const after = vital(runtime, "delver_1", "mana");

  assert.ok(
    after < before,
    `a cast must draw mana from the caster: ${before} -> ${after}. A free cast is an unpriced `
      + "resource — and core's own formula charges 0 for push, which is exactly why the price "
      + "comes from the authored rules artifact instead (F10c).",
  );
});

// ## TODO: Test Permutations
//
// Keep every assertion on registry state.
//
// - all 10 affinity kinds x all 4 expressions against an actor target: the sign
//   of the change must match the matrix (Water/Growth/Fortify/Light/Earth buff,
//   Fire/Wind/Decay/Corrode/Dark drain), and the routed vital must be the
//   affinity's primary one
// - push vs pull sign reversal on the same kind and target
// - stacks 1..5: effect magnitude must scale linearly, and push/pull range with it
// - a caster with insufficient mana: refused, recorded, target untouched
// - hazard targets: durability damage, destruction at 0, and the immortal
//   (durabilityMax 0) hazard which must refuse
// - a pull against a matching armed hazard: neutralization transfers its mana

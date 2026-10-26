/**
 * Unified combat through `cast_affinity`. Conventional `attack` is rejected.
 * Assertions are registry state after the action, never leftover world.ts APIs.
 */
"use strict";

const assert = require("node:assert/strict");

async function artifacts(actors) {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const width = 5;
  const height = 5;
  const terrain = boxedTerrain(width, height);
  terrain[width + 1] = "spawn";
  terrain[2 * width + 4] = "exit";
  return buildUnifiedArtifacts({
    width,
    height,
    terrain,
    runId: "combat_test",
    clock: "2026-01-01T00:00:00.000Z",
    actors,
  });
}

function actor(id, category, position, { motivation = "attacking", stacks = 2, health = 10 } = {}) {
  return {
    id,
    category,
    position,
    motivations: [motivation],
    affinities: category === "delver" || motivation === "attacking"
      ? [{ kind: "fire", expression: "push", stacks }]
      : [],
    activeAffinityKey: (category === "delver" || motivation === "attacking") ? "fire:push" : null,
    vitals: {
      health: { current: health, max: health, regen: 0 },
      mana: { current: 20, max: 20, regen: 0 },
      stamina: { current: 10, max: 10, regen: 0 },
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

function health(runtime, id) {
  return runtime.getActorSnapshot().actors.find((entry) => entry.id === id).vitals.health.current;
}

function accepted(runtime, kind) {
  return runtime.getTickFrames().flatMap((frame) => frame.acceptedActions || []).filter((action) => action.kind === kind);
}

test("runtime accepts cast_affinity from an adjacent attacking actor and records it in tick frames", async () => {
  const runtime = await startRuntime([
    actor("delver_1", "delver", { x: 1, y: 2 }),
    actor("warden_1", "warden", { x: 2, y: 2 }, { motivation: "defending", health: 6 }),
  ]);
  await runtime.step();
  const casts = accepted(runtime, "cast_affinity");
  assert.ok(casts.length > 0, "at least one tick frame must contain an accepted cast_affinity");
  assert.equal(casts[0].actorId, "delver_1");
  assert.equal(casts[0].params.targetId, "warden_1");
  assert.equal(accepted(runtime, "attack").length, 0, "conventional attack is not an accepted action");
});

test("accepted cast reduces warden health in the registry", async () => {
  const runtime = await startRuntime([
    actor("delver_1", "delver", { x: 1, y: 2 }),
    actor("warden_1", "warden", { x: 2, y: 2 }, { motivation: "defending", health: 6 }),
  ]);
  const before = health(runtime, "warden_1");
  await runtime.step();
  const after = health(runtime, "warden_1");
  assert.ok(after < before, `warden health should drop after a cast, ${before} -> ${after}`);
});

test("out-of-range affinity does not appear as an accepted cast", async () => {
  const runtime = await startRuntime([
    actor("delver_1", "delver", { x: 1, y: 2 }, { stacks: 1 }),
    actor("warden_1", "warden", { x: 3, y: 2 }, { motivation: "defending", health: 6 }),
  ]);
  await runtime.step();
  assert.equal(accepted(runtime, "cast_affinity").length, 0);
  assert.equal(health(runtime, "warden_1"), 6);
});

test("further casts keep decrementing warden health, even after a knockback", async () => {
  const runtime = await startRuntime([
    actor("delver_1", "delver", { x: 1, y: 2 }),
    actor("warden_1", "warden", { x: 2, y: 2 }, { motivation: "defending", health: 6 }),
  ]);
  await runtime.step();
  const afterFirst = health(runtime, "warden_1");
  // #482: the first hit knocks the warden back, so the delver may close in before it casts again.
  let afterSecond = afterFirst;
  for (let tick = 0; tick < 4 && afterSecond >= afterFirst; tick += 1) {
    await runtime.step();
    afterSecond = health(runtime, "warden_1");
  }
  assert.ok(afterFirst < 6);
  assert.ok(afterSecond < afterFirst);
  assert.ok(accepted(runtime, "cast_affinity").length >= 2);
});

test("runtime step with no hostile actors present records no casts and keeps movement", async () => {
  const runtime = await startRuntime([
    actor("delver_1", "delver", { x: 1, y: 2 }, { motivation: "exploring" }),
  ]);
  await runtime.step();
  assert.equal(accepted(runtime, "attack").length, 0);
  assert.equal(accepted(runtime, "cast_affinity").length, 0);
  assert.ok(accepted(runtime, "move").length > 0);
});

test("attack remains an unsupported action kind", async () => {
  const runtime = await startRuntime([
    actor("delver_1", "delver", { x: 1, y: 2 }),
    actor("warden_1", "warden", { x: 2, y: 2 }, { motivation: "defending", health: 6 }),
  ]);
  await runtime.step({
    personaPayloads: {
      actor: { proposals: [{ kind: "attack", params: { targetId: "warden_1", damage: 2 } }] },
    },
  });
  assert.equal(accepted(runtime, "attack").length, 0);
  const rejection = runtime.getTickFrames()
    .flatMap((frame) => frame.preCoreRejections || [])
    .find((entry) => entry.action?.kind === "attack");
  assert.ok(rejection, "attack must be recorded as a rejection, not silently dropped");
  assert.equal(rejection.reason, "unsupported_action_kind");
});

// ## TODO: Test Permutations
// - lethal cast reaches health 0 and later ticks do not target the defeated actor
// - two attacking actors both cast on the same tick

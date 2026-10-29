/**
 * Unified delver vs warden: approach then cast_affinity. Conventional attack is gone.
 */
"use strict";

const assert = require("node:assert/strict");

async function battleArtifacts() {
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
    runId: "delver_warden_battle",
    clock: "2026-06-04T00:00:00.000Z",
    actors: [
      {
        id: "delver_1",
        category: "delver",
        position: { x: 1, y: 2 },
        motivations: ["attacking"],
        // #340: range 2 reaches the warden; intensity 2 hits for 2 × 2² = 8 and costs base × 2² × 3.
        affinities: [{ kind: "fire", expression: "push", stacks: 2, intensity: 2 }],
        activeAffinityKey: "fire:push",
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 30, max: 30, regen: 0 },
          stamina: { current: 10, max: 10, regen: 0 },
        },
      },
      {
        id: "warden_1",
        category: "warden",
        position: { x: 3, y: 2 },
        motivations: ["defending"],
        // #218: armed actors see adjacent tiles plus lit cells. The warden's lamp
        // lights the gap so the delver, two tiles away, can see it to approach.
        affinities: [{ kind: "light", expression: "emit", stacks: 1 }],
        activeAffinityKey: "light:emit",
        vitals: {
          health: { current: 6, max: 6, regen: 0 },
          mana: { current: 6, max: 6, regen: 0 },
          stamina: { current: 6, max: 6, regen: 0 },
        },
      },
    ],
  });
}

async function runBattle(ticks = 6) {
  const { simConfig, initialState } = await battleArtifacts();
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  for (let t = 0; t < ticks; t++) await runtime.step();
  return runtime;
}

function accepted(runtime) {
  return runtime.getTickFrames().flatMap((frame) => frame.acceptedActions || []);
}

test("unified battle artifacts carry Configurator actors with attacking/defending motivations", async () => {
  const { initialState } = await battleArtifacts();
  assert.equal(initialState.schema, "agent-kernel/InitialStateArtifact");
  assert.equal(initialState.actors.length, 2);
  const delver = initialState.actors.find((actor) => actor.id === "delver_1");
  const warden = initialState.actors.find((actor) => actor.id === "warden_1");
  assert.ok(delver && warden);
  assert.ok(delver.motivations.includes("attacking"));
  assert.ok(warden.motivations.includes("defending"));
});

test("scenario runs approach then cast_affinity without conventional attack", async () => {
  const runtime = await runBattle(6);
  const actions = accepted(runtime);
  const firstMove = actions.find((action) => action.kind === "move" && action.actorId === "delver_1");
  assert.ok(firstMove, "delver must move toward the warden");
  assert.equal(firstMove.params.target.x, 2);
  assert.equal(firstMove.params.target.y, 2);

  const casts = actions.filter(
    (action) => action.kind === "cast_affinity" && action.actorId === "delver_1" && action.params?.targetId === "warden_1",
  );
  assert.ok(casts.length > 0, "delver must cast at the adjacent warden");
  assert.equal(actions.some((action) => action.kind === "attack"), false);

  const warden = runtime.getActorSnapshot().actors.find((actor) => actor.id === "warden_1");
  assert.ok(warden.vitals.health.current < 6, "warden health must drop after casts");
  const delver = runtime.getActorSnapshot().actors.find((actor) => actor.id === "delver_1");
  assert.ok(delver.position.x >= 2, "delver should finish adjacent to the warden");
});

test("scenario is deterministic: two independent runs produce identical accepted-action sequences", async () => {
  async function runOnce() {
    const runtime = await runBattle(6);
    return accepted(runtime).map((action) => ({ kind: action.kind, actorId: action.actorId, params: action.params }));
  }
  assert.deepEqual(await runOnce(), await runOnce());
});

// ## TODO: Test Permutations
// - lethal cast sequence reaches health 0
// - defending warden does not propose conventional attack

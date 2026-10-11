"use strict";

const assert = require("node:assert/strict");

async function artifacts(actors, { width = 11, height = 11, runId = "field" } = {}) {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const terrain = boxedTerrain(width, height);
  terrain[width + 1] = "spawn";
  terrain[(height - 2) * width + (width - 2)] = "exit";
  return buildUnifiedArtifacts({
    width,
    height,
    terrain,
    runId,
    clock: "2026-08-14T00:00:00.000Z",
    actors,
  });
}

function actor(id, position, motivation = "exploring") {
  return {
    id,
    category: "delver",
    position,
    motivations: [motivation],
    affinities: [{ kind: "fire", expression: "emit", stacks: 3 }],
    activeAffinityKey: "fire:emit",
    vitals: {
      health: { current: 20, max: 20, regen: 0 },
      mana: { current: 20, max: 20, regen: 0 },
      stamina: { current: 8, max: 8, regen: 4 },
    },
  };
}

async function startRuntime({ simConfig, initialState }) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  return runtime;
}

async function fieldFingerprint(runtime) {
  const { readActorRegistryObservation } = await import("../../packages/core-ts/src/rules/actor-observation.ts");
  const observation = readActorRegistryObservation({ snapshot: () => runtime.getActorSnapshot() }, 0);
  return observation.affinityFields
    .filter((field) => field.intensity > 0 || field.stacks > 0)
    .map((field) => `${field.position.x},${field.position.y}:${field.kind}:${field.intensity}:${field.stacks}`)
    .sort()
    .join("|");
}

test("the affinity field changes across ticks as its source actor moves", async () => {
  const { simConfig, initialState } = await artifacts([actor("delver_1", { x: 5, y: 5 }, "exploring")]);
  const runtime = await startRuntime({ simConfig, initialState });

  await runtime.step();
  const early = await fieldFingerprint(runtime);
  const earlyPos = runtime.getActorSnapshot().actors.find((entry) => entry.id === "delver_1").position;

  for (let i = 0; i < 6; i += 1) await runtime.step();
  const late = await fieldFingerprint(runtime);
  const latePos = runtime.getActorSnapshot().actors.find((entry) => entry.id === "delver_1").position;

  assert.notDeepEqual(
    earlyPos,
    latePos,
    "precondition: the actor must actually have moved, or this test proves nothing",
  );
  assert.ok(early.length > 0 || late.length > 0, "the emitting actor must produce some field");
  assert.notEqual(
    late,
    early,
    "the field must follow the actor. Identical fingerprints across a run in which the actor "
      + `moved ${earlyPos.x},${earlyPos.y} -> ${latePos.x},${latePos.y} mean it is still the setup-time snapshot (F7).`,
  );
});

// ## TODO: Test Permutations
//
// - a STATIONARY emitter: the field fingerprint must be identical across ticks,
//   which is the honest counterpart to the test above — prove the field is
//   tracking the actor rather than merely being noisy
// - two emitters of the same kind whose radii overlap: the overlap cell's stacks
//   must reflect both contributions, and must change when one of them moves away
// - two emitters of OPPOSITE kinds overlapping (fire vs water)
// - an actor whose grant is spent mid-run: its contribution must disappear from
//   the field on the tick after the grant is dropped
// - field state after 100 ticks must be a pure function of the final positions,
//   not of the path taken to reach them

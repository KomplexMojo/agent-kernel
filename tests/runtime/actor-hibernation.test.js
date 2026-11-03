/**
 * Hibernation is distance from the controlled actor (Chebyshev), not fog/camera.
 * Far wardens skip decide until the player approaches; near ones keep acting.
 */
const assert = require("node:assert/strict");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { createRuntime } = require("../../packages/runtime/src/runner/runtime.js");
const { createCore } = require("../../packages/core-ts/src/index.ts");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

/** Wide open strip: hero at left, near warden, far warden to the right. */
const W = 48;
const wall = "#".repeat(W);
const hall = `S${".".repeat(W - 2)}E`;
const STRIP = [wall, hall, wall];

const HERO = {
  category: "delver",
  id: "hero",
  position: { x: 1, y: 1 },
  vitals: viableVitals({ stamina: 200 }),
  motivations: ["user_controlled"],
};
const NEAR = {
  category: "warden",
  id: "near",
  position: { x: 4, y: 1 },
  vitals: viableVitals(),
  motivations: ["attacking"],
  affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
  activeAffinityKey: "fire:push",
};
const FAR = {
  category: "warden",
  id: "far",
  position: { x: 40, y: 1 },
  vitals: viableVitals(),
  motivations: ["attacking"],
  affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
  activeAffinityKey: "fire:push",
};

function truthPos(sessionOrRuntime, id) {
  if (typeof sessionOrRuntime.debugView === "function") {
    return sessionOrRuntime.debugView().actors.find((actor) => actor.id === id)?.position;
  }
  return sessionOrRuntime.getActorSnapshot().actors.find((actor) => actor.id === id)?.position;
}

function acceptedByActor(frames) {
  const byActor = new Map();
  for (const frame of frames) {
    for (const action of frame?.acceptedActions || []) {
      if (!action?.actorId) continue;
      if (!byActor.has(action.actorId)) byActor.set(action.actorId, []);
      byActor.get(action.actorId).push(action);
    }
  }
  return byActor;
}

test("in-radius wardens still decide; out-of-radius wardens are skipped", async () => {
  const level = buildUnifiedLevel({ id: "hibernation-skip", tiles: STRIP, actors: [HERO, NEAR, FAR] });
  const runtime = createRuntime({ core: createCore(), adapters: {}, hibernationRadius: 5 });
  await runtime.init({ seed: 0, simConfig: level.simConfig, initialState: level.initialState });
  const farBefore = { ...truthPos(runtime, "far") };

  for (let i = 0; i < 6; i += 1) {
    await runtime.step({
      focusActorId: "hero",
      actorCommands: { hero: { kind: "wait" } },
    });
  }
  const byActor = acceptedByActor(runtime.getTickFrames());
  assert.ok((byActor.get("near") || []).length > 0, "near warden must receive accepted actions");
  assert.equal((byActor.get("far") || []).length, 0, "far warden must not decide while hibernating");
  assert.deepEqual(truthPos(runtime, "far"), farBefore, "hibernating far warden must not move");
});

test("waking when the controlled actor is within radius", async () => {
  // Same far warden: hibernates with focus at spawn, decides when focus is placed nearby.
  const asleep = buildUnifiedLevel({ id: "hibernation-asleep", tiles: STRIP, actors: [HERO, FAR] });
  const asleepRt = createRuntime({ core: createCore(), adapters: {}, hibernationRadius: 5 });
  await asleepRt.init({ seed: 0, simConfig: asleep.simConfig, initialState: asleep.initialState });
  for (let i = 0; i < 3; i += 1) {
    await asleepRt.step({ focusActorId: "hero", actorCommands: { hero: { kind: "wait" } } });
  }
  assert.equal((acceptedByActor(asleepRt.getTickFrames()).get("far") || []).length, 0);

  const woken = buildUnifiedLevel({
    id: "hibernation-woken",
    tiles: STRIP,
    actors: [{ ...HERO, position: { x: 36, y: 1 } }, { ...FAR, position: { x: 40, y: 1 } }],
  });
  const awakeRt = createRuntime({ core: createCore(), adapters: {}, hibernationRadius: 5 });
  await awakeRt.init({ seed: 0, simConfig: woken.simConfig, initialState: woken.initialState });
  for (let i = 0; i < 4; i += 1) {
    await awakeRt.step({ focusActorId: "hero", actorCommands: { hero: { kind: "wait" } } });
  }
  assert.ok(
    (acceptedByActor(awakeRt.getTickFrames()).get("far") || []).length > 0,
    "far warden must decide once the controlled actor is within Chebyshev radius",
  );
});

test("fog does not hibernate: an off-screen but in-radius warden still decides", async () => {
  const short = ["###########", "S........E#", "###########"];
  const level = buildUnifiedLevel({
    id: "hibernation-fog",
    tiles: short,
    actors: [
      { ...HERO, position: { x: 1, y: 1 } },
      { ...NEAR, id: "lurker", position: { x: 4, y: 1 } },
    ],
  });
  const foggy = createRuntime({ core: createCore(), adapters: {}, hibernationRadius: 5 });
  await foggy.init({ seed: 0, simConfig: level.simConfig, initialState: level.initialState });
  for (let i = 0; i < 4; i += 1) {
    await foggy.step({ focusActorId: "hero", actorCommands: { hero: { kind: "wait" } } });
  }
  const fogActions = acceptedByActor(foggy.getTickFrames()).get("lurker") || [];
  assert.ok(fogActions.length > 0, "in-radius warden must decide even when the player cannot see it");
});

// ## TODO: Test Permutations
// - hibernationRadius: false keeps far warden deciding on the strip
// - commanded far actor via alwaysAwake / actorCommands

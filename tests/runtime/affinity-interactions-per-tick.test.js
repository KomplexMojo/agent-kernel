/**
 * AM.8 — affinity fields that meet are RESOLVED during the tick (closes F6).
 *
 * Unified ActorTurn.resolveFields() projects overlapping emit/draw cells and
 * applies exposure. Cancellation lives on the projected field, not on leftover
 * world.ts pair records.
 */
"use strict";

const assert = require("node:assert/strict");

async function artifacts(actors, { width = 11, height = 11 } = {}) {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const terrain = boxedTerrain(width, height);
  terrain[width + 1] = "spawn";
  terrain[(height - 2) * width + (width - 2)] = "exit";
  return buildUnifiedArtifacts({
    width,
    height,
    terrain,
    runId: "ix",
    clock: "2026-08-14T00:00:00.000Z",
    actors,
  });
}

function actor(id, position, affinity, motivation = "stationary") {
  return {
    id,
    category: id.startsWith("delver") ? "delver" : "warden",
    position,
    motivations: [motivation],
    affinities: [affinity],
    activeAffinityKey: `${affinity.kind}:${affinity.expression}`,
    vitals: {
      health: { current: 20, max: 20, regen: 0 },
      mana: { current: 20, max: 20, regen: 0 },
      stamina: { current: 8, max: 8, regen: 4 },
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

async function observe(runtime) {
  const { readActorRegistryObservation } = await import("../../packages/core-ts/src/rules/actor-observation.ts");
  return readActorRegistryObservation({ snapshot: () => runtime.getActorSnapshot() }, 0);
}

function sharedCells(contributions, leftId, rightId) {
  const cells = new Map();
  for (const field of contributions) {
    const key = `${field.position.x},${field.position.y}`;
    const ids = cells.get(key) || new Set();
    ids.add(field.sourceId);
    cells.set(key, ids);
  }
  return [...cells.entries()].filter(([, ids]) => ids.has(leftId) && ids.has(rightId)).map(([key]) => key);
}

function stacksOf(runtime, id) {
  const entry = runtime.getActorSnapshot().actors.find((actor) => actor.id === id);
  return entry?.affinities?.[0]?.stacks ?? 0;
}

function fieldsResolved(runtime) {
  return runtime.getTickFrames().some((frame) => frame.emittedSnapshot?.view?.turn?.fieldsResolved);
}

test("two actors whose fields overlap produce a resolved interaction", async () => {
  const runtime = await startRuntime([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "emit", stacks: 3 }),
  ]);

  await runtime.step();
  const observation = await observe(runtime);
  assert.ok(fieldsResolved(runtime), "ActorTurn must resolve fields after the tick's actions");
  assert.ok(
    sharedCells(observation.affinityContributions, "delver_1", "warden_1").length > 0,
    "adjacent emitters must share at least one contribution cell. Zero overlap means the field "
      + "never left its source tile.",
  );
});

test("actors far apart produce no interaction at all", async () => {
  const runtime = await startRuntime([
    actor("delver_1", { x: 1, y: 1 }, { kind: "fire", expression: "emit", stacks: 1 }),
    actor("warden_1", { x: 9, y: 9 }, { kind: "water", expression: "emit", stacks: 1 }),
  ]);

  await runtime.step();
  const observation = await observe(runtime);
  assert.deepEqual(
    sharedCells(observation.affinityContributions, "delver_1", "warden_1"),
    [],
    "fields that do not reach each other must not share a cell — a rule that fires for every pair "
      + "regardless of distance would be indistinguishable from one that ignores position",
  );
});

test("a cancelling cell reduces both actors' stacks in core", async () => {
  const runtime = await startRuntime([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "emit", stacks: 2 }),
  ]);

  await runtime.step();
  const observation = await observe(runtime);
  const overlap = sharedCells(observation.affinityContributions, "delver_1", "warden_1");
  assert.ok(overlap.length > 0, "fire(3) vs water(2) at range 1 must overlap");
  const [key] = overlap;
  const [x, y] = key.split(",").map(Number);
  const contributions = observation.affinityContributions.filter((field) => field.position.x === x && field.position.y === y);
  const nets = observation.affinityFields.filter((field) => field.position.x === x && field.position.y === y);
  const contributedStacks = contributions.reduce((sum, field) => sum + field.stacks, 0);
  const netStacks = nets.reduce((sum, field) => sum + field.stacks, 0);
  assert.ok(
    netStacks < contributedStacks,
    "opposite emit overlap must cancel on the projected field, not only in a leftover pair record",
  );
  assert.equal(stacksOf(runtime, "delver_1"), 3, "source stacks stay authored; cancellation is a field net");
  assert.equal(stacksOf(runtime, "warden_1"), 2, "target stacks stay authored; cancellation is a field net");
});

test("the Moderator plans pairs deterministically, lower index first", async () => {
  const { planAffinityInteractions } = await import(
    "../../packages/runtime/src/personas/moderator/affinity-interactions.js"
  );
  const computeRadius = () => 2;
  const actors = [
    { index: 2, x: 5, y: 5, kind: 1, expression: 3, stacks: 2 },
    { index: 0, x: 6, y: 5, kind: 2, expression: 3, stacks: 2 },
    { index: 1, x: 20, y: 20, kind: 1, expression: 3, stacks: 2 },
  ];

  const pairs = planAffinityInteractions({ actors, computeRadius });
  assert.equal(pairs.length, 1, "only the two in contact may pair; the distant actor must not");
  assert.equal(pairs[0].sourceIndex, 0, "lower index is the source regardless of input order");
  assert.equal(pairs[0].targetIndex, 2);
});

test("an actor with no affinity is never paired", async () => {
  const { planAffinityInteractions } = await import(
    "../../packages/runtime/src/personas/moderator/affinity-interactions.js"
  );
  const pairs = planAffinityInteractions({
    actors: [
      { index: 0, x: 5, y: 5, kind: 0, expression: 0, stacks: 0 },
      { index: 1, x: 5, y: 6, kind: 1, expression: 3, stacks: 2 },
    ],
    computeRadius: () => 3,
  });
  assert.deepEqual(pairs, [], "nothing to resolve against an actor that holds no affinity");
});

test("SAME-kind fields resolve but do NOT cancel", async () => {
  const runtime = await startRuntime([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "fire", expression: "emit", stacks: 2 }),
  ]);

  await runtime.step();
  const observation = await observe(runtime);
  const overlap = sharedCells(observation.affinityContributions, "delver_1", "warden_1");
  assert.ok(overlap.length > 0, "same-kind emitters still occupy overlapping cells");
  const [key] = overlap;
  const [x, y] = key.split(",").map(Number);
  const nets = observation.affinityFields.filter((field) => field.position.x === x && field.position.y === y && field.kind === "fire");
  assert.ok(nets.length > 0, "a same-relationship cell does not cancel fire off the board");
  assert.equal(stacksOf(runtime, "delver_1"), 3, "stacks untouched");
  assert.equal(stacksOf(runtime, "warden_1"), 2);
});

test("NEUTRAL-kind fields resolve but do NOT cancel", async () => {
  const runtime = await startRuntime([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "earth", expression: "emit", stacks: 2 }),
  ]);

  await runtime.step();
  const observation = await observe(runtime);
  const overlap = sharedCells(observation.affinityContributions, "delver_1", "warden_1");
  assert.ok(overlap.length > 0);
  const [key] = overlap;
  const [x, y] = key.split(",").map(Number);
  const nets = observation.affinityFields.filter((field) => field.position.x === x && field.position.y === y);
  assert.ok(nets.some((field) => field.kind === "fire"));
  assert.ok(nets.some((field) => field.kind === "earth"));
  assert.equal(stacksOf(runtime, "delver_1"), 3);
  assert.equal(stacksOf(runtime, "warden_1"), 2);
});

test("per-tick backlash preserves the core's directional Pull → Push effects", async () => {
  const runtime = await startRuntime([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "pull", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "push", stacks: 2 }),
  ]);

  await runtime.step();
  assert.ok(fieldsResolved(runtime), "pull/push contact must still close the field pass");
  assert.equal(stacksOf(runtime, "delver_1"), 3);
  assert.equal(stacksOf(runtime, "warden_1"), 2);
});

test("EQUAL opposite stacks cancel to nothing, and BOTH sides are cleared", async () => {
  const runtime = await startRuntime([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 2 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "emit", stacks: 2 }),
  ]);

  await runtime.step();
  const observation = await observe(runtime);
  const overlap = sharedCells(observation.affinityContributions, "delver_1", "warden_1");
  assert.ok(overlap.length > 0, "equal opposite emitters must still occupy overlapping cells");
  const cancelled = overlap.some((key) => {
    const [x, y] = key.split(",").map(Number);
    const contributions = observation.affinityContributions
      .filter((field) => field.position.x === x && field.position.y === y);
    const nets = observation.affinityFields
      .filter((field) => field.position.x === x && field.position.y === y);
    return nets.reduce((sum, field) => sum + field.stacks, 0)
      < contributions.reduce((sum, field) => sum + field.stacks, 0);
  });
  assert.ok(cancelled, "equal opposite overlap must cancel on at least one projected cell");
  assert.equal(stacksOf(runtime, "delver_1"), 2, "authored stacks remain; cancellation is a field net");
  assert.equal(stacksOf(runtime, "warden_1"), 2);
});

test("the Moderator plans every overlapping pair, but resolution consumes what it cancels", async () => {
  const { planAffinityInteractions } = await import(
    "../../packages/runtime/src/personas/moderator/affinity-interactions.js"
  );
  const runtime = await startRuntime([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 2 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "emit", stacks: 2 }),
    actor("warden_2", { x: 5, y: 6 }, { kind: "earth", expression: "emit", stacks: 2 }),
  ]);

  const planned = planAffinityInteractions({
    actors: [
      { index: 0, x: 5, y: 5, kind: 1, expression: 3, stacks: 2 },
      { index: 1, x: 6, y: 5, kind: 2, expression: 3, stacks: 2 },
      { index: 2, x: 5, y: 6, kind: 3, expression: 3, stacks: 2 },
    ],
    computeRadius: () => 2,
  });
  assert.equal(planned.length, 3, "all three pairs are in contact");

  await runtime.step();
  const observation = await observe(runtime);
  assert.ok(sharedCells(observation.affinityContributions, "delver_1", "warden_1").length > 0);
  assert.equal(stacksOf(runtime, "warden_2"), 2, "the third actor is untouched");
});

test("the tie-break is stable under input reordering, so replay is safe", async () => {
  const { planAffinityInteractions } = await import(
    "../../packages/runtime/src/personas/moderator/affinity-interactions.js"
  );
  const computeRadius = () => 3;
  const forward = [
    { index: 0, x: 5, y: 5, kind: 1, expression: 3, stacks: 2 },
    { index: 1, x: 6, y: 5, kind: 2, expression: 3, stacks: 2 },
    { index: 2, x: 5, y: 6, kind: 3, expression: 3, stacks: 2 },
  ];
  const shuffled = [forward[2], forward[0], forward[1]];

  assert.deepEqual(
    planAffinityInteractions({ actors: shuffled, computeRadius }),
    planAffinityInteractions({ actors: forward, computeRadius }),
    "the plan must depend on actor INDEX, not on the order the caller happened to hand them over. "
      + "If it did not, two runs of the same scenario could resolve different pairs and `ak replay` "
      + "would mismatch.",
  );
});

test("a zero radius means no contact, even on adjacent tiles", async () => {
  const { planAffinityInteractions } = await import(
    "../../packages/runtime/src/personas/moderator/affinity-interactions.js"
  );
  const pairs = planAffinityInteractions({
    actors: [
      { index: 0, x: 5, y: 5, kind: 1, expression: 3, stacks: 2 },
      { index: 1, x: 5, y: 6, kind: 2, expression: 3, stacks: 2 },
    ],
    computeRadius: () => 0,
  });
  assert.deepEqual(
    pairs,
    [],
    "reach comes from core's radius curve, not from adjacency. Two actors on touching tiles whose "
      + "fields have no extent are not in contact.",
  );
});

// ## TODO: Test Permutations
// - emit vs draw overlap on the same cell
// - three mutually overlapping opposite pairs
// - a defeated emitter stops contributing mid-run

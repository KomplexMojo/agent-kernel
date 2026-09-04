/**
 * AM.8 — affinity fields that meet are RESOLVED during the tick (closes F6).
 *
 * core's `resolveMotivatedActorAffinityInteraction` — the 48-cell matrix over
 * (source expression, target expression, relationship) — has existed and been
 * unit-tested throughout. Its only consumer was
 * `configurator/affinity-interaction-core.js`, at DESIGN time. During play it was
 * never called: two actors could stand inside each other's fields for an entire
 * run and nothing was resolved between them.
 *
 * What is APPLIED is stack cancellation, and only that: core computes the net
 * figure itself, so writing it back applies a value the kernel defined. The
 * matrix's other outcomes are effect CODES with no magnitude, so they are
 * recorded and left for a deliberate decision rather than given invented
 * numbers here.
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

function buildSimConfig({ width = 11, height = 11 } = {}) {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "ix_sim", runId: "ix", createdAt: "2026-08-14T00:00:00.000Z" },
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
        hazards: [],
      },
    },
  };
}

function actor(id, position, affinity, motivation = "stationary") {
  return {
    id,
    kind: "ambulatory",
    archetype: id.startsWith("delver") ? "delver" : "warden",
    role: id.startsWith("delver") ? "delver" : "warden",
    position,
    motivation: { kind: motivation },
    affinities: [affinity],
    vitals: {
      health: { current: 20, max: 20, regen: 0 },
      mana: { current: 20, max: 20, regen: 0 },
      stamina: { current: 8, max: 8, regen: 4 },
      durability: { current: 1, max: 1, regen: 0 },
    },
  };
}

function buildInitialState(actors) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "ix", runId: "ix", createdAt: "2026-08-14T00:00:00.000Z" },
    simConfigRef: { id: "ix_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors,
  };
}

async function startRuntime(initialState) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig: buildSimConfig(), initialState });
  return { core, runtime };
}

function interactionsFrom(runtime) {
  return runtime.getTickFrames().flatMap((f) => f.affinityInteractions || []);
}

// ---------------------------------------------------------------------------
// Fields in contact resolve
// ---------------------------------------------------------------------------

test("two actors whose fields overlap produce a resolved interaction", async () => {
  const { runtime } = await startRuntime(buildInitialState([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "emit", stacks: 3 }),
  ]));

  await runtime.step();
  const interactions = interactionsFrom(runtime);

  assert.ok(
    interactions.length > 0,
    "adjacent emitters must resolve against each other. Zero interactions means the matrix is "
      + "still design-time-only, which is F6.",
  );
  const first = interactions[0];
  assert.equal(first.sourceIndex, 0, "the lower index is always the source, so pairs are reproducible");
  assert.equal(first.targetIndex, 1);
  assert.ok(
    Number.isFinite(first.relationship),
    "the resolved relationship must be recorded — fire vs water is Opposite, and which cell of "
      + "the matrix was used is the whole explanation of the outcome",
  );
});

test("actors far apart produce no interaction at all", async () => {
  const { runtime } = await startRuntime(buildInitialState([
    actor("delver_1", { x: 1, y: 1 }, { kind: "fire", expression: "emit", stacks: 1 }),
    actor("warden_1", { x: 9, y: 9 }, { kind: "water", expression: "emit", stacks: 1 }),
  ]));

  await runtime.step();
  assert.deepEqual(
    interactionsFrom(runtime),
    [],
    "fields that do not reach each other must not resolve — a rule that fires for every pair "
      + "regardless of distance would be indistinguishable from one that ignores position",
  );
});

// ---------------------------------------------------------------------------
// Cancellation reaches the world
// ---------------------------------------------------------------------------

test("a cancelling cell reduces both actors' stacks in core", async () => {
  const { core, runtime } = await startRuntime(buildInitialState([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "emit", stacks: 2 }),
  ]));

  const beforeSource = core.getMotivatedActorAffinityStacksByIndex(0);
  const beforeTarget = core.getMotivatedActorAffinityStacksByIndex(1);
  await runtime.step();

  // fire vs water is OPPOSITE, and every opposite cell in the matrix sets the
  // cancel flag — so this pairing must cancel. Asserted rather than branched on:
  // an earlier draft skipped the real assertions when no cancellation appeared,
  // which would have passed silently on the very defect it exists to catch.
  const cancelling = interactionsFrom(runtime).filter((i) => i.canceledStacks > 0);
  assert.equal(
    cancelling.length,
    1,
    "fire(3) vs water(2) at range 1 is an opposite-relationship emit/emit cell, which cancels",
  );
  assert.equal(cancelling[0].canceledStacks, 2, "min(3, 2) stacks cancel");
  assert.equal(cancelling[0].applied, "stack_cancellation");

  const afterSource = core.getMotivatedActorAffinityStacksByIndex(0);
  const afterTarget = core.getMotivatedActorAffinityStacksByIndex(1);
  assert.equal(
    afterSource,
    1,
    `the source keeps its net stacks in CORE, not just in the record: ${beforeSource} -> ${afterSource}`,
  );
  assert.equal(
    afterTarget,
    0,
    "and the fully-cancelled side is CLEARED. This read 2 until `clearMotivatedActorAffinity` was "
      + "published on the core surface: the call was behind a `typeof` guard, the function was "
      + `missing, and the cancellation silently did nothing (${beforeTarget} -> ${afterTarget}).`,
  );
});

// ---------------------------------------------------------------------------
// The Moderator owns which pairs meet
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Permutations across the relationship axis
//
// AM.8 permutations. Delegated to the local model first, per CLAUDE.md's Ollama
// tier; it failed all 5 iterations and rolled back, and one of the stubs it was
// given was factually wrong (see "resolution is order-dependent" below), so
// these are hand-written against behaviour probed from core rather than assumed.
// ---------------------------------------------------------------------------

test("SAME-kind fields resolve but do NOT cancel", async () => {
  const { core, runtime } = await startRuntime(buildInitialState([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "fire", expression: "emit", stacks: 2 }),
  ]));

  await runtime.step();
  const [ix] = interactionsFrom(runtime);

  assert.equal(ix.relationship, 0, "fire vs fire is Same");
  assert.equal(ix.canceledStacks, 0, "a same-relationship cell does not cancel");
  assert.equal(ix.applied, "recorded_only");
  assert.equal(core.getMotivatedActorAffinityStacksByIndex(0), 3, "stacks untouched");
  assert.equal(core.getMotivatedActorAffinityStacksByIndex(1), 2);
});

test("NEUTRAL-kind fields resolve but do NOT cancel", async () => {
  const { core, runtime } = await startRuntime(buildInitialState([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "earth", expression: "emit", stacks: 2 }),
  ]));

  await runtime.step();
  const [ix] = interactionsFrom(runtime);

  assert.equal(ix.relationship, 2, "fire vs earth is Neutral — earth's opposite is wind");
  assert.equal(ix.canceledStacks, 0);
  assert.equal(core.getMotivatedActorAffinityStacksByIndex(0), 3);
  assert.equal(core.getMotivatedActorAffinityStacksByIndex(1), 2);
});

test("per-tick backlash preserves the core's directional Pull → Push effects", async () => {
  const { runtime } = await startRuntime(buildInitialState([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "pull", stacks: 3 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "push", stacks: 2 }),
  ]));

  await runtime.step();
  const [interaction] = interactionsFrom(runtime);
  assert.equal(interaction.relationship, 1, "fire vs water is opposite");
  assert.equal(interaction.sourceEffect, 1, "Pull source deals damage");
  assert.equal(interaction.targetEffect, 0, "Push target receives no backlash effect");
  assert.equal(interaction.visualState, 8, "the recorded semantic cell is backlash");
});

test("EQUAL opposite stacks cancel to nothing, and BOTH sides are cleared", async () => {
  const { core, runtime } = await startRuntime(buildInitialState([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 2 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "emit", stacks: 2 }),
  ]));

  await runtime.step();
  const [ix] = interactionsFrom(runtime);

  assert.equal(ix.canceledStacks, 2);
  assert.equal(ix.netSourceStacks, 0);
  assert.equal(ix.netTargetStacks, 0);
  assert.equal(
    core.getMotivatedActorAffinityKindByIndex(0),
    0,
    "cleared, not left at zero stacks — a zero-stack affinity still reads as HELD everywhere that "
      + "checks for a kind, which is how the target side stayed at 2 before the clear was published",
  );
  assert.equal(core.getMotivatedActorAffinityKindByIndex(1), 0);
});

// ---------------------------------------------------------------------------
// Resolution is ORDER-DEPENDENT within a tick, and ACTOR INDEX is the tie-break
//
// Ratified by the maintainer 2026-08-14. It is arbitrary in the sense that
// nothing about the affinities decides which pair resolves first — but it is
// deterministic, which is what replay requires, and no alternative (strongest
// stacks, nearest, oldest) is more principled without a rule saying why.
// ---------------------------------------------------------------------------

test("the Moderator plans every overlapping pair, but resolution consumes what it cancels", async () => {
  const { planAffinityInteractions } = await import(
    "../../packages/runtime/src/personas/moderator/affinity-interactions.js"
  );
  const { core, runtime } = await startRuntime(buildInitialState([
    actor("delver_1", { x: 5, y: 5 }, { kind: "fire", expression: "emit", stacks: 2 }),
    actor("warden_1", { x: 6, y: 5 }, { kind: "water", expression: "emit", stacks: 2 }),
    actor("warden_2", { x: 5, y: 6 }, { kind: "earth", expression: "emit", stacks: 2 }),
  ]));

  // The PLANNER sees three mutually overlapping fields and returns all three pairs.
  const planned = planAffinityInteractions({
    actors: [
      { index: 0, x: 5, y: 5, kind: 1, expression: 3, stacks: 2 },
      { index: 1, x: 6, y: 5, kind: 2, expression: 3, stacks: 2 },
      { index: 2, x: 5, y: 6, kind: 3, expression: 3, stacks: 2 },
    ],
    computeRadius: (e, s) => core.computeAffinityRadius(e, s),
  });
  assert.equal(planned.length, 3, "all three pairs are in contact");

  await runtime.step();
  const resolved = interactionsFrom(runtime);

  // ...but only ONE resolves. Pair (0,1) is opposite, cancels both to zero and
  // clears them, so pairs (0,2) and (1,2) then fail core's precondition: an
  // actor holding no affinity has nothing to resolve.
  assert.equal(
    resolved.length,
    1,
    "resolution MUTATES the state later pairs depend on, so a plan of three yields one outcome: "
      + "the first pair cancels both actors to zero and clears them, and the remaining pairs then "
      + "fail core's precondition",
  );
  assert.deepEqual(
    [resolved[0].sourceIndex, resolved[0].targetIndex],
    [0, 1],
    "the LOWEST-INDEXED pair is the one that resolves — actor index is the ratified tie-break, so "
      + "this is a guarantee callers may rely on, not an accident of iteration",
  );
  assert.equal(core.getMotivatedActorAffinityStacksByIndex(2), 2, "the third actor is untouched");
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

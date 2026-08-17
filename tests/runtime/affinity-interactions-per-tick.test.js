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

// ## TODO: Test Permutations
//
// - all 4x4 expression pairs x 3 relationships (same/opposite/neutral): the
//   recorded sourceEffect/targetEffect must equal the matrix cell, and
//   `canceledStacks > 0` exactly for the cells whose cancel flag is set
// - equal stacks on a cancelling cell: BOTH affinities must be cleared, not left
//   at zero stacks — a zero-stack affinity still reads as "held"
// - three mutually overlapping actors must produce three pairs, each resolved once
// - a pair that separates mid-run must stop interacting on the tick it does
// - the same scenario replayed must produce an identical interaction sequence

/**
 * AM.7 / AM.3b — the affinity field follows its source, and the MODERATOR closes
 * the tick (closes F7).
 *
 * `computeAffinityField()` was called exactly once, during setup
 * (runner/core-setup.mjs). Actors then moved for the rest of the run while their
 * auras stayed at the starting positions — a field that never follows its source
 * is decoration, and every consumer of it (tile visuals, the aura bridge, the
 * gameplay renderer) was reading a snapshot of tick 0.
 *
 * The recompute is deliberately NOT a second unconditional glue call. Advancing
 * the tick and recomputing the field describe the same instant, so both are one
 * Moderator decision (`plan_tick_close`), which also closes the AM.3b weakness:
 * before it, glue advanced the tick and the Moderator never said to.
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
    meta: { id: "field_sim", runId: "field", createdAt: "2026-08-14T00:00:00.000Z" },
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

function buildInitialState(actors) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "field", runId: "field", createdAt: "2026-08-14T00:00:00.000Z" },
    simConfigRef: { id: "field_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors,
  };
}

function actor(id, position, motivation = "random") {
  return {
    id,
    kind: "ambulatory",
    archetype: "delver",
    role: "delver",
    position,
    motivation: { kind: motivation },
    // core seeds an actor's affinity from THIS array (runner/core-setup.mjs),
    // not from `traits.affinities` — the field is computed from core state, so
    // an actor with only a trait entry emits nothing.
    affinities: [{ kind: "fire", expression: "emit", stacks: 3 }],
    traits: { affinities: { fire: 1 } },
    vitals: {
      health: { current: 20, max: 20, regen: 0 },
      mana: { current: 20, max: 20, regen: 0 },
      stamina: { current: 8, max: 8, regen: 4 },
      durability: { current: 1, max: 1, regen: 0 },
    },
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

const FIRE = 1;

/** A stable fingerprint of the whole fire field, so a shift anywhere shows up. */
function fieldFingerprint(core, width, height) {
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const intensity = core.getAffinityFieldIntensityAt?.(x, y, FIRE) ?? 0;
      const stacks = core.getAffinityFieldStacksAt?.(x, y, FIRE) ?? 0;
      if (intensity > 0 || stacks > 0) cells.push(`${x},${y}:${intensity}:${stacks}`);
    }
  }
  return cells.join("|");
}

// ---------------------------------------------------------------------------
// The field must move with the actor
// ---------------------------------------------------------------------------

test("the affinity field changes across ticks as its source actor moves", async () => {
  const simConfig = buildSimConfig();
  const initialState = buildInitialState([actor("delver_1", { x: 5, y: 5 }, "random")]);
  const affinityEffects = {
    actors: [{ actorId: "delver_1", affinityStacks: { "fire:emit": 3 } }],
  };

  const { core, runtime } = await startRuntime({ simConfig, initialState, affinityEffects });
  const { width, height } = { width: 11, height: 11 };

  await runtime.step();
  const early = fieldFingerprint(core, width, height);
  const earlyPos = `${core.getMotivatedActorXByIndex(0)},${core.getMotivatedActorYByIndex(0)}`;

  for (let i = 0; i < 6; i += 1) await runtime.step();
  const late = fieldFingerprint(core, width, height);
  const latePos = `${core.getMotivatedActorXByIndex(0)},${core.getMotivatedActorYByIndex(0)}`;

  assert.notEqual(
    earlyPos,
    latePos,
    "precondition: the actor must actually have moved, or this test proves nothing",
  );
  assert.ok(early.length > 0 || late.length > 0, "the emitting actor must produce some field");
  assert.notEqual(
    late,
    early,
    "the field must follow the actor. Identical fingerprints across a run in which the actor "
      + `moved ${earlyPos} -> ${latePos} mean it is still the setup-time snapshot (F7).`,
  );
});

// ---------------------------------------------------------------------------
// The Moderator owns closing the tick
// ---------------------------------------------------------------------------

test("the Moderator decides to close the tick, and says so as data", async () => {
  const { createModeratorPersona } = await import(
    "../../packages/runtime/src/personas/moderator/persona.js"
  );
  const { TickPhases } = await import(
    "../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );
  const moderator = createModeratorPersona({ clock: () => "fixed" });

  const plan = moderator.advance({
    phase: TickPhases.SUMMARIZE,
    event: "plan_tick_close",
    payload: {},
    tick: 1,
  })?.tickClose;

  assert.ok(plan, "the Moderator must answer plan_tick_close");
  assert.equal(plan.advanceTick, true);
  assert.equal(
    plan.recomputeAffinityField,
    true,
    "advancing and recomputing describe the same instant, so they travel together",
  );
});

test("a paused Moderator closes nothing — neither the tick nor the field", async () => {
  const { createModeratorPersona } = await import(
    "../../packages/runtime/src/personas/moderator/persona.js"
  );
  const { TickPhases } = await import(
    "../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );
  const moderator = createModeratorPersona({ clock: () => "fixed" });
  moderator.advance({ phase: TickPhases.INIT, event: "start", payload: {}, tick: 0 });
  moderator.advance({ phase: TickPhases.OBSERVE, event: "pause", payload: {}, tick: 1 });

  const plan = moderator.advance({
    phase: TickPhases.SUMMARIZE,
    event: "plan_tick_close",
    payload: {},
    tick: 1,
  })?.tickClose;

  assert.equal(plan.advanceTick, false, "a paused tick must not advance");
  assert.equal(
    plan.recomputeAffinityField,
    false,
    "and must not publish a field for a tick that never happened",
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

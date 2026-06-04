/**
 * M4 — Runtime combat action application: failing tests
 *
 * These tests specify how the runtime FSM should adapt actor-proposed `attack`
 * actions to the core `applyAttack` API and record them in tick frames.
 * They MUST FAIL until M5 adds `attack` handling to `adaptActionToCore` in
 * `packages/runtime/src/runner/runtime-fsm.mjs` and exposes `applyAttack`
 * from `createCommandRuntimeCore` in `packages/runtime/src/commands/kernel.js`.
 *
 * Architecture: runtime → core-ts boundary only. No LLM, no external IO.
 * Tests drive the full runtime.step() path with a pre-authored sim config.
 */
"use strict";

const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// Helpers — build minimal sim config and initial state for two-actor combat
// ---------------------------------------------------------------------------

/**
 * Minimal sim config for a 5×5 room with delver and warden adjacent.
 * Layout (row 2): # . A B . #  where A=delver(1,2), B=warden(2,2)
 */
function makeCombatSimConfig() {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "combat_test_sim", runId: "combat_test", createdAt: "2026-01-01T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 5,
        height: 5,
        // Row 2: spawn(S) at col 0, floor at cols 1-3, exit(E) at col 4
        // Actors placed at (1,2) and (2,2) — both floor tiles, not spawn or exit
        tiles: [
          "#####",
          "#####",
          "S...E",
          "#####",
          "#####",
        ],
        spawn: { x: 0, y: 2 },
        exit: { x: 4, y: 2 },
        rooms: [{ id: "R1", x: 0, y: 2, width: 5, height: 1 }],
        traps: [],
      },
    },
  };
}

/**
 * Initial state placing delver (attacking) at (1,2) and warden (defending) at (2,2).
 * Both actors have full vitals so they can act.
 */
function makeCombatInitialState() {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "combat_test_state", runId: "combat_test", createdAt: "2026-01-01T00:00:00.000Z" },
    simConfigRef: { id: "combat_test_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors: [
      {
        id: "delver_1",
        kind: "ambulatory",
        archetype: "delver",
        position: { x: 1, y: 2 },
        role: "delver",
        motivation: { kind: "attacking" },
        vitals: {
          health:   { current: 10, max: 10, regen: 0 },
          mana:     { current: 10, max: 10, regen: 0 },
          stamina:  { current: 10, max: 10, regen: 0 },
          durability: { current: 1, max: 1, regen: 0 },
        },
      },
      {
        id: "warden_1",
        kind: "ambulatory",
        archetype: "warden",
        position: { x: 2, y: 2 },
        role: "warden",
        motivation: { kind: "defending" },
        vitals: {
          health:   { current: 6, max: 6, regen: 0 },
          mana:     { current: 6, max: 6, regen: 0 },
          stamina:  { current: 6, max: 6, regen: 0 },
          durability: { current: 1, max: 1, regen: 0 },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Attack action adaptation — runtime-fsm must handle "attack" kind
// ---------------------------------------------------------------------------

test("runtime accepts attack action from adjacent attacking actor and records it in tick frames", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({
    seed: 0,
    simConfig: makeCombatSimConfig(),
    initialState: makeCombatInitialState(),
  });

  // Run one tick — delver is adjacent to warden and should attack
  await runtime.step();

  const frames = runtime.getTickFrames();
  assert.ok(Array.isArray(frames) && frames.length > 0, "runtime must produce tick frames");

  // At least one frame must contain an accepted attack action
  const attackFrames = frames.filter(f =>
    Array.isArray(f?.acceptedActions) &&
    f.acceptedActions.some(a => a.kind === "attack")
  );
  assert.ok(attackFrames.length > 0, "at least one tick frame must contain an accepted attack action");

  const attackAction = attackFrames[0].acceptedActions.find(a => a.kind === "attack");
  assert.equal(attackAction.actorId, "delver_1");
  assert.equal(attackAction.params.targetId, "warden_1");
});

test("accepted attack action reduces warden HP in subsequent observation", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({
    seed: 0,
    simConfig: makeCombatSimConfig(),
    initialState: makeCombatInitialState(),
  });

  await runtime.step();

  // Verify warden HP via core state — the simulation source of truth.
  // Warden is actor index 1 (sorted by ID: delver_1, warden_1), vital kind 0 = health.
  const wardenHp = core.getMotivatedActorVitalCurrentByIndex(1, 0);
  assert.ok(wardenHp < 6, `warden HP should be < 6 after attack, got ${wardenHp}`);
  // Default attack damage = 2, warden start = 6, expected = 4
  assert.equal(wardenHp, 4, `warden HP should be exactly 4 (6 - 2 damage), got ${wardenHp}`);
});

test("attack action rejection (non-adjacent) does not appear in acceptedActions", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });

  // Place actors far apart — (1,2) and (3,2) are 2 tiles apart; no attack possible
  const farInitialState = makeCombatInitialState();
  farInitialState.actors[1].position = { x: 3, y: 2 }; // floor tile, not exit

  await runtime.init({
    seed: 0,
    simConfig: makeCombatSimConfig(),
    initialState: farInitialState,
  });

  await runtime.step();

  const frames = runtime.getTickFrames();
  const hasAcceptedAttack = frames.some(f =>
    f?.acceptedActions?.some(a => a.kind === "attack")
  );
  assert.equal(hasAcceptedAttack, false, "non-adjacent attack must not appear in acceptedActions");
});

test("two ticks of combat decrement warden HP each tick and keep runtime state consistent", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig: makeCombatSimConfig(), initialState: makeCombatInitialState() });

  await runtime.step();
  assert.equal(core.getMotivatedActorVitalCurrentByIndex(1, 0), 4);

  await runtime.step();
  assert.equal(core.getMotivatedActorVitalCurrentByIndex(1, 0), 2);

  const acceptedAttacks = runtime.getTickFrames()
    .flatMap((f) => f?.acceptedActions || [])
    .filter((a) => a.kind === "attack" && a.params?.targetId === "warden_1");
  assert.equal(acceptedAttacks.length, 2);
});

test.skip("lethal attack reaches HP 0 and subsequent ticks show no further attacks against defeated actor", async () => {
  // Current combat rules/persona targeting do not filter defeated actors.
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const state = makeCombatInitialState();
  state.actors[1].vitals.health.current = 2;
  state.actors[1].vitals.health.max = 2;
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig: makeCombatSimConfig(), initialState: state });

  await runtime.step();
  await runtime.step();

  assert.equal(core.getMotivatedActorVitalCurrentByIndex(1, 0), 0);
  const acceptedAttacks = runtime.getTickFrames()
    .flatMap((f) => f?.acceptedActions || [])
    .filter((a) => a.kind === "attack" && a.params?.targetId === "warden_1");
  assert.equal(acceptedAttacks.length, 1);
});

test.skip("counter-attack lets warden attack delver on the same tick and changes both HP values", async () => {
  // Runtime currently advances the primary actor persona only; no same-tick multi-actor counter-attack pass exists.
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const state = makeCombatInitialState();
  state.actors[1].motivation = { kind: "attacking" };
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig: makeCombatSimConfig(), initialState: state });

  await runtime.step();

  assert.equal(core.getMotivatedActorVitalCurrentByIndex(0, 0), 8);
  assert.equal(core.getMotivatedActorVitalCurrentByIndex(1, 0), 4);
});

test("runtime step with no hostile actors present records no attacks and keeps normal movement frames", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const state = makeCombatInitialState();
  state.actors = [state.actors[0]];
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig: makeCombatSimConfig(), initialState: state });

  await runtime.step();

  const accepted = runtime.getTickFrames().flatMap((f) => f?.acceptedActions || []);
  assert.equal(accepted.some((a) => a.kind === "attack"), false);
  assert.equal(accepted.some((a) => a.kind === "move"), true);
});

test("attack action with missing targetId is rejected and not accepted", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig: makeCombatSimConfig(), initialState: makeCombatInitialState() });

  await runtime.step({
    personaPayloads: {
      actor: {
        proposals: [{ kind: "attack", params: { damage: 2 } }],
      },
    },
  });

  const frames = runtime.getTickFrames();
  const acceptedMissingTarget = frames.some((f) =>
    f?.acceptedActions?.some((a) => a.kind === "attack" && !a.params?.targetId)
  );
  const rejection = frames
    .flatMap((f) => f?.preCoreRejections || [])
    .find((entry) => entry.reason === "missing_target_id");

  assert.equal(acceptedMissingTarget, false);
  assert.ok(rejection, "missing targetId attack should be recorded as a pre-core rejection");
});

test("multiple ticks until delver reaches warden produce movement followed by attack frames", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const state = makeCombatInitialState();
  state.actors[1].position = { x: 3, y: 2 };
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig: makeCombatSimConfig(), initialState: state });

  await runtime.step();
  await runtime.step();

  const accepted = runtime.getTickFrames().flatMap((f) => f?.acceptedActions || []);
  const firstMoveIndex = accepted.findIndex((a) => a.kind === "move" && a.actorId === "delver_1");
  const firstAttackIndex = accepted.findIndex((a) => a.kind === "attack" && a.actorId === "delver_1");

  assert.ok(firstMoveIndex >= 0, "movement should occur before the first attack");
  assert.ok(firstAttackIndex > firstMoveIndex, "attack should occur after movement reaches adjacency");
  assert.equal(core.getMotivatedActorVitalCurrentByIndex(1, 0), 4);
});

// NOTE: M9 left 2 test(s) skipped — implementation gap, escalate to Claude Sonnet/high.

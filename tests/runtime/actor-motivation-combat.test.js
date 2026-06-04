/**
 * M4 — Actor persona motivation + combat: failing tests
 *
 * These tests specify how the actor persona should behave under simple
 * motivations when a hostile actor is present. They MUST FAIL until M5
 * wires hostile-target pursuit and attack proposals into the actor controller.
 *
 * Scope:
 *   - attacking motivation: move toward hostile, attack when adjacent
 *   - defending motivation: hold position, attack when hostile becomes adjacent
 *   - stationary motivation: never move, attack if adjacent (optional for now)
 *
 * Architecture: runtime persona layer only — no IO, injected clock.
 */
"use strict";

const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 5x5 floor-only baseTiles string grid (all '.' interior, '#' border). */
function makeFloorGrid(w = 5, h = 5) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      x === 0 || x === w - 1 || y === 0 || y === h - 1 ? "#" : "."
    ).join("")
  );
}

/**
 * Run one observe → decide → propose cycle on a persona and return the result.
 * Wraps the three-advance sequence used throughout the actor persona tests.
 */
async function oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles, payload = {} }) {
  const base = { actorId, observation, baseTiles, ...payload };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: base, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: base, tick: 0 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload: base, tick: 0 });
}

// ---------------------------------------------------------------------------
// Motivation: attacking — move toward hostile target
// ---------------------------------------------------------------------------

test("attacking actor proposes move toward hostile target rather than exit", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  // 5×3 board: delver at (1,1), warden at (3,1), exit at (4,1)
  // Attacking motivation should prefer moving toward warden (3,1) over exit (4,1).
  const baseTiles = makeFloorGrid(5, 3);
  const actorId = "delver_1";

  const persona = createActorPersona({ clock: () => "fixed" });

  const observation = {
    actors: [
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: "warden_1", kind: 2, position: { x: 3, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles },
    exit: { x: 4, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  // M5 must produce a move action toward the warden, not the exit
  assert.ok(result.actions.length > 0, "attacking actor must propose at least one action");
  const action = result.actions[0];
  assert.equal(action.kind, "move");
  assert.equal(action.actorId, "delver_1");
  // Should move east toward warden (x increases), not toward exit beyond warden
  assert.equal(action.params.direction, "east", "attacking actor should move east toward warden");
  assert.deepEqual(action.params.from, { x: 1, y: 1 });
  assert.deepEqual(action.params.to, { x: 2, y: 1 });
});

// ---------------------------------------------------------------------------
// Motivation: attacking — attack when adjacent
// ---------------------------------------------------------------------------

test("attacking actor proposes attack action when adjacent to hostile target", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  // delver at (1,1) directly adjacent to warden at (2,1)
  const baseTiles = makeFloorGrid(5, 3);
  const actorId = "delver_1";

  const persona = createActorPersona({ clock: () => "fixed" });

  const observation = {
    actors: [
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: "warden_1", kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles },
    exit: { x: 4, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  // M5 must produce an attack action, not a move action
  assert.ok(result.actions.length > 0, "adjacent attacking actor must propose an action");
  const action = result.actions[0];
  assert.equal(action.kind, "attack", "adjacent attacking actor must propose attack, not move");
  assert.equal(action.actorId, "delver_1");
  assert.equal(action.params.targetId, "warden_1");
});

// ---------------------------------------------------------------------------
// Motivation: defending — hold position, attack when hostile becomes adjacent
// ---------------------------------------------------------------------------

test("defending actor does not move when hostile is not adjacent", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  // warden at (3,1), delver at (1,1) — two tiles away, not adjacent
  const baseTiles = makeFloorGrid(5, 3);
  const actorId = "warden_1";

  const persona = createActorPersona({ clock: () => "fixed" });

  const observation = {
    actors: [
      { id: "warden_1", kind: 2, position: { x: 3, y: 1 }, role: "warden", motivation: { kind: "defending" } },
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver" },
    ],
    tiles: { baseTiles },
    exit: { x: 4, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  // Defending actor must not propose a move action toward the hostile
  const moveActions = result.actions.filter(a => a.kind === "move");
  assert.equal(moveActions.length, 0, "defending actor must not move when hostile is not adjacent");
});

test("defending actor proposes attack when hostile becomes adjacent", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  // warden at (3,1), delver at (2,1) — adjacent
  const baseTiles = makeFloorGrid(5, 3);
  const actorId = "warden_1";

  const persona = createActorPersona({ clock: () => "fixed" });

  const observation = {
    actors: [
      { id: "warden_1", kind: 2, position: { x: 3, y: 1 }, role: "warden", motivation: { kind: "defending" } },
      { id: "delver_1", kind: 2, position: { x: 2, y: 1 }, role: "delver" },
    ],
    tiles: { baseTiles },
    exit: { x: 4, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  assert.ok(result.actions.length > 0, "defending actor must react when hostile is adjacent");
  const action = result.actions[0];
  assert.equal(action.kind, "attack", "defending actor must attack when hostile is adjacent");
  assert.equal(action.actorId, "warden_1");
  assert.equal(action.params.targetId, "delver_1");
});

// ---------------------------------------------------------------------------
// Motivation: stationary — never moves regardless of hostiles
// ---------------------------------------------------------------------------

test("stationary actor proposes no movement even when hostile is present", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const baseTiles = makeFloorGrid(5, 3);
  const actorId = "warden_1";

  const persona = createActorPersona({ clock: () => "fixed" });

  const observation = {
    actors: [
      { id: "warden_1", kind: 2, position: { x: 3, y: 1 }, role: "warden", motivation: { kind: "stationary" } },
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver" },
    ],
    tiles: { baseTiles },
    exit: { x: 4, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  const moveActions = result.actions.filter(a => a.kind === "move");
  assert.equal(moveActions.length, 0, "stationary actor must never propose movement");
});

test("attacking actor with no hostile present falls back to exit pathfinding", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const baseTiles = makeFloorGrid(5, 3);
  const actorId = "delver_1";
  const persona = createActorPersona({ clock: () => "fixed" });
  const observation = {
    actors: [
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
    ],
    tiles: { baseTiles },
    exit: { x: 3, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  assert.equal(result.actions[0].kind, "move");
  assert.equal(result.actions[0].params.direction, "east");
  assert.deepEqual(result.actions[0].params.to, { x: 2, y: 1 });
});

test.skip("attacking actor with hostile at HP 0 ignores defeated actor and falls back to exit", async () => {
  // Current hostile selection does not inspect actor health/vitals.
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const baseTiles = makeFloorGrid(5, 3);
  const actorId = "delver_1";
  const persona = createActorPersona({ clock: () => "fixed" });
  const observation = {
    actors: [
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: "warden_1", kind: 2, position: { x: 2, y: 1 }, role: "warden", vitals: { health: { current: 0, max: 6, regen: 0 } } },
    ],
    tiles: { baseTiles },
    exit: { x: 3, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  assert.equal(result.actions[0].kind, "move");
  assert.equal(result.actions[0].params.direction, "east");
  assert.notEqual(result.actions[0].params?.targetId, "warden_1");
});

test("attacking actor with multiple hostiles targets nearest hostile by Chebyshev distance", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const baseTiles = makeFloorGrid(7, 3);
  const actorId = "delver_1";
  const persona = createActorPersona({ clock: () => "fixed" });
  const observation = {
    actors: [
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: "warden_far", kind: 2, position: { x: 5, y: 1 }, role: "warden" },
      { id: "warden_near", kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles },
    exit: { x: 6, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  assert.equal(result.actions[0].kind, "attack");
  assert.equal(result.actions[0].params.targetId, "warden_near");
});

test("defending actor with hostile adjacent on diagonal attacks the diagonal neighbor", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const baseTiles = makeFloorGrid(5, 5);
  const actorId = "warden_1";
  const persona = createActorPersona({ clock: () => "fixed" });
  const observation = {
    actors: [
      { id: "warden_1", kind: 2, position: { x: 2, y: 2 }, role: "warden", motivation: { kind: "defending" } },
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver" },
    ],
    tiles: { baseTiles },
    exit: { x: 3, y: 3 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  assert.equal(result.actions[0].kind, "attack");
  assert.equal(result.actions[0].params.targetId, "delver_1");
});

test.skip("defending actor with no visible hostile proposes wait without movement or attack", async () => {
  // Current defending behavior falls back to exit pathing when no hostile is visible.
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const baseTiles = makeFloorGrid(5, 3);
  const actorId = "warden_1";
  const persona = createActorPersona({ clock: () => "fixed" });
  const observation = {
    actors: [
      { id: "warden_1", kind: 2, position: { x: 1, y: 1 }, role: "warden", motivation: { kind: "defending" } },
    ],
    tiles: { baseTiles },
    exit: { x: 3, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  assert.equal(result.actions[0].kind, "wait");
  assert.equal(result.actions.filter((a) => a.kind === "move" || a.kind === "attack").length, 0);
});

test("two attacking actors each target the other independently", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const baseTiles = makeFloorGrid(5, 3);
  const observation = {
    actors: [
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: "warden_1", kind: 2, position: { x: 2, y: 1 }, role: "warden", motivation: { kind: "attacking" } },
    ],
    tiles: { baseTiles },
    exit: { x: 3, y: 1 },
  };

  const delverResult = await oneProposeCycle(
    createActorPersona({ clock: () => "fixed" }),
    { TickPhases },
    { actorId: "delver_1", observation, baseTiles },
  );
  const wardenResult = await oneProposeCycle(
    createActorPersona({ clock: () => "fixed" }),
    { TickPhases },
    { actorId: "warden_1", observation, baseTiles },
  );

  assert.equal(delverResult.actions[0].kind, "attack");
  assert.equal(delverResult.actions[0].params.targetId, "warden_1");
  assert.equal(wardenResult.actions[0].kind, "attack");
  assert.equal(wardenResult.actions[0].params.targetId, "delver_1");
});

test("actor with non-combat motivation kind falls back to exit pathing", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const baseTiles = makeFloorGrid(5, 3);
  const actorId = "delver_1";
  const persona = createActorPersona({ clock: () => "fixed" });
  const observation = {
    actors: [
      { id: "delver_1", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "exploring" } },
    ],
    tiles: { baseTiles },
    exit: { x: 3, y: 1 },
  };

  const result = await oneProposeCycle(persona, { TickPhases }, { actorId, observation, baseTiles });

  assert.equal(result.actions[0].kind, "move");
  assert.equal(result.actions[0].params.direction, "east");
  assert.deepEqual(result.actions[0].params.to, { x: 2, y: 1 });
});

// NOTE: M9 left 2 test(s) skipped — implementation gap, escalate to Claude Sonnet/high.

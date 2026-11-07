/**
 * Moderator actor hibernation — Chebyshev wake radius around the controlled actor.
 * Activity is distance-based, never fog/camera. Pure filter tests.
 */
"use strict";

const assert = require("node:assert/strict");

async function hibernation() {
  return import("../../../packages/runtime/src/personas/moderator/persona.js");
}

test("Chebyshev distance is the wake metric (square, same as sight/cast)", async () => {
  const { chebyshevTileDistance } = await hibernation();
  assert.equal(chebyshevTileDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 4);
  assert.equal(chebyshevTileDistance({ x: 10, y: 10 }, { x: 10, y: 10 }), 0);
});

test("default hibernation radius is 50 tiles; false disables", async () => {
  const { resolveActorHibernationRadius, DEFAULT_ACTOR_HIBERNATION_RADIUS } = await hibernation();
  assert.equal(DEFAULT_ACTOR_HIBERNATION_RADIUS, 50);
  assert.equal(resolveActorHibernationRadius(undefined), 50);
  assert.equal(resolveActorHibernationRadius(12), 12);
  assert.equal(resolveActorHibernationRadius(false), Infinity);
  assert.equal(resolveActorHibernationRadius(null), Infinity);
});

test("actors within radius stay awake; beyond radius hibernate", async () => {
  const { filterAwakeActorIds } = await hibernation();
  const actors = [
    { id: "hero", position: { x: 5, y: 5 } },
    { id: "near", position: { x: 8, y: 5 } }, // Chebyshev 3
    { id: "far", position: { x: 20, y: 5 } }, // Chebyshev 15
  ];
  const awake = filterAwakeActorIds({
    actorIds: ["hero", "near", "far"],
    actors,
    focusActorId: "hero",
    radius: 5,
  });
  assert.deepEqual(awake, ["hero", "near"]);
});

test("explicit commands keep an out-of-radius actor awake", async () => {
  const { filterAwakeActorIds } = await hibernation();
  const actors = [
    { id: "hero", position: { x: 0, y: 0 } },
    { id: "remote", position: { x: 40, y: 0 } },
  ];
  const awake = filterAwakeActorIds({
    actorIds: ["hero", "remote"],
    actors,
    focusActorId: "hero",
    radius: 5,
    alwaysAwakeIds: ["remote"],
  });
  assert.deepEqual(awake, ["hero", "remote"]);
});

test("disabled hibernation (false) leaves every candidate awake", async () => {
  const { filterAwakeActorIds } = await hibernation();
  const actors = [
    { id: "hero", position: { x: 0, y: 0 } },
    { id: "far", position: { x: 99, y: 99 } },
  ];
  assert.deepEqual(
    filterAwakeActorIds({
      actorIds: ["hero", "far"],
      actors,
      focusActorId: "hero",
      radius: false,
    }),
    ["hero", "far"],
  );
});

test("missing focus position fails open (everyone awake)", async () => {
  const { filterAwakeActorIds } = await hibernation();
  assert.deepEqual(
    filterAwakeActorIds({
      actorIds: ["a", "b"],
      actors: [{ id: "a", position: { x: 1, y: 1 } }, { id: "b", position: { x: 50, y: 50 } }],
      focusActorId: "missing",
      radius: 2,
    }),
    ["a", "b"],
  );
});

// #700: walls and props on a vast level never had a turn to take; they no longer enter decide.
const WALL = { id: "wall", position: { x: 6, y: 5 }, capabilities: { canMove: false }, motivations: [] };
const TURRET = { id: "turret", position: { x: 7, y: 5 }, capabilities: { canMove: false }, motivations: ["stationary"] };
const HERO = { id: "hero", position: { x: 5, y: 5 }, capabilities: { canMove: true }, motivations: ["user_controlled"] };

test("an actor that cannot move and has no motivation is never asked to decide", async () => {
  const { filterAwakeActorIds } = await hibernation();
  const args = { actorIds: ["hero", "wall", "turret"], actors: [HERO, WALL, TURRET], focusActorId: "hero" };
  assert.deepEqual(filterAwakeActorIds({ ...args, radius: 5 }), ["hero", "turret"]);
  assert.deepEqual(filterAwakeActorIds({ ...args, radius: false }), ["hero", "turret"], "with hibernation off too");
  assert.deepEqual(filterAwakeActorIds({ ...args, focusActorId: "missing", radius: 5 }), ["hero", "turret"], "and with no focus");
});

test("a command or a strategy still wakes an inert actor; a mobile one without motivations stays", async () => {
  const { filterAwakeActorIds } = await hibernation();
  const drifter = { id: "drifter", position: { x: 5, y: 6 }, capabilities: { canMove: true }, motivations: [] };
  assert.deepEqual(filterAwakeActorIds({ actorIds: ["hero", "wall", "drifter"], actors: [HERO, WALL, drifter],
    focusActorId: "hero", radius: 5, alwaysAwakeIds: ["wall"] }), ["hero", "wall", "drifter"]);
  assert.deepEqual(filterAwakeActorIds({ actorIds: ["wall"], actors: [WALL], focusActorId: "wall", radius: 5 }), ["wall"],
    "the focus actor is always asked");
});

// ## TODO: Test Permutations
// - an inert actor with the singular `motivation.kind` form is not inert
// - an actor with no capabilities record is not inert (fail open)
// - radius 0 wakes only the focus (and alwaysAwakeIds)
// - actor without position stays awake (fail open)
// - input order of actorIds is preserved among the awake set

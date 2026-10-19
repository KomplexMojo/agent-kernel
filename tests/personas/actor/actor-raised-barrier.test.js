/**
 * Raised barriers (#413) in the Actor: a cast command may aim at a tile, and pathing treats a
 * raised barrier as temporary. A route goes round one when it can and through it only when
 * there is no other way, so the actor waits at it rather than giving up on its goal.
 */
const assert = require("node:assert/strict");

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import("../../../packages/runtime/src/personas/actor/controller.js"),
    import("../../../packages/runtime/src/personas/actor/proposal-helpers.js"),
    import("../../../packages/core-ts/src/rules/actor-cast.ts"),
  ]);
  return modulesPromise;
}

test("a cast command at a tile keeps its tile and its named slot", async () => {
  const [{ normalizeActorCommand }] = await loadModules();
  assert.deepEqual(normalizeActorCommand({ kind: "cast_affinity", params: { target: { x: 3, y: 1 }, affinityKey: "earth:push" } }),
    { kind: "cast_affinity", params: { target: { x: 3, y: 1 }, affinityKey: "earth:push" } });
  assert.deepEqual(normalizeActorCommand({ kind: "cast_affinity", params: { targetId: "W1" } }),
    { kind: "cast_affinity", params: { targetId: "W1" } });
  assert.throws(() => normalizeActorCommand({ kind: "cast_affinity", params: { target: { x: 1.5, y: 0 } } }), /params.target/);
});

test("a route goes round a raised barrier when it can", async () => {
  const [, { findPath }, { RAISED_BARRIER_TILE_KIND: B }] = await loadModules();
  const kinds = [
    [0, 0, 0],
    [0, B, 0],
    [0, 0, 0],
  ];
  const path = findPath({ x: 1, y: 0 }, { x: 1, y: 2 }, kinds, null);
  assert.ok(path);
  assert.ok(path.every((cell) => !(cell.x === 1 && cell.y === 1)));
});

test("a route goes through a raised barrier when it is the only way, never through a wall", async () => {
  const [, { findPath }, { RAISED_BARRIER_TILE_KIND: B }] = await loadModules();
  const sealed = [
    [1, 0, 1],
    [1, B, 1],
    [1, 0, 1],
  ];
  assert.deepEqual(findPath({ x: 1, y: 0 }, { x: 1, y: 2 }, sealed, null), [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }]);
  const walled = sealed.map((row) => row.map((kind) => (kind === B ? 1 : kind)));
  assert.equal(findPath({ x: 1, y: 0 }, { x: 1, y: 2 }, walled, null), null);
});

// ## TODO: Test Permutations
// - an exit-seeking delver whose only route crosses a raised barrier steps toward it and waits
// - the owner's scoped observation opens its own barrier, so its route goes straight through

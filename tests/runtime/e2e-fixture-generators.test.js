const assert = require("node:assert/strict");
const { generateTierActors, generateTierLayout, resolveTierSpec } = require("../helpers/tier-generators");

function terrainMarker(layout, kind) {
  const index = Array.isArray(layout.terrain) ? layout.terrain.indexOf(kind) : -1;
  assert.ok(index >= 0, `generated terrain must include a ${kind} cell`);
  return { x: index % layout.width, y: Math.floor(index / layout.width) };
}

test("tier generators produce deterministic actors and layouts", async () => {
  const tier = 6;
  const spec = resolveTierSpec(tier);
  assert.equal(spec.width, 1000);
  assert.equal(spec.height, 1000);
  assert.equal(spec.count, 500);

  const actorResult = await generateTierActors({
    tier,
    width: 40,
    height: 40,
    count: 20,
    seed: 1606,
    idPrefix: "tier6_actor",
  });
  assert.equal(actorResult.ok, true);
  assert.equal(actorResult.actors.length, 20);
  assert.equal(actorResult.actors[0].id, "tier6_actor_1");

  const positions = new Set();
  actorResult.actors.forEach((actor) => {
    assert.ok(actor.position.x >= 0 && actor.position.x < 40);
    assert.ok(actor.position.y >= 0 && actor.position.y < 40);
    positions.add(`${actor.position.x},${actor.position.y}`);
  });
  assert.equal(positions.size, actorResult.actors.length);

  const repeatActors = await generateTierActors({
    tier,
    width: 40,
    height: 40,
    count: 20,
    seed: 1606,
    idPrefix: "tier6_actor",
  });
  assert.deepEqual(actorResult.actors, repeatActors.actors);

  const layoutResult = await generateTierLayout({
    tier,
    width: 40,
    height: 40,
    seed: 2606,
    roomCount: 6,
    corridorWidth: 1,
  });
  assert.equal(layoutResult.ok, true);
  const layout = layoutResult.value;
  assert.equal(layout.width, 40);
  assert.equal(layout.height, 40);
  assert.equal(Array.isArray(layout.terrain), true);
  assert.equal(layout.terrain.length, 40 * 40);
  for (const obsolete of ["tiles", "kinds", "legend", "spawn", "exit"]) {
    assert.equal(Object.hasOwn(layout, obsolete), false, `leftover ${obsolete} must stay off generated layouts`);
  }
  const spawn = terrainMarker(layout, "spawn");
  const exitCell = terrainMarker(layout, "exit");
  assert.ok(spawn.x >= 0 && spawn.x < 40);
  assert.ok(spawn.y >= 0 && spawn.y < 40);
  assert.ok(exitCell.x >= 0 && exitCell.x < 40);
  assert.ok(exitCell.y >= 0 && exitCell.y < 40);
  assert.ok(Number.isInteger(layout.spawnApproach?.x) && Number.isInteger(layout.spawnApproach?.y));
  assert.ok(Number.isInteger(layout.exitApproach?.x) && Number.isInteger(layout.exitApproach?.y));
});
// ## TODO: Test Permutations
// - generateTierLayout of a wall-only seed still rejects instead of restoring leftover tiles
// - generateTierActors still refuses overlapping IDs after leftover kind/role stripping

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateTierActors, generateTierLayout, resolveTierSpec } = require("../helpers/tier-generators");

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
  assert.equal(layout.tiles.length, 40);
  assert.equal(layout.tiles[0].length, 40);
  assert.ok(layout.spawn.x >= 0 && layout.spawn.x < 40);
  assert.ok(layout.spawn.y >= 0 && layout.spawn.y < 40);
  assert.ok(layout.exit.x >= 0 && layout.exit.x < 40);
  assert.ok(layout.exit.y >= 0 && layout.exit.y < 40);
});

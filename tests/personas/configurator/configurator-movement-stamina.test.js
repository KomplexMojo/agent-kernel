const assert = require("node:assert/strict");

test("assembles ID-keyed movement stamina from the placed roster without glue defaults", async () => {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/controller.js"
  );
  const c = createConfiguratorPersona({ clock: () => "2026-09-16T00:00:00.000Z" });
  const delver = { category: "delver", id: "delver" };
  const hazard = { category: "hazard", id: "flame", capabilities: { canMove: false } };
  const mobileResource = {
    category: "resource",
    id: "ore",
    capabilities: { canMove: true, movementCost: 0 },
  };
  const authored = { warden: 4 };
  const assembled = c.assembleMovementStamina({
    actors: [delver, hazard, mobileResource, { category: "warden", id: "warden" }],
    movementStamina: authored,
  });
  assert.deepEqual(assembled, { warden: 4, delver: 1, ore: 0 });
  assert.equal(Object.hasOwn(assembled, "flame"), false);
  assembled.delver = 99;
  authored.warden = 99;
  assert.equal(c.assembleMovementStamina({
    actors: [delver, hazard, mobileResource, { category: "warden", id: "warden" }],
    movementStamina: { warden: 4 },
  }).warden, 4);
});

test("omitted movement map still covers mobile placed actors and rejects malformed maps", async () => {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/controller.js"
  );
  const c = createConfiguratorPersona({ clock: () => "2026-09-16T00:00:00.000Z" });
  assert.deepEqual(c.assembleMovementStamina({
    actors: [{ category: "delver", id: "hero" }, { category: "hazard", id: "pit" }],
  }), { hero: 1 });
  assert.deepEqual(c.assembleMovementStamina({ actors: [] }), {});
  for (const movementStamina of [null, [], new Map()]) {
    assert.throws(() => c.assembleMovementStamina({ actors: [], movementStamina }), /movement stamina/);
  }
});
// ## TODO: Test Permutations
// - Unmigrated CLI type:delver entries without category still receive a cardinal cost.
// - Duplicate IDs keep the first authored override rather than a later default.

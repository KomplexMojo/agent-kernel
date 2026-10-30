// `ak create slots=` / `equip=`: the Configurator authors an actor card's affinity slots and
// starting equips as the fields core loads, and refuses only what core could not load.
const assert = require("node:assert/strict");

async function author(args) {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/persona.js");
  return createConfiguratorPersona({ clock: () => "2026-10-14T00:00:00.000Z" }).authorActorEquipment(args);
}
const HELD = [
  { kind: "earth", expression: "push", stacks: 3 },
  { kind: "light", expression: "emit", stacks: 1 },
  { kind: "dark", expression: "emit", stacks: 2 },
];

test("slots and equips become core's slot, active, equipped and running-stack fields", async () => {
  const fields = await author({ role: "delver", index: 1, slots: 3, affinities: HELD,
    equip: [{ kind: "earth", expression: "push", stacks: 2 }, { kind: "light", expression: "emit" }, { kind: "dark", expression: "emit", stacks: 2 }] });
  assert.deepEqual(fields, {
    affinitySlots: 3,
    activeAffinityKey: "earth:push",
    equippedAffinityKeys: ["earth:push", "light:emit", "dark:emit"],
    equippedAffinityStacks: { "earth:push": 2 },
  }, "opposite emits together are allowed; stacks equal to what is held need no running entry");
});

test("one equip is only the active key; nothing given changes nothing", async () => {
  assert.deepEqual(await author({ role: "warden", index: 1, affinity: "fire", equip: [{ kind: "fire", expression: "push" }] }),
    { activeAffinityKey: "fire:push" }, "with no affinities list the primary affinity at the default expression is held");
  assert.deepEqual(await author({ role: "warden", index: 1, affinity: "fire" }), {});
  assert.deepEqual(await author({ role: "delver", index: 1, slots: 1 }), { affinitySlots: 1 });
});

test("equips must fit the slots and be held, once, at no more stacks than held", async () => {
  await assert.rejects(author({ role: "warden", index: 2, affinities: HELD,
    equip: HELD.map(({ kind, expression }) => ({ kind, expression })) }), /warden\[2\] equips 3 affinities but has 2 slots/);
  await assert.rejects(author({ role: "delver", index: 1, affinity: "earth", equip: [{ kind: "earth", expression: "emit" }] }),
    /cannot equip earth:emit: it holds only earth:push/);
  await assert.rejects(author({ role: "delver", index: 1, affinities: HELD,
    equip: [{ kind: "light", expression: "emit" }, { kind: "light", expression: "emit" }] }), /equips light:emit twice/);
  await assert.rejects(author({ role: "delver", index: 1, affinities: HELD, equip: [{ kind: "earth", expression: "push", stacks: 4 }] }),
    /runs earth:push at 4 stacks but holds only 3/);
});

// Darren, 2026-10-30: extra slots are retired; an actor's slots run from 1 to its preset (at most
// core's cap of 3), and the affinities past them are carried as a pack.
test("slots run from 1 to the preset: a delver 3, a warden 2", async () => {
  await assert.rejects(author({ role: "delver", index: 1, slots: 4 }), /slots must be an integer from 1 to 3, got 4: extra slots are retired/);
  await assert.rejects(author({ role: "warden", index: 1, slots: 3 }), /from 1 to 2, got 3/);
  await assert.rejects(author({ role: "delver", index: 1, slots: 0 }), /from 1 to 3/);
  assert.deepEqual(await author({ role: "delver", index: 1, slots: 3 }), { affinitySlots: 3 });
});

// ## TODO: Test Permutations
// - every affinity kind and expression as a single equip
// - equip lists of length 1..3 against slots 1..3
// - a role with no preset (hazard authored through this path) is refused

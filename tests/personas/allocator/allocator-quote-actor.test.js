/**
 * pricing.quoteActor: the Allocator prices one actor configuration, line by line, so a
 * screen that edits a character can show what each choice costs without pricing anything
 * itself. The same numbers `ak create` charges for that actor.
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/";
const CLOCK = () => "2026-10-29T00:00:00.000Z";

const ENTRY = Object.freeze({
  vitals: {
    health: { max: 20, regen: 1 },
    mana: { max: 30, regen: 3 },
    stamina: { max: 10, regen: 2 },
    durability: { max: 10, regen: 1 },
  },
  affinities: [
    { kind: "fire", expression: "emit", stacks: 2, intensity: 1 },
    { kind: "fire", expression: "push", stacks: 3, intensity: 1 },
  ],
  motivations: ["user_controlled"],
});

async function makeAllocator() {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { createConfiguratorPersona } = await import(`${P}configurator/persona.js`);
  const configurator = createConfiguratorPersona({ clock: CLOCK });
  return createAllocatorPersona({ clock: CLOCK, normalizeMotivations: configurator.normalizeMotivations });
}

test("quoteActor prices vitals (max linear, regen squared), affinities and the playable premium", async () => {
  const a = await makeAllocator();
  const quote = a.pricing.quoteActor(ENTRY);
  const byLabel = Object.fromEntries(quote.detail.lineItems.map((item) => [item.label, item.spendTokens]));
  assert.equal(byLabel["health max"], 20);
  assert.equal(byLabel["mana regen"], 9);
  assert.equal(byLabel["motivation:user_controlled"], 18);
  assert.equal(quote.cost, quote.detail.lineItems.reduce((sum, item) => sum + item.spendTokens, 0));
});

test("quoteActor refuses an unpriced input by naming it, never by defaulting", async () => {
  const a = await makeAllocator();
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { createConfiguratorPersona } = await import(`${P}configurator/persona.js`);
  const normalizeMotivations = createConfiguratorPersona({ clock: CLOCK }).normalizeMotivations;
  const bare = createAllocatorPersona({ clock: CLOCK, normalizeMotivations, priceList: { schema: "agent-kernel/PriceList", schemaVersion: 1, meta: { id: "x" }, items: [] } });
  assert.ok(bare.pricing.quoteActor({ vitals: { health: { max: 5, regen: 1 } }, motivations: [] }).errors.length > 0);
  assert.ok(a.pricing.quoteActor(ENTRY).errors === undefined);
});

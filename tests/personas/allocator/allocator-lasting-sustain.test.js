/**
 * #650 M1 — characterization, no price edit: what the Allocator charges for the seed-9 "walk-kill"
 * kit, and what that buys in core. Two lasting emits whose upkeep is covered by mana regen stay on
 * every turn, for as long as the level lasts, at no further cost. The perturbation is the point:
 * one regen below the emits' combined upkeep and they do not stay on.
 *
 * Kit (playtest generate-random seed 9, commit 68b1225): dark:emit:3:3, wind:emit:4:3,
 * fire:draw:5:4, mana 60 with regen 34.
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/";
const CORE = "../../../packages/core-ts/src/";
const CLOCK = () => "2026-11-08T00:00:00.000Z";

const KIT = Object.freeze([
  { kind: "dark", expression: "emit", stacks: 3, intensity: 3 },
  { kind: "wind", expression: "emit", stacks: 4, intensity: 3 },
  { kind: "fire", expression: "draw", stacks: 5, intensity: 4 },
]);

async function makeAllocator() {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { createConfiguratorPersona } = await import(`${P}configurator/persona.js`);
  const configurator = createConfiguratorPersona({ clock: CLOCK });
  return createAllocatorPersona({ clock: CLOCK, normalizeMotivations: configurator.normalizeMotivations });
}

/** The upkeep table the runtime hands core: the Configurator's `2 + n`, read at range + intensity². */
async function upkeepTable() {
  const { computeInternalManaUpkeep } = await import(`${P}configurator/cost-model.js`);
  return Array.from({ length: 64 }, (_, n) => (n === 0 ? 0 : computeInternalManaUpkeep(n)));
}

/** Run `ticks` turns of a lone actor wearing the kit; count the turns each slot was lit. */
async function litTurns({ manaRegen, ticks = 20 }) {
  const { createActorRegistry } = await import(`${CORE}state/actor-registry.ts`);
  const { createActorTurn } = await import(`${CORE}rules/actor-turn.ts`);
  const { litActorAffinities } = await import(`${CORE}rules/actor-upkeep.ts`);
  const table = await upkeepTable();
  const registry = createActorRegistry({ dimensions: { width: 3, height: 3 }, terrain: Array(9).fill("floor"), actors: [{
    id: "hero", alignment: "external", lifecycle: "alive", position: { x: 1, y: 1 }, defeatVital: "health",
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 60, max: 60, regen: manaRegen } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: false, canExit: false, blocksMovement: false, blocksSight: false },
    motivations: ["user_controlled"], affinities: KIT.map((pair) => ({ ...pair })), holdings: [],
    activeAffinityKey: "dark:emit", affinitySlots: 3, equippedAffinityKeys: ["dark:emit", "wind:emit", "fire:draw"],
  }] });
  const lit = { "dark:emit": 0, "wind:emit": 0, "fire:draw": 0 };
  for (let tick = 0; tick < ticks; tick += 1) {
    const turn = createActorTurn(registry, tick, { castManaBase: {}, movementStamina: { hero: 1 }, persistentUpkeep: table });
    turn.apply({ actorId: "hero", tick, kind: "wait" });
    turn.closeActions();
    turn.resolveFields();
    turn.regenerate();
    turn.resolveExits();
    for (const pair of litActorAffinities(registry.getActor("hero"))) lit[`${pair.kind}:${pair.expression}`] += 1;
  }
  return lit;
}

test("the kit's quote: regen is most of it, and three lasting slots are priced one by one", async () => {
  const allocator = await makeAllocator();
  const quote = allocator.pricing.quoteActor({
    vitals: { health: { max: 10, regen: 1 }, mana: { max: 60, regen: 34 }, stamina: { max: 10, regen: 1 }, durability: { max: 10, regen: 1 } },
    affinities: KIT, motivations: ["user_controlled"],
  });
  const byLabel = Object.fromEntries(quote.detail.lineItems.map((item) => [item.label, item.spendTokens]));
  assert.equal(byLabel["mana regen"], 34 * 34, "regen is n² tokens");
  // Each lasting slot is priced on its own: the second emit costs what it would alone.
  assert.equal(byLabel["dark+3+emit"], 143);
  assert.equal(byLabel["wind+4+emit"], 157);
  assert.equal(byLabel["fire+5+draw"], 245);
  assert.equal(quote.cost, 1817);
});

test("upkeep is 2 + range + intensity² a turn, so the two emits cost 29 together", async () => {
  const { affinityUpkeepIndex, affinityUpkeepForStacks } = await import(`${CORE}rules/actor-upkeep.ts`);
  const table = await upkeepTable();
  const upkeep = KIT.map((pair) => affinityUpkeepForStacks(table, affinityUpkeepIndex(pair.stacks, pair.intensity)));
  assert.deepEqual(upkeep, [14, 15, 23]);
});

test("regen 34 covers both emits, so they never go off; the draw cycles", async () => {
  const lit = await litTurns({ manaRegen: 34 });
  assert.equal(lit["dark:emit"], 20, "dark emit lit every turn");
  assert.equal(lit["wind:emit"], 20, "wind emit lit every turn");
  assert.ok(lit["fire:draw"] < 20, "the draw (23 more) cannot also be sustained");
});

test("perturbation: one regen below the emits' combined upkeep (28) and they no longer stay on", async () => {
  const lit = await litTurns({ manaRegen: 28 });
  assert.ok(lit["dark:emit"] + lit["wind:emit"] < 40, `emits lit ${lit["dark:emit"]} + ${lit["wind:emit"]} of 40 turns`);
});

// ## TODO: Test Permutations
// - one emit alone at regen = its upkeep exactly (sustained) and one below (cycles)
// - the same kit with the draw unequipped: both emits sustained at regen 29
// - a kit whose upkeep exceeds max mana (#441): never back on once off

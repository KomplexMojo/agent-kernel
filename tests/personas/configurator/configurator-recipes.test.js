// #713/#714: the configuration recipe catalogue. Every recipe loads, expands into a spec's fields and
// is priced by the Allocator with no errors; the prices are pinned so a table or price change shows
// in the diff (design: project notes recipes-2026-11-04.md).
const assert = require("node:assert/strict");

const CLOCK = () => "2026-11-04T00:00:00.000Z";
async function personas() {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/persona.js");
  const { createAllocatorPersona } = await import("../../../packages/runtime/src/personas/allocator/persona.js");
  const configurator = createConfiguratorPersona({ clock: CLOCK });
  const allocator = createAllocatorPersona({ clock: CLOCK, normalizeMotivations: configurator.normalizeMotivations });
  return { configurator, allocator };
}

// Tokens, from the Allocator's quote: delver with user_controlled, warden with defending.
const PRICES = {
  delver: { shadowblade: 373, pyromancer: 382, "glass-cannon": 432, archer: 365, leech: 359, sapper: 418, hexer: 397, kiter: 451,
    duelist: 463, geomancer: 406, tank: 392, paladin: 415, cleric: 420, spellward: 378, gatekeeper: 392, wellspring: 475,
    "retinue-leader": 309, scout: 363, sneak: 289, "lantern-bearer": 405 },
  warden: { shadowblade: 310, pyromancer: 309, "glass-cannon": 416, archer: 349, leech: 286, sapper: 355, hexer: 324, kiter: 435,
    duelist: 447, geomancer: 333, tank: 376, paladin: 336, cleric: 331, spellward: 299, gatekeeper: 319, wellspring: 459,
    "retinue-leader": 293, scout: 347, sneak: 273, "lantern-bearer": 326 },
};
const NO_ATTACK = ["tank", "cleric", "wellspring", "retinue-leader", "lantern-bearer"];

test("the catalogue holds the 20 designed recipes, in order", async () => {
  const { configurator } = await personas();
  assert.deepEqual(configurator.configurationRecipeNames(), Object.keys(PRICES.delver));
});

test("every recipe expands and is priced by the Allocator, for a delver and a warden", async () => {
  const { configurator, allocator } = await personas();
  for (const role of ["delver", "warden"]) {
    for (const name of configurator.configurationRecipeNames()) {
      const expanded = configurator.expandConfigurationRecipe({ name, role });
      const quote = allocator.pricing.quoteActor({ type: role, vitals: expanded.vitals, affinities: expanded.affinities,
        affinitySlots: expanded.affinities.length, motivations: role === "delver" ? ["user_controlled"] : ["defending"] });
      assert.deepEqual(quote.errors ?? [], [], `${role} ${name} quotes without errors`);
      assert.equal(quote.cost, PRICES[role][name], `${role} ${name} costs ${PRICES[role][name]} tokens`);
    }
  }
});

test("every held affinity is equipped; a warden keeps the first two and reports the rest", async () => {
  const { configurator } = await personas();
  const delver = configurator.expandConfigurationRecipe({ name: "lantern-bearer", role: "delver" });
  assert.deepEqual(delver.equip, delver.affinities.map(({ kind, expression }) => ({ kind, expression })));
  assert.deepEqual(delver.dropped, []);
  const warden = configurator.expandConfigurationRecipe({ name: "lantern-bearer", role: "warden" });
  assert.deepEqual(warden.affinities.map(({ kind, expression, stacks, intensity }) => `${kind}:${expression}:${stacks}:${intensity}`),
    ["light:emit:3:2", "light:pull:2:1"]);
  assert.deepEqual(warden.dropped, [{ kind: "light", expression: "push" }]);
});

test("roles come from the table: the no-attack recipes are exactly the designed ones", async () => {
  const { configurator } = await personas();
  const rows = configurator.describeConfigurationRecipes();
  assert.deepEqual(rows.filter((row) => row.roles.attack === 0).map((row) => row.name), NO_ATTACK);
  assert.deepEqual(rows.find((row) => row.name === "shadowblade").roles, { attack: 2, defence: 0, support: 1 });
});

test("a {K} recipe takes the author's kind, defaults otherwise, and refuses a kind it has no use for", async () => {
  const { configurator } = await personas();
  const kinds = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
  for (const kind of kinds) {
    const ward = configurator.expandConfigurationRecipe({ name: "spellward", kind });
    assert.deepEqual(ward.affinities.map((entry) => entry.kind), [kind, kind, kind]);
  }
  assert.equal(configurator.expandConfigurationRecipe({ name: "spellward" }).kind, "fire");
  assert.throws(() => configurator.expandConfigurationRecipe({ name: "tank", kind: "fire", label: "delver[1]" }),
    /delver\[1\]: recipe tank has no \{K\} kind to set; drop kind=/);
  assert.throws(() => configurator.expandConfigurationRecipe({ name: "spellward", kind: "plasma" }), /kind=plasma is not an affinity kind/);
});

test("an unknown recipe is refused, naming the known ones", async () => {
  const { configurator } = await personas();
  assert.throws(() => configurator.expandConfigurationRecipe({ name: "necromancer", label: "warden[2]" }),
    /warden\[2\]: unknown recipe "necromancer" \(known: shadowblade, pyromancer, .*lantern-bearer\)/);
});

test("no recipe exceeds the catalogue's intensity cap, and every recipe meets the viability floor", async () => {
  const { RECIPE_MAX_INTENSITY, configurationRecipe, configurationRecipeNames } = await import("../../../packages/runtime/src/personas/configurator/recipes.js");
  assert.equal(RECIPE_MAX_INTENSITY, 3);
  for (const name of configurationRecipeNames()) {
    const recipe = configurationRecipe(name);
    assert.ok(recipe.affinities.every((entry) => entry.intensity <= RECIPE_MAX_INTENSITY), name);
    assert.ok(recipe.vitals.health.max >= 10 && recipe.vitals.mana.max >= 10 && recipe.vitals.durability.max >= 10, name);
    assert.ok(Object.isFrozen(recipe), `${name} is frozen`);
  }
});

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
// #834 repriced mana regen (3 a point), which moved every recipe.
const PRICES = {
  delver: { shadowblade: 436, pyromancer: 424, "glass-cannon": 362, archer: 423, leech: 365, sapper: 414, hexer: 387, kiter: 455,
    duelist: 463, geomancer: 410, tank: 394, paladin: 419, cleric: 440, spellward: 451, gatekeeper: 392, wellspring: 405,
    "retinue-leader": 305, scout: 363, sneak: 279, "lantern-bearer": 395, watcher: 292 },
  warden: { shadowblade: 310, pyromancer: 351, "glass-cannon": 346, archer: 407, leech: 292, sapper: 351, hexer: 314, kiter: 439,
    duelist: 447, geomancer: 337, tank: 378, paladin: 340, cleric: 351, spellward: 372, gatekeeper: 319, wellspring: 389,
    "retinue-leader": 289, scout: 347, sneak: 263, "lantern-bearer": 316, watcher: 276 },
};
const NO_ATTACK = ["tank", "cleric", "wellspring", "retinue-leader", "lantern-bearer", "watcher"];

test("the catalogue holds the 21 designed recipes, in order", async () => {
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

test("a kindColumn recipe takes a kind from the table's column, not one the data names (#564)", async () => {
  const { configurator } = await personas();
  const revealing = ["light"]; // the table's reveals column today; the test reads the table below too
  const { affinityKindsWith } = await import("../../../packages/core-ts/src/state/affinity-table.ts");
  assert.deepEqual(affinityKindsWith("reveals"), revealing);
  const watcher = configurator.expandConfigurationRecipe({ name: "watcher", role: "warden" });
  assert.equal(watcher.kind, affinityKindsWith("reveals")[0]);
  assert.deepEqual(watcher.affinities.map((entry) => entry.expression), ["emit", "pull"]);
  for (const kind of affinityKindsWith("reveals")) assert.equal(configurator.expandConfigurationRecipe({ name: "watcher", kind }).kind, kind);
  for (const kind of ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "dark"]) {
    assert.throws(() => configurator.expandConfigurationRecipe({ name: "watcher", kind }), /not a kind with the reveals column/);
  }
  const row = configurator.describeConfigurationRecipes().find((entry) => entry.name === "watcher");
  assert.equal(row.kindColumn, "reveals");
});

test("an unknown recipe is refused, naming the known ones", async () => {
  const { configurator } = await personas();
  assert.throws(() => configurator.expandConfigurationRecipe({ name: "necromancer", label: "warden[2]" }),
    /warden\[2\]: unknown recipe "necromancer" \(known: shadowblade, pyromancer, .*watcher\)/);
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

// #719: strategy recipes are the Actor's (goals and tactics in its own grammar, tagged with the
// posture, mobility and cognition they need); `strategy-recipe=<name>` on a spec adds those
// motivations through the Configurator, refusing a clash with an explicit one. No new price.
const assert = require("node:assert/strict");

const {
  STRATEGY_CONDITION_INPUTS,
  TARGET_SELECTORS,
  actorStrategyRecipe,
  actorStrategyRecipeNames,
  describeActorStrategyRecipes,
  normalizeActorStrategy,
} = require("../../../packages/runtime/src/personas/actor/persona.js");
const { createConfiguratorPersona } = require("../../../packages/runtime/src/personas/configurator/controller.js");
const { GAME_MOTIVATION_FAMILIES } = require("../../../packages/runtime/src/contracts/game-elements.js");

const configurator = createConfiguratorPersona({ clock: () => "2026-11-04T00:00:00.000Z" });

async function specs() {
  const { createAuthoringSpecs } = await import("../../../packages/runtime/src/commands/authoring-specs.js");
  return createAuthoringSpecs({ makeId: () => "t" });
}

const NAMES = ["attack-alignment", "break-off", "mana-discipline", "focus-fire", "kite", "ambush-from-the-dark",
  "read-before-engaging", "hold-the-chokepoint", "guard-the-leader", "triage-heal", "loot-run", "hit-and-fade",
  "structure-breaker", "leech-loop", "silence-the-caster"];

test("the Actor holds the fifteen strategy recipes, each in its own canonical grammar", () => {
  assert.deepEqual(actorStrategyRecipeNames(), NAMES);
  for (const name of NAMES) {
    const recipe = actorStrategyRecipe(name);
    assert.deepEqual(normalizeActorStrategy(recipe.strategy), recipe.strategy, `${name} is already canonical`);
    assert.ok(recipe.postures.every((posture) => GAME_MOTIVATION_FAMILIES.posture.includes(posture)), name);
    assert.equal(recipe.cognition, recipe.strategy.tactics?.length ? "strategy_focused" : "goal_oriented", name);
  }
  assert.equal(actorStrategyRecipe("moonwalk"), undefined);
  const copy = actorStrategyRecipe("kite");
  copy.strategy.tactics.length = 0;
  assert.ok(actorStrategyRecipe("kite").strategy.tactics.length > 0, "callers get a copy");
  assert.deepEqual(describeActorStrategyRecipes().map((row) => row.name), NAMES);
});

test("every recipe's conditions are observable ones (#718) and every cast names a known selector or none", () => {
  for (const name of NAMES) {
    for (const tactic of actorStrategyRecipe(name).strategy.tactics ?? []) {
      const condition = Object.keys(tactic.when).find((key) => Object.hasOwn(STRATEGY_CONDITION_INPUTS, key));
      assert.ok(condition, `${name}: ${JSON.stringify(tactic.when)} is a guarded condition`);
      if (tactic.do.kind === "cast_affinity") assert.ok(TARGET_SELECTORS.includes(tactic.do.params.targetId), `${name}: cast target is a selector`);
    }
  }
});

test("aggressive strategies go with attacking, protective with defending (Darren 2026-11-04)", () => {
  const posture = Object.fromEntries(NAMES.map((name) => [name, actorStrategyRecipe(name).postures]));
  for (const name of ["focus-fire", "kite", "read-before-engaging", "hit-and-fade", "structure-breaker", "leech-loop", "silence-the-caster"]) {
    assert.deepEqual(posture[name], ["attacking"], name);
  }
  for (const name of ["break-off", "mana-discipline", "hold-the-chokepoint"]) assert.deepEqual(posture[name], ["defending"], name);
  assert.ok(!NAMES.some((name) => posture[name].includes("attacking") && actorStrategyRecipe(name).strategy.tactics[0].do.kind === "retreat"
    && name !== "kite" && name !== "hit-and-fade" && name !== "loot-run" && name !== "ambush-from-the-dark"),
  "an attacking recipe never opens by running unless the run is its point");
});

test("the Configurator adds the recipe's motivations, replacing a role default that does not fit", () => {
  const compose = (role, raw, name) => configurator.composeStrategyRecipeMotivations({ role, index: 0, raw, recipe: actorStrategyRecipe(name) });
  assert.deepEqual(compose("delver", undefined, "kite"), ["attacking", "exploring", "strategy_focused"]);
  assert.deepEqual(compose("warden", undefined, "kite"), ["attacking", "exploring", "strategy_focused"], "the warden default defending gives way");
  assert.deepEqual(compose("warden", undefined, "break-off"), ["defending", "strategy_focused"]);
  assert.deepEqual(compose("delver", "user_controlled", "kite"), ["user_controlled", "attacking", "exploring"],
    "a player's actor already follows tactics: no cognition added");
  assert.deepEqual(compose("delver", "attacking+strategy_focused", "focus-fire"), ["attacking", "strategy_focused"]);
  assert.deepEqual(compose("delver", "friendly", "loot-run"), ["friendly", "exploring", "strategy_focused"], "either posture fits");
});

test("an explicit motivation that clashes with the recipe is refused, naming both", () => {
  const compose = (raw, name) => configurator.composeStrategyRecipeMotivations({ role: "delver", index: 2, raw, recipe: actorStrategyRecipe(name) });
  assert.throws(() => compose("defending", "kite"), /delver\[2\] motivation defending clashes with strategy-recipe kite, which needs attacking/);
  assert.throws(() => compose("attacking+stationary", "kite"), /motivation stationary clashes with strategy-recipe kite, which needs exploring/);
  assert.throws(() => compose("attacking+goal_oriented", "kite"), /motivation goal_oriented clashes with strategy-recipe kite, which needs strategy_focused/);
});

test("strategy-recipe= on a spec lands as the recipe's strategy and motivations, as if typed", async () => {
  const { parseDelverSpecs, parseWardenSpecs } = await specs();
  const [byName] = parseDelverSpecs(["strategy-recipe=structure-breaker;affinities=corrode:push:3"]);
  const recipe = actorStrategyRecipe("structure-breaker");
  assert.deepEqual(byName.value.strategy, recipe.strategy);
  const [typed] = parseDelverSpecs([`motivation=attacking+exploring+strategy_focused;affinities=corrode:push:3;strategy=${JSON.stringify(recipe.strategy)}`]);
  assert.deepEqual(byName.value, typed.value);
  const [warden] = parseWardenSpecs(["strategy-recipe=hold-the-chokepoint"]);
  assert.deepEqual(warden.motivations, ["defending", "stationary", "strategy_focused"]);
  assert.throws(() => parseDelverSpecs(["strategy-recipe=kite;strategy=reach:exit"]), /delver\[1\] gives strategy= and strategy-recipe=; give one/);
  assert.throws(() => parseDelverSpecs(["strategy-recipe=moonwalk"]), /unknown strategy recipe "moonwalk" \(known: attack-alignment, break-off/);
  assert.throws(() => parseDelverSpecs(["motivation=defending;strategy-recipe=kite"]), /clashes with strategy-recipe kite/);
});

test("the configuration recipes' suggested strategies are all strategy recipes", async () => {
  const known = new Set(actorStrategyRecipeNames());
  for (const row of configurator.describeConfigurationRecipes()) {
    for (const name of row.strategies) assert.ok(known.has(name), `${row.name} suggests ${name}`);
  }
});

// ## TODO: Test Permutations
// - strategy-recipe= beside recipe= (a configuration recipe and its suggested strategy together).
// - a goals-only recipe adds goal_oriented, and an explicit strategy_focused fits it.
// - agon recipes --kind strategy text and --json rows; agon_recipe_show for a strategy recipe.

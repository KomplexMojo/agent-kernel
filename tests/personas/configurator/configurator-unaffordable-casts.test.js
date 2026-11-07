/**
 * #732: a cast that costs more than the actor's mana max can never be made: core never pays more
 * than the pool holds, so the Actor falls through to a weaker slot every turn. The pyromancer's
 * fire push (range 4, intensity 2, 80 mana) sat behind a 40 mana pool and the kit lost every fight.
 * The Configurator now says so: an authored actor's spec is kept (#371) and the cast is reported,
 * and a recipe that cannot pay for its own casts refuses to load.
 */
import assert from "node:assert/strict";
import { createConfiguratorPersona } from "../../../packages/runtime/src/personas/configurator/persona.js";
import {
  configurationRecipe,
  configurationRecipeNames,
  loadConfigurationRecipeCatalogue,
} from "../../../packages/runtime/src/personas/configurator/recipes.js";
import { resolveAffinityManaCost } from "../../../packages/runtime/src/personas/configurator/affinity-rules.js";

const { reportUnaffordableCasts } = createConfiguratorPersona({ clock: () => "2026-11-07T00:00:00.000Z" }).authorCandidates;

const actor = (manaMax, affinities) => ({
  id: "hero-1",
  motivations: ["user_controlled"],
  affinities,
  vitals: { mana: { current: manaMax, max: manaMax, regen: 4 } },
});

test("a push dearer than the mana max is reported with its price and the pool", () => {
  const report = reportUnaffordableCasts(actor(40, [
    { kind: "fire", expression: "push", stacks: 4, intensity: 2 },
    { kind: "fire", expression: "emit", stacks: 2, intensity: 1 },
    { kind: "fortify", expression: "pull", stacks: 1, intensity: 1 },
  ]));
  assert.deepEqual(report, [{ actorId: "hero-1", affinity: "fire:push", range: 4, intensity: 2, mana: 80, manaMax: 40 }]);
});

test("a cast that exactly fills the pool is affordable; emit and draw are never casts", () => {
  assert.deepEqual(reportUnaffordableCasts(actor(80, [{ kind: "fire", expression: "push", stacks: 4, intensity: 2 }])), []);
  assert.deepEqual(reportUnaffordableCasts(actor(1, [{ kind: "dark", expression: "emit", stacks: 3, intensity: 2 },
    { kind: "fire", expression: "draw", stacks: 2, intensity: 2 }])), []);
});

test("an actor with no affinities or no mana pool reports nothing", () => {
  assert.deepEqual(reportUnaffordableCasts({ id: "w-1", motivations: ["defending"], vitals: { mana: { current: 0, max: 0, regen: 0 } } }), []);
  assert.deepEqual(reportUnaffordableCasts({ id: "w-1", motivations: ["defending"], affinities: [{ kind: "fire", expression: "push", stacks: 1 }] }), []);
});

test("a structure with no motivation never casts, so its alignment is not reported", () => {
  const barrier = { ...actor(10, [{ kind: "earth", expression: "push", stacks: 2, intensity: 2 }]), id: "barrier_3_4", motivations: [] };
  assert.deepEqual(reportUnaffordableCasts(barrier), []);
});

test("every recipe can pay for each of its casts from a full pool", () => {
  for (const name of configurationRecipeNames()) {
    const recipe = configurationRecipe(name);
    for (const entry of recipe.affinities) {
      if (entry.expression !== "push" && entry.expression !== "pull") continue;
      const kind = entry.kind === "{K}" ? recipe.kindDefault : entry.kind;
      const cost = resolveAffinityManaCost({ rules: null, kind, expression: entry.expression, stacks: entry.range, intensity: entry.intensity });
      assert.ok(cost <= recipe.vitals.mana.max, `${name}: ${kind}:${entry.expression} costs ${cost}, mana max ${recipe.vitals.mana.max}`);
    }
  }
});

test("a recipe whose cast costs more than its mana max refuses to load", () => {
  const recipe = {
    name: "underfed", title: "Underfed", archetype: "mage", description: "d", weaknesses: "w", strategies: [],
    vitals: { health: { max: 25, regen: 1 }, mana: { max: 40, regen: 4 }, stamina: { max: 25, regen: 3 }, durability: { max: 15, regen: 1 } },
    affinities: [{ kind: "fire", expression: "push", range: 4, intensity: 2 }],
  };
  assert.throws(() => loadConfigurationRecipeCatalogue({ maxIntensity: 3, recipes: [recipe] }),
    /recipe "underfed": fire:push costs 80 mana a cast but mana max is 40/);
  recipe.vitals.mana.max = 80;
  assert.equal(loadConfigurationRecipeCatalogue({ maxIntensity: 3, recipes: [recipe] }).length, 1);
});

// ## TODO: Test Permutations
// - a {K} recipe is checked at its kindDefault
// - a pull dearer than the pool is reported the same way as a push
// - several unaffordable casts on one actor are each reported, in held order
// - a packed (unequipped) affinity is reported too: equipping it later changes nothing

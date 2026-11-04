/**
 * Strategy recipes (#719, #720; Darren 2026-11-04): named standing orders an actor can be given by
 * name (`strategy-recipe=kite`). The data is `strategy-recipes/strategy-recipes.json`; this module
 * is its only reader, and the Actor controller its only importer.
 *
 * A recipe is a strategy in the Actor's canonical form (`strategy.js`: goals and `{when, do}`
 * tactics) plus the tags that say who may follow it:
 *   postures   the posture motivations it fits (Darren: aggressive strategies go with `attacking`)
 *   mobility   the mobility it implies, or null for any
 *   cognition  derived, not written: tactics need `strategy_focused`, goals alone `goal_oriented`
 *   requires   the kit it expects, `{ role?, kind?, expressions? }` per held affinity (informational)
 *   fits       `list`, or `z3-candidate` where a solver may later pick better (#674)
 * It has no price of its own (decided): the motivations it adds are priced like any others.
 * Every `when` is one of the strategy conditions, so each reads only what the actor observes (#718).
 */
import CATALOGUE from "./strategy-recipes/strategy-recipes.json" with { type: "json" };
import { MOTIVATION_FAMILIES } from "../../contracts/domain-constants.js";
import { AFFINITY_EXPRESSIONS, AFFINITY_KINDS } from "../../contracts/domain-constants.js";

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const STRATEGY_RECIPE_FITS = Object.freeze(["list", "z3-candidate"]);
const ROLES = Object.freeze(["attack", "defence", "support"]);

function fail(message) {
  throw new Error(`strategy recipe catalogue: ${message}`);
}

function validateRequirement(entry, label) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label}: each requires entry must be an object.`);
  const unknown = Object.keys(entry).filter((key) => !["role", "kind", "expressions"].includes(key));
  if (unknown.length) fail(`${label}: requires has unknown field ${unknown.join(", ")}.`);
  if (entry.role !== undefined && !ROLES.includes(entry.role)) fail(`${label}: requires.role must be ${ROLES.join(", ")}.`);
  if (entry.kind !== undefined && !AFFINITY_KINDS.includes(entry.kind)) fail(`${label}: requires.kind ${JSON.stringify(entry.kind)} is not an affinity kind.`);
  if (entry.expressions !== undefined && (!Array.isArray(entry.expressions) || entry.expressions.length === 0
    || !entry.expressions.every((expression) => AFFINITY_EXPRESSIONS.includes(expression)))) {
    fail(`${label}: requires.expressions must list affinity expressions.`);
  }
}

function loadRecipe(recipe, seen, normalizeStrategy) {
  const label = `recipe ${JSON.stringify(recipe?.name)}`;
  if (!recipe || typeof recipe !== "object") fail("every recipe must be an object.");
  if (typeof recipe.name !== "string" || !NAME.test(recipe.name)) fail(`${label}: name must be lowercase kebab-case.`);
  if (seen.has(recipe.name)) fail(`${label} is listed twice.`);
  seen.add(recipe.name);
  for (const key of ["title", "description"]) {
    if (typeof recipe[key] !== "string" || recipe[key].trim() === "") fail(`${label}: ${key} must be a non-empty string.`);
  }
  if (recipe.limits !== undefined && (typeof recipe.limits !== "string" || recipe.limits.trim() === "")) fail(`${label}: limits, when given, is a sentence.`);
  if (!Array.isArray(recipe.postures) || recipe.postures.length === 0
    || !recipe.postures.every((posture) => MOTIVATION_FAMILIES.posture.includes(posture))) {
    fail(`${label}: postures must list posture motivations (${MOTIVATION_FAMILIES.posture.join(", ")}).`);
  }
  if (recipe.mobility !== null && !MOTIVATION_FAMILIES.mobility.includes(recipe.mobility)) {
    fail(`${label}: mobility must be null or one of ${MOTIVATION_FAMILIES.mobility.join(", ")}.`);
  }
  if (!STRATEGY_RECIPE_FITS.includes(recipe.fits)) fail(`${label}: fits must be ${STRATEGY_RECIPE_FITS.join(" or ")}.`);
  if (!Array.isArray(recipe.requires)) fail(`${label}: requires must be a list.`);
  recipe.requires.forEach((entry) => validateRequirement(entry, label));
  let strategy;
  try {
    strategy = normalizeStrategy(recipe.strategy);
  } catch (error) {
    fail(`${label}: ${error.message}`);
  }
  const cognition = Array.isArray(strategy.tactics) && strategy.tactics.length > 0 ? "strategy_focused" : "goal_oriented";
  return Object.freeze({
    name: recipe.name,
    title: recipe.title,
    description: recipe.description,
    ...(recipe.limits ? { limits: recipe.limits } : {}),
    postures: Object.freeze([...recipe.postures]),
    mobility: recipe.mobility,
    cognition,
    requires: Object.freeze(recipe.requires.map((entry) => Object.freeze(structuredClone(entry)))),
    fits: recipe.fits,
    strategy: Object.freeze(strategy),
  });
}

/**
 * The catalogue, checked against the Actor's own strategy grammar (`normalizeStrategy` is the
 * controller's `normalizeActorStrategy`). Throws, naming the recipe, on any malformed entry.
 */
export function createStrategyRecipeCatalogue(normalizeStrategy) {
  if (!Array.isArray(CATALOGUE?.recipes) || CATALOGUE.recipes.length === 0) fail("recipes must be a non-empty list.");
  const seen = new Set();
  const recipes = Object.freeze(CATALOGUE.recipes.map((recipe) => loadRecipe(recipe, seen, normalizeStrategy)));
  const byName = new Map(recipes.map((recipe) => [recipe.name, recipe]));
  const copy = (recipe) => structuredClone({ ...recipe, strategy: recipe.strategy });
  return Object.freeze({
    names: () => recipes.map((recipe) => recipe.name),
    /** The recipe called `name` (a copy), or undefined. */
    get: (name) => (byName.has(name) ? copy(byName.get(name)) : undefined),
    /** A listing row per recipe: tags and counts, no strategy body. */
    describe: () => recipes.map((recipe) => ({
      name: recipe.name,
      title: recipe.title,
      description: recipe.description,
      ...(recipe.limits ? { limits: recipe.limits } : {}),
      postures: [...recipe.postures],
      mobility: recipe.mobility,
      cognition: recipe.cognition,
      requires: structuredClone(recipe.requires),
      fits: recipe.fits,
      goals: recipe.strategy.goals.length,
      tactics: recipe.strategy.tactics?.length ?? 0,
    })),
  });
}

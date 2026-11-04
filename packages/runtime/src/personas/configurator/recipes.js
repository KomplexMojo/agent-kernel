/**
 * Configuration recipes (#713, Darren 2026-11-04): named, ready-made actor configurations a
 * player, a script, an MCP client or a model can ask for by name (`recipe=shadowblade`). The data
 * is `recipes/configuration-recipes.json`; this module is its only reader.
 *
 * What a recipe is: a choice of already-priced pieces (vitals, regen, affinities with range and
 * intensity), so it has no price of its own; the Allocator quotes its expansion like any typed spec
 * (Darren: "no new price"). What it is not: a rule. Every field a spec writes beside `recipe=`
 * overrides the recipe's own (#715), and the expansion goes through the same Configurator
 * authoring as a hand-typed actor, so there is no parallel path.
 *
 * Affinities are listed in importance order and every one is equipped from the start (an explicit
 * equip order that leaves an attack in the pack is the trap #722 warns about). An actor with fewer
 * slots than the recipe has affinities keeps the first ones and the expansion says what it dropped.
 * A `{K}` kind is the author's pick (`kind=`), else the recipe's `kindDefault`.
 */
import CATALOGUE from "./recipes/configuration-recipes.json" with { type: "json" };
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  ACTOR_VIABILITY_FLOOR,
  PRESET_AFFINITY_SLOTS,
} from "../../contracts/domain-constants.js";
import { GAME_VITAL_KEYS } from "../../contracts/game-elements.js";
import { MAX_AFFINITY_SLOTS } from "../../../../core-ts/src/state/actor-inventory.ts";
import { affinityRole } from "../../../../core-ts/src/state/affinity-table.ts";

export const RECIPE_KIND_PARAMETER = "{K}";
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function fail(message) {
  throw new Error(`configuration recipe catalogue: ${message}`);
}

function validateRecipe(recipe, seen, maxIntensity) {
  const label = `recipe ${JSON.stringify(recipe?.name)}`;
  if (!recipe || typeof recipe !== "object") fail("every recipe must be an object.");
  if (typeof recipe.name !== "string" || !NAME.test(recipe.name)) fail(`${label}: name must be lowercase kebab-case.`);
  if (seen.has(recipe.name)) fail(`${label} is listed twice.`);
  seen.add(recipe.name);
  for (const key of ["title", "archetype", "description", "weaknesses"]) {
    if (typeof recipe[key] !== "string" || recipe[key].trim() === "") fail(`${label}: ${key} must be a non-empty string.`);
  }
  for (const key of GAME_VITAL_KEYS) {
    const vital = recipe.vitals?.[key];
    if (!vital || !Number.isSafeInteger(vital.max) || !Number.isSafeInteger(vital.regen) || vital.max < 1 || vital.regen < 0) {
      fail(`${label}: vitals.${key} must be { max >= 1, regen >= 0 } whole numbers.`);
    }
    const floor = ACTOR_VIABILITY_FLOOR[key];
    if (floor && (vital.max < floor.max || vital.regen < floor.regen)) {
      fail(`${label}: vitals.${key} is below the actor viability floor (${floor.max}, regen ${floor.regen}).`);
    }
  }
  if (recipe.vitals.stamina.regen < 1) fail(`${label}: stamina regen must be at least 1 so the actor can move.`);
  const affinities = recipe.affinities;
  if (!Array.isArray(affinities) || affinities.length < 1 || affinities.length > MAX_AFFINITY_SLOTS) {
    fail(`${label}: affinities must list 1 to ${MAX_AFFINITY_SLOTS} entries.`);
  }
  const usesKind = affinities.some((entry) => entry.kind === RECIPE_KIND_PARAMETER);
  if (usesKind !== (recipe.kindDefault !== undefined)) fail(`${label}: kindDefault is given exactly when an affinity uses ${RECIPE_KIND_PARAMETER}.`);
  if (usesKind && !AFFINITY_KINDS.includes(recipe.kindDefault)) fail(`${label}: kindDefault ${JSON.stringify(recipe.kindDefault)} is not an affinity kind.`);
  const keys = new Set();
  for (const entry of affinities) {
    if (entry.kind !== RECIPE_KIND_PARAMETER && !AFFINITY_KINDS.includes(entry.kind)) fail(`${label}: unknown affinity kind ${JSON.stringify(entry.kind)}.`);
    if (!AFFINITY_EXPRESSIONS.includes(entry.expression)) fail(`${label}: unknown expression ${JSON.stringify(entry.expression)}.`);
    if (!Number.isSafeInteger(entry.range) || entry.range < 1) fail(`${label}: ${entry.kind}:${entry.expression} range must be a whole number >= 1.`);
    if (!Number.isSafeInteger(entry.intensity) || entry.intensity < 1 || entry.intensity > maxIntensity) {
      fail(`${label}: ${entry.kind}:${entry.expression} intensity must be 1 to ${maxIntensity} (the catalogue cap).`);
    }
    const key = `${entry.kind}:${entry.expression}`;
    if (keys.has(key)) fail(`${label}: ${key} is listed twice.`);
    keys.add(key);
  }
  if (!Array.isArray(recipe.strategies) || !recipe.strategies.every((name) => typeof name === "string" && NAME.test(name))) {
    fail(`${label}: strategies must be a list of strategy recipe names.`);
  }
}

function loadCatalogue(source) {
  if (!Number.isSafeInteger(source?.maxIntensity) || source.maxIntensity < 1) fail("maxIntensity must be a whole number >= 1.");
  if (!Array.isArray(source.recipes) || source.recipes.length === 0) fail("recipes must be a non-empty list.");
  const seen = new Set();
  source.recipes.forEach((recipe) => validateRecipe(recipe, seen, source.maxIntensity));
  return Object.freeze(source.recipes.map((recipe) => Object.freeze(structuredClone(recipe))));
}

const RECIPES = loadCatalogue(CATALOGUE);
const BY_NAME = new Map(RECIPES.map((recipe) => [recipe.name, recipe]));

/** The catalogue's intensity cap (a recipe above it is refused when the catalogue loads). */
export const RECIPE_MAX_INTENSITY = CATALOGUE.maxIntensity;

/** Every recipe name, in catalogue order. */
export function configurationRecipeNames() {
  return RECIPES.map((recipe) => recipe.name);
}

/** The recipe called `name`, or undefined. Frozen: callers copy before they change anything. */
export function configurationRecipe(name) {
  return BY_NAME.get(name);
}

function resolveKind(recipe, kind, label) {
  if (kind === undefined || kind === null || kind === "") return recipe.kindDefault;
  if (recipe.kindDefault === undefined) throw new Error(`${label}: recipe ${recipe.name} has no ${RECIPE_KIND_PARAMETER} kind to set; drop kind=.`);
  if (!AFFINITY_KINDS.includes(kind)) throw new Error(`${label}: kind=${kind} is not an affinity kind (expected ${AFFINITY_KINDS.join(", ")}).`);
  return kind;
}

/** Attack / defence / support counts of a list of `{ kind, expression }` (the table's labels, #704). */
export function recipeRoleMix(affinities) {
  const mix = { attack: 0, defence: 0, support: 0 };
  affinities.forEach((entry) => { const role = affinityRole(entry.kind, entry.expression); if (role) mix[role] += 1; });
  return mix;
}

/**
 * One recipe as the fields an actor spec carries, for `role` (delver, warden, ...):
 *   { name, kind?, vitals: { key: { max, regen } }, affinities: [{ kind, expression, stacks, intensity }],
 *     equip: [{ kind, expression }], dropped: [{ kind, expression }], roles }
 * `stacks` is the range, as everywhere in the spec grammar. Affinities past the role's slots are
 * `dropped` (not held, so not paid for) and the caller reports them. Throws, naming the known
 * recipes, for an unknown name.
 */
export function expandConfigurationRecipe({ name, role = "delver", kind, label = `${role}` } = {}) {
  const recipe = BY_NAME.get(name);
  if (!recipe) {
    throw new Error(`${label}: unknown recipe ${JSON.stringify(name)} (known: ${configurationRecipeNames().join(", ")}).`);
  }
  if (!Object.hasOwn(PRESET_AFFINITY_SLOTS, role)) throw new Error(`${label}: recipes configure actors with affinity slots; ${role} has none.`);
  const chosenKind = resolveKind(recipe, kind, label);
  const all = recipe.affinities.map((entry) => ({
    kind: entry.kind === RECIPE_KIND_PARAMETER ? chosenKind : entry.kind,
    expression: entry.expression,
    stacks: entry.range,
    intensity: entry.intensity,
  }));
  const slots = Math.min(MAX_AFFINITY_SLOTS, PRESET_AFFINITY_SLOTS[role]);
  const affinities = all.slice(0, slots);
  const vitals = Object.fromEntries(GAME_VITAL_KEYS.map((key) => [key, { ...recipe.vitals[key] }]));
  return {
    name: recipe.name,
    ...(chosenKind !== undefined ? { kind: chosenKind } : {}),
    vitals,
    affinities,
    equip: affinities.map(({ kind: entryKind, expression }) => ({ kind: entryKind, expression })),
    dropped: all.slice(slots).map(({ kind: entryKind, expression }) => ({ kind: entryKind, expression })),
    roles: recipeRoleMix(affinities),
  };
}

/** A summary row per recipe for listings (no price: the caller asks the Allocator for one). */
export function describeConfigurationRecipes() {
  return RECIPES.map((recipe) => {
    const affinities = recipe.affinities.map((entry) => ({
      ...entry, kind: entry.kind === RECIPE_KIND_PARAMETER ? recipe.kindDefault : entry.kind,
    }));
    return {
      name: recipe.name,
      title: recipe.title,
      archetype: recipe.archetype,
      description: recipe.description,
      weaknesses: recipe.weaknesses,
      affinities: recipe.affinities.map((entry) => `${entry.kind}:${entry.expression}:${entry.range}:${entry.intensity}`),
      ...(recipe.kindDefault !== undefined ? { kindDefault: recipe.kindDefault } : {}),
      roles: recipeRoleMix(affinities),
      strategies: [...recipe.strategies],
    };
  });
}

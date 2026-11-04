/**
 * The recipe catalogue as every front end reads it (#716): `ak recipes` / `ak recipe`, the MCP
 * tools, the character sheet and the LLM planner. Glue only: the recipes are the Configurator's
 * (configuration) and the Actor's (strategy), each row's price is the Allocator's quote of the
 * recipe's expansion. Nothing here decides what a recipe holds or costs.
 */
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";

export const RECIPE_LISTING_KINDS = Object.freeze(["config", "strategy"]);
export const RECIPE_LISTING_ROLES = Object.freeze(["attack", "defence", "support"]);
const PRICED_ROLES = Object.freeze(["delver", "warden"]);
// What a recipe is quoted with: a playable delver (the character sheet's case) and a defending
// warden (the spec's default warden motivation). The quote is the Allocator's either way.
const QUOTE_MOTIVATIONS = Object.freeze({ delver: ["user_controlled"], warden: ["defending"] });

export function createRecipeCatalogue({ configurator, allocator, strategyRecipes = null } = {}) {
  const config = configurator ?? createConfiguratorPersona({ clock: UNUSED_CLOCK });
  const pricing = allocator ?? createAllocatorPersona({ clock: UNUSED_CLOCK, normalizeMotivations: config.normalizeMotivations });

  function quote(name, role, kind) {
    const expanded = config.expandConfigurationRecipe({ name, role, kind });
    const result = pricing.pricing.quoteActor({ type: role, vitals: expanded.vitals, affinities: expanded.affinities,
      affinitySlots: expanded.affinities.length, motivations: QUOTE_MOTIVATIONS[role] });
    return { expanded, cost: result.cost, lineItems: result.detail?.lineItems ?? [], errors: result.errors ?? [] };
  }

  function configRows({ role } = {}) {
    return config.describeConfigurationRecipes()
      .filter((row) => !role || row.roles[role] > 0)
      .map((row) => ({
        kind: "config",
        ...row,
        cost: Object.fromEntries(PRICED_ROLES.map((actor) => [actor, quote(row.name, actor).cost])),
      }));
  }

  function strategyRows() {
    return typeof strategyRecipes?.describe === "function" ? strategyRecipes.describe().map((row) => ({ kind: "strategy", ...row })) : [];
  }

  /** Every recipe, optionally only one kind (config | strategy) or only config recipes with a slot of `role`. */
  function list({ kind, role } = {}) {
    if (kind !== undefined && !RECIPE_LISTING_KINDS.includes(kind)) {
      throw new Error(`recipes --kind must be one of ${RECIPE_LISTING_KINDS.join(", ")}, got ${JSON.stringify(kind)}.`);
    }
    if (role !== undefined && !RECIPE_LISTING_ROLES.includes(role)) {
      throw new Error(`recipes --role must be one of ${RECIPE_LISTING_ROLES.join(", ")}, got ${JSON.stringify(role)}.`);
    }
    return [
      ...(kind === undefined || kind === "config" ? configRows({ role }) : []),
      ...((kind === undefined || kind === "strategy") && role === undefined ? strategyRows() : []),
    ];
  }

  /** One recipe in full: its expansion for `role` and the Allocator's line items. */
  function show(name, { role = "delver", kind } = {}) {
    if (!PRICED_ROLES.includes(role)) throw new Error(`recipe --role must be one of ${PRICED_ROLES.join(", ")}, got ${JSON.stringify(role)}.`);
    if (config.configurationRecipe(name)) {
      const row = config.describeConfigurationRecipes().find((entry) => entry.name === name);
      const { expanded, cost, lineItems, errors } = quote(name, role, kind);
      return { kind: "config", ...row, role, expansion: expanded, cost, lineItems, ...(errors.length ? { errors } : {}) };
    }
    const strategy = typeof strategyRecipes?.show === "function" ? strategyRecipes.show(name) : undefined;
    if (strategy) return { kind: "strategy", ...strategy };
    const known = [...config.configurationRecipeNames(), ...(typeof strategyRecipes?.names === "function" ? strategyRecipes.names() : [])];
    throw new Error(`unknown recipe ${JSON.stringify(name)} (known: ${known.join(", ")}).`);
  }

  return { list, show };
}

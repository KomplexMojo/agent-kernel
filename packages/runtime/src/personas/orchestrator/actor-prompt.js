/**
 * #721 — the Orchestrator's prompt contract for an LLM-authored cast (`agon create --actors llm`).
 *
 * The model is shown the author's text, the budget and the recipe catalogue (configuration recipes
 * with their Allocator cost per role and one sentence, strategy recipes with their postures), and
 * asked for `{ "delvers": [...], "wardens": [...] }`: each entry a spec string like the ones a person
 * types (`recipe=shadowblade;motivation=user_controlled`) or an object of spec fields. This module
 * only builds the prompt and reads the reply into spec strings; the spec parser checks every one, so
 * an unknown recipe is refused, never invented. The recipes configure actors; nothing here is ever
 * shown to an actor's seat (the seat rule). Pure functions; the model call is the adapter's.
 */
import { extractResponseText, parseJsonLenient } from "./llm-session.js";

const SPEC_FIELDS = Object.freeze(["id", "count", "recipe", "kind", "motivation", "strategyRecipe", "affinity", "affinities", "vitals", "equip", "escort"]);

function recipeLine(row) {
  const roles = Object.entries(row.roles ?? {}).filter(([, n]) => n > 0).map(([role, n]) => `${role} ${n}`).join(", ") || "no slots";
  const kind = row.kindDefault ? ` (kind= picks its {K} kind, default ${row.kindDefault})` : "";
  return `- ${row.name}: ${row.title}, ${row.archetype}; delver ${row.cost?.delver} t, warden ${row.cost?.warden} t; ${roles}${kind}. ${row.description}`;
}

function strategyLine(row) {
  return `- ${row.name}: ${row.title} (${row.postures.join(" or ")}${row.mobility ? `, ${row.mobility}` : ""}). ${row.description}`;
}

/** The prompt asking for a level's delvers and wardens, by recipe where one fits. */
export function buildActorPlanPrompt({ text, goal, budgetTokens, recipes = [], strategies = [] } = {}) {
  return [
    "You choose the delvers and wardens for a dungeon level from the author's description.",
    ...(text ? [`Description: ${text}`] : []),
    ...(goal ? [`Goal: ${goal}`] : []),
    ...(Number.isFinite(budgetTokens) ? [`Budget: ${budgetTokens} tokens for the whole level.`] : []),
    "Configuration recipes (name one with recipe=<name>; costs are per actor, from the price list):",
    ...recipes.map(recipeLine),
    ...(strategies.length > 0 ? ["Strategy recipes (name one with strategy-recipe=<name>; it adds the motivations it needs):", ...strategies.map(strategyLine)] : []),
    "Each actor is a spec of key=value fields joined by ';': recipe, kind, count, id, motivation (kinds joined by +), strategy-recipe.",
    "Exactly one delver should be playable: give it motivation=user_controlled. Use only recipe names from the lists.",
    "Reply with JSON only: {\"delvers\":[\"<spec>\"],\"wardens\":[\"<spec>\"]}",
  ].join("\n");
}

function specFromObject(entry, label) {
  const unknown = Object.keys(entry).filter((key) => !SPEC_FIELDS.includes(key));
  if (unknown.length > 0) return { error: `${label} has unknown field ${unknown.join(", ")}` };
  const parts = Object.entries(entry).filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key === "strategyRecipe" ? "strategy-recipe" : key}=${Array.isArray(value) ? value.join(key === "motivation" ? "+" : ",") : value}`);
  return { spec: parts.join(";") };
}

/**
 * The model's reply (an adapter payload or plain text) → `{ delvers, wardens }` spec strings, or
 * `{ errors }` saying why it can't be read. What each spec means is the spec parser's to decide.
 */
export function readActorPlanResponse(payload) {
  const text = typeof payload === "string" ? payload : extractResponseText(payload);
  if (typeof text !== "string" || text.trim() === "") return { errors: ["the model returned no text"] };
  const parsed = parseJsonLenient(text);
  if (!parsed || typeof parsed !== "object") return { errors: ["the reply is not a JSON object"] };
  const errors = [];
  const read = (key) => {
    const list = parsed[key] ?? [];
    if (!Array.isArray(list)) {
      errors.push(`the reply's "${key}" is not a list`);
      return [];
    }
    return list.flatMap((entry, index) => {
      const label = `${key}[${index}]`;
      if (typeof entry === "string" && entry.trim() !== "") return [entry.trim()];
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const { spec, error } = specFromObject(entry, label);
        if (error) errors.push(error);
        return spec ? [spec] : [];
      }
      errors.push(`${label} is not a spec`);
      return [];
    });
  };
  const delvers = read("delvers");
  const wardens = read("wardens");
  if (errors.length > 0) return { errors };
  if (delvers.length + wardens.length === 0) return { errors: ["the reply names no delvers or wardens"] };
  return { delvers, wardens };
}

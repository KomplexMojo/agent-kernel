/**
 * #402 — the Orchestrator's prompt contract for an LLM-authored tactic plan (`--tactic llm`).
 *
 * The model is shown the level summary, the budget and the tactic catalogue's parts, and asked
 * for `{ "tactics": [{ "tactic", "params"? }] }`. This module only builds the prompt and reads
 * the reply into raw entries; the Director checks each tactic exists (`normalizeTactics`) and
 * the Configurator checks its params (`validateTactics`). Any failure falls back to the seeded
 * plan (#401). Pure functions; the model call is the adapter's.
 */
import { extractResponseText, parseJsonLenient } from "./llm-session.js";

const CATALOGUE_LINES = Object.freeze([
  "- ambush: params guards (wardens hidden in a room, needs a warden), resources (loot in that room, needs a resource).",
  "- retinue: params size (minions around a warden leader, needs a warden).",
  "- minefield: params hazards (emit hazards in a room on the route), range (each hazard's reach, >= 1).",
]);

/** The prompt asking for a tactic plan for this level. */
export function buildTacticPlanPrompt({ wardens = 0, resources = 0, rooms = 0, budgetTokens, goal } = {}) {
  return [
    "You design placement tactics for a dungeon level. Pick a mix that makes the level interesting.",
    `Level: ${wardens} warden(s), ${resources} resource(s), ${rooms} authored room spec(s)${Number.isFinite(budgetTokens) ? `, budget ${budgetTokens} tokens` : ""}.`,
    ...(goal ? [`Goal: ${goal}`] : []),
    "Tactics (each optional, params are whole numbers):",
    ...CATALOGUE_LINES,
    "A warden can lead a retinue or guard an ambush, not both. Rooms are picked by the builder.",
    "Reply with JSON only: {\"tactics\":[{\"tactic\":\"<name>\",\"params\":{\"<param>\":<n>}}]}",
  ].join("\n");
}

/**
 * The model's reply (an adapter payload or plain text) → `{ tactics }` raw entries, or
 * `{ errors }` saying why it can't be read.
 */
export function readTacticPlanResponse(payload) {
  const text = typeof payload === "string" ? payload : extractResponseText(payload);
  if (typeof text !== "string" || text.trim() === "") return { errors: ["the model returned no text"] };
  const parsed = parseJsonLenient(text);
  const tactics = parsed?.tactics;
  if (!Array.isArray(tactics)) return { errors: ["the reply has no \"tactics\" list"] };
  if (tactics.length === 0) return { errors: ["the reply's tactic list is empty"] };
  return { tactics };
}

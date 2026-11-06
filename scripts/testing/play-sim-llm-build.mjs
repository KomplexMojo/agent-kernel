/**
 * Play-sim M3 (#614): a local model proposes the player's character near its allowance; the
 * character sheet (the Allocator's prices) must accept it before play-sim runs it. The model only
 * chooses; it never prices. An over-budget, below-the-floor or malformed proposal is refused and
 * retried, up to a cap, with the sheet's own reasons fed back.
 *
 * Local and unversioned: the model id and prompt hash are recorded, and the result is never a gate.
 * Live use (manual, needs Ollama):  node scripts/testing/play-sim.mjs --build-source llm --model phi4
 * Tests use a fixture adapter (`{ generate }` returning canned JSON); nothing here calls a live model.
 */
import { createHash } from "node:crypto";
import { AFFINITY_EXPRESSIONS, AFFINITY_KINDS } from "../../packages/runtime/src/contracts/domain-constants.js";
import { GAME_VITAL_KEYS } from "../../packages/runtime/src/contracts/game-vocabulary.js";
import { createCharacterSheet } from "../../packages/runtime/src/runner/character-sheet.js";

export const DEFAULT_ATTEMPTS = 3;

/** The JSON shape the model must answer with. */
export const PROPOSAL_SCHEMA = Object.freeze({
  type: "object",
  required: ["slots", "vitals"],
  properties: {
    slots: { type: "array", maxItems: 6, items: { type: "object", required: ["kind", "expression", "range", "intensity"],
      properties: { kind: { enum: AFFINITY_KINDS }, expression: { enum: AFFINITY_EXPRESSIONS }, range: { type: "integer", minimum: 1 }, intensity: { type: "integer", minimum: 1 } } } },
    vitals: { type: "object", additionalProperties: { type: "object", required: ["max", "regen"], properties: { max: { type: "integer", minimum: 1 }, regen: { type: "integer", minimum: 0 } } } },
  },
});

/** The sheet's own price list for the base character, as plain lines for the prompt. */
export function priceSummary(view) {
  return view.rows.filter((row) => row.kind !== "minion").map((row) => `${row.kind === "slot" ? `slot ${row.label}` : row.label}: ${row.price} tokens`);
}

export function buildPrompt({ allowance, baseView, problems = [] }) {
  return [
    "You are choosing a player character for a small dungeon game. Answer with JSON only.",
    `The character may cost at most ${allowance} tokens in total. Spend as close to that as you can without going over.`,
    `Slots: up to 6 affinities {kind, expression, range, intensity}. kinds: ${AFFINITY_KINDS.join(", ")}. expressions: ${AFFINITY_EXPRESSIONS.join(", ")}. The first 3 slots are ready to use; do not repeat a kind+expression.`,
    `Vitals: ${GAME_VITAL_KEYS.join(", ")} each {max, regen}. Each needs at least max 10 and regen 1.`,
    "Starting character prices (for scale; costs grow quickly with range and intensity):",
    ...priceSummary(baseView).map((line) => `  ${line}`),
    `Starting total: ${baseView.total} of ${allowance}.`,
    ...(problems.length ? ["Your last answer was refused:", ...problems.map((problem) => `  - ${problem}`), "Fix these and answer again."] : []),
    `JSON schema: ${JSON.stringify(PROPOSAL_SCHEMA)}`,
  ].join("\n");
}

/** Parse the model's text into a proposal, or throw a short reason. */
export function parseProposal(text) {
  let value;
  try { value = JSON.parse(String(text).trim().replace(/^```(?:json)?|```$/g, "")); } catch { throw new Error("the answer was not JSON"); }
  if (!value || !Array.isArray(value.slots) || typeof value.vitals !== "object" || !value.vitals) throw new Error("the answer needs `slots` (array) and `vitals` (object)");
  for (const slot of value.slots) {
    if (!AFFINITY_KINDS.includes(slot?.kind) || !AFFINITY_EXPRESSIONS.includes(slot?.expression)) throw new Error(`unknown affinity ${JSON.stringify(slot)}`);
    if (!Number.isInteger(slot.range) || slot.range < 1 || !Number.isInteger(slot.intensity) || slot.intensity < 1) throw new Error("range and intensity are whole numbers of 1 or more");
  }
  return value;
}

/** A `--delver` spec the sheet reads, from a proposal (same field format the sheet writes). */
export function specFromProposal(proposal, { id = "hero" } = {}) {
  const seen = new Set();
  const slots = proposal.slots.filter((slot) => !seen.has(`${slot.kind}:${slot.expression}`) && seen.add(`${slot.kind}:${slot.expression}`));
  const parts = ["count=1", `id=${id}`];
  if (slots.length) {
    parts.push(`affinity=${slots[0].kind}`);
    parts.push(`affinities=${slots.map((slot) => `${slot.kind}:${slot.expression}:${slot.range}${slot.intensity > 1 ? `:${slot.intensity}` : ""}`).join(",")}`);
    parts.push(`equip=${slots.slice(0, 3).map((slot) => `${slot.kind}:${slot.expression}`).join(",")}`);
  }
  parts.push("motivation=user_controlled");
  parts.push(`vitals=${GAME_VITAL_KEYS.map((key) => `${key}:${proposal.vitals[key]?.max ?? 0}:${proposal.vitals[key]?.regen ?? 0}`).join(",")}`);
  return parts.join(";");
}

/**
 * Ask the model for a character; accept only what the sheet accepts within the allowance.
 * Returns { ok, spec?, attempts, model, promptHash, total?, problems? }.
 */
export async function proposeCharacterSpec({ llm, model, allowance, baseSpec, maxAttempts = DEFAULT_ATTEMPTS, id = "hero" }) {
  const baseView = createCharacterSheet({ spec: baseSpec, budgetTokens: allowance, id }).view();
  let problems = [];
  let promptHash = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const prompt = buildPrompt({ allowance, baseView, problems });
    promptHash ??= createHash("sha256").update(prompt).digest("hex").slice(0, 16);
    let proposal;
    try {
      const answer = await llm.generate({ model, prompt, format: "json", options: { temperature: 0.2 } });
      proposal = parseProposal(answer?.response ?? answer?.text ?? answer);
    } catch (error) {
      problems = [error.message];
      continue;
    }
    const spec = specFromProposal(proposal, { id });
    const view = createCharacterSheet({ spec, budgetTokens: allowance, id }).view();
    if (view.ok && view.total <= allowance) return { ok: true, spec, attempts: attempt, model, promptHash, total: view.total, allowance };
    problems = view.problems.length ? view.problems : [`total ${view.total} is over the allowance ${allowance}`];
  }
  return { ok: false, attempts: maxAttempts, model, promptHash, problems };
}

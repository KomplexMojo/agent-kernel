#!/usr/bin/env node
/**
 * Play-sim M5 (#616): batch the M2 anomaly cards and cohort into one size-capped prompt that asks a
 * model for structured recommendations (Allocator, scenarios, UI). No dungeon is played here, and
 * nothing is applied: a human approves a recommendation, then files a follow-up issue for it. This
 * is not a merge gate, and it never edits `base-costs.json` or any code.
 *
 *   node scripts/testing/play-sim-advisor.mjs --in artifacts/play-sim/<run-id> [--prompt-only] [--max-chars 12000]
 *
 * `--prompt-only` (the default) writes <in>/advisor-prompt.md and stops. With PLAY_SIM_ADVISOR_MODEL
 * set (and optionally PLAY_SIM_ADVISOR_URL, default Ollama on localhost) and without --prompt-only,
 * the model is called, its answer validated against the schema below and written to
 * <in>/advisor-output.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MAX_CHARS = 12000;
export const CONFIDENCE = Object.freeze(["low", "medium", "high"]);
export const AREAS = Object.freeze(["allocator", "scenarios", "ui", "actor", "other"]);

/** What the advisor must answer with. */
export const ADVICE_SCHEMA = Object.freeze({
  type: "object",
  required: ["findings", "recommendedChanges", "evidenceRefs", "confidence"],
  properties: {
    findings: { type: "array", items: { type: "string" } },
    recommendedChanges: { type: "array", items: { type: "object", required: ["area", "change", "evidenceRefs"],
      properties: { area: { enum: AREAS }, change: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } } } },
    evidenceRefs: { type: "array", items: { type: "string" } },
    confidence: { enum: CONFIDENCE },
  },
});

/** Read the cards and cohort a report run left in `dir`. */
export function loadEvidence(dir) {
  const cardsDir = join(dir, "cards");
  const cards = existsSync(cardsDir)
    ? readdirSync(cardsDir).filter((file) => file.endsWith(".json")).sort().map((file) => ({ ref: `cards/${file}`, card: JSON.parse(readFileSync(join(cardsDir, file), "utf8")) }))
    : [];
  const cohortPath = join(dir, "cohort.json");
  return { cards, cohort: existsSync(cohortPath) ? JSON.parse(readFileSync(cohortPath, "utf8")) : null };
}

const cardLine = ({ ref, card }) => `- [${ref}] ${card.scenario} s${card.seed} ${card.arm}: ${card.outcome} in ${card.ticks} ticks; anomalies ${card.anomalies.join(", ") || "none"}; delver cap ${card.metrics?.delverPool?.capTokens ?? "?"}`;

/**
 * The prompt, capped at `maxChars`: instructions and the schema always stay; the cohort next; cards
 * fill what is left, and the number left out is said. Every card line carries its evidence ref.
 */
export function buildAdvisorPrompt({ cards, cohort }, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const head = [
    "You review headless play-sim results for a small dungeon game: runs at the full budget (baseline) and at 90% (treatment).",
    "Recommend changes only where the evidence supports them, and cite the evidence refs (the [cards/...] ids) for each one.",
    "Areas: allocator (prices), scenarios, ui, actor, other. Do not invent numbers. A human decides; nothing you write is applied.",
    `Answer with JSON only, matching: ${JSON.stringify(ADVICE_SCHEMA)}`,
    "",
    "Cohort summary:",
    cohort ? JSON.stringify(cohort) : "(none)",
    "",
    "Anomaly cards:",
  ].join("\n");
  const lines = [];
  let used = head.length;
  for (const entry of cards) {
    const line = cardLine(entry);
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  const omitted = cards.length - lines.length;
  return `${head}\n${lines.join("\n") || "(none)"}${omitted > 0 ? `\n(${omitted} more card(s) left out to fit the size cap)` : ""}\n`;
}

/** Check a parsed advisor answer against the schema; returns a list of problems (empty when valid). */
export function validateAdvice(advice, { knownRefs = null } = {}) {
  const problems = [];
  if (!advice || typeof advice !== "object" || Array.isArray(advice)) return ["the answer is not an object"];
  const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
  if (!strings(advice.findings)) problems.push("findings must be an array of strings");
  if (!strings(advice.evidenceRefs)) problems.push("evidenceRefs must be an array of strings");
  if (!CONFIDENCE.includes(advice.confidence)) problems.push(`confidence must be one of ${CONFIDENCE.join(", ")}`);
  if (!Array.isArray(advice.recommendedChanges)) problems.push("recommendedChanges must be an array");
  else advice.recommendedChanges.forEach((change, index) => {
    if (!AREAS.includes(change?.area)) problems.push(`recommendedChanges[${index}].area must be one of ${AREAS.join(", ")}`);
    if (typeof change?.change !== "string" || !change.change) problems.push(`recommendedChanges[${index}].change must be text`);
    if (!strings(change?.evidenceRefs) || change.evidenceRefs.length === 0) problems.push(`recommendedChanges[${index}] needs evidenceRefs`);
  });
  if (knownRefs) {
    const cited = [...(strings(advice.evidenceRefs) ? advice.evidenceRefs : []), ...(Array.isArray(advice.recommendedChanges) ? advice.recommendedChanges.flatMap((change) => change?.evidenceRefs ?? []) : [])];
    for (const ref of cited) if (!knownRefs.includes(ref)) problems.push(`unknown evidence ref ${ref}`);
  }
  return problems;
}

async function main(argv) {
  const at = argv.indexOf("--in");
  if (at < 0 || !argv[at + 1]) throw new Error("usage: play-sim-advisor.mjs --in <play-sim run dir> [--prompt-only] [--max-chars N]");
  const dir = resolve(argv[at + 1]);
  const maxAt = argv.indexOf("--max-chars");
  const evidence = loadEvidence(dir);
  const prompt = buildAdvisorPrompt(evidence, maxAt >= 0 ? { maxChars: Number(argv[maxAt + 1]) } : {});
  writeFileSync(join(dir, "advisor-prompt.md"), prompt);
  console.log(`Wrote ${join(dir, "advisor-prompt.md")} (${prompt.length} chars, ${evidence.cards.length} card(s)).`);
  const model = process.env.PLAY_SIM_ADVISOR_MODEL;
  if (argv.includes("--prompt-only") || !model) {
    if (!argv.includes("--prompt-only")) console.log("PLAY_SIM_ADVISOR_MODEL is not set: prompt only.");
    return;
  }
  const { createLlmAdapter } = await import("../../packages/adapters-cli/src/adapters/llm/index.js");
  const answer = await createLlmAdapter(process.env.PLAY_SIM_ADVISOR_URL ? { baseUrl: process.env.PLAY_SIM_ADVISOR_URL } : {}).generate({ model, prompt, format: "json", options: { temperature: 0.2 } });
  let advice;
  try { advice = JSON.parse(String(answer?.response ?? "").trim()); } catch { throw new Error("the model's answer was not JSON"); }
  const problems = validateAdvice(advice, { knownRefs: evidence.cards.map((entry) => entry.ref) });
  if (problems.length) throw new Error(`the model's answer did not match the schema:\n- ${problems.join("\n- ")}`);
  writeFileSync(join(dir, "advisor-output.json"), `${JSON.stringify({ model, advice }, null, 2)}\n`);
  console.log(`Wrote ${join(dir, "advisor-output.json")}. Review it, then file an issue for each change you accept.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(2); });
}

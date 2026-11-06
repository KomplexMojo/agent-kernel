/**
 * The playtest scenario catalogue: named levels for `ak create`, with seed-filled affinities.
 *
 * Framework content (Darren, 2026-11-06, #744): the LLM sims, the power and recipe ladders and
 * the scenario sim suite run on these scenarios, and the game's playtest launcher and phone app
 * build the same levels from them through this module. One list, so a scenario played by a
 * person and the one a sim plays are the same level. Edit `playtest-scenarios.json` to add one.
 *
 * A seed picks the affinities: {A} the player's, {B} its opposite, {C}/{D} another opposed
 * pair, {T1}/{T2} two kinds whose affinity-table row carries a trait.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { AFFINITY_KINDS, AFFINITY_OPPOSITES } from "../../../runtime/src/contracts/domain-constants.js";
import { affinityRole, affinityTraitKinds } from "../../../runtime/src/render/affinity-role.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_PATH = join(HERE, "playtest-scenarios.json");
/** The `ak` entry point the scenarios are built and played with. */
export const AK_CLI = join(HERE, "ak.mjs");

export function loadPlaytestScenarios() {
  return JSON.parse(readFileSync(SCENARIOS_PATH, "utf8"));
}

/** The opposed pairs, each once, in AFFINITY_KINDS order. */
function opposedPairs() {
  const pairs = [];
  for (const kind of AFFINITY_KINDS) {
    const opposite = AFFINITY_OPPOSITES[kind];
    if (opposite && !pairs.some((pair) => pair.includes(kind))) pairs.push([kind, opposite]);
  }
  return pairs;
}

/** The kinds whose table row carries a trait (#419-#421), with the trait: the table decides, never a kind name. */
export function traitKinds() {
  return affinityTraitKinds();
}

/**
 * {A, B, C, D, T1, T2} for a seed: A/B one opposed pair (either way round), C/D a different one,
 * T1/T2 two different trait-bearing kinds.
 */
export function affinitiesForSeed(seed) {
  const pairs = opposedPairs();
  const n = pairs.length;
  const s = Math.abs(Math.trunc(seed));
  const first = pairs[s % n];
  const [A, B] = Math.floor(s / n) % 2 ? [first[1], first[0]] : first;
  const second = pairs[(s % n + 1 + (Math.floor(s / (2 * n)) % (n - 1))) % n];
  const [C, D] = Math.floor(s / (2 * n * (n - 1))) % 2 ? [second[1], second[0]] : second;
  const traits = traitKinds();
  const t = traits.length;
  const T1 = traits[s % t].kind;
  const T2 = traits[(s % t + 1 + (Math.floor(s / t) % (t - 1))) % t].kind;
  return { A, B, C, D, T1, T2 };
}

/**
 * The scenario's level arguments with the seed's affinities filled in. A grade (#422)
 * takes the place of the scenario's own budget: the Allocator sets budget and split.
 */
const PLACEHOLDER = /\{(A|B|C|D|T1|T2)\}/g;

/** The scenario's playable delver spec (the one with `user_controlled`), seed's affinities filled in. */
function playerDelverIndex(scenario) {
  const at = scenario.args.findIndex((arg, index) => scenario.args[index - 1] === "--delver" && /motivation=user_controlled/.test(arg));
  if (at < 0) throw new Error(`scenario "${scenario.id}" has no playable delver to configure.`);
  return at;
}

/**
 * Darren, 2026-11-03: a default actor never has a loadout with no offence. When the seed's {A}
 * cannot harm (a restoring kind), its opposite's push is held and equipped beside it, so the
 * player always has one attack option. The table decides, never a kind name; a spec without
 * `equip=` or `affinities=` (a configured character) is left as written.
 */
/**
 * Darren, 2026-11-04: wardens too. Any delver or warden whose kind came from a seed placeholder
 * is armed the same way, with its own opposite; a kind the scenario names outright is kept.
 */
function armActor(raw, filled) {
  const placeholder = /affinity=\{(A|B|C|D)\}/.exec(raw);
  const own = /affinity=([^;]*)/.exec(filled)?.[1];
  return placeholder ? armSpec(filled, own, AFFINITY_OPPOSITES[own]) : filled;
}

function armSpec(text, ownKind, oppositeKind) {
  if (!ownKind || affinityRole(ownKind, "push") === "attack" || !oppositeKind || affinityRole(oppositeKind, "push") !== "attack") return text;
  // The restoring push becomes the opposite's push at the same range and intensity (the same
  // price: pricing is affinity-agnostic); a spec without one gains it beside what it holds.
  const own = `${ownKind}:push`;
  const key = `${oppositeKind}:push`;
  const edit = (field, entry) => (spec) => spec.replace(new RegExp(`(${field}=)([^;]*)`), (whole, head, list) => {
    const items = list.split(",");
    if (items.some((item) => item.startsWith(key))) return whole;
    const at = items.findIndex((item) => item.startsWith(own));
    if (at >= 0) items[at] = items[at].replace(own, key);
    else items.push(entry);
    return `${head}${items.join(",")}`;
  });
  return edit("equip", key)(edit("affinities", `${key}:3:1`)(text));
}

export function playerDelverSpec(scenario, seed) {
  const picks = affinitiesForSeed(seed);
  const raw = scenario.args[playerDelverIndex(scenario)];
  return armActor(raw, raw.replace(PLACEHOLDER, (_, key) => picks[key]));
}

/**
 * The scenario's level arguments with the seed's affinities filled in. A `character` (the delver
 * spec the character screen wrote) takes the place of the scenario's own playable delver.
 */
export function scenarioArgs(scenario, seed, grade, character) {
  const picks = affinitiesForSeed(seed);
  const ownAt = character ? playerDelverIndex(scenario) : -1;
  const filled = (text) => text.replace(PLACEHOLDER, (_, key) => picks[key]);
  const fill = (text, index) => (index === ownAt ? character
    : ["--delver", "--warden"].includes(scenario.args[index - 1]) ? armActor(text, filled(text)) : filled(text));
  const budget = budgetArgs(scenario, grade);
  // A tactic with no --seed draws one, so a scenario with tactics pins the build to its seed.
  const tacticSeed = scenario.args.includes("--tactic") ? ["--seed", String(seed)] : [];
  return [...budget, ...tacticSeed, ...scenario.args.map(fill)];
}

/**
 * A grade (#422) takes the place of the scenario's own budget. Either way the Allocator prices the
 * level: this only chooses which `ak create` flag carries the caller's input.
 */
function budgetArgs(scenario, grade) {
  if (grade) return ["--grade", grade];
  return ["--budget-tokens", String(scenario.budgetTokens)];
}

/** The full `ak create` arguments: the same scenario, seed and createdAt always build the same level. */
export function createArgs(scenario, seed, createdAt, grade, character) {
  return ["--run-id", `playtest-${scenario.id}-s${seed}`, "--created-at", createdAt, ...scenarioArgs(scenario, seed, grade, character)];
}

export function fillFocus(scenario, seed) {
  const picks = affinitiesForSeed(seed);
  return scenario.focus.map((line) => line.replace(PLACEHOLDER, (_, key) => picks[key]));
}

/** "fire (spread), water (soak)" for the trait kinds a scenario uses, or "" when it uses none. */
export function traitsInPlay(scenario, seed) {
  const picks = affinitiesForSeed(seed);
  const used = ["T1", "T2"].filter((key) => scenario.args.some((arg) => arg.includes(`{${key}}`)));
  const byKind = Object.fromEntries(traitKinds().map((row) => [row.kind, row.trait]));
  return used.map((key) => `${picks[key]} (${byKind[picks[key]]})`).join(", ");
}

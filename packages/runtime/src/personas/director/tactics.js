/**
 * #396 — the tactic list a plan carries (strategic placement, tracker #395).
 *
 * A tactic is a named, parameterised placement pattern: `ambush` (a resource room with
 * hidden guards), `retinue` (a boss with minions), `minefield` (a room of hazards with a
 * safe line through it), `shrine` (#486: a hazard whose field restores a vital, a detour worth
 * taking). The Director owns which tactics exist
 * and puts the authored list in the plan (`directives.tactics`) and the BuildSpec
 * (`plan.hints.tactics`); the Configurator compiles them into roles and placement
 * constraints in later steps. Until it does, a known tactic is carried and reported, not
 * applied. Pure functions; no IO.
 */
import { validateTacticList } from "../../contracts/build-spec.js";

export const PLAN_TACTIC_IDS = Object.freeze(["ambush", "retinue", "minefield", "shrine"]);

// #401: `--tactic auto` asks the Director for a seeded mix instead of an authored list.
export const AUTO_TACTIC = "auto";

// #418: the budget pools a tactic spends from because it adds things of its own (a minefield
// adds hazards, and so does a shrine, #486). A tactic that only seats the level's own things
// spends from no new pool.
const TACTIC_BUDGET_POOLS = Object.freeze({ minefield: Object.freeze(["hazards"]), shrine: Object.freeze(["hazards"]) });

/** The budget pools the tactics add things to, in first-asked order, each once. */
export function tacticBudgetPools(tactics) {
  if (!Array.isArray(tactics)) return [];
  return [...new Set(tactics.flatMap((entry) => TACTIC_BUDGET_POOLS[entry?.tactic] || []))];
}

function refuseUnknown(tactic) {
  if (!PLAN_TACTIC_IDS.includes(tactic)) {
    throw new Error(`unknown tactic "${tactic}": known tactics are ${PLAN_TACTIC_IDS.join(", ")}`);
  }
}

function readParam(value) {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : value;
}

/** `"<tactic>[;key=value...]"` → `{ tactic, params? }`. Throws with a reason when it can't. */
export function parseTactic(text) {
  const parts = String(text ?? "").split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("tactic: expected \"<tactic>[;key=value...]\"");
  const [tactic, ...rest] = parts;
  refuseUnknown(tactic);
  const params = {};
  for (const part of rest) {
    const equals = part.indexOf("=");
    if (equals <= 0 || equals === part.length - 1) {
      throw new Error(`tactic ${tactic}: "${part}" is not key=value`);
    }
    params[part.slice(0, equals).trim()] = readParam(part.slice(equals + 1).trim());
  }
  return Object.keys(params).length > 0 ? { tactic, params } : { tactic };
}

/** A list of tactic specs or `{ tactic, params }` objects → the canonical list, in order. */
export function normalizeTactics(entries) {
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries)) throw new Error("tactics: expected a list");
  const tactics = entries.map((entry) => {
    if (typeof entry === "string") return parseTactic(entry);
    const errors = [];
    validateTacticList([entry], "tactic", errors);
    if (errors.length > 0) throw new Error(errors.join("; "));
    refuseUnknown(entry.tactic);
    return entry.params && Object.keys(entry.params).length > 0
      ? { tactic: entry.tactic, params: { ...entry.params } }
      : { tactic: entry.tactic };
  });
  return tactics;
}

// #401: the same small LCG the Configurator's level generator uses, so a seed means one thing.
function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function between(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * #401 — `--tactic auto`: the seed picks a mix of tactics, with their sizes, for a level with
 * `wardens` wardens and `resources` resources. An ambush needs both and a retinue needs a
 * warden of its own; a minefield brings its own hazards. The picks come back in catalogue
 * order as an ordinary tactic list, so the plan records them and `--seed` rebuilds them.
 * Rooms are left to the Configurator, which picks them from the same seed.
 */
export function pickSeededTactics(seed, { wardens = 0, resources = 0 } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("tactic auto: needs a non-negative integer seed");
  const rng = createRng(seed);
  const candidates = ["minefield"];
  if (wardens >= 1) candidates.push("retinue");
  if (wardens >= 1 && resources >= 1) candidates.push("ambush");
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const chosen = new Set(candidates.slice(0, between(rng, 1, candidates.length)));
  // The retinue's leader is a free warden, so an ambush keeps one back for it.
  const guardsFree = wardens - (chosen.has("retinue") ? 1 : 0);
  if (chosen.has("ambush") && guardsFree < 1) chosen.delete("ambush");
  const tactics = [];
  for (const tactic of PLAN_TACTIC_IDS) {
    if (!chosen.has(tactic)) continue;
    if (tactic === "ambush") tactics.push({ tactic, params: { guards: between(rng, 1, Math.min(2, guardsFree)) } });
    if (tactic === "retinue") tactics.push({ tactic, params: { size: between(rng, 1, 3) } });
    if (tactic === "minefield") tactics.push({ tactic, params: { hazards: between(rng, 2, 5) } });
  }
  return tactics;
}

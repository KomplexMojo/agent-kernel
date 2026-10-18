/**
 * #396 — the tactic list a plan carries (strategic placement, tracker #395).
 *
 * A tactic is a named, parameterised placement pattern: `ambush` (a resource room with
 * hidden guards), `retinue` (a boss with minions). The Director owns which tactics exist
 * and puts the authored list in the plan (`directives.tactics`) and the BuildSpec
 * (`plan.hints.tactics`); the Configurator compiles them into roles and placement
 * constraints in later steps. Until it does, a known tactic is carried and reported, not
 * applied. Pure functions; no IO.
 */
import { validateTacticList } from "../../contracts/build-spec.js";

export const PLAN_TACTIC_IDS = Object.freeze(["ambush", "retinue"]);

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

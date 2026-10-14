/**
 * `configurator/actors` — actor-config authoring, moved out of CLI glue 2026-08-18
 * (local-codex/Plan.md §POST-AM/Z).
 *
 * `ak-impl.mjs`'s `parseDelverSpec` used to default a missing motivation to
 * `"attacking"`, validate affinity/motivation/setup-mode against the chartered enums,
 * and assemble the delver roster entry itself — domain logic in adapter glue. The CLI's
 * `;`-delimited field splitting and its generic value-format tokenizers
 * (affinity/vitals/goal tuples, shared with `parseWardenSpec`) stay in the CLI: that is
 * DSL syntax, not configuration authoring. What moved here is exactly the three things
 * unique to a delver candidate: defaulting, enum validation, and final assembly.
 *
 * Not the same responsibility as `configurator/cards` (`candidate-authoring.js`): that
 * module assembles PRICED CARDS for the Allocator to judge. This assembles a build/run
 * request's ACTOR ROSTER ENTRY directly — no pricing involved.
 */
import {
  AFFINITY_KINDS,
  MOTIVATION_KINDS,
  DELVER_SETUP_MODES,
  getMotivationExclusiveGroup,
} from "../../contracts/domain-constants.js";

// What an actor does when its spec names no motivation. Neither is `user_controlled`:
// an actor is playable only when authored so (Darren, 2026-10-13), never by default.
const DEFAULT_MOTIVATION_BY_ROLE = Object.freeze({ delver: "attacking", warden: "defending" });

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Authors an actor's motivations from its spec's `motivation=` value: one kind, or
 * several joined with `+` or `,` (`exploring+attacking`), at most one per family
 * (mobility, posture, cognition). `user_controlled` sits beside any of them and makes
 * the actor playable; nothing is added that was not asked for. Order is kept, repeats
 * collapse, an unknown kind or two kinds from one family is refused.
 *
 * @returns {string[]}
 */
export function authorMotivations({ role, index, raw } = {}) {
  const label = `${role}[${index}]`;
  const text = isNonEmptyString(raw) ? raw : DEFAULT_MOTIVATION_BY_ROLE[role];
  if (!isNonEmptyString(text)) throw new Error(`${label} has no default motivation.`);
  const kinds = [];
  const byFamily = new Map();
  for (const part of String(text).split(/[+,]/)) {
    const kind = part.trim().toLowerCase();
    if (!MOTIVATION_KINDS.includes(kind)) {
      throw new Error(`${label} motivation must be one of: ${MOTIVATION_KINDS.join(", ")}.`);
    }
    if (kinds.includes(kind)) continue;
    const family = getMotivationExclusiveGroup(kind);
    if (family) {
      const taken = byFamily.get(family.id);
      if (taken) {
        throw new Error(`${label} motivations ${taken} and ${kind} are both ${family.id}; take at most one per family.`);
      }
      byFamily.set(family.id, kind);
    }
    kinds.push(kind);
  }
  return kinds;
}

/**
 * Authors one delver actor candidate.
 *
 * `affinities`/`vitals`/`count` arrive already tokenized by the caller's generic
 * value-format parsers (kind:expression:stacks / vital:max:regen tuples) — this
 * function does not reparse them, only decides whether to attach them.
 */
export function authorDelverCandidate({
  index,
  rawAffinity,
  rawMotivation,
  rawId,
  rawSetupMode,
  defaultAffinity,
  count,
  affinities,
  vitals,
} = {}) {
  const affinity = String(rawAffinity || defaultAffinity).trim().toLowerCase();
  if (!AFFINITY_KINDS.includes(affinity)) {
    throw new Error(`delver[${index}] affinity must be one of: ${AFFINITY_KINDS.join(", ")}.`);
  }

  const motivations = authorMotivations({ role: "delver", index, raw: rawMotivation });

  const id = isNonEmptyString(rawId) ? String(rawId).trim() : `card_delver_${index}`;

  let setupMode;
  if (isNonEmptyString(rawSetupMode)) {
    setupMode = String(rawSetupMode).trim().toLowerCase();
    if (!DELVER_SETUP_MODES.includes(setupMode)) {
      throw new Error(`delver[${index}] setup-mode must be one of: ${DELVER_SETUP_MODES.join(", ")}.`);
    }
  }

  const delver = {
    id,
    type: "delver",
    source: "actor",
    count,
    affinity,
    motivations,
  };
  if (affinities && affinities.length > 0) {
    delver.affinities = affinities;
  }
  if (vitals && Object.keys(vitals).length > 0) {
    delver.vitals = vitals;
  }
  if (setupMode) {
    delver.setupMode = setupMode;
  }
  return delver;
}

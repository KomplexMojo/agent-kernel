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
import { AFFINITY_KINDS, MOTIVATION_KINDS, DELVER_SETUP_MODES } from "../../contracts/domain-constants.js";

const DEFAULT_DELVER_MOTIVATION = "attacking";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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

  const motivation = String(rawMotivation || DEFAULT_DELVER_MOTIVATION).trim().toLowerCase();
  if (!MOTIVATION_KINDS.includes(motivation)) {
    throw new Error(`delver[${index}] motivation must be one of: ${MOTIVATION_KINDS.join(", ")}.`);
  }

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
    motivations: Array.from(new Set([motivation, "user_controlled"])),
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

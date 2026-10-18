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
  DEFAULT_AFFINITY_EXPRESSION,
  PRESET_AFFINITY_SLOTS,
} from "../../contracts/domain-constants.js";
import { MAX_AFFINITY_SLOTS } from "../../../../core-ts/src/state/actor-inventory.ts";

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
  // No affinity named and no default given means none (#263): no kind is a default.
  const named = isNonEmptyString(rawAffinity) ? rawAffinity : defaultAffinity;
  const affinity = isNonEmptyString(named) ? String(named).trim().toLowerCase() : null;
  if (affinity !== null && !AFFINITY_KINDS.includes(affinity)) {
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

/**
 * Authors an actor card's affinity slots and starting equips (`ak create` delver/warden
 * `slots=` and `equip=`), as the unified actor fields core reads. Returns only the fields
 * the author set, so a card without them is unchanged.
 *
 * `equip` arrives tokenized by the caller: `[{ kind, expression, stacks? }]`, in equip
 * order. `stacks` runs the slot below what the actor holds (#230); omitted, it runs at
 * all it holds. What is held is the card's `affinities`, else its primary `affinity` at
 * the default expression and one stack, exactly as the actor is assembled. Any mix is
 * allowed (opposite emits included); only what core could not load is refused.
 *
 * @returns {{ affinitySlots?: number, activeAffinityKey?: string,
 *   equippedAffinityKeys?: string[], equippedAffinityStacks?: Record<string, number> }}
 */
export function authorActorEquipment({ role, index, slots, equip, affinity, affinities } = {}) {
  const label = `${role}[${index}]`;
  if (!Object.hasOwn(PRESET_AFFINITY_SLOTS, role)) throw new Error(`${label} has no affinity slot preset.`);
  const fields = {};
  if (slots !== undefined) {
    if (!Number.isSafeInteger(slots) || slots < 1 || slots > MAX_AFFINITY_SLOTS) {
      throw new Error(`${label} slots must be an integer from 1 to ${MAX_AFFINITY_SLOTS}, got ${slots}.`);
    }
    fields.affinitySlots = slots;
  }
  if (!Array.isArray(equip) || equip.length === 0) return fields;

  const held = Array.isArray(affinities) && affinities.length > 0
    ? affinities
    : [{ kind: affinity, expression: DEFAULT_AFFINITY_EXPRESSION, stacks: 1 }];
  const capacity = fields.affinitySlots ?? PRESET_AFFINITY_SLOTS[role];
  if (equip.length > capacity) {
    throw new Error(`${label} equips ${equip.length} affinities but has ${capacity} slot${capacity === 1 ? "" : "s"}; add slots=${equip.length} or equip fewer.`);
  }
  const keys = [];
  const running = {};
  equip.forEach((entry) => {
    const key = `${entry.kind}:${entry.expression}`;
    const holding = held.find((pair) => pair.kind === entry.kind && pair.expression === entry.expression);
    if (!holding) {
      const known = held.map((pair) => `${pair.kind}:${pair.expression}`).join(", ");
      throw new Error(`${label} cannot equip ${key}: it holds only ${known}.`);
    }
    if (keys.includes(key)) throw new Error(`${label} equips ${key} twice.`);
    keys.push(key);
    if (entry.stacks === undefined || entry.stacks === holding.stacks) return;
    if (!Number.isSafeInteger(entry.stacks) || entry.stacks < 1 || entry.stacks > holding.stacks) {
      throw new Error(`${label} runs ${key} at ${entry.stacks} stacks but holds only ${holding.stacks}.`);
    }
    running[key] = entry.stacks;
  });
  // Core's record shape: the first equipped key is the active one, the full list is kept
  // only past one slot, and running stacks only for slots run below what they hold.
  fields.activeAffinityKey = keys[0];
  if (keys.length > 1) fields.equippedAffinityKeys = keys;
  if (Object.keys(running).length > 0) fields.equippedAffinityStacks = running;
  return fields;
}

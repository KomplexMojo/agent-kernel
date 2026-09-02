/**
 * actor-hud-model.js
 *
 * Builds the view-model for the selected-entity HUD.
 *
 * The board sprite carries two channels — role as silhouette, affinity as fill
 * (`entity-sprite-composer.js`). Everything the medallion used to cram into
 * 32×32 and could not render legibly — four vitals, expression, motivation —
 * lives here instead, and is drawn at readable size for the *selected* entity
 * only. Nothing was removed from the game; it was moved off a 64-pixel budget.
 *
 * Why this is in `runtime` and not in the renderer: ordering, labels, colours,
 * which vitals a role even has, and how a fraction is derived are all
 * **semantics**. `ui-web` renders and emits intents; it does not own meaning
 * (charter, "Ports & Adapters with Persona State Machines"). The renderer had
 * been carrying its own `VITAL_COLORS` table with labels and hex values baked
 * in — a duplicate of `GAME_COLOR_PALETTE.vitals` that happened to still agree.
 * The affinity palette had the same shape of duplicate and had already drifted
 * into a live bug (M2), so this one is folded back before it can.
 *
 * The output is plain serializable data: no functions, no class instances, so it
 * can cross a boundary or be logged like any other artifact-shaped value.
 *
 * @module actor-hud-model
 */

import { GAME_COLOR_PALETTE } from "../contracts/game-elements.js";
import {
  VITAL_KEYS,
  DELVER_VITAL_KEYS,
  WARDEN_VITAL_KEYS,
  HAZARD_VITAL_KEYS,
  RESOURCE_VITAL_KEYS,
  AFFINITY_KINDS,
} from "../contracts/domain-constants.js";

/**
 * Two-character labels. The HUD is a compact strip, so a bar's label has a
 * fixed, tiny budget; the long names live in the DOM inspector.
 */
export const HUD_VITAL_LABELS = Object.freeze({
  health: "HP",
  mana: "MP",
  stamina: "ST",
  durability: "DU",
  defence: "DF",
});

/**
 * Which vitals a role actually has. Rendering four bars for everything would
 * invent two of them on a hazard, which reports only mana and durability.
 */
const VITAL_KEYS_BY_ROLE = Object.freeze({
  delver: DELVER_VITAL_KEYS,
  warden: WARDEN_VITAL_KEYS,
  hazard: HAZARD_VITAL_KEYS,
  resource: RESOURCE_VITAL_KEYS,
});

const DEFAULT_VITAL_COLOR = "#aaaaaa";

function token(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function inferRole(entity) {
  const explicit = token(
    [entity?.role, entity?.type, entity?.archetype, entity?.actorType, entity?.kind]
      .find((v) => typeof v === "string" && v.trim()),
  );
  if (explicit in VITAL_KEYS_BY_ROLE) return explicit;
  const haystack = `${explicit} ${token(entity?.id)}`;
  if (haystack.includes("warden") || haystack.includes("defender")) return "warden";
  if (haystack.includes("hazard")) return "hazard";
  if (haystack.includes("resource")) return "resource";
  return "delver";
}

/** Affinity arrives in several shapes; reading only one of them loses most entities. */
function inferAffinity(entity) {
  const direct = token(typeof entity?.affinity === "string" ? entity.affinity : entity?.affinity?.kind);
  if (AFFINITY_KINDS.includes(direct)) return direct;
  const equipped = token(entity?.equippedAffinity?.kind ?? entity?.equippedAffinity);
  if (AFFINITY_KINDS.includes(equipped)) return equipped;
  for (const source of [entity?.affinities, entity?.affinityStacks]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      const kind = token(typeof entry === "string" ? entry : entry?.kind ?? entry?.name);
      if (AFFINITY_KINDS.includes(kind)) return kind;
    }
  }
  return "";
}

function inferExpression(entity) {
  const direct = token(entity?.expression ?? entity?.equippedAffinity?.expression);
  if (direct) return direct;
  const list = Array.isArray(entity?.affinities) ? entity.affinities : [];
  for (const entry of list) {
    const expression = token(entry?.expression);
    if (expression) return expression;
  }
  return "";
}

function inferMotivation(entity) {
  const direct = token(entity?.motivation);
  if (direct) return direct;
  const list = Array.isArray(entity?.motivations) ? entity.motivations : [];
  for (const entry of list) {
    const kind = token(typeof entry === "string" ? entry : entry?.kind ?? entry?.name);
    if (kind) return kind;
  }
  return "";
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRegen(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/**
 * Ordered vital keys for a role: the role's own set, in canonical order, then
 * anything else the entity reported so an unexpected vital is shown rather than
 * silently dropped.
 */
function orderedVitalKeys(role, vitals) {
  const roleKeys = VITAL_KEYS_BY_ROLE[role] || VITAL_KEYS;
  const present = Object.keys(vitals);
  const ordered = roleKeys.filter((key) => present.includes(key));
  const extras = present.filter((key) => !roleKeys.includes(key));
  return [...ordered, ...extras];
}

/**
 * @typedef {object} HudVital
 * @property {string} key
 * @property {string} label
 * @property {number} current
 * @property {number} max
 * @property {number} fraction  0..1, safe when max is 0
 * @property {number} regen     non-negative integer
 * @property {string} colorHex
 */

/**
 * @typedef {object} ActorHudModel
 * @property {string} id
 * @property {string} role
 * @property {string} affinity
 * @property {string} expression
 * @property {string} motivation
 * @property {HudVital[]} vitals
 */

/**
 * Build the HUD view-model for one entity.
 *
 * @param {unknown} entity An observation actor, hazard or resource.
 * @returns {ActorHudModel | null} null when the input is not entity-shaped.
 */
export function buildActorHudModel(entity) {
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) return null;

  const role = inferRole(entity);
  const rawVitals = entity.vitals && typeof entity.vitals === "object" && !Array.isArray(entity.vitals)
    ? entity.vitals
    : {};

  const vitals = orderedVitalKeys(role, rawVitals).map((key) => {
    const record = rawVitals[key] || {};
    const current = finiteOr(record.current, 0);
    const max = finiteOr(record.max, 0);
    // Guard the divide: a 0-max vital is real (a hazard with no stamina pool),
    // and NaN/Infinity here would render as a bar of undefined length.
    const fraction = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    return {
      key,
      label: HUD_VITAL_LABELS[key] || key.slice(0, 2).toUpperCase(),
      current,
      max,
      fraction,
      regen: normalizeRegen(record.regen),
      colorHex: GAME_COLOR_PALETTE.vitals[key] || DEFAULT_VITAL_COLOR,
    };
  });

  return {
    id: typeof entity.id === "string" ? entity.id : "",
    role,
    affinity: inferAffinity(entity),
    expression: inferExpression(entity),
    motivation: inferMotivation(entity),
    vitals,
  };
}

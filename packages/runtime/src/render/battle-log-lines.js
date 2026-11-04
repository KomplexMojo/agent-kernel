/**
 * #554 — the words for battle-log entries, so every UI (ASCII, phone app, later Phaser) shows
 * identical lines. Pure: entries in, text out. The Annotator derives the entries; this only words
 * them, and never adds what the entry does not carry (no vitals, #497).
 *
 * AK-28: cast hits and lasting-field hurt lines carry a short affinity×mode flavor phrase
 * (deterministic table below) so "earth emit" reads as a dust storm, not only the dry key.
 */

import { HUD_VITAL_LABELS } from "./actor-hud-model.js";

const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

/**
 * Short combat-observation phrases by affinity kind + expression. Describes what hit —
 * not how to play (AK-19). Missing keys fall back to the bare `kind expression` wording.
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const AFFINITY_ATTACK_FLAVOR = Object.freeze({
  earth: Object.freeze({
    emit: "a dust storm",
    push: "thrown earth",
    pull: "a crushing earth yank",
    draw: "a grinding earth drain",
  }),
  fire: Object.freeze({
    emit: "a sheet of flame",
    push: "a firebolt",
    pull: "a searing yank",
    draw: "a heat siphon",
  }),
  water: Object.freeze({
    emit: "a soaking spray",
    push: "a water jet",
    pull: "a tidal yank",
    draw: "a draining current",
  }),
  wind: Object.freeze({
    emit: "a cutting gale",
    push: "a gust strike",
    pull: "a vacuum yank",
    draw: "a breath steal",
  }),
  growth: Object.freeze({
    emit: "choking vines",
    push: "a thorn lash",
    pull: "a root yank",
    draw: "a life siphon",
  }),
  decay: Object.freeze({
    emit: "a rotting miasma",
    push: "a decay bolt",
    pull: "a withering yank",
    draw: "a rot drain",
  }),
  corrode: Object.freeze({
    emit: "an acid haze",
    push: "an acid splash",
    pull: "a corrosive yank",
    draw: "an acid drain",
  }),
  fortify: Object.freeze({
    emit: "a hardening aura",
    push: "a stone slam",
    pull: "a bracing yank",
    draw: "a tempering draw",
  }),
  light: Object.freeze({
    emit: "a blinding flare",
    push: "a light lance",
    pull: "a radiant yank",
    draw: "a light siphon",
  }),
  dark: Object.freeze({
    emit: "a shadow veil",
    push: "a shadow bolt",
    pull: "a void yank",
    draw: "a shadow drain",
  }),
});

/** Lookup `AFFINITY_ATTACK_FLAVOR[kind][expression]`, or null when unknown. */
export function affinityAttackFlavor(kind, expression) {
  if (!kind || !expression) return null;
  return AFFINITY_ATTACK_FLAVOR[kind]?.[expression] ?? null;
}

/**
 * #582: what a field did to a vital this tick, with regen's share. A hit that regen cancels reads as
 * cancelled, not as hurting; `net` is what the vital actually lost (never above 0).
 * `effect` is `{ vital, hit, regen }` as core's turn recorded it (`hit` negative when harmful).
 */
function fieldEffectWords(effect) {
  const label = HUD_VITAL_LABELS[effect.vital] ?? effect.vital;
  const net = Math.min(0, effect.hit + effect.regen);
  const regen = effect.regen ? `, regen ${signed(effect.regen)}` : "";
  return { hurting: net < 0, words: `${label} ${signed(effect.hit)}${regen}${effect.regen ? ` (net ${net === 0 ? "0" : signed(net)})` : ""}` };
}

/** What a take gave: `+10 health`, `+5 max mana, +1 mana regen`, `fire push`, `an affinity slot`. */
function takenWords(taken) {
  if (!taken) return "";
  if (taken.kind === "affinity") return `${taken.affinity} ${taken.expression}`;
  if (taken.kind === "vital") {
    // A consumable fills the vital; a level or permanent grant raises its max.
    const max = taken.permanenceMode === "consumable" ? "" : "max ";
    return (taken.vitals ?? []).flatMap((grant) => [
      ...(grant.delta ? [`${signed(grant.delta)} ${max}${grant.key}`] : []),
      ...(grant.regen ? [`${signed(grant.regen)} ${grant.key} regen`] : []),
    ]).join(", ");
  }
  return "";
}

/** #692: the words a band reads as: "it looks bloodied". */
export const CONDITION_WORDS = Object.freeze({ unhurt: "unhurt", hurt: "hurt", bloodied: "bloodied", near_defeat: "near defeat", unknown: "unknown" });
/** #692: the same bands on a vital that is not the defeat vital (armour, stamina): it wears, it is not "hurt". */
export const STRUCK_VITAL_WORDS = Object.freeze({ unhurt: "intact", hurt: "worn", bloodied: "badly worn", near_defeat: "nearly gone" });

/** `its durability looks badly worn` (the line) or `durability badly worn` (a list); empty without a struck band. */
function struckVitalWords(vital, band, inLine) {
  if (!vital || !band) return "";
  const words = STRUCK_VITAL_WORDS[band] ?? band;
  return inLine ? `its ${vital} looks ${words}` : `${vital} ${words}`;
}

/** #692: `: a solid hit, amplified; its durability looks worn; it looks unhurt` for the caster's side; nothing otherwise. */
function struckNote(entry, showCondition) {
  if (!showCondition) return "";
  const how = [entry.hit ? `a ${entry.hit} hit` : null, entry.reception ?? null].filter(Boolean).join(", ");
  const struck = struckVitalWords(entry.struckVital, entry.struckCondition, true) || null;
  const looks = entry.condition ? `it looks ${CONDITION_WORDS[entry.condition]}` : null;
  const parts = [how, struck, looks].filter(Boolean);
  return parts.length ? `: ${parts.join("; ")}` : "";
}

/** #692: how a remembered band reads in a list: `looks unhurt, durability worn, 2 ticks ago`; `condition unknown` once it has faded. */
export function conditionNote(condition) {
  if (!condition?.band) return "";
  if (condition.band === "unknown") return "condition unknown";
  const age = Number.isInteger(condition.age) && condition.age > 0 ? `, ${condition.age} tick${condition.age === 1 ? "" : "s"} ago` : "";
  const struck = struckVitalWords(condition.struckVital, condition.struckBand, false);
  return `looks ${CONDITION_WORDS[condition.band] ?? condition.band}${struck ? `, ${struck}` : ""}${age}`;
}

/** ` — a dust storm —` when the affinity×mode has a flavor phrase; empty otherwise. */
function flavorAside(kind, expression) {
  const phrase = affinityAttackFlavor(kind, expression);
  return phrase ? ` — ${phrase} —` : "";
}

/** ` with a dust storm` on a struck cast; empty when unknown. */
function flavorWith(kind, expression) {
  const phrase = affinityAttackFlavor(kind, expression);
  return phrase ? ` with ${phrase}` : "";
}

/**
 * @param {object} entry   an `agent-kernel/BattleLogEntry`
 * @param {object} [who]
 * @param {string} [who.seatId]               the actor the player is playing: named "you"
 * @param {(id: string) => (string|null)} [who.labelOf]  the glyph label of an actor, when it has one
 * @param {{vital: string, hit: number, regen: number}} [who.effect]  a `field` entry's effect on a target
 *   the reader may see the vitals of (itself or its own side, #497), so the line can state the amount and the net
 * @param {boolean} [who.showCondition]  #692: the reader is on the caster's side, so a struck cast says how it landed
 */
export function battleLogLine(entry, { seatId, labelOf = () => null, effect = null, showCondition = false } = {}) {
  const name = (id) => {
    if (id === seatId) return "you";
    const label = labelOf(id);
    return label ? `${label} ${id}` : id;
  };
  const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const whose = (id) => (id === seatId ? "your" : `${name(id)}'s`);
  const attack = entry.kind ? `${entry.kind} ${entry.expression}` : null;
  switch (entry.event) {
    case "cast": {
      const source = name(entry.sourceId);
      if (entry.struck) {
        return `${cap(source)} cast ${attack} and struck ${name(entry.targetId)}${flavorWith(entry.kind, entry.expression)}${struckNote(entry, showCondition)}.`;
      }
      return `${cap(source)} cast ${attack}${entry.targetId ? ` at ${name(entry.targetId)}` : ""}.`;
    }
    case "take": {
      const what = takenWords(entry.taken);
      return `${cap(name(entry.sourceId))} took ${what ? `${what} ` : ""}from ${name(entry.targetId)}.`;
    }
    case "defeat": {
      const by = entry.sourceId ? ` by ${attack ? `${whose(entry.sourceId)} ${attack}` : name(entry.sourceId)}` : "";
      // What lives on durability (hazards, resources, barriers) is destroyed; delvers and wardens are defeated (#428).
      const how = entry.defeatVital === "durability" ? "destroyed" : "defeated";
      return `${cap(name(entry.targetId))} ${entry.targetId === seatId ? "were" : "was"} ${how}${by}.`;
    }
    case "field": {
      // A lasting field (emit, draw) that started hurting someone this tick.
      // Flavor aside is cheap, so regen-cancel lines get it too (AK-28).
      const flavored = `${attack}${flavorAside(entry.kind, entry.expression)}`;
      if (effect) {
        const { hurting, words } = fieldEffectWords(effect);
        return `${cap(whose(entry.sourceId))} ${flavored} ${hurting ? "is hurting" : "hits, but regen cancels it on"} ${name(entry.targetId)}: ${words}.`;
      }
      return `${cap(whose(entry.sourceId))} ${flavored} is hurting ${name(entry.targetId)}.`;
    }
    case "exit":
      return `${cap(name(entry.targetId))} left by the exit.`;
    default:
      return "";
  }
}

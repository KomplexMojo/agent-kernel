/**
 * #554 — the words for battle-log entries, so every UI (ASCII, phone app, later Phaser) shows
 * identical lines. Pure: entries in, text out. The Annotator derives the entries; this only words
 * them, and never adds what the entry does not carry (no vitals, #497).
 */

import { HUD_VITAL_LABELS } from "./actor-hud-model.js";

const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

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

/**
 * @param {object} entry   an `agent-kernel/BattleLogEntry`
 * @param {object} [who]
 * @param {string} [who.seatId]               the actor the player is playing: named "you"
 * @param {(id: string) => (string|null)} [who.labelOf]  the glyph label of an actor, when it has one
 * @param {{vital: string, hit: number, regen: number}} [who.effect]  a `field` entry's effect on a target
 *   the reader may see the vitals of (itself or its own side, #497), so the line can state the amount and the net
 */
export function battleLogLine(entry, { seatId, labelOf = () => null, effect = null } = {}) {
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
      if (entry.struck) return `${cap(source)} cast ${attack} and struck ${name(entry.targetId)}.`;
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
    case "field":
      // A lasting field (emit, draw) that started hurting someone this tick.
      if (effect) {
        const { hurting, words } = fieldEffectWords(effect);
        return `${cap(whose(entry.sourceId))} ${attack} ${hurting ? "is hurting" : "hits, but regen cancels it on"} ${name(entry.targetId)}: ${words}.`;
      }
      return `${cap(whose(entry.sourceId))} ${attack} is hurting ${name(entry.targetId)}.`;
    case "exit":
      return `${cap(name(entry.targetId))} left by the exit.`;
    default:
      return "";
  }
}

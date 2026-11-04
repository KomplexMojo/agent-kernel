/**
 * The commands a seat could try now, as `{ id, label, command }` ordered by id (moved here from the
 * play-sim T1 script, #653, so every front end shares one list). Read from the play view only, so
 * fog hides what it hides. It is a candidate list: wall, barrier, actor and stamina checks keep
 * obvious refusals out; core still decides, and a listed command can still be refused. A step into
 * a cell the seat cannot see right now (fog on: typically a diagonal past a corner, where sight
 * never peeks) is listed but marked `unseen` in its label and entry, because a barrier or actor
 * may stand there; core refuses such a step with ActorCollision, as it should (#672).
 */
import { PLAY_DIRECTION_STEPS, PLAY_SIGHT } from "./play-session.js";
import { affinityRole } from "../render/affinity-role.js";

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
// #723: each cast and equip says what the slot is for (the table's attack / defence / support), so a
// seat sees which choices can strike; an unequipped attack also names who it would reach once equipped.
const roleOf = (key) => { const [kind, expression] = key.split(":"); return affinityRole(kind, expression); };
const vitalNow = (player, key) => (player?.vitals || []).find((vital) => vital.key === key)?.current ?? 0;

export function listLegalPlayCommands(view) {
  const player = view?.player;
  if (!player || view.status?.exited || view.status?.defeated) return [];
  const actions = [{ id: "wait", label: "wait a turn", command: { kind: "wait" } }];
  const rows = view.rows || [];
  const legend = view.legend || {};
  const solid = new Set([legend.wall, legend.barrier, ...(legend.wallGlyphs || [])].filter(Boolean));
  const occupied = new Set([...(view.actors || []), ...(view.hazards || [])].filter((actor) => actor.position).map((actor) => `${actor.position.x},${actor.position.y}`));
  const free = (x, y) => {
    const glyph = [...(rows[y] || "")][x];
    return glyph !== undefined && glyph !== legend.fog && !solid.has(glyph) && !occupied.has(`${x},${y}`);
  };
  const unseen = (x, y) => Array.isArray(view.sight) && view.sight[y] !== undefined && [...view.sight[y]][x] !== PLAY_SIGHT.VISIBLE;
  const stamina = vitalNow(player, "stamina");
  const costs = player.moveStamina;
  for (const [direction, { dx, dy }] of Object.entries(PLAY_DIRECTION_STEPS)) {
    const to = { x: player.position.x + dx, y: player.position.y + dy };
    if (!free(to.x, to.y)) continue;
    const step = costs ? (dx !== 0 && dy !== 0 ? costs.diagonal : costs.step) : 0;
    if (step <= stamina) {
      const hidden = unseen(to.x, to.y);
      actions.push({ id: `move:${direction}`, label: `step ${direction}${hidden ? " (cell not in sight; something unseen may block it)" : ""}`,
        command: { kind: "move", params: { direction } }, ...(hidden ? { unseen: true } : {}) });
    }
    const far = { x: to.x + dx, y: to.y + dy };
    if (free(far.x, far.y) && (costs ? costs.sprint : 0) <= stamina) {
      actions.push({ id: `sprint:${direction}`, label: `sprint ${direction}`, command: { kind: "move", params: { direction, sprint: true } } });
    }
  }
  const mana = vitalNow(player, "mana");
  const targets = [...(view.actors || []), ...(view.hazards || [])].filter((actor) => actor.position);
  for (const [key, { range, mana: price }] of Object.entries(player.castableAffinities || {})) {
    if (price !== undefined && price > mana) continue;
    for (const target of targets) {
      if (chebyshev(player.position, target.position) > range) continue;
      const role = roleOf(key);
      actions.push({ id: `cast:${key}@${target.id}`, label: `cast ${key.replace(":", " ")} at ${target.label ?? target.id}${role ? ` (${role})` : ""}`,
        command: { kind: "cast_affinity", params: { targetId: target.id, affinityKey: key } } });
    }
  }
  // Equip and unequip (#670): a held affinity outside the equipped slots is an action too, one turn.
  // With every slot full, core makes the oldest equipped one give way.
  const equipped = player.equippedAffinityKeys || [];
  const slots = player.affinitySlots ?? 1;
  for (const pair of player.affinities || []) {
    const key = `${pair.kind}:${pair.expression}`;
    const name = key.replace(":", " ");
    if (equipped.includes(key)) {
      actions.push({ id: `unequip:${key}`, label: `unequip ${name} (a turn)`, command: { kind: "unequip_affinity", params: { affinityKey: key } } });
    } else {
      const gives = equipped.length >= slots ? equipped[0] : null;
      const role = roleOf(key);
      const castable = pair.expression === "push" || pair.expression === "pull";
      const reaches = role === "attack" && castable && Number.isInteger(pair.stacks)
        ? targets.filter((target) => chebyshev(player.position, target.position) <= pair.stacks).map((target) => target.label ?? target.id) : [];
      const purpose = role ? `; ${role}${reaches.length ? `, would reach ${reaches.join(", ")} next turn` : ""}` : "";
      actions.push({ id: `equip:${key}`, label: `equip ${name} (a turn${gives ? `; ${gives.replace(":", " ")} gives way` : ""}${purpose})`,
        command: { kind: "equip_affinity", params: { affinityKey: key } } });
    }
  }
  for (const item of view.loot || []) {
    actions.push({ id: `take:${item.targetId}:${item.holdingId}`, label: `take from ${item.targetId}`,
      command: { kind: "take", params: { targetId: item.targetId, holdingId: item.holdingId } } });
  }
  return actions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Why the list offers no step, when the cause is stamina (#671): a seat that sees only `wait` should
 * be told it cannot afford a step, what a step costs (a soaked actor pays one more), what it has
 * and what waiting gives back. Null when a step is on offer or the cause is something else.
 */
export function legalMovementNote(view) {
  const player = view?.player;
  const cost = player?.moveStamina?.step;
  if (!player || view.status?.exited || view.status?.defeated || !Number.isInteger(cost)) return null;
  const stamina = (player.vitals || []).find((vital) => vital.key === "stamina");
  if (!stamina || stamina.current >= cost) return null;
  const soaked = Number.isInteger(player.soaked) && player.soaked > 0;
  return `No step is offered: a step costs ${cost} stamina${soaked ? ` (soaked: one more than dry)` : ""} and you have ${stamina.current}.`
    + (stamina.regen > 0 ? ` Waiting gives back ${stamina.regen} a turn, before anything that hits it.` : "");
}

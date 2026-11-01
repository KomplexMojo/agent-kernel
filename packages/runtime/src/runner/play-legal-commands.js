/**
 * "What can the seat do now": the commands a play session could try from a view, as
 * `{ id, label, command }`. A pure read of the seat's view, so fog hides what it hides, and
 * the same view always gives the same list. Moved here from the play-sim T1 script (#653) so a
 * caller driving a seat through `ak_play_legal` (a model, a script, a person) asks the runtime,
 * not a test script.
 */
import { PLAY_DIRECTION_STEPS } from "./play-session.js";

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const vitalNow = (player, key) => (player?.vitals || []).find((vital) => vital.key === key)?.current ?? 0;

/**
 * Commands the seat could try now, as `{ id, label, command }`, ordered by id. Read from the view
 * only (so fog hides what it hides). It is a candidate list: wall, barrier, actor and stamina checks
 * keep obvious refusals out; core still decides, so a listed command may be refused.
 */
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
  const stamina = vitalNow(player, "stamina");
  const costs = player.moveStamina;
  for (const [direction, { dx, dy }] of Object.entries(PLAY_DIRECTION_STEPS)) {
    const to = { x: player.position.x + dx, y: player.position.y + dy };
    if (!free(to.x, to.y)) continue;
    const step = costs ? (dx !== 0 && dy !== 0 ? costs.diagonal : costs.step) : 0;
    if (step <= stamina) actions.push({ id: `move:${direction}`, label: `step ${direction}`, command: { kind: "move", params: { direction } } });
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
      actions.push({ id: `cast:${key}@${target.id}`, label: `cast ${key.replace(":", " ")} at ${target.label ?? target.id}`,
        command: { kind: "cast_affinity", params: { targetId: target.id, affinityKey: key } } });
    }
  }
  for (const item of view.loot || []) {
    actions.push({ id: `take:${item.targetId}:${item.holdingId}`, label: `take from ${item.targetId}`,
      command: { kind: "take", params: { targetId: item.targetId, holdingId: item.holdingId } } });
  }
  return actions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

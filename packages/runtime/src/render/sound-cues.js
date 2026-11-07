/**
 * #757 — the sound cue for one battle-log entry the seat may read (`contracts/sound-cues.js`).
 * Pure, like `battle-log-lines.js`: an entry in, a cue out, and nothing the entry does not carry.
 */
import { SOUND_CUE_EVENTS } from "../contracts/sound-cues.js";

const OPTIONAL = Object.freeze(["kind", "expression", "reception", "hit"]);

/** The cue for `entry` (an Annotator battle-log entry), from `seatId`'s side; null for an event with no cue. */
export function soundCueOf(entry, { seatId, friendly = false } = {}) {
  if (!entry || !SOUND_CUE_EVENTS.includes(entry.event)) return null;
  const seat = entry.sourceId === seatId ? "source" : entry.targetId === seatId ? "target" : "none";
  const cue = { tick: entry.tick, event: entry.event, seat };
  for (const key of OPTIONAL) if (typeof entry[key] === "string") cue[key] = entry[key];
  if (entry.event === "cast") cue.struck = Boolean(entry.struck);
  if (friendly) cue.friendly = true;
  return cue;
}

/**
 * #757 — sound cues: the events a client may play a sound for, as data. The framework ships no
 * audio; a client (the terminal one may ignore them) maps each cue to its own sounds. A cue names
 * the event, its affinity and the seat's part in it, never a sound file and never an actor, and it
 * exists only for what the seat may read (the battle log's fog rule, #497).
 *
 * Cue shape, one per battle-log entry the seat may read, on each play-session turn result (`cues`):
 *   { tick, event, seat, kind?, expression?, struck?, reception?, hit?, friendly? }
 *     event      one of SOUND_CUE_EVENTS
 *     seat       the seated actor's part: "source" (it did it), "target" (it was done to it), "none"
 *     kind, expression  the affinity that did it (cast, field, a defeat by a cast or field)
 *     struck     a cast hit another actor
 *     reception  "amplified" | "resisted", when the struck actor's slots did either
 *     hit        how hard the hit landed, in the battle log's words (`actorHitWord`)
 *     friendly   the seat's side hurt its own side (friendly fire stays, #573)
 */
export const SOUND_CUE_EVENTS = Object.freeze(["cast", "field", "take", "defeat", "exit"]);
export const SOUND_CUE_SEAT_ROLES = Object.freeze(["source", "target", "none"]);

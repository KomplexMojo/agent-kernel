/**
 * #692 (Darren, 2026-11-02) — hit condition bands. A landed hit tells the attacker's side how
 * hurt the target is, in words, never in numbers (#497 stays: no one reads another's vitals):
 * - a band on what is left of the target's defeat vital, as a fraction of its max;
 * - a hit word for how much of the struck vital's max one hit took;
 * - (in `actor-cast.ts`) whether the receiver amplified or resisted it.
 * The band is a reading in time: a surface ages it and stops trusting it after
 * `ACTOR_CONDITION_FADE_TICKS` ticks without a fresh hit. Pure; thresholds are tuning.
 */
export const ACTOR_CONDITION_BANDS = Object.freeze(['unhurt', 'hurt', 'bloodied', 'near_defeat'] as const);
export type ActorConditionBand = typeof ACTOR_CONDITION_BANDS[number];
export const ACTOR_HIT_WORDS = Object.freeze(['glancing', 'solid', 'crushing'] as const);
export type ActorHitWord = typeof ACTOR_HIT_WORDS[number];

/** A band older than this many ticks reads as unknown: the target may have healed or worsened since. */
export const ACTOR_CONDITION_FADE_TICKS = 5;

/** Above each share of max, the band before it: >75% unhurt, >50% hurt, >25% bloodied, else near defeat. */
const BAND_FLOORS: readonly number[] = [0.75, 0.5, 0.25];
/** Below each share of max a single hit took, the word: <10% glancing, <25% solid, else crushing. */
const HIT_CEILINGS: readonly number[] = [0.1, 0.25];

/** The band for `current` of `max` left; null when there is no max to read against. */
export function actorConditionBand(current: number, max: number): ActorConditionBand | null {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null;
  const share = Math.max(0, current) / max;
  const index = BAND_FLOORS.findIndex(floor => share > floor);
  return ACTOR_CONDITION_BANDS[index === -1 ? BAND_FLOORS.length : index];
}

/** The word for a hit that took `loss` (positive) of a vital whose max is `max`; null for no loss. */
export function actorHitWord(loss: number, max: number): ActorHitWord | null {
  if (!Number.isFinite(loss) || !Number.isFinite(max) || loss <= 0 || max <= 0) return null;
  const share = loss / max;
  const index = HIT_CEILINGS.findIndex(ceiling => share < ceiling);
  return ACTOR_HIT_WORDS[index === -1 ? HIT_CEILINGS.length : index];
}

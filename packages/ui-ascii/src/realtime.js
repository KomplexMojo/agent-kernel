/**
 * Opt-in real time (#291, Darren 2026-10-15: "both, opt-in"). Turn-based by
 * default; with real time on, the terminal sends the same `wait` a `.` key
 * would every `intervalMs` while the player does nothing, so traps, regen and
 * upkeep keep acting. Every turn is still an ordinary `game.handle()` call, so
 * records and replays are unchanged. Terminal timing only: no rule lives here.
 */
import { INTENT } from "./keymap.js";

/** The key that switches real time on and off in interactive play. */
export const REALTIME_TOGGLE_KEY = "t";
/** The interval `t` uses when no `--realtime <ms>` was given. */
export const DEFAULT_REALTIME_MS = 500;
/** Shortest interval accepted, so a typo cannot flood the session. */
export const MIN_REALTIME_MS = 50;

/** Parse a `--realtime` value: whole milliseconds, at least MIN_REALTIME_MS. */
export function parseRealtimeMs(value) {
  if (!/^\d+$/.test(String(value)) || Number(value) < MIN_REALTIME_MS) {
    throw new Error(`--realtime needs whole milliseconds, at least ${MIN_REALTIME_MS}; got ${value}`);
  }
  return Number(value);
}

/**
 * One real-time beat: a wait, unless a panel is open (the player is choosing)
 * or the level is over. Returns whether a turn ran.
 */
export async function realtimeBeat(game) {
  const state = game.state();
  if (state.panel || state.finished || state.status?.exited || state.status?.defeated) return false;
  await game.handle({ type: INTENT.WAIT });
  return true;
}

/** The status line interactive play shows under the screen. */
export function realtimeLine({ on, intervalMs }) {
  return on
    ? `Real time: a turn every ${intervalMs} ms while you wait (${REALTIME_TOGGLE_KEY} pauses)`
    : `Turn-based: time passes when you act (${REALTIME_TOGGLE_KEY} for real time)`;
}

/**
 * The shared controls (#505, Darren 2026-10-25): what a player can ask for, and the keys that ask
 * for it, as data any interface reads. `ui-ascii` is the reference client; a Phaser, web or harness
 * client supplies its own input decoding and drawing, then maps these intents onto its own style, so
 * changing a binding here changes every interface.
 *
 * Keys are LOGICAL names, as the DOM's `KeyboardEvent.key` spells them: a printable character is
 * itself (an upper-case letter is the shifted key), and the rest are `ArrowUp`, `ArrowDown`,
 * `ArrowLeft`, `ArrowRight`, `Enter`, `Tab`, `Escape`, ` ` (space), with `Shift+` or `Control+` in
 * front of a modifier. Turning a terminal's escape sequences into these names is the terminal
 * client's job; nothing here knows about a terminal.
 *
 * Intents are what the UI asks for. Whether a move is legal is never decided here (core decides,
 * through the play session).
 */

export const INTENT = Object.freeze({
  MOVE: "move",
  WAIT: "wait",
  RESTART: "restart",
  NEXT_LEVEL: "next_level",
  HELP: "help",
  QUIT: "quit",
  AFFINITIES: "affinities",
  CAST: "cast",
  TAKE: "take",
  NEXT_TARGET: "next_target",
  SELECT: "select",
  LEVEL_UP: "level_up",
  LEVEL_DOWN: "level_down",
  ORDER: "order",
  INTENSITY_UP: "intensity_up",
  INTENSITY_DOWN: "intensity_down",
  SPRINT: "sprint",
  RAISE: "raise",
  INSPECT: "inspect",
  WATCH: "watch",
  MAP: "map",
});

/** The eight directions, in the order the play session names them. */
export const MOVE_DIRECTIONS = Object.freeze(["north", "south", "east", "west", "northwest", "northeast", "southwest", "southeast"]);

/** Keys that move, by direction: arrows, WASD, vi keys, and the roguelike diagonals. */
export const MOVE_BINDINGS = Object.freeze({
  north: Object.freeze(["ArrowUp", "w", "k"]),
  south: Object.freeze(["ArrowDown", "s", "j"]),
  east: Object.freeze(["ArrowRight", "d", "l"]),
  west: Object.freeze(["ArrowLeft", "a", "h"]),
  northwest: Object.freeze(["y"]),
  northeast: Object.freeze(["u"]),
  southwest: Object.freeze(["b"]),
  southeast: Object.freeze(["n"]),
});

/** Keys for every other intent except SELECT (the digits 1-9 pick the 1st to 9th row). */
export const INTENT_BINDINGS = Object.freeze({
  [INTENT.WAIT]: Object.freeze([".", " "]),
  [INTENT.RESTART]: Object.freeze(["r"]),
  [INTENT.NEXT_LEVEL]: Object.freeze(["Enter"]),
  [INTENT.HELP]: Object.freeze(["?"]),
  [INTENT.AFFINITIES]: Object.freeze(["i"]),
  [INTENT.CAST]: Object.freeze(["f"]),
  [INTENT.TAKE]: Object.freeze(["g"]),
  [INTENT.ORDER]: Object.freeze(["o"]),
  [INTENT.NEXT_TARGET]: Object.freeze(["Tab"]),
  [INTENT.LEVEL_UP]: Object.freeze(["+", "="]),
  [INTENT.LEVEL_DOWN]: Object.freeze(["-"]),
  [INTENT.INTENSITY_UP]: Object.freeze(["]"]),
  [INTENT.INTENSITY_DOWN]: Object.freeze(["["]),
  [INTENT.SPRINT]: Object.freeze(["x"]),
  [INTENT.RAISE]: Object.freeze(["z"]),
  [INTENT.INSPECT]: Object.freeze(["v"]),
  [INTENT.WATCH]: Object.freeze(["e"]),
  [INTENT.MAP]: Object.freeze(["m"]),
  [INTENT.QUIT]: Object.freeze(["q", "Control+c", "Escape"]),
});

const invert = (table) => new Map(Object.entries(table).flatMap(([target, keys]) => keys.map((key) => [key, target])));
const MOVE_BY_KEY = invert(MOVE_BINDINGS);
const INTENT_BY_KEY = invert(INTENT_BINDINGS);

/**
 * The intent a logical key asks for, or null.
 * @returns {{type: string, direction?: string, sprint?: boolean, index?: number} | null}
 */
export function intentForLogicalKey(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  // Sprint (#437): shift with a move key, i.e. an upper-case letter or shift+arrow.
  const shiftedArrow = /^Shift\+(Arrow(?:Up|Down|Left|Right))$/.exec(key);
  if (shiftedArrow) return { type: INTENT.MOVE, direction: MOVE_BY_KEY.get(shiftedArrow[1]), sprint: true };
  const direction = MOVE_BY_KEY.get(key) ?? MOVE_BY_KEY.get(key.toLowerCase());
  if (direction) return { type: INTENT.MOVE, direction, ...(key.length === 1 && key !== key.toLowerCase() ? { sprint: true } : {}) };
  if (/^[1-9]$/.test(key)) return { type: INTENT.SELECT, index: Number(key) - 1 };
  const type = INTENT_BY_KEY.get(key) ?? INTENT_BY_KEY.get(key.toLowerCase());
  return type ? { type } : null;
}

export const HELP_LINES = Object.freeze([
  "Move: arrows / WASD / hjkl   Diagonals: y u b n   Sprint 2 tiles: shift+move, or toggle x (stays on)",
  "Wait: . or space   Restart: r   Next level: Enter   Quit: q",
  "Affinities: i, then 1-9 to equip or unequip   Take: g",
  "In the affinity list: Tab picks a row, + / - run it at more or less range, ] / [ at more or less intensity",
  "Cast: f (or a slot's number), then Tab for the next target, Enter to cast, Esc to cancel",
  "Inspect: v, Tab for the next target, Enter to spend a turn looking at it (the reading stays on screen)",
  "Watch: e, Tab for the next target, Enter to start (1 mana a turn, live while in sight); the same again stops it",
  "Aim at a tile: a move key while casting; the cast hits the first actor or wall   Raise a barrier: z, aim, Enter",
  "Cast path on the floor: > < ^ v / \\ (a push points away from the caster, a pull back)",
  "Walls: ─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼  (short stubs ╴ ╶ ╵ ╷, alone ■) — stubs are wall ends, not cast path",
  "Barrier ▮: only while in sight (unlit: adjacent); remembered tiles show floor — not a permanent wall",
  "Notebook: m shows what you remember (rooms, hallways, how much is cleared); m or Esc closes",
  "Party: Tab (outside a list) plays your next user_controlled actor",
  "Order: o, then a number for who and a number for what (follow, guard, ...); costs a turn",
]);

/** Watching a recorded run (`--watch`): keys step through its ticks. */
export const WATCH_INTENT = Object.freeze({
  NEXT: "next_tick",
  PREVIOUS: "previous_tick",
  FIRST: "first_tick",
  LAST: "last_tick",
  HELP: INTENT.HELP,
  QUIT: INTENT.QUIT,
});

export const WATCH_BINDINGS = Object.freeze({
  [WATCH_INTENT.NEXT]: Object.freeze(["ArrowRight", "l", "d", ".", " "]),
  [WATCH_INTENT.PREVIOUS]: Object.freeze(["ArrowLeft", "h", "a", ","]),
  [WATCH_INTENT.FIRST]: Object.freeze(["["]),
  [WATCH_INTENT.LAST]: Object.freeze(["]"]),
  [WATCH_INTENT.HELP]: Object.freeze(["?"]),
  [WATCH_INTENT.QUIT]: Object.freeze(["q", "Control+c", "Escape"]),
});

const WATCH_BY_KEY = invert(WATCH_BINDINGS);

/** @returns {{type: string} | null} */
export function watchIntentForLogicalKey(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  const type = WATCH_BY_KEY.get(key) ?? WATCH_BY_KEY.get(key.toLowerCase());
  return type ? { type } : null;
}

export const WATCH_HELP_LINES = Object.freeze([
  "Next tick: right / l / d / . / space   Previous tick: left / h / a / ,",
  "First tick: [   Last tick: ]   Help: ?   Quit: q",
]);

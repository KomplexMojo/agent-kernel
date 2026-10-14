/**
 * Keypress -> UI intent. Pure: no terminal access, so it is testable as data.
 *
 * Intents are what the UI asks for; whether a move is legal is never decided
 * here (core decides, through the runtime play session).
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
});

const MOVE_KEYS = Object.freeze({
  // Arrow keys (ANSI cursor sequences, normal and application mode)
  "\u001b[A": "north",
  "\u001b[B": "south",
  "\u001b[C": "east",
  "\u001b[D": "west",
  "\u001bOA": "north",
  "\u001bOB": "south",
  "\u001bOC": "east",
  "\u001bOD": "west",
  // WASD
  w: "north",
  a: "west",
  s: "south",
  d: "east",
  // vi keys, including roguelike diagonals
  k: "north",
  h: "west",
  j: "south",
  l: "east",
  y: "northwest",
  u: "northeast",
  b: "southwest",
  n: "southeast",
});

const OTHER_KEYS = Object.freeze({
  ".": INTENT.WAIT,
  " ": INTENT.WAIT,
  r: INTENT.RESTART,
  "\r": INTENT.NEXT_LEVEL,
  "\n": INTENT.NEXT_LEVEL,
  "?": INTENT.HELP,
  i: INTENT.AFFINITIES,
  f: INTENT.CAST,
  g: INTENT.TAKE,
  "\t": INTENT.NEXT_TARGET,
  "+": INTENT.LEVEL_UP,
  "=": INTENT.LEVEL_UP,
  "-": INTENT.LEVEL_DOWN,
  q: INTENT.QUIT,
  "\u0003": INTENT.QUIT, // Ctrl-C
  "\u001b": INTENT.QUIT, // bare Esc
});

/** @returns {{type: string, direction?: string, index?: number} | null} */
export function intentForKey(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  const direction = MOVE_KEYS[key] ?? MOVE_KEYS[key.toLowerCase()];
  if (direction) return { type: INTENT.MOVE, direction };
  if (/^[1-9]$/.test(key)) return { type: INTENT.SELECT, index: Number(key) - 1 };
  const type = OTHER_KEYS[key] ?? OTHER_KEYS[key.toLowerCase()];
  return type ? { type } : null;
}

/**
 * Split a raw stdin chunk into keys. A fast typist or a paste can deliver
 * several keys in one chunk; escape sequences stay whole.
 */
export function splitKeys(chunk) {
  const keys = [];
  const text = String(chunk ?? "");
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\u001b" && (text[i + 1] === "[" || text[i + 1] === "O") && i + 2 < text.length) {
      keys.push(text.slice(i, i + 3));
      i += 2;
    } else {
      keys.push(text[i]);
    }
  }
  return keys;
}

export const HELP_LINES = Object.freeze([
  "Move: arrows / WASD / hjkl   Diagonals: y u b n",
  "Wait: . or space   Restart: r   Next level: Enter   Quit: q",
  "Affinities: i, then 1-9 to equip or unequip   Take: g",
  "In the affinity list: Tab picks a row, + / - run it at more or fewer stacks",
  "Cast: f (or a slot's number), then Tab for the next target, Enter to cast, Esc to cancel",
  "Party: Tab (outside a list) plays your next user_controlled actor",
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

const WATCH_KEYS = Object.freeze({
  "\u001b[C": WATCH_INTENT.NEXT,
  "\u001bOC": WATCH_INTENT.NEXT,
  l: WATCH_INTENT.NEXT,
  d: WATCH_INTENT.NEXT,
  ".": WATCH_INTENT.NEXT,
  " ": WATCH_INTENT.NEXT,
  "\u001b[D": WATCH_INTENT.PREVIOUS,
  "\u001bOD": WATCH_INTENT.PREVIOUS,
  h: WATCH_INTENT.PREVIOUS,
  a: WATCH_INTENT.PREVIOUS,
  ",": WATCH_INTENT.PREVIOUS,
  "[": WATCH_INTENT.FIRST,
  "]": WATCH_INTENT.LAST,
  "?": WATCH_INTENT.HELP,
  q: WATCH_INTENT.QUIT,
  "\u0003": WATCH_INTENT.QUIT, // Ctrl-C
  "\u001b": WATCH_INTENT.QUIT, // bare Esc
});

/** @returns {{type: string} | null} */
export function watchIntentForKey(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  const type = WATCH_KEYS[key] ?? WATCH_KEYS[key.toLowerCase()];
  return type ? { type } : null;
}

export const WATCH_HELP_LINES = Object.freeze([
  "Next tick: right / l / d / . / space   Previous tick: left / h / a / ,",
  "First tick: [   Last tick: ]   Help: ?   Quit: q",
]);

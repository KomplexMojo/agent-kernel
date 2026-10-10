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
  q: INTENT.QUIT,
  "\u0003": INTENT.QUIT, // Ctrl-C
  "\u001b": INTENT.QUIT, // bare Esc
});

/** @returns {{type: string, direction?: string} | null} */
export function intentForKey(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  const direction = MOVE_KEYS[key] ?? MOVE_KEYS[key.toLowerCase()];
  if (direction) return { type: INTENT.MOVE, direction };
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
]);

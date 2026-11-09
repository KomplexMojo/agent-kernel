/**
 * Terminal key decoding. The intents, the default bindings (as data, by logical key name) and the
 * help text are the shared controls in runtime (`runtime/src/controls/intents.js`, #505), so every
 * interface follows one set; this file only turns a terminal's raw bytes into those logical keys.
 * Re-exports keep this module's public surface unchanged.
 */
import {
  INTENT, WATCH_INTENT, HELP_LINES, WATCH_HELP_LINES, intentForLogicalKey, watchIntentForLogicalKey,
} from "../../runtime/src/controls/intents.js";

export { INTENT, WATCH_INTENT, HELP_LINES, WATCH_HELP_LINES };

// Terminal byte sequences -> logical key names (the DOM's spelling). Anything else printable is
// its own name.
const LOGICAL_KEYS = Object.freeze({
  "\u001b[A": "ArrowUp",
  "\u001b[B": "ArrowDown",
  "\u001b[C": "ArrowRight",
  "\u001b[D": "ArrowLeft",
  "\u001bOA": "ArrowUp",
  "\u001bOB": "ArrowDown",
  "\u001bOC": "ArrowRight",
  "\u001bOD": "ArrowLeft",
  // shift+arrow carries modifier 2 (`\u001b[1;2A`)
  "\u001b[1;2A": "Shift+ArrowUp",
  "\u001b[1;2B": "Shift+ArrowDown",
  "\u001b[1;2C": "Shift+ArrowRight",
  "\u001b[1;2D": "Shift+ArrowLeft",
  "\r": "Enter",
  "\n": "Enter",
  "\t": "Tab",
  "\u0003": "Control+c",
  "\u001b": "Escape",
});

/** A terminal key (a raw sequence) as its logical name, or the key itself when it has none. */
export function logicalKeyForTerminalKey(key) {
  return typeof key === "string" ? (LOGICAL_KEYS[key] ?? key) : key;
}

/** @returns {{type: string, direction?: string, index?: number} | null} */
export function intentForKey(key) {
  return intentForLogicalKey(logicalKeyForTerminalKey(key));
}

/** @returns {{type: string} | null} */
export function watchIntentForKey(key) {
  return watchIntentForLogicalKey(logicalKeyForTerminalKey(key));
}

/**
 * Split a raw stdin chunk into keys. A fast typist or a paste can deliver
 * several keys in one chunk; escape sequences stay whole.
 */
export function splitKeys(chunk) {
  const keys = [];
  const text = String(chunk ?? "");
  for (let i = 0; i < text.length; i += 1) {
    // A CSI sequence may carry parameters before its final letter (shift+arrow is `\u001b[1;2A`).
    const csi = text[i] === "\u001b" && text[i + 1] === "[" ? /^\u001b\[[0-9;]*[A-Za-z~]/.exec(text.slice(i)) : null;
    if (csi) {
      keys.push(csi[0]);
      i += csi[0].length - 1;
    } else if (text[i] === "\u001b" && text[i + 1] === "O" && i + 2 < text.length) {
      keys.push(text.slice(i, i + 3));
      i += 2;
    } else {
      keys.push(text[i]);
    }
  }
  return keys;
}

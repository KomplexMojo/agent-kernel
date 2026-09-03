// The keyboard bindings for screen navigation, as data plus one pure resolver,
// extracted so they can be unit-tested independently of main.js (the app entry
// point, which is not importable in isolation) -- the same reason
// gameplay-launch.js exists.
//
// Why this is a module and not an if-chain in the handler: the inventory screen
// shipped bound to Cmd+} -- literally Cmd+Shift+] -- which macOS browsers
// reserve for "next tab". The keypress never reached the page, so a whole screen
// had no working way in, and no test noticed because the binding lived inline in
// a file nothing imports.

/**
 * Chords the browser consumes before the page sees them. A binding listed here
 * cannot work, no matter what the handler does.
 *
 * Keyed by platform concern rather than by browser: these are the ones that hold
 * across the macOS browsers this app targets.
 */
export const BROWSER_RESERVED_CHORDS = Object.freeze([
  // Cmd+digit switches browser tabs.
  Object.freeze({ meta: true, shift: false, keys: Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8", "9"]),
    why: "Cmd+digit switches browser tabs" }),
  // Cmd+Shift+] / [ is next/previous tab -- and Cmd+} IS Cmd+Shift+].
  Object.freeze({ meta: true, shift: true, keys: Object.freeze(["]", "[", "}", "{"]),
    why: "Cmd+Shift+bracket is next/previous browser tab" }),
]);

/** Whether a chord is one the browser will swallow. */
export function isBrowserReserved({ metaKey = false, shiftKey = false, key = "" } = {}) {
  return BROWSER_RESERVED_CHORDS.some((chord) =>
    chord.meta === Boolean(metaKey)
    && chord.shift === Boolean(shiftKey)
    && chord.keys.includes(key));
}

/**
 * The screen bindings.
 *
 * Ctrl+<digit> for direct jumps: free on macOS, because the browser's own tab
 * switching is Cmd+digit. (Chrome on Windows/Linux does bind Ctrl+1..8, so these
 * would need revisiting to ship there.)
 */
export const SCREEN_SHORTCUTS = Object.freeze([
  Object.freeze({ action: "design", ctrl: true, key: "1", label: "Ctrl+1" }),
  Object.freeze({ action: "gameplay", ctrl: true, key: "2", label: "Ctrl+2" }),
  Object.freeze({ action: "inventory", ctrl: true, key: "3", label: "Ctrl+3" }),
]);

/**
 * Resolve a keydown to a screen action.
 *
 * @param {{ key?: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }} event
 * @returns {{ action: string } | null} null when the event is not a screen binding.
 */
export function resolveScreenShortcut(event = {}) {
  const { key = "", ctrlKey = false, metaKey = false } = event;

  // A reserved chord never reaches the page in a real browser, so treating one
  // as a binding here would only hide the problem again.
  if (isBrowserReserved(event)) return null;

  if (key === "Escape") return { action: "close-inventory" };

  if (metaKey || ctrlKey) {
    if (key === "]") return { action: "forward" };
    if (key === "[") return { action: "back" };
  }

  if (ctrlKey && !metaKey) {
    const match = SCREEN_SHORTCUTS.find((s) => s.ctrl && s.key === key);
    if (match) return { action: match.action };
  }

  return null;
}

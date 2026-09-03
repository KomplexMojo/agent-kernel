import assert from "node:assert/strict";
import { test } from "vitest";

import {
  BROWSER_RESERVED_CHORDS,
  SCREEN_SHORTCUTS,
  isBrowserReserved,
  resolveScreenShortcut,
} from "../../packages/ui-web/src/screen-shortcuts.js";

// The inventory screen shipped bound to Cmd+} -- literally Cmd+Shift+], which
// macOS browsers reserve for "next tab". The keypress never reached the page, so
// a whole screen had no working way in. Nothing caught it: the binding was an
// if-chain inside main.js, which no test imports.

const press = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

test("Ctrl+digit reaches each screen", () => {
  assert.deepEqual(resolveScreenShortcut(press("1", { ctrlKey: true })), { action: "design" });
  assert.deepEqual(resolveScreenShortcut(press("2", { ctrlKey: true })), { action: "gameplay" });
  assert.deepEqual(resolveScreenShortcut(press("3", { ctrlKey: true })), { action: "inventory" });
});

test("the inventory has a binding that is not browser-reserved", () => {
  // The actual defect: a screen whose only way in cannot fire.
  const binding = SCREEN_SHORTCUTS.find((s) => s.action === "inventory");
  assert.ok(binding, "the inventory needs a binding at all");
  assert.equal(
    isBrowserReserved({ key: binding.key, ctrlKey: binding.ctrl, metaKey: false, shiftKey: false }),
    false,
    `${binding.label} must not be a chord the browser swallows`,
  );
  assert.deepEqual(resolveScreenShortcut(press(binding.key, { ctrlKey: binding.ctrl })), { action: "inventory" });
});

test("NO screen binding may use a browser-reserved chord", () => {
  // Forbid the capability, not the one spelling: any future binding added to the
  // table is checked, so the next unreachable chord fails here rather than in
  // someone's hands.
  for (const binding of SCREEN_SHORTCUTS) {
    assert.equal(
      isBrowserReserved({ key: binding.key, ctrlKey: binding.ctrl, metaKey: false, shiftKey: false }),
      false,
      `${binding.label} (${binding.action}) is reserved by the browser and cannot fire`,
    );
  }
});

test.each([
  ["Cmd+}", press("}", { metaKey: true, shiftKey: true })],
  ["Cmd+Shift+]", press("]", { metaKey: true, shiftKey: true })],
  ["Cmd+Shift+[", press("[", { metaKey: true, shiftKey: true })],
  ["Cmd+1", press("1", { metaKey: true })],
])("a browser-reserved chord resolves to nothing: %s", (_label, event) => {
  // Resolving one of these would let the same bug hide behind a passing test.
  assert.equal(isBrowserReserved(event), true, "should be recognised as reserved");
  assert.equal(resolveScreenShortcut(event), null);
});

test("plain brackets still navigate, and are not confused with the reserved shifted form", () => {
  assert.deepEqual(resolveScreenShortcut(press("]", { metaKey: true })), { action: "forward" });
  assert.deepEqual(resolveScreenShortcut(press("[", { metaKey: true })), { action: "back" });
  assert.deepEqual(resolveScreenShortcut(press("]", { ctrlKey: true })), { action: "forward" });
});

test("Escape asks to close the inventory", () => {
  assert.deepEqual(resolveScreenShortcut(press("Escape")), { action: "close-inventory" });
});

test("bare keys belong to the game, not to screen navigation", () => {
  // Movement and actions are bare keys; a screen must never steal one.
  for (const key of ["1", "2", "3", "w", "a", "s", "d", "z", "]", "["]) {
    assert.equal(resolveScreenShortcut(press(key)), null, `bare ${key} must not navigate`);
  }
});

test("the reserved table explains itself", () => {
  // A chord list without reasons rots into cargo cult.
  for (const chord of BROWSER_RESERVED_CHORDS) {
    assert.ok(chord.why && chord.why.length > 10, "each reserved chord needs a why");
    assert.ok(chord.keys.length > 0);
  }
});

// ## TODO: Test Permutations
// Named permutations awaiting /local-test-gen. Empty bodies on purpose -- see
// tests/README.md: un-skipping one creates a vacuously passing empty test.
test.skip("Ctrl+digit for a screen that does not exist resolves to nothing", () => {});
test.skip("a chord with both Ctrl and Cmd held is not a screen binding", () => {});
test.skip("key values arriving with different capitalisation are handled", () => {});

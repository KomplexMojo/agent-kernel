/**
 * #463: a cast's path shows an arrow on each floor cell for the turn of the cast, away from
 * the caster for a push and back toward it for a pull; the glyphs are runtime render's.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { ASCII_CAST_PATH_GLYPHS, asciiCastPathGlyph } from "../../packages/runtime/src/render/visualization-snapshot.js";
import { asciiCastPathCellStyle } from "../../packages/runtime/src/render/ascii-cell-style.js";
import { AFFINITY_COLOR_HEX } from "../../packages/runtime/src/render/affinity-palette.js";

const at = (x, y) => ({ x, y });

test("a push points away from the caster, a pull back toward it, in all eight directions", () => {
  const cases = [[1, 0, ">", "<"], [-1, 0, "<", ">"], [0, -1, "^", "v"], [0, 1, "v", "^"],
    [1, -1, "/", "/"], [-1, 1, "/", "/"], [1, 1, "\\", "\\"], [-1, -1, "\\", "\\"]];
  for (const [dx, dy, push, pull] of cases) {
    assert.equal(asciiCastPathGlyph(at(5, 5), at(5 + dx, 5 + dy), "push"), push);
    assert.equal(asciiCastPathGlyph(at(5, 5), at(5 + dx, 5 + dy), "pull"), pull);
  }
  assert.ok(Object.values(ASCII_CAST_PATH_GLYPHS).every((glyph) => glyph.length === 1 && glyph.charCodeAt(0) < 128));
});

test("a path cell takes its cast affinity's palette colour, every affinity alike", () => {
  const floor = { fg: "#666666", bg: "#111111" };
  for (const kind of Object.keys(AFFINITY_COLOR_HEX)) {
    const style = asciiCastPathCellStyle(floor, kind);
    assert.notEqual(style.bg, floor.bg, kind);
  }
  assert.equal(asciiCastPathCellStyle(floor, "unknown"), floor);
});

// ## TODO: Test Permutations
// - a zero-length step (same cell) has no arrow
// - draw reads as inward like pull

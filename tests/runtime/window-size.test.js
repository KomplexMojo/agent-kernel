/** The play window is sized from the display: odd, clamped 7-15, and 11 on a standard iPhone. */
const assert = require("node:assert/strict");
const { windowSizeForViewport, windowSizeForTerminal, WINDOW_DEFAULT } = require("../../packages/runtime/src/render/window-size.js");

test("phones: 32 px tiles give 11 on a standard iPhone and never an even size", () => {
  assert.equal(windowSizeForViewport({ widthPx: 393, heightPx: 852 }), 11);
  assert.equal(windowSizeForViewport({ widthPx: 375, heightPx: 667 }), 9);
  assert.equal(windowSizeForViewport({ widthPx: 430, heightPx: 932 }), 11);
  assert.equal(windowSizeForViewport({ widthPx: 1200, heightPx: 2000 }), 15);
  assert.equal(windowSizeForViewport({ widthPx: 200, heightPx: 400 }), 7);
  assert.equal(windowSizeForViewport({ widthPx: 393, heightPx: 852, tilePx: 64 }), 7);
  assert.equal(windowSizeForViewport({}), WINDOW_DEFAULT);
});

test("terminals: a glyph and a space per tile, sixteen rows for the HUD", () => {
  assert.equal(windowSizeForTerminal({ columns: 80, rows: 40 }), 15);
  assert.equal(windowSizeForTerminal({ columns: 80, rows: 28 }), 11);
  assert.equal(windowSizeForTerminal({ columns: 40, rows: 40 }), 15);
  assert.equal(windowSizeForTerminal({ columns: 30, rows: 40 }), 13);
  assert.equal(windowSizeForTerminal({}), WINDOW_DEFAULT);
});

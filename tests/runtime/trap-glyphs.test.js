const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/render/trap-glyphs.js");

test("trap glyph resolver maps affinity stacks into deterministic glyph markers", () => {
  runEsm(`
    import assert from "node:assert/strict";
    import { resolveTrapGlyph, resolveTrapGlyphMarker } from ${JSON.stringify(modulePath)};

    assert.equal(resolveTrapGlyph({ kind: "fire", stacks: 1 }), "f");
    assert.equal(resolveTrapGlyph({ kind: "fire", stacks: 2 }), "F");
    assert.equal(resolveTrapGlyph({ kind: "water", stacks: 3 }), "W");
    assert.equal(resolveTrapGlyph({ kind: "unknown", stacks: 2 }), ".");

    assert.deepEqual(
      resolveTrapGlyphMarker({ kind: "dark", stacks: 3 }),
      { kind: "dark", stacks: 3, glyph: "K" },
    );
    assert.equal(resolveTrapGlyphMarker({ kind: "unknown", stacks: 1 }), null);
  `);
});

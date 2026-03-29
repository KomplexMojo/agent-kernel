import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveIconHTML } from "../../packages/ui-web/src/icon-resolver.js";

const EXPECTED_AFFINITY_GLYPHS = Object.freeze({
  fire: "🔥",
  water: "💧",
  earth: "🪨",
  wind: "🌪️",
  life: "🌿",
  decay: "🧪",
  corrode: "🧫",
  fortify: "🧱",
  light: "🌟",
  dark: "🌑",
});

test("resolveIconHTML returns intended affinity glyph fallbacks", () => {
  Object.entries(EXPECTED_AFFINITY_GLYPHS).forEach(([key, glyph]) => {
    assert.equal(resolveIconHTML(null, "affinities", key), glyph, `affinity ${key} should map to ${glyph}`);
  });
});

test("resolveIconHTML falls back to default glyph for unknown affinity", () => {
  assert.equal(resolveIconHTML(null, "affinities", "unknown"), "◈");
});

test("resolveIconHTML prefers bundle dataUri and keeps textual alt", () => {
  const bundle = {
    mappings: { icons: { affinities: { fire: "asset-fire" } } },
    assets: [{ id: "asset-fire", dataUri: "data:image/png;base64,AAAA" }],
  };

  const html = resolveIconHTML(bundle, "affinities", "fire");
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64,AAAA"/);
  assert.match(html, /alt="fire"/);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveIcon, resolveIconHTML } from "../../packages/ui-web/src/icon-resolver.js";

function withFakeDocument(run) {
  const originalDocument = global.document;
  const fakeDocument = {
    createElement(tag) {
      const element = {
        tagName: String(tag).toUpperCase(),
        className: "",
        style: {},
        textContent: "",
        children: [],
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        removeChild(child) {
          this.children = this.children.filter((c) => c !== child);
        },
      };
      return element;
    },
  };
  global.document = fakeDocument;
  try {
    return run();
  } finally {
    global.document = originalDocument;
  }
}

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

const EXPECTED_TYPE_GLYPHS = Object.freeze({
  room: "🏛️",
  delver: "⚔️",
  attacker: "⚔️",
  warden: "🛡️",
  defender: "🛡️",
  untyped: "◻️",
});

test("resolveIconHTML returns intended affinity glyph fallbacks", () => {
  Object.entries(EXPECTED_AFFINITY_GLYPHS).forEach(([key, glyph]) => {
    assert.equal(resolveIconHTML(null, "affinities", key), glyph, `affinity ${key} should map to ${glyph}`);
  });
});

test("resolveIconHTML returns richer type glyph fallbacks", () => {
  Object.entries(EXPECTED_TYPE_GLYPHS).forEach(([key, glyph]) => {
    assert.equal(resolveIconHTML(null, "types", key), glyph, `type ${key} should map to ${glyph}`);
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

test("resolveIconHTML prefers bundle icons for types before fallbacks", () => {
  const bundle = {
    mappings: { icons: { types: { delver: "asset-delver" } } },
    assets: [{ id: "asset-delver", dataUri: "data:image/png;base64,BBBB" }],
  };

  const html = resolveIconHTML(bundle, "types", "delver");
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64,BBBB"/);
  assert.match(html, /alt="delver"/);
});

test("resolveIconHTML returns default UI glyph for card-builder when bundle is missing", () => {
  assert.equal(resolveIconHTML(null, "ui", "card-builder"), "◈");
});

test("resolveIcon falls back to default UI glyph element for card-builder when bundle is missing", () =>
  withFakeDocument(() => {
    const iconEl = resolveIcon(null, "ui", "card-builder");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "◈");
  }));

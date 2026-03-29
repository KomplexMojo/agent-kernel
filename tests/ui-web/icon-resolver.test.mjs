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

const EXPECTED_EXPRESSION_GLYPHS = Object.freeze({
  push: "✦",
  pull: "✦",
  emit: "✦",
});

const EXPECTED_MOTIVATION_GLYPHS = Object.freeze({
  random: "❖",
  stationary: "❖",
  exploring: "❖",
  attacking: "❖",
  defending: "❖",
  patrolling: "❖",
  reflexive: "❖",
  goal_oriented: "❖",
  strategy_focused: "❖",
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

test("resolveIconHTML returns expression glyph fallbacks", () => {
  Object.entries(EXPECTED_EXPRESSION_GLYPHS).forEach(([key, glyph]) => {
    assert.equal(resolveIconHTML(null, "expressions", key), glyph, `expression ${key} should map to ${glyph}`);
  });
});

test("resolveIconHTML returns motivation glyph fallbacks", () => {
  Object.entries(EXPECTED_MOTIVATION_GLYPHS).forEach(([key, glyph]) => {
    assert.equal(resolveIconHTML(null, "motivations", key), glyph, `motivation ${key} should map to ${glyph}`);
  });
});

test("resolveIconHTML returns default glyph for unknown type", () => {
  assert.equal(resolveIconHTML(null, "types", "unknown"), "◈");
});

test("resolveIconHTML returns default glyph for unknown expression", () => {
  assert.equal(resolveIconHTML(null, "expressions", "unknown"), "◈");
});

test("resolveIconHTML returns default glyph for unknown motivation", () => {
  assert.equal(resolveIconHTML(null, "motivations", "unknown"), "◈");
});

test("resolveIconHTML returns default UI glyph for unknown UI key", () => {
  assert.equal(resolveIconHTML(null, "ui", "unknown-surface"), "◈");
});

test("resolveIcon creates fallback span element with appropriate glyph for types", () =>
  withFakeDocument(() => {
    const iconEl = resolveIcon(null, "types", "delver");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "⚔️");
  }));

test("resolveIcon creates fallback span element with appropriate glyph for affinities", () =>
  withFakeDocument(() => {
    const iconEl = resolveIcon(null, "affinities", "fire");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🔥");
  }));

test("resolveIcon creates fallback span element for unknown key without raw text", () =>
  withFakeDocument(() => {
    const iconEl = resolveIcon(null, "affinities", "unknown-affinity");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "◈");
    assert.notEqual(iconEl?.textContent, "unknown-affinity", "should not show raw key text");
  }));

test("resolveIcon creates img element when bundle provides dataUri", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { types: { warden: "asset-warden" } } },
      assets: [{ id: "asset-warden", dataUri: "data:image/png;base64,CCCC" }],
    };
    const iconEl = resolveIcon(bundle, "types", "warden");
    assert.equal(iconEl?.tagName, "IMG");
    assert.equal(iconEl?.className, "icon-from-bundle");
    assert.equal(iconEl?.src, "data:image/png;base64,CCCC");
    assert.equal(iconEl?.alt, "warden");
  }));

test("resolveIcon falls back to glyph when bundle mapping exists but asset is missing", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { affinities: { water: "missing-asset" } } },
      assets: [],
    };
    const iconEl = resolveIcon(bundle, "affinities", "water");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "💧");
  }));

test("resolveIcon falls back to glyph when bundle asset has no dataUri", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { affinities: { earth: "asset-earth" } } },
      assets: [{ id: "asset-earth", dataUri: null }],
    };
    const iconEl = resolveIcon(bundle, "affinities", "earth");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🪨");
  }));

test("resolveIconHTML returns intended expression glyph fallbacks", () => {
  Object.entries(EXPECTED_EXPRESSION_GLYPHS).forEach(([key, glyph]) => {
    assert.equal(resolveIconHTML(null, "expressions", key), glyph, `expression ${key} should map to ${glyph}`);
  });
});

test("resolveIconHTML returns intended motivation glyph fallbacks", () => {
  Object.entries(EXPECTED_MOTIVATION_GLYPHS).forEach(([key, glyph]) => {
    assert.equal(resolveIconHTML(null, "motivations", key), glyph, `motivation ${key} should map to ${glyph}`);
  });
});

test("resolveIconHTML prefers bundle icons for expressions before fallbacks", () => {
  const bundle = {
    mappings: { icons: { expressions: { push: "asset-push" } } },
    assets: [{ id: "asset-push", dataUri: "data:image/png;base64,CCCC" }],
  };

  const html = resolveIconHTML(bundle, "expressions", "push");
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64,CCCC"/);
  assert.match(html, /alt="push"/);
});

test("resolveIconHTML prefers bundle icons for motivations before fallbacks", () => {
  const bundle = {
    mappings: { icons: { motivations: { attacking: "asset-attacking" } } },
    assets: [{ id: "asset-attacking", dataUri: "data:image/png;base64,DDDD" }],
  };

  const html = resolveIconHTML(bundle, "motivations", "attacking");
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64,DDDD"/);
  assert.match(html, /alt="attacking"/);
});

test("resolveIconHTML returns default glyph for unknown type key", () => {
  assert.equal(resolveIconHTML(null, "types", "unknown-type"), "◈");
  assert.notEqual(resolveIconHTML(null, "types", "unknown-type"), "unknown-type", "should not return raw key text");
});

test("resolveIconHTML returns default glyph for unknown expression key", () => {
  assert.equal(resolveIconHTML(null, "expressions", "unknown-expression"), "◈");
  assert.notEqual(resolveIconHTML(null, "expressions", "unknown-expression"), "unknown-expression", "should not return raw key text");
});

test("resolveIconHTML returns default glyph for unknown motivation key", () => {
  assert.equal(resolveIconHTML(null, "motivations", "unknown-motivation"), "◈");
  assert.notEqual(resolveIconHTML(null, "motivations", "unknown-motivation"), "unknown-motivation", "should not return raw key text");
});

test("resolveIconHTML returns default UI glyph for unknown UI key", () => {
  assert.equal(resolveIconHTML(null, "ui", "unknown-surface"), "◈");
  assert.notEqual(resolveIconHTML(null, "ui", "unknown-surface"), "unknown-surface", "should not return raw key text");
});

test("resolveIcon creates fallback span element with appropriate glyph for types", () =>
  withFakeDocument(() => {
    const iconEl = resolveIcon(null, "types", "delver");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "⚔️");
  }));

test("resolveIcon creates fallback span element with appropriate glyph for affinities", () =>
  withFakeDocument(() => {
    const iconEl = resolveIcon(null, "affinities", "fire");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🔥");
  }));

test("resolveIcon creates fallback span element for unknown affinity key without raw text", () =>
  withFakeDocument(() => {
    const iconEl = resolveIcon(null, "affinities", "unknown-affinity");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "◈");
    assert.notEqual(iconEl?.textContent, "unknown-affinity", "should not show raw key text");
  }));

test("resolveIcon creates img element when bundle provides dataUri", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { types: { warden: "asset-warden" } } },
      assets: [{ id: "asset-warden", dataUri: "data:image/png;base64,CCCC" }],
    };
    const iconEl = resolveIcon(bundle, "types", "warden");
    assert.equal(iconEl?.tagName, "IMG");
    assert.equal(iconEl?.className, "icon-from-bundle");
    assert.equal(iconEl?.src, "data:image/png;base64,CCCC");
    assert.equal(iconEl?.alt, "warden");
  }));

test("resolveIcon falls back to glyph when bundle mapping exists but asset is missing", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { affinities: { water: "missing-asset" } } },
      assets: [],
    };
    const iconEl = resolveIcon(bundle, "affinities", "water");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "💧");
  }));

test("resolveIcon falls back to glyph when bundle asset has no dataUri", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { affinities: { earth: "asset-earth" } } },
      assets: [{ id: "asset-earth", dataUri: null }],
    };
    const iconEl = resolveIcon(bundle, "affinities", "earth");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🪨");
  }));

test("resolveIconHTML returns fallback for vitals category with defined keys", () => {
  assert.equal(resolveIconHTML(null, "vitals", "health"), "◦");
  assert.equal(resolveIconHTML(null, "vitals", "mana"), "◦");
  assert.equal(resolveIconHTML(null, "vitals", "stamina"), "◦");
  assert.equal(resolveIconHTML(null, "vitals", "durability"), "◦");
});

test("resolveIconHTML returns default glyph for unknown vitals key", () => {
  assert.equal(resolveIconHTML(null, "vitals", "unknown-vital"), "◈");
  assert.notEqual(resolveIconHTML(null, "vitals", "unknown-vital"), "unknown-vital", "should not return raw key text");
});

test("resolveIconHTML prefers bundle icons for vitals before fallbacks", () => {
  const bundle = {
    mappings: { icons: { vitals: { health: "asset-health" } } },
    assets: [{ id: "asset-health", dataUri: "data:image/png;base64,EEEE" }],
  };

  const html = resolveIconHTML(bundle, "vitals", "health");
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64,EEEE"/);
  assert.match(html, /alt="health"/);
});

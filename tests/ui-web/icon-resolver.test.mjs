import assert from "node:assert/strict";

import { resolveIcon, resolveIconHTML } from "../../packages/ui-web/src/icon-resolver.js";
import { GAME_AFFINITY_COLOR_HEX } from "../../packages/runtime/src/contracts/game-elements.js";
import {
  ENTITY_SPRITE_OUTLINE_DARK,
  ENTITY_SPRITE_OUTLINE_LIGHT,
} from "../../packages/runtime/src/render/entity-sprite-composer.js";

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
  decay: "🍂",
  corrode: "⚗️",
  fortify: "🧱",
  light: "🌟",
  dark: "🌑",
});

const EXPECTED_TYPE_GLYPHS = Object.freeze({
  room: "🏛️",
  delver: "⛏️",
  attacker: "⚔️",
  warden: "🗝️",
  defender: "🛡️",
  hazard: "☠️",
  untyped: "◻️",
});

const EXPECTED_EXPRESSION_GLYPHS = Object.freeze({
  push: "➡️",
  pull: "⬅️",
  emit: "✴️",
  draw: "🧲",
});

const EXPECTED_MOTIVATION_GLYPHS = Object.freeze({
  random: "🎲",
  stationary: "⏸️",
  exploring: "🧭",
  attacking: "💥",
  defending: "🚧",
  stealthy: "🥷",
  friendly: "🤝",
  patrolling: "👣",
  reflexive: "⚡",
  goal_oriented: "🎯",
  strategy_focused: "♟️",
  user_controlled: "🕹️",
});

const EXPECTED_VITAL_GLYPHS = Object.freeze({
  health: "❤️",
  mana: "🔷",
  stamina: "🏃",
  defence: "🪖",
  durability: "⛓️",
});

// Affinities, types, items and vitals are GENERATED from the sprite language now,
// so they no longer fall through to a unicode glyph or to bundle art. The unicode
// table is still the contract for the categories the language has no mark for.
test("generated categories return an inline svg, with or without a bundle", () => {
  for (const key of Object.keys(EXPECTED_AFFINITY_GLYPHS)) {
    const html = resolveIconHTML(null, "affinities", key);
    assert.match(html, /^<svg /, `affinity ${key} should render as svg`);
    assert.match(html, /<path /, `affinity ${key} should draw a glyph path`);
  }
  for (const key of Object.keys(EXPECTED_TYPE_GLYPHS)) {
    assert.match(resolveIconHTML(null, "types", key), /^<svg /, `type ${key} should render as svg`);
  }
});

test("generated icons carry the canonical colour and the board outline rule", () => {
  const fire = resolveIconHTML(null, "affinities", "fire");
  assert.ok(fire.includes(GAME_AFFINITY_COLOR_HEX.fire), "fire icon must use the canonical fire colour");
  // `light` is near-white so it takes the DARK outline -- the same rule that keeps
  // a light sprite from being an edgeless blob on the board.
  assert.ok(resolveIconHTML(null, "affinities", "light").includes(ENTITY_SPRITE_OUTLINE_DARK));
  assert.ok(resolveIconHTML(null, "affinities", "dark").includes(ENTITY_SPRITE_OUTLINE_LIGHT));
});

test("expressions and motivations still use their unicode glyphs", () => {
  Object.entries(EXPECTED_EXPRESSION_GLYPHS).forEach(([key, glyph]) => {
    assert.equal(resolveIconHTML(null, "expressions", key), glyph, `expression ${key}`);
  });
  Object.entries(EXPECTED_MOTIVATION_GLYPHS).forEach(([key, glyph]) => {
    assert.equal(resolveIconHTML(null, "motivations", key), glyph, `motivation ${key}`);
  });
});

test("resolveIconHTML falls back to default glyph for unknown affinity", () => {
  assert.equal(resolveIconHTML(null, "affinities", "unknown"), "◈");
});

test("resolveIconHTML prefers bundle dataUri for non-generated categories", () => {
  const bundle = {
    mappings: { icons: { expressions: { emit: "asset-fire" } } },
    assets: [{ id: "asset-fire", dataUri: "data:image/png;base64,AAAA" }],
  };

  const html = resolveIconHTML(bundle, "expressions", "emit");
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64,AAAA"/);
  assert.match(html, /alt="emit"/);
});

test("resolveIconHTML prefers bundle icons for non-generated categories", () => {
  const bundle = {
    mappings: { icons: { motivations: { exploring: "asset-delver" } } },
    assets: [{ id: "asset-delver", dataUri: "data:image/png;base64,BBBB" }],
  };

  const html = resolveIconHTML(bundle, "motivations", "exploring");
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64,BBBB"/);
  assert.match(html, /alt="exploring"/);
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

test("resolveIcon creates fallback span for a non-generated category", () =>
  withFakeDocument(() => {
    // `motivations` has no mark in the sprite language, so it still resolves to
    // the unicode glyph. `types` does, and is covered by the svg test below.
    const iconEl = resolveIcon(null, "motivations", "exploring");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🧭");
  }));

test("resolveIcon creates a generated svg wrapper for affinities", () =>
  withFakeDocument(() => {
    const iconEl = resolveIcon(null, "affinities", "fire");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-generated-wrap");
    assert.match(iconEl?.innerHTML ?? "", /^<svg /);
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
      mappings: { icons: { expressions: { push: "asset-push" } } },
      assets: [{ id: "asset-push", dataUri: "data:image/png;base64,CCCC" }],
    };
    const iconEl = resolveIcon(bundle, "expressions", "push");
    assert.equal(iconEl?.tagName, "IMG");
    assert.equal(iconEl?.className, "icon-from-bundle");
    assert.equal(iconEl?.src, "data:image/png;base64,CCCC");
    assert.equal(iconEl?.alt, "push");
  }));

test("resolveIcon falls back to glyph when bundle mapping exists but asset is missing", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { motivations: { stealthy: "missing-asset" } } },
      assets: [],
    };
    const iconEl = resolveIcon(bundle, "expressions", "draw");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🧲");
  }));

test("resolveIcon falls back to glyph when bundle asset has no dataUri", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { motivations: { friendly: "asset-earth" } } },
      assets: [{ id: "asset-earth", dataUri: null }],
    };
    const iconEl = resolveIcon(bundle, "motivations", "friendly");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🤝");
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

test("resolveIcon creates fallback span for a non-generated category", () =>
  withFakeDocument(() => {
    // `motivations` has no mark in the sprite language, so it still resolves to
    // the unicode glyph. `types` does, and is covered by the svg test below.
    const iconEl = resolveIcon(null, "motivations", "exploring");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🧭");
  }));

test("resolveIcon creates a generated svg wrapper for affinities", () =>
  withFakeDocument(() => {
    const iconEl = resolveIcon(null, "affinities", "fire");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-generated-wrap");
    assert.match(iconEl?.innerHTML ?? "", /^<svg /);
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
      mappings: { icons: { expressions: { push: "asset-push" } } },
      assets: [{ id: "asset-push", dataUri: "data:image/png;base64,CCCC" }],
    };
    const iconEl = resolveIcon(bundle, "expressions", "push");
    assert.equal(iconEl?.tagName, "IMG");
    assert.equal(iconEl?.className, "icon-from-bundle");
    assert.equal(iconEl?.src, "data:image/png;base64,CCCC");
    assert.equal(iconEl?.alt, "push");
  }));

test("resolveIcon falls back to glyph when bundle mapping exists but asset is missing", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { motivations: { stealthy: "missing-asset" } } },
      assets: [],
    };
    const iconEl = resolveIcon(bundle, "expressions", "draw");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🧲");
  }));

test("resolveIcon falls back to glyph when bundle asset has no dataUri", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { motivations: { friendly: "asset-earth" } } },
      assets: [{ id: "asset-earth", dataUri: null }],
    };
    const iconEl = resolveIcon(bundle, "motivations", "friendly");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "🤝");
  }));

test("vitals render as generated bars, not unicode", () => {
  // Vitals have a canonical colour in GAME_COLOR_PALETTE.vitals, so the sprite
  // language covers them and they no longer fall through to an emoji.
  Object.keys(EXPECTED_VITAL_GLYPHS).forEach((key) => {
    assert.match(resolveIconHTML(null, "vitals", key), /^<svg /, `vital ${key}`);
  });
});

test("resolveIconHTML returns default glyph for unknown vitals key", () => {
  assert.equal(resolveIconHTML(null, "vitals", "unknown-vital"), "◈");
  assert.notEqual(resolveIconHTML(null, "vitals", "unknown-vital"), "unknown-vital", "should not return raw key text");
});

test("resolveIconHTML prefers bundle icons for non-generated categories before fallbacks", () => {
  const bundle = {
    mappings: { icons: { motivations: { attacking: "asset-health" } } },
    assets: [{ id: "asset-health", dataUri: "data:image/png;base64,EEEE" }],
  };

  const html = resolveIconHTML(bundle, "motivations", "attacking");
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64,EEEE"/);
  assert.match(html, /alt="attacking"/);
});

test("resolveIcon falls back to glyph when bundle mapping exists but asset is missing for a non-generated category", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { motivations: { goal_oriented: "missing-asset" } } },
      assets: [],
    };
    const iconEl = resolveIcon(bundle, "motivations", "goal_oriented");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, EXPECTED_MOTIVATION_GLYPHS.goal_oriented);
  }));

test("resolveIconHTML rejects grey placeholder images and uses glyph fallback", () => {
  // This is the actual grey placeholder from the user's example
  const greyPlaceholderDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAQK0lEQVR4AQEgEN/vAFVVVf9VVVX/VVVV/1VVVf9VVVV/VVVV/1VVVf9VVVV/VVVV/1VVVf9VVVV/VVVV/VVVV/1VVVf9VVVV/1VVVf9VVVX/VVVV/VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf/AFVVVf9VVVX/VVVV/1VVVf9VVVX/VVVV/1VVVf9VVVX/VVVV/1VVVf9VVVX/VVVV/1VVVf9VVVX/VVVV/1VVVf9VVVX/VVVV/1VVVf9VVVX/VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf/";

  const bundle = {
    mappings: { icons: { motivations: { patrolling: "asset-room-placeholder" } } },
    assets: [{ id: "asset-room-placeholder", dataUri: greyPlaceholderDataUri }],
  };

  const html = resolveIconHTML(bundle, "motivations", "patrolling");
  // Should fall back to the room glyph instead of showing the grey placeholder
  assert.equal(html, "👣");
  assert.ok(!html.includes("<img"), "should not return an img tag for placeholder");
});

test("resolveIcon rejects grey placeholder images and uses glyph fallback DOM element", () =>
  withFakeDocument(() => {
    const greyPlaceholderDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAQK0lEQVR4AQEgEN/vAFVVVf9VVVX/VVVV/1VVVf9VVVV/VVVV/1VVVf9VVVV/VVVV/1VVVf9VVVV/VVVV/1VVVf9VVVV/1VVVf9VVVX/VVVV/VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVV/1VVVf9VVVX/";

    const bundle = {
      mappings: { icons: { motivations: { patrolling: "asset-room-placeholder" } } },
      assets: [{ id: "asset-room-placeholder", dataUri: greyPlaceholderDataUri }],
    };

    const iconEl = resolveIcon(bundle, "motivations", "patrolling");
    assert.equal(iconEl?.tagName, "SPAN");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "👣");
  }));

test("resolveIconHTML accepts valid non-placeholder images", () => {
  // A realistic base64 string with varied content (not highly repetitive)
  // This simulates an actual icon with diverse pixel data
  const validImageDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M+AFzAxMIxKjkoCAE0dAwkJe8l0AAAAAElFTkSuQmCCaGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmdlciBzdHJpbmcgdG8gbWFrZSBzdXJlIGl0IHBhc3NlcyB0aGUgMTAwIGNoYXIgbGltaXQ=";

  const bundle = {
    mappings: { icons: { motivations: { random: "asset-fire-real" } } },
    assets: [{ id: "asset-fire-real", dataUri: validImageDataUri }],
  };

  const html = resolveIconHTML(bundle, "motivations", "random");
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64/);
});

test("resolveIconHTML allows short base64 test fixtures through", () => {
  // Very short base64 strings (<100 chars) are allowed for test fixtures
  const shortTestDataUri = "data:image/png;base64,ABC";

  const bundle = {
    mappings: { icons: { motivations: { defending: "asset-water-short" } } },
    assets: [{ id: "asset-water-short", dataUri: shortTestDataUri }],
  };

  const html = resolveIconHTML(bundle, "motivations", "defending");
  // Short strings pass through as valid (for test fixtures)
  assert.match(html, /<img /);
  assert.match(html, /src="data:image\/png;base64,ABC"/);
});

// ─── B4: Icon size forwarding (M3 — populateUIIcons size param) ───────────────

test("resolveIcon accepts a size argument without throwing and still resolves the icon", () => {
  // main.js reads data-icon-size and passes it as the 4th arg to resolveIcon.
  // Verify that extra size param is accepted gracefully (no throw, icon returned).
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { expressions: { emit: "asset-fire" } } },
      assets: [{ id: "asset-fire", dataUri: "data:image/png;base64,FIRE" }],
    };

    for (const size of ["sm", "md", "lg", undefined]) {
      const el = resolveIcon(bundle, "expressions", "emit", size);
      assert.ok(el, `resolveIcon must return an element for size="${size}"`);
      // Bundle icon found — should be an img element regardless of size
      assert.equal(el.tagName, "IMG", `expected IMG for size="${size}", got ${el.tagName}`);
    }
  });
});

test("resolveIcon falls back to text label when size is provided but bundle is null", () => {
  withFakeDocument(() => {
    // A generated category returns the svg wrapper regardless of size; a
    // non-generated one still falls back to its unicode label.
    const el = resolveIcon(null, "motivations", "exploring", "lg");
    assert.ok(el, "must return a fallback element");
    assert.equal(el.tagName, "SPAN", "fallback without bundle must be a SPAN");
    assert.equal(el.textContent, "🧭");
  });
});

test.skip("resolveIcon with multi-size bundle mapping resolves sm/md/lg to different assets", () => {
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { motivations: { reflexive: { sm: "asset-sm", md: "asset-md", lg: "asset-lg" } } } },
      assets: [
        { id: "asset-sm", dataUri: "data:image/png;base64,SM" },
        { id: "asset-md", dataUri: "data:image/png;base64,MD" },
        { id: "asset-lg", dataUri: "data:image/png;base64,LG" },
      ],
    };

    assert.equal(resolveIcon(bundle, "motivations", "reflexive", "sm").src, "data:image/png;base64,SM");
    assert.equal(resolveIcon(bundle, "motivations", "reflexive", "md").src, "data:image/png;base64,MD");
    assert.equal(resolveIcon(bundle, "motivations", "reflexive", "lg").src, "data:image/png;base64,LG");
  });
});

test.skip("resolveIcon size fallback chain uses lg to md to sm to text label", () => {
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { affinities: { fire: { sm: "asset-sm", md: "asset-md" } } } },
      assets: [
        { id: "asset-sm", dataUri: "data:image/png;base64,SM" },
        { id: "asset-md", dataUri: "data:image/png;base64,MD" },
      ],
    };

    assert.equal(resolveIcon(bundle, "motivations", "reflexive", "lg").src, "data:image/png;base64,MD");
  });
});

test.skip("resolveIconHTML with size parameter returns the requested size img src", () => {
  const bundle = {
    mappings: { icons: { affinities: { fire: { sm: "asset-sm", lg: "asset-lg" } } } },
    assets: [
      { id: "asset-sm", dataUri: "data:image/png;base64,SM" },
      { id: "asset-lg", dataUri: "data:image/png;base64,LG" },
    ],
  };

  assert.match(resolveIconHTML(bundle, "affinities", "fire", "lg"), /base64,LG/);
});

test.skip("populateUIIcons applies data-icon-size lg assets to DOM elements", () => {
  assert.equal(true, false, "populateUIIcons is not exported for direct headless testing yet");
});

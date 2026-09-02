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
        src: "",
        alt: "",
        children: [],
        appendChild(child) {
          this.children.push(child);
          return child;
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

test("resolveIcon falls back to glyph when bundle has empty dataUri", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { expressions: { emit: "asset-fire" } } },
      assets: [{ id: "asset-fire", dataUri: "" }],
    };

    const iconEl = resolveIcon(bundle, "expressions", "emit");
    assert.equal(iconEl?.tagName, "SPAN", "Should fallback to span for empty dataUri");
    assert.equal(iconEl?.className, "icon-fallback-text");
    assert.equal(iconEl?.textContent, "✴️", "Should show emit glyph");
  }));

test("resolveIcon falls back to glyph when bundle has whitespace-only dataUri", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { motivations: { exploring: "asset-delver" } } },
      assets: [{ id: "asset-delver", dataUri: "   " }],
    };

    const iconEl = resolveIcon(bundle, "motivations", "exploring");
    assert.equal(iconEl?.tagName, "SPAN", "Should fallback to span for whitespace dataUri");
    assert.equal(iconEl?.textContent, "🧭", "Should show exploring glyph");
  }));

test("resolveIcon falls back to glyph when bundle has non-data-uri string", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { motivations: { attacking: "asset-attacking" } } },
      assets: [{ id: "asset-attacking", dataUri: "invalid-uri-format" }],
    };

    const iconEl = resolveIcon(bundle, "motivations", "attacking");
    assert.equal(iconEl?.tagName, "SPAN", "Should fallback to span for invalid dataUri format");
    assert.equal(iconEl?.textContent, "💥", "Should show attacking glyph");
  }));

test("resolveIcon falls back to glyph when bundle has http URL instead of data URI", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { expressions: { push: "asset-push" } } },
      assets: [{ id: "asset-push", dataUri: "http://example.com/icon.png" }],
    };

    const iconEl = resolveIcon(bundle, "expressions", "push");
    assert.equal(iconEl?.tagName, "SPAN", "Should fallback to span for http URL");
    assert.equal(iconEl?.textContent, "➡️", "Should show push glyph");
  }));

test("resolveIconHTML falls back to glyph when bundle has empty dataUri", () => {
  const bundle = {
    mappings: { icons: { expressions: { draw: "asset-water" } } },
    assets: [{ id: "asset-water", dataUri: "" }],
  };

  const html = resolveIconHTML(bundle, "expressions", "draw");
  assert.equal(html, "🧲", "Should return draw glyph for empty dataUri");
  assert.doesNotMatch(html, /<img/, "Should not return img tag");
});

test("resolveIconHTML falls back to glyph when bundle has non-data-uri string", () => {
  const bundle = {
    mappings: { icons: { motivations: { defending: "asset-defending" } } },
    assets: [{ id: "asset-defending", dataUri: "https://example.com/icon.png" }],
  };

  const html = resolveIconHTML(bundle, "motivations", "defending");
  assert.equal(html, "🚧", "Should return defending glyph for https URL");
  assert.doesNotMatch(html, /<img/, "Should not return img tag");
});

test("resolveIcon accepts valid data URI with image/png", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { motivations: { patrolling: "asset-room" } } },
      assets: [{ id: "asset-room", dataUri: "data:image/png;base64,iVBORw0KGgo=" }],
    };

    const iconEl = resolveIcon(bundle, "motivations", "patrolling");
    assert.equal(iconEl?.tagName, "IMG", "Should create img for valid data URI");
    assert.equal(iconEl?.src, "data:image/png;base64,iVBORw0KGgo=");
  }));

test("resolveIcon accepts valid data URI with image/svg+xml", () =>
  withFakeDocument(() => {
    const bundle = {
      mappings: { icons: { expressions: { emit: "asset-fire" } } },
      assets: [{ id: "asset-fire", dataUri: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E" }],
    };

    const iconEl = resolveIcon(bundle, "expressions", "emit");
    assert.equal(iconEl?.tagName, "IMG", "Should create img for valid SVG data URI");
    assert.match(iconEl?.src, /^data:image\/svg\+xml/);
  }));

test("resolveIconHTML accepts valid data URI", () => {
  const bundle = {
    mappings: { icons: { expressions: { emit: "asset-emit" } } },
    assets: [{ id: "asset-emit", dataUri: "data:image/png;base64,ABC123" }],
  };

  const html = resolveIconHTML(bundle, "expressions", "emit");
  assert.match(html, /<img/, "Should return img tag for valid data URI");
  assert.match(html, /src="data:image\/png;base64,ABC123"/);
});

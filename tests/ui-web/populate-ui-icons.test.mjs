import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveIcon } from "../../packages/ui-web/src/icon-resolver.js";

// Fake DOM implementation for testing
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.textContent = "";
    this.children = [];
    this.firstChild = null;
    this.className = "";
    this.src = "";
    this.alt = "";
    this.style = {};
  }

  appendChild(child) {
    this.children.push(child);
    if (!this.firstChild) this.firstChild = child;
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    if (this.firstChild === child) {
      this.firstChild = this.children[0] || null;
    }
  }
}

class FakeDocument {
  constructor() {
    this.elements = [];
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  querySelectorAll(selector) {
    if (selector === "[data-icon-category][data-icon-key]") {
      return this.elements;
    }
    return [];
  }
}

function withFakeDOM(run) {
  const originalDocument = global.document;
  const fakeDocument = new FakeDocument();
  global.document = fakeDocument;
  try {
    return run(fakeDocument);
  } finally {
    global.document = originalDocument;
  }
}

function createMockBundle() {
  return {
    mappings: {
      icons: {
        types: {
          room: "asset-room",
          delver: "asset-delver",
          warden: "asset-warden",
        },
        ui: {
          "game-inspector": "asset-game-inspector",
        },
      },
    },
    assets: [
      { id: "asset-room", dataUri: "data:image/png;base64,ROOM" },
      { id: "asset-delver", dataUri: "data:image/png;base64,DELVER" },
      { id: "asset-warden", dataUri: "data:image/png;base64,WARDEN" },
      { id: "asset-game-inspector", dataUri: "data:image/png;base64,INSPECTOR" },
    ],
  };
}

// Simulate the populateUIIcons function from main.js
function populateUIIcons(resourceBundle) {
  const iconElements = document.querySelectorAll("[data-icon-category][data-icon-key]");
  iconElements.forEach((el) => {
    const category = el.dataset.iconCategory;
    const key = el.dataset.iconKey;
    if (!category || !key) return;

    // Clear existing content
    el.textContent = "";
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }

    // Resolve and append icon
    const iconEl = resolveIcon(resourceBundle, category, key);
    if (iconEl) {
      el.appendChild(iconEl);
    }
  });
}

test("populateUIIcons replaces static icon placeholders with bundle images", () =>
  withFakeDOM((doc) => {
    // Create fake HTML elements like those in index.html
    const roomIcon = new FakeElement("h3");
    roomIcon.dataset.iconCategory = "types";
    roomIcon.dataset.iconKey = "room";

    const delverIcon = new FakeElement("h3");
    delverIcon.dataset.iconCategory = "types";
    delverIcon.dataset.iconKey = "delver";

    const wardenIcon = new FakeElement("h3");
    wardenIcon.dataset.iconCategory = "types";
    wardenIcon.dataset.iconKey = "warden";

    const inspectorIcon = new FakeElement("span");
    inspectorIcon.dataset.iconCategory = "ui";
    inspectorIcon.dataset.iconKey = "game-inspector";

    doc.elements = [roomIcon, delverIcon, wardenIcon, inspectorIcon];

    const bundle = createMockBundle();
    populateUIIcons(bundle);

    // Check that room icon was replaced with bundle image
    assert.equal(roomIcon.children.length, 1, "Room icon should have one child");
    assert.equal(roomIcon.children[0].tagName, "IMG", "Room icon should be an img element");
    assert.equal(roomIcon.children[0].className, "icon-from-bundle", "Should have bundle icon class");
    assert.match(roomIcon.children[0].src, /ROOM/, "Should use room asset");

    // Check delver icon
    assert.equal(delverIcon.children.length, 1, "Delver icon should have one child");
    assert.equal(delverIcon.children[0].tagName, "IMG", "Delver icon should be an img element");
    assert.match(delverIcon.children[0].src, /DELVER/, "Should use delver asset");

    // Check warden icon
    assert.equal(wardenIcon.children.length, 1, "Warden icon should have one child");
    assert.equal(wardenIcon.children[0].tagName, "IMG", "Warden icon should be an img element");
    assert.match(wardenIcon.children[0].src, /WARDEN/, "Should use warden asset");

    // Check UI icon
    assert.equal(inspectorIcon.children.length, 1, "Inspector icon should have one child");
    assert.equal(inspectorIcon.children[0].tagName, "IMG", "Inspector icon should be an img element");
    assert.match(inspectorIcon.children[0].src, /INSPECTOR/, "Should use inspector asset");
  }));

test("populateUIIcons falls back to glyphs when bundle is missing", () =>
  withFakeDOM((doc) => {
    const roomIcon = new FakeElement("h3");
    roomIcon.dataset.iconCategory = "types";
    roomIcon.dataset.iconKey = "room";

    const delverIcon = new FakeElement("h3");
    delverIcon.dataset.iconCategory = "types";
    delverIcon.dataset.iconKey = "delver";

    const wardenIcon = new FakeElement("h3");
    wardenIcon.dataset.iconCategory = "types";
    wardenIcon.dataset.iconKey = "warden";

    doc.elements = [roomIcon, delverIcon, wardenIcon];

    // No bundle
    populateUIIcons(null);

    // Check that icons fall back to glyphs
    assert.equal(roomIcon.children.length, 1, "Room icon should have one child");
    assert.equal(roomIcon.children[0].tagName, "SPAN", "Should be a span for glyph fallback");
    assert.equal(roomIcon.children[0].className, "icon-fallback-text", "Should have fallback class");
    assert.equal(roomIcon.children[0].textContent, "🏛️", "Should show room glyph");

    assert.equal(delverIcon.children[0].textContent, "⚔️", "Should show delver glyph");
    assert.equal(wardenIcon.children[0].textContent, "🛡️", "Should show warden glyph");
  }));

test("populateUIIcons clears existing content before adding new icon", () =>
  withFakeDOM((doc) => {
    const iconEl = new FakeElement("h3");
    iconEl.dataset.iconCategory = "types";
    iconEl.dataset.iconKey = "room";

    // Add some existing content
    iconEl.textContent = "OLD TEXT";
    const oldChild = new FakeElement("span");
    oldChild.textContent = "OLD CHILD";
    iconEl.appendChild(oldChild);

    doc.elements = [iconEl];

    const bundle = createMockBundle();
    populateUIIcons(bundle);

    // Check that old content was cleared
    assert.equal(iconEl.textContent, "", "textContent should be cleared");
    assert.equal(iconEl.children.length, 1, "Should have exactly one child (the new icon)");
    assert.equal(iconEl.children[0].tagName, "IMG", "New child should be the bundle image");
    assert.notEqual(iconEl.children[0].textContent, "OLD CHILD", "Old child should be removed");
  }));

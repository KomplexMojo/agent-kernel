import assert from "node:assert/strict";
import { test } from "vitest";
import { buildPropertyCatalog } from "../../packages/ui-web/src/card-builder-controller.js";
// M4 target module — does not exist yet. These tests are the implementation contract.
import { createPhaserFrameView } from "../../packages/ui-web/src/views/phaser-frame-view.js";

function makeNode(tagName = "div") {
  const handlers = {};
  return {
    tagName: String(tagName).toUpperCase(),
    id: "",
    dataset: {},
    children: [],
    style: {},
    hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    set textContent(v) {
      this._text = String(v ?? "");
      this.children = [];
    },
    get textContent() {
      return this._text || "";
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...parts) {
      parts.forEach((p) => p && this.appendChild(p));
    },
    addEventListener(event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        (node.children || []).forEach((c) => {
          if (sel.startsWith("[data-") ) {
            const m = sel.match(/^\[data-([a-z-]+)\]$/);
            if (m) {
              const key = m[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
              if (c.dataset && c.dataset[key] !== undefined) out.push(c);
            }
          } else if (sel.startsWith("#") && c.id === sel.slice(1)) {
            out.push(c);
          }
          walk(c);
        });
      };
      walk(this);
      return out;
    },
  };
}

function createFrameRoot() {
  const mount = makeNode("div");
  mount.id = "phaser-frame-root";
  const root = {
    createElement: (tag) => makeNode(tag),
    querySelector: (sel) => (sel === "#phaser-frame-root" ? mount : null),
  };
  return { root, mount };
}

test("frame view mounts a single Phaser frame hosting both surfaces", () => {
  const { root, mount } = createFrameRoot();
  const frame = createPhaserFrameView({ root, loadPhaser: async () => ({}) });
  assert.doesNotThrow(() => frame.mount());

  const cardSurface = mount.querySelector("[data-card-builder-surface]");
  const gameplaySurface = mount.querySelector("[data-gameplay-surface]");
  assert.ok(cardSurface, "card builder surface host must be mounted");
  assert.ok(gameplaySurface, "gameplay surface host must be mounted");
  frame.dispose?.();
});

test("frame view exposes both surface handles without adding game mechanics", () => {
  const { root } = createFrameRoot();
  const frame = createPhaserFrameView({ root, loadPhaser: async () => ({}) });
  frame.mount();

  assert.ok(frame.getCardBuilderSurface(), "card builder surface handle must be exposed");
  assert.ok(frame.getGameplaySurface(), "gameplay surface handle must be exposed");
  // The frame is a shell — it must not expose simulation/tick controls of its own.
  assert.equal(typeof frame.step, "undefined");
  assert.equal(typeof frame.tick, "undefined");
  frame.dispose?.();
});

test("frame view keeps the gameplay bundle load entry point working", async () => {
  const { root } = createFrameRoot();
  const loaded = [];
  const frame = createPhaserFrameView({
    root,
    loadPhaser: async () => ({}),
    onLoadGameplayBundle: (bundle) => {
      loaded.push(bundle);
      return true;
    },
  });
  frame.mount();

  const bundle = { schema: "agent-kernel/GameplayBundle", artifacts: [], tickFrames: [] };
  const result = await frame.loadGameplayBundle(bundle);
  assert.equal(result, true);
  assert.equal(loaded.length, 1);
  frame.dispose?.();
});

// ## TODO: Test Permutations
test("mount called twice does not duplicate surface hosts", () => {
  const { root, mount } = createFrameRoot();
  const frame = createPhaserFrameView({ root, loadPhaser: async () => ({}) });

  assert.deepEqual(frame.mount(), { ok: true });
  assert.deepEqual(frame.mount(), { ok: true });

  assert.equal(mount.querySelectorAll("[data-card-builder-surface]").length, 1);
  assert.equal(mount.querySelectorAll("[data-gameplay-surface]").length, 1);
  frame.dispose?.();
});

test("dispose after mount removes both surface hosts and is idempotent", () => {
  const { root, mount } = createFrameRoot();
  const frame = createPhaserFrameView({ root, loadPhaser: async () => ({}) });
  frame.mount();

  assert.doesNotThrow(() => frame.dispose());
  assert.equal(mount.children.length, 0);
  assert.doesNotThrow(() => frame.dispose());
  assert.equal(mount.children.length, 0);
});

test("frame view with no gameplay bundle handler returns false without throwing", async () => {
  const { root } = createFrameRoot();
  const frame = createPhaserFrameView({ root, loadPhaser: async () => ({}) });
  frame.mount();

  const result = await frame.loadGameplayBundle({ schema: "agent-kernel/GameplayBundle", artifacts: [], tickFrames: [] });

  assert.equal(result, false);
  frame.dispose?.();
});

test("getCardBuilderSurface returns a stable handle across calls", () => {
  const { root } = createFrameRoot();
  const frame = createPhaserFrameView({ root, loadPhaser: async () => ({}) });
  frame.mount();

  assert.equal(frame.getCardBuilderSurface(), frame.getCardBuilderSurface());
  assert.equal(frame.getGameplaySurface(), frame.getGameplaySurface());
  frame.dispose?.();
});

test("frame view surfaces a card-builder controller with the shared property catalog", () => {
  const { root } = createFrameRoot();
  const frame = createPhaserFrameView({ root, loadPhaser: async () => ({}) });
  frame.mount();

  const controller = frame.getCardBuilderSurface().getController();
  assert.deepEqual(controller.getCatalog(), buildPropertyCatalog());
  frame.dispose?.();
});

test.skip("loadGameplayBundle rejects a payload missing artifacts without throwing", async () => {
  const { root } = createFrameRoot();
  const frame = createPhaserFrameView({
    root,
    loadPhaser: async () => ({}),
    onLoadGameplayBundle: () => true,
  });
  frame.mount();

  const result = await frame.loadGameplayBundle({ schema: "agent-kernel/GameplayBundle", tickFrames: [] });

  assert.equal(result, false);
  frame.dispose?.();
});

test("mounting without a #phaser-frame-root element returns a failure result", () => {
  const root = { createElement: (tag) => makeNode(tag), querySelector: () => null };
  const frame = createPhaserFrameView({ root, loadPhaser: async () => ({}) });

  assert.deepEqual(frame.mount(), { ok: false, reason: "missing_frame_root" });
});

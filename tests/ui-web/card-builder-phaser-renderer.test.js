import assert from "node:assert/strict";
import { test } from "vitest";
import { createCardBuilderController } from "../../packages/ui-web/src/card-builder-controller.js";
import { buildDefaultPriceList } from "../../packages/runtime/src/personas/allocator/default-price-list.js";
// M5 target module — does not exist yet. These tests are the implementation contract.
import {
  createCardBuilderPhaserRenderer,
  CARD_BUILDER_UI_INTENTS,
} from "../../packages/ui-web/src/views/card-builder-phaser-renderer.js";

const defaultPriceList = buildDefaultPriceList({ createdAt: "2026-07-20T00:00:00.000Z" });

function createFakePhaser(records = {}) {
  records.rectangles = [];
  records.texts = [];
  records.containers = [];
  records.images = [];
  records.inputHandlers = {};
  function node(type, props = {}) {
    return {
      type,
      ...props,
      setOrigin() { return this; },
      // Real Phaser game objects have these; the double was missing them, so a
      // renderer that measures a label and then places it failed only in tests.
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setStrokeStyle(...args) { this.stroke = args; return this; },
      setFillStyle(...args) { this.fill = args; return this; },
      setColor(color) { this.color = color; return this; },
      setStyle(style) { this.style = { ...(this.style || {}), ...style }; return this; },
      setDepth() { return this; },
      setData(k, v) { (this.data = this.data || {})[k] = v; return this; },
      setName(n) { this.name = n; return this; },
      setInteractive() { this.interactive = true; return this; },
      on(event, handler) { (this.handlers = this.handlers || {})[event] = handler; return this; },
      setVisible() { return this; },
      // Record it: a stub that swallowed the value made every "is this visible?"
      // assertion pass vacuously.
      setAlpha(a) { this.alpha = a; return this; },
      setTint() { return this; },
      destroy() { this.destroyed = true; },
    };
  }
  class Game {
    constructor(config) {
      records.config = config;
      this.canvas = { style: {} };
      this.scale = { resize() {} };
      const scene = {
        add: {
          container(x, y) {
            const c = node("container", { x, y, list: [], add(child) { this.list.push(child); return child; } });
            records.containers.push(c);
            return c;
          },
          rectangle(x, y, w, h, color, alpha) {
            const r = node("rectangle", { x, y, width: w, height: h, color, alpha });
            records.rectangles.push(r);
            return r;
          },
          zone(x, y, w, h) {
            const z = node("zone", { x, y, width: w, height: h });
            records.rectangles.push(z);
            return z;
          },
          text(x, y, text, style) {
            const t = node("text", { x, y, text, style });
            records.texts.push(t);
            return t;
          },
          image(x, y, key) {
            const i = node("image", { x, y, textureKey: key });
            records.images.push(i);
            return i;
          },
          graphics() {
            return {
              fillStyle() { return this; },
              fillRect() { return this; },
              fillRoundedRect() { return this; },
              fillTriangle() { return this; },
              fillCircle() { return this; },
              strokeRoundedRect() { return this; },
              lineStyle() { return this; },
              beginPath() { return this; },
              moveTo() { return this; },
              lineTo() { return this; },
              strokePath() { return this; },
              strokeRect() { return this; },
              // Room cards draw closed shapes for their floor plans.
              fillPath() { return this; },
              closePath() { return this; },
              // Reached once a TYPED card renders its affinity blocks -- no test
              // exercised that path before, so the stub was missing these.
              strokeCircle() { return this; },
              strokeTriangle() { return this; },
              arc() { return this; },
              closePath() { return this; },
              setScrollFactor() { return this; },
              setDepth() { return this; },
              setAlpha() { return this; },
              clear() { return this; },
              destroy() {},
            };
          },
        },
        cameras: { main: { width: config.width, height: config.height, setBackgroundColor() {} } },
        input: { on(event, handler) { records.inputHandlers[event] = handler; }, keyboard: { on() {} } },
        textures: { exists: () => false, addBase64() {}, addImage() {} },
        events: { on() {} },
      };
      records.scene = scene;
      config.scene.create?.call(scene);
    }
    destroy() { records.destroyed = true; }
  }
  return { AUTO: "AUTO", Scale: { NONE: "NONE" }, Game };
}

function makeContainer() {
  let stage = null;
  return {
    clientWidth: 600,
    clientHeight: 400,
    querySelector(sel) {
      return sel === "[data-card-builder-phaser-stage]" ? stage : null;
    },
    appendChild(child) {
      stage = child;
      child.parentElement = this;
    },
    get stage() {
      return stage;
    },
  };
}

test("renderer mounts and renders catalog chips from controller state", async () => {
  const records = {};
  const controller = createCardBuilderController();
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const renderedText = records.texts.map((t) => String(t.text).toLowerCase()).join(" ");
  // Catalog type options include the existing card types.
  assert.match(renderedText, /room/);
  assert.match(renderedText, /delver/);
  assert.match(renderedText, /warden/);
  renderer.dispose();
});

test("renderer renders budget, receipt, and status displays from controller state", async () => {
  const records = {};
  const controller = createCardBuilderController();
  controller.setCards([]);
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  // The renderer surfaces controller-derived budget/status panels.
  assert.equal(typeof renderer.getRenderedSnapshot, "function");
  const snapshot = renderer.getRenderedSnapshot();
  assert.ok("budgetTokens" in snapshot);
  assert.ok("status" in snapshot);
  renderer.dispose();
});

test("dropping a chip maps to the existing { group, value, affinityKind? } payload and applies via controller", async () => {
  const records = {};
  const controller = createCardBuilderController();
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const activeId = controller.getActiveCard().id;
  const result = renderer.emitIntent({
    kind: "drop_chip",
    cardId: activeId,
    property: { group: "type", value: "delver" },
  });
  assert.equal(result.ok, true);
  assert.equal(controller.getActiveCard().type, "delver");
  renderer.dispose();
});

test("invalid drop rejects without mutating cards and surfaces a status message", async () => {
  const records = {};
  const controller = createCardBuilderController();
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const blank = controller.getActiveCard();
  renderer.emitIntent({
    kind: "drop_chip",
    cardId: blank.id,
    property: { group: "affinities", value: "fire" },
  });
  // Untyped card → affinity drop blocked by existing validation path; card unchanged.
  assert.equal(controller.getActiveCard().type, "");
  assert.deepEqual(controller.getActiveCard().affinities, blank.affinities);
  assert.equal(controller.getStatus().level, "error");
  renderer.dispose();
});

test("renderer emits only allowed UI intent kinds", async () => {
  const records = {};
  const controller = createCardBuilderController();
  const emitted = [];
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
    onIntent: (intent) => emitted.push(intent),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const allowed = new Set(CARD_BUILDER_UI_INTENTS);
  assert.ok(allowed.has("drag_chip"));
  assert.ok(allowed.has("drop_chip"));
  assert.ok(allowed.has("select_card"));
  assert.ok(allowed.has("move_card_between_groups"));
  // No simulation/gameplay command kinds in the allowed set.
  assert.ok(!allowed.has("run"));
  assert.ok(!allowed.has("tick"));
  assert.ok(!allowed.has("apply_attack"));

  renderer.emitIntent({ kind: "drop_chip", cardId: controller.getActiveCard().id, property: { group: "type", value: "room" } });
  emitted.forEach((intent) => {
    assert.ok(allowed.has(intent.kind), `emitted intent ${intent.kind} must be in the allowed set`);
  });
  renderer.dispose();
});

test("drop_chip with an unknown catalog value leaves the card unchanged and reports status", async () => {
  const records = {};
  const controller = createCardBuilderController();
  controller.applyPropertyDrop(controller.getActiveCard().id, { group: "type", value: "delver" });
  const before = controller.getActiveCard();
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const result = renderer.emitIntent({
    kind: "drop_chip",
    cardId: before.id,
    property: { group: "affinities", value: "plasma" },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(controller.getActiveCard().affinities, before.affinities);
  assert.equal(controller.getStatus().level, "error");
  assert.match(controller.getStatus().message, /invalid_affinity/i);
  renderer.dispose();
});

test("drop_chip carrying affinityKind targets the selected affinity on a multi-affinity card", async () => {
  const records = {};
  const controller = createCardBuilderController();
  controller.applyPropertyDrop(controller.getActiveCard().id, { group: "type", value: "delver" });
  controller.applyPropertyDrop(controller.getActiveCard().id, { group: "affinities", value: "water" });
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const result = renderer.emitIntent({
    kind: "drop_chip",
    cardId: controller.getActiveCard().id,
    property: { group: "expressions", value: "draw", affinityKind: "water" },
  });

  assert.equal(result.ok, true);
  assert.ok(controller.getActiveCard().affinities.some((entry) => entry.kind === "water" && entry.expression === "draw"));
  renderer.dispose();
});

test("select_card intent updates the active card to the chosen shelved card", async () => {
  const records = {};
  const controller = createCardBuilderController();
  controller.setCards([
    { id: "select_room", type: "room", roomSize: "small", affinity: "fire" },
    { id: "select_atk", type: "delver", affinity: "light", motivations: ["attacking"] },
  ]);
  const chosen = controller.getCards().find((card) => card.type === "delver");
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const result = renderer.emitIntent({ kind: "select_card", cardId: chosen.id });

  assert.equal(result.ok, true);
  assert.equal(controller.getActiveCard().type, "delver");
  assert.equal(controller.getActiveCard().id, chosen.id);
  renderer.dispose();
});

test("move_card_between_groups intent stashes the active card to the target group", async () => {
  const records = {};
  const controller = createCardBuilderController();
  controller.applyPropertyDrop(controller.getActiveCard().id, { group: "type", value: "delver" });
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const result = renderer.emitIntent({ kind: "move_card_between_groups", group: "delver" });

  assert.equal(result.ok, true);
  assert.equal(controller.getCards().length, 1);
  assert.equal(controller.getCards()[0].type, "delver");
  assert.equal(controller.getActiveCard().type, "");
  renderer.dispose();
});

test("render after a count adjustment reflects the new receipt totals in the snapshot", async () => {
  const records = {};
  const controller = createCardBuilderController({ llmConfig: { priceList: defaultPriceList } });
  controller.applyPropertyDrop(controller.getActiveCard().id, { group: "type", value: "delver" });
  const beforeTotal = controller.getActiveCard().tokenReceipt.tokenTotals.total;
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());

  controller.adjustCardCount(controller.getActiveCard().id, 1);
  await renderer.render();

  const snapshot = renderer.getRenderedSnapshot();
  assert.ok(snapshot.activeReceipt.tokenTotals.total > beforeTotal);
  renderer.dispose();
});

test("emitIntent with an unsupported kind is rejected without mutating controller state", async () => {
  const records = {};
  const emitted = [];
  const controller = createCardBuilderController();
  const before = controller.getActiveCard();
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
    onIntent: (intent) => emitted.push(intent),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const result = renderer.emitIntent({ kind: "run", cardId: before.id });

  assert.deepEqual(result, { ok: false, reason: "unsupported_intent" });
  assert.deepEqual(emitted, []);
  assert.deepEqual(controller.getActiveCard(), before);
  renderer.dispose();
});

test("render with an empty card set shows the blank-editor budget panel", async () => {
  const records = {};
  const controller = createCardBuilderController();
  controller.setCards([]);
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  const snapshot = renderer.getRenderedSnapshot();
  assert.equal(snapshot.cardCount, 0);
  assert.equal(snapshot.budgetTokens, 2500);
  assert.ok(snapshot.activeReceipt);
  renderer.dispose();
});

test("dispose before render does not throw", () => {
  const controller = createCardBuilderController();
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser({}),
  });

  assert.doesNotThrow(() => renderer.dispose());
});

test.skip("render is idempotent and does not duplicate catalog chips", async () => {
  const records = {};
  const controller = createCardBuilderController();
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());

  await renderer.render();
  const firstRenderTextCount = records.texts.length;
  await renderer.render();

  assert.equal(records.texts.length, firstRenderTextCount);
  renderer.dispose();
});

test("no icon markup is ever drawn as canvas text", async () => {
  // Reported twice from the running app: an icon string reaching a text draw
  // renders the raw <svg …> source on screen. It happened first in the property
  // rail and then again on the card face, where the fallback drew it at 40px.
  //
  // This forbids the CAPABILITY rather than the two sites that had it: any text
  // object whose content looks like markup fails, wherever it came from.
  //
  // A card must be TYPED for the card face to draw at all, and headless runs have
  // no Image constructor so icon textures never rasterise -- which is precisely
  // the state that exercises the fallback. Rendering an untyped card skips the
  // path entirely and the guard passes vacuously.
  const records = {};
  const controller = createCardBuilderController();
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();

  renderer.emitIntent({
    kind: "drop_chip",
    cardId: controller.getActiveCard().id,
    property: { group: "type", value: "warden" },
  });
  assert.equal(controller.getActiveCard().type, "warden", "precondition: card must be typed");
  await renderer.render();

  const offenders = records.texts
    .map((t) => String(t.text ?? ""))
    .filter((text) => /<svg|<img|<circle|<path|viewBox=/.test(text));
  assert.deepEqual(
    offenders,
    [],
    `icon markup drawn as text: ${offenders.map((o) => o.slice(0, 70)).join(" | ")}`,
  );
  renderer.dispose();
});

// ---------------------------------------------------------------------------
// The shelve button.
//
// It used to be an unlabelled 22px square at the end of the editor's content
// flow, so it moved with the card: a delver carrying two motivation rows put it
// 32px below where a warden with one row did. A control that lands somewhere
// different per card cannot be aimed at from memory, and with its label hidden
// until hover there was nothing to aim at either. Now it is pinned to the
// editor's top-right corner and always carries its label.
// ---------------------------------------------------------------------------

/** Configure a card of `type` with `motivations` applied, then render. */
async function renderCardWithMotivations(records, type, motivations) {
  const controller = createCardBuilderController();
  const id = controller.getActiveCard().id;
  controller.applyPropertyDrop(id, { group: "type", value: type });
  for (const m of motivations) {
    controller.applyPropertyDrop(controller.getActiveCard().id, { group: "motivations", value: m });
  }
  const renderer = createCardBuilderPhaserRenderer({
    controller,
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(makeContainer());
  await renderer.render();
  const button = renderer.getEditorChips().find((c) => c.role === "shelve_button");
  return { renderer, button };
}

test("the shelve button holds one position regardless of what the card contains", async () => {
  // The defect: its y came from the running content offset.
  const a = await renderCardWithMotivations({}, "delver", []);
  const b = await renderCardWithMotivations({}, "delver", ["exploring", "attacking"]);
  const c = await renderCardWithMotivations({}, "warden", ["defending"]);

  assert.ok(a.button && b.button && c.button, "every configured card needs a shelve button");
  assert.equal(a.button.y, b.button.y, "extra motivation rows must not move the button");
  assert.equal(a.button.y, c.button.y, "a different card type must not move it either");

  // And it stays at the top of the panel rather than trailing the content.
  assert.ok(a.button.y < 60, `expected the button near the top, got y=${a.button.y}`);
  for (const r of [a, b, c]) r.renderer.dispose();
});

test("the shelve button is right-aligned to the editor panel", async () => {
  // Its right edge is the anchor, so a longer label grows leftwards and the
  // button does not drift as the type name changes length.
  const delver = await renderCardWithMotivations({}, "delver", []);
  const room = await renderCardWithMotivations({}, "room", []);
  const rightEdge = (b) => b.x + b.width;

  assert.equal(
    rightEdge(delver.button),
    rightEdge(room.button),
    "both buttons must share a right edge despite different label widths",
  );
  assert.notEqual(delver.button.width, room.button.width, "the labels differ in length");
  delver.renderer.dispose();
  room.renderer.dispose();
});

test("the shelve button names the group it moves the card to, without hovering", async () => {
  // The label used to render at alpha 0 until pointerover, so nothing on screen
  // said what the control did.
  const records = {};
  const { renderer, button } = await renderCardWithMotivations(records, "warden", []);
  const label = records.texts.find((t) => String(t.text) === "Shelve as warden");

  assert.ok(label, "expected a visible 'Shelve as warden' label");
  assert.notEqual(label.alpha, 0, "the label must not be hidden until hover");
  assert.equal(button.value, "warden");
  renderer.dispose();
});

test("the shelve button's hit area covers the button that is drawn", async () => {
  // Registry rect and interactive zone must describe the same rectangle: this is
  // the claim a user makes when they say a control is "misaligned".
  const records = {};
  const { renderer, button } = await renderCardWithMotivations(records, "delver", ["exploring"]);
  const zone = records.rectangles.find((r) => (
    r.type === "zone"
    && Math.abs(r.width - button.width) < 0.5
    && Math.abs(r.height - button.height) < 0.5
  ));

  assert.ok(zone, "expected an interactive zone matching the button's size");
  // Zones are centre-origin; the registry records the top-left.
  assert.ok(Math.abs((zone.x - zone.width / 2) - button.x) < 0.5, "zone x must match the drawn box");
  assert.ok(Math.abs((zone.y - zone.height / 2) - button.y) < 0.5, "zone y must match the drawn box");
  renderer.dispose();
});

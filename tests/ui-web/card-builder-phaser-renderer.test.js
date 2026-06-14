import assert from "node:assert/strict";
import { test } from "vitest";
import { createCardBuilderController } from "../../packages/ui-web/src/card-builder-controller.js";
// M5 target module — does not exist yet. These tests are the implementation contract.
import {
  createCardBuilderPhaserRenderer,
  CARD_BUILDER_UI_INTENTS,
} from "../../packages/ui-web/src/views/card-builder-phaser-renderer.js";

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
      setDepth() { return this; },
      setData(k, v) { (this.data = this.data || {})[k] = v; return this; },
      setName(n) { this.name = n; return this; },
      setInteractive() { this.interactive = true; return this; },
      on(event, handler) { (this.handlers = this.handlers || {})[event] = handler; return this; },
      setVisible() { return this; },
      setAlpha() { return this; },
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

// ## TODO: Test Permutations
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
  const controller = createCardBuilderController();
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

import assert from "node:assert/strict";
import { createGameplayPhaserRenderer } from "../../packages/ui-web/src/views/gameplay-phaser-renderer.js";

function createFakePhaser(records = {}) {
  records.rectangles = records.rectangles || [];
  records.circles = records.circles || [];
  records.texts = records.texts || [];
  records.images = records.images || [];
  records.containers = records.containers || [];
  records.camera = records.camera || {};
  records.resizes = records.resizes || [];
  records.inputHandlers = records.inputHandlers || {};
  records.destroyed = false;

  function createNode(type, props = {}) {
    return {
      type,
      ...props,
      setStrokeStyle(...args) { this.stroke = args; return this; },
      setAngle(angle) { this.angle = angle; return this; },
      setDepth(depth) { this.depth = depth; return this; },
      setDisplaySize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; },
      setTint(tint) { this.tint = tint; return this; },
      setOrigin(x, y) { this.origin = { x, y }; return this; },
      setAlpha(a) { this.alpha = a; return this; },
      setScale(s) { this.scale = s; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setVisible(v) { this.visible = v; return this; },
      destroy() { this.destroyed = true; },
    };
  }

  class Game {
    constructor(config) {
      records.config = config;
      this.canvas = { style: {} };
      this.scale = {
        resize(w, h) { records.resizes.push({ w, h }); },
      };
      const scene = {
        textures: {
          exists() { return false; },
          addImage() {},
        },
        add: {
          container(x, y) {
            const node = createNode("container", {
              x, y, list: [],
              add(child) { this.list.push(child); return child; },
              destroy() { this.destroyed = true; },
            });
            records.containers.push(node);
            return node;
          },
          rectangle(x, y, w, h, color, alpha) {
            const node = createNode("rectangle", { x, y, width: w, height: h, color, alpha });
            records.rectangles.push(node);
            return node;
          },
          circle(x, y, r, color, alpha) {
            const node = createNode("circle", { x, y, radius: r, color, alpha });
            records.circles.push(node);
            return node;
          },
          text(x, y, text, style) {
            const node = createNode("text", { x, y, text, style });
            records.texts.push(node);
            return node;
          },
          image(x, y, key) {
            const node = createNode("image", { x, y, textureKey: key });
            records.images.push(node);
            return node;
          },
        },
        cameras: {
          main: {
            scrollX: 0,
            scrollY: 0,
            zoom: 1,
            setViewport(...args) { records.camera.viewport = args; return this; },
            setBounds(...args) { records.camera.bounds = args; return this; },
            setZoom(v) { this.zoom = v; records.camera.zoom = v; return this; },
            centerOn(...args) { records.camera.center = args; return this; },
          },
        },
        input: {
          on(event, handler) {
            if (!records.inputHandlers[event]) {
              records.inputHandlers[event] = handler;
            } else {
              const prev = records.inputHandlers[event];
              records.inputHandlers[event] = (...args) => { prev(...args); handler(...args); };
            }
            records.input = { event, handler };
          },
          keyboard: {
            on(event, handler) {
              records.inputHandlers[event] = handler;
            },
          },
        },
        events: {
          on(event, handler) {
            if (!records.inputHandlers[event]) {
              records.inputHandlers[event] = handler;
            }
          },
        },
        tweens: {
          add(config) { (records.tweens = records.tweens || []).push(config); },
        },
      };
      records.scene = scene;
      config.scene.create?.call(scene);
    }

    destroy() {
      records.destroyed = true;
    }
  }

  return { AUTO: "AUTO", Scale: { NONE: "NONE" }, Game };
}

function makeContainer() {
  let stage = null;
  return {
    clientWidth: 400,
    clientHeight: 300,
    querySelector(sel) {
      return sel === "[data-gameplay-phaser-stage]" ? stage : null;
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

const BOARD_STATE = {
  tiles: [
    "XXXXX",
    "XX.XX",
    "X...X",
    "XX.XX",
    "XXXXX",
  ],
  boardWidth: 5,
  boardHeight: 5,
  simConfig: { layout: { data: { width: 5, height: 5, rooms: [] } }, seed: 0 },
  initialState: {
    actors: [
      { id: "delver-1", type: "delver", position: { x: 2, y: 2 } },
      { id: "warden-1", type: "warden", position: { x: 2, y: 3 } },
    ],
  },
  observation: {
    actors: [
      { id: "delver-1", type: "delver", position: { x: 2, y: 2 } },
      { id: "warden-1", type: "warden", position: { x: 2, y: 3 } },
    ],
    hazards: [{ id: "hazard-1", position: { x: 1, y: 2 } }],
    resources: [{ id: "resource-1", position: { x: 3, y: 2 } }],
  },
  resourceBundle: null,
};

test("gameplay phaser renderer mounts without throwing", () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  assert.doesNotThrow(() => renderer.mount(container));
  renderer.dispose();
});

test("gameplay phaser renderer draws tile shapes from the board", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  assert.ok(records.rectangles.length > 0, "expected at least one rectangle for level tiles");
  renderer.dispose();
});

test("gameplay phaser renderer draws at least one shape per delver", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  const totalActorShapes = records.circles.length + records.rectangles.length;
  assert.ok(totalActorShapes > 0, "expected actor shapes (delver) in draw records");
  renderer.dispose();
});

test("gameplay phaser renderer draws at least one shape per warden", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  // Two actors in the fixture — total shape count must reflect both
  const shapeCount = records.circles.length + records.rectangles.length;
  assert.ok(shapeCount >= 2, `expected shapes for both actors, got ${shapeCount}`);
  renderer.dispose();
});

test("gameplay phaser renderer labels archetype wardens distinctly from delvers", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun({
    ...BOARD_STATE,
    observation: {
      actors: [
        { id: "A-1", kind: "ambulatory", archetype: "delver", position: { x: 1, y: 1 } },
        { id: "D-1", kind: "ambulatory", archetype: "warden", position: { x: 2, y: 1 } },
      ],
      hazards: [],
      resources: [],
    },
  });

  assert.ok(records.texts.some((entry) => entry.text === "D"), "expected delver label");
  assert.ok(records.texts.some((entry) => entry.text === "W"), "expected warden label");
  renderer.dispose();
});

test("gameplay phaser renderer draws hazard from observation", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  const totalShapes = records.circles.length + records.rectangles.length + records.texts.length;
  assert.ok(totalShapes > 0, "expected at least one shape for hazard");
  renderer.dispose();
});

test("gameplay phaser renderer draws resource from observation", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  const totalShapes = records.circles.length + records.rectangles.length + records.texts.length + records.images.length;
  assert.ok(totalShapes > 0, "expected at least one shape for resource");
  renderer.dispose();
});

test("gameplay phaser renderer calls game.destroy on dispose", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.dispose();

  assert.equal(records.destroyed, true);
});

test("gameplay phaser renderer wires onSelect through input handler", async () => {
  const records = {};
  const container = makeContainer();
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect: (pos) => selected.push(pos),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  assert.equal(typeof records.inputHandlers.pointerup, "function", "pointerup handler must be registered");
  records.inputHandlers.pointerdown({ x: 20, y: 20, worldX: 20, worldY: 20 });
  records.inputHandlers.pointerup({ x: 20, y: 20, worldX: 20, worldY: 20 });
  assert.equal(selected.length, 1);
  renderer.dispose();
});

test("gameplay phaser renderer fits the full level into the viewport on first render", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun({
    ...BOARD_STATE,
    boardWidth: 30,
    boardHeight: 20,
    tiles: Array.from({ length: 20 }, () => ".".repeat(30)),
  });

  assert.deepEqual(records.camera.bounds, [0, 0, 960, 640]);
  assert.ok(records.camera.zoom < 1, "large boards should start zoomed out to fit");
  assert.deepEqual(records.camera.center, [480, 320]);
  assert.equal(container.stage.dataset.gameplayWorldPixels, "960x640");
  renderer.dispose();
});

test("gameplay phaser renderer exposes zoom and fit camera controls", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun({
    ...BOARD_STATE,
    boardWidth: 30,
    boardHeight: 20,
    tiles: Array.from({ length: 20 }, () => ".".repeat(30)),
  });
  const fitZoom = renderer.getCameraState().zoom;
  const zoomedIn = renderer.zoomIn();
  assert.ok(zoomedIn > fitZoom);
  const zoomedOut = renderer.zoomOut();
  assert.ok(zoomedOut <= zoomedIn);
  assert.equal(renderer.fitToLevel(), fitZoom);
  renderer.dispose();
});

test("gameplay phaser renderer supports drag panning without selecting a tile", async () => {
  const records = {};
  const container = makeContainer();
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect: (pos) => selected.push(pos),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  records.inputHandlers.pointerdown({ x: 100, y: 100, worldX: 100, worldY: 100 });
  records.inputHandlers.pointermove({ x: 130, y: 120, worldX: 130, worldY: 120, isDown: true });
  records.inputHandlers.pointerup({ x: 130, y: 120, worldX: 130, worldY: 120 });

  assert.equal(selected.length, 0);
  assert.notEqual(records.scene.cameras.main.scrollX, 0);
  assert.notEqual(records.scene.cameras.main.scrollY, 0);
  renderer.dispose();
});

test("gameplay phaser renderer centers the camera on a selected tile", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  assert.equal(renderer.centerOnTile({ x: 3, y: 4 }), true);
  assert.deepEqual(records.camera.center, [112, 144]);
  renderer.dispose();
});

test("gameplay phaser renderer annotates the stage with world and actor counts", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  assert.equal(container.stage.dataset.gameplayWorldTiles, "5x5");
  assert.equal(container.stage.dataset.gameplayActors, "2");
  renderer.dispose();
});

test("gameplay phaser renderer annotates role counts and unique actor positions", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun({
    ...BOARD_STATE,
    observation: {
      actors: [
        { id: "A-1", archetype: "delver", position: { x: 1, y: 1 } },
        { id: "A-2", archetype: "delver", position: { x: 2, y: 1 } },
        { id: "D-1", archetype: "warden", position: { x: 3, y: 1 } },
      ],
      hazards: [],
      resources: [],
    },
  });

  assert.equal(container.stage.dataset.gameplayActors, "3");
  assert.equal(container.stage.dataset.gameplayDelvers, "2");
  assert.equal(container.stage.dataset.gameplayWardens, "1");
  const positions = JSON.parse(container.stage.dataset.gameplayActorPositions);
  assert.equal(new Set(positions.map((entry) => `${entry.x},${entry.y}`)).size, 3);
  renderer.dispose();
});

test("gameplay phaser renderer exposes renderFrame method", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  assert.equal(typeof renderer.renderFrame, "function");
  await renderer.renderFrame(BOARD_STATE);
  renderer.dispose();
});

test("gameplay phaser renderer creates a fresh container on each render call", async () => {
  const records = {};
  const container = makeContainer();
  const BOARD_STATE_TICK1 = {
    ...BOARD_STATE,
    observation: {
      actors: [{ id: "delver-1", type: "delver", position: { x: 1, y: 1 } }],
      hazards: [],
      resources: [],
    },
  };

  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);           // tick 0
  await renderer.renderFrame(BOARD_STATE_TICK1);   // tick 1
  await renderer.renderFrame(BOARD_STATE);         // rewind to tick 0

  assert.equal(records.containers.length, 3, "expected one container per render call");
  assert.equal(records.containers[0].destroyed, true, "tick 0 container must be destroyed after tick 1 render");
  assert.equal(records.containers[1].destroyed, true, "tick 1 container must be destroyed after rewind");
  assert.ok(!records.containers[2].destroyed, "current container must not be destroyed yet");

  renderer.dispose();
});

// --- M2: hover quick-view ---

const QUICK_VIEW_MODEL = {
  id: "delver-1",
  entityType: "actor",
  position: { x: 2, y: 2 },
  vitals: { health: { current: 8, max: 10 }, mana: { current: 5, max: 8 } },
  affinities: [{ kind: "fire", expression: "ward", stacks: 2 }],
  motivations: ["explore", "loot"],
  equippedAffinity: { kind: "fire", expression: "ward", stacks: 2 },
};

test("renderer fires onHover with tile position on pointer move (no drag)", async () => {
  const records = {};
  const container = makeContainer();
  const hovered = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onHover: (pos) => hovered.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  // DEFAULT_TILE_SIZE=32: tile (2,2) center worldX=80, worldY=80
  records.inputHandlers.pointermove({ worldX: 80, worldY: 80, isDown: false, buttons: 0 });
  assert.equal(hovered.length, 1);
  assert.deepEqual(hovered[0], { x: 2, y: 2 });
  renderer.dispose();
});

test("renderer fires onHover again when pointer moves to a different tile", async () => {
  const records = {};
  const container = makeContainer();
  const hovered = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onHover: (pos) => hovered.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  records.inputHandlers.pointermove({ worldX: 80, worldY: 80, isDown: false, buttons: 0 });
  records.inputHandlers.pointermove({ worldX: 112, worldY: 80, isDown: false, buttons: 0 });
  assert.equal(hovered.length, 2);
  assert.deepEqual(hovered[1], { x: 3, y: 2 });
  renderer.dispose();
});

test("renderer does not fire onHover again when pointer stays on the same tile", async () => {
  const records = {};
  const container = makeContainer();
  const hovered = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onHover: (pos) => hovered.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  records.inputHandlers.pointermove({ worldX: 80, worldY: 80, isDown: false, buttons: 0 });
  records.inputHandlers.pointermove({ worldX: 85, worldY: 82, isDown: false, buttons: 0 });
  assert.equal(hovered.length, 1, "must not fire twice for same tile");
  renderer.dispose();
});

test("renderer does not fire onHover during a camera drag", async () => {
  const records = {};
  const container = makeContainer();
  const hovered = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onHover: (pos) => hovered.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  records.inputHandlers.pointerdown({ x: 80, y: 80, worldX: 80, worldY: 80 });
  records.inputHandlers.pointermove({ worldX: 112, worldY: 80, isDown: true, buttons: 1 });
  assert.equal(hovered.length, 0);
  renderer.dispose();
});

test("renderer fires onHoverEnd when pointer leaves the canvas", async () => {
  const records = {};
  const container = makeContainer();
  let endCount = 0;
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onHoverEnd: () => endCount++,
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  assert.equal(typeof records.inputHandlers.gameout, "function", "gameout handler must be registered");
  records.inputHandlers.gameout({});
  assert.equal(endCount, 1);
  renderer.dispose();
});

// --- Quick-view vitals bar chart (all vitals + regen + indicator bars) ---

const QUICK_VIEW_MODEL_PARTIAL = {
  id: "warden-1",
  entityType: "actor",
  position: { x: 2, y: 2 },
  vitals: {
    health:  { current: 5, max: 10, regen: 0 },
    stamina: { current: 3, max:  6, regen: 1 },
  },
  affinities: [],
  motivations: [],
  equippedAffinity: null,
};

const QUICK_VIEW_MODEL_SINGLE = {
  id: "hazard-1",
  entityType: "hazard",
  position: { x: 3, y: 3 },
  vitals: {
    health: { current: 2, max: 8, regen: 0 },
  },
  affinities: [],
  motivations: [],
  equippedAffinity: null,
};

const QUICK_VIEW_MODEL_FULL = {
  id: "delver-1",
  entityType: "actor",
  position: { x: 2, y: 2 },
  vitals: {
    health:    { current: 8,  max: 10, regen: 1 },
    mana:      { current: 5,  max: 8,  regen: 2 },
    stamina:   { current: 7,  max: 7,  regen: 0 },
    durability:{ current: 3,  max: 8,  regen: 0 },
  },
  affinities: [{ kind: "fire", expression: "ward", stacks: 2 }],
  motivations: ["explore", "loot"],
  equippedAffinity: { kind: "fire", expression: "ward", stacks: 2 },
};

test("showQuickView renders separate label and value text for each vital", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.showQuickView(QUICK_VIEW_MODEL_FULL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text));
  assert.ok(newTexts.includes("HP"), "health label must be a separate 'HP' text node");
  assert.ok(newTexts.includes("MP"), "mana label must be a separate 'MP' text node");
  assert.ok(newTexts.includes("ST"), "stamina label must be a separate 'ST' text node");
  assert.ok(newTexts.includes("DU"), "durability label must be a separate 'DU' text node");
  renderer.dispose();
});

test("showQuickView renders current/max value text for each vital", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.showQuickView(QUICK_VIEW_MODEL_FULL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text));
  assert.ok(newTexts.includes("8/10"), "health current/max must appear");
  assert.ok(newTexts.includes("5/8"),  "mana current/max must appear");
  assert.ok(newTexts.includes("7/7"),  "stamina current/max must appear");
  assert.ok(newTexts.includes("3/8"),  "durability current/max must appear");
  renderer.dispose();
});

test("showQuickView renders regen as block rectangles, not +N text", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const rectsBefore = records.rectangles.length;
  const textsBefore = records.texts.length;
  renderer.showQuickView(QUICK_VIEW_MODEL_FULL);
  // health regen=1 → 1 block, mana regen=2 → 2 blocks, stamina/durability=0 → no blocks
  const totalRegenBlocks = 1 + 2;
  const vitalCount = Object.keys(QUICK_VIEW_MODEL_FULL.vitals).length;
  const newRects = records.rectangles.length - rectsBefore;
  // bg(1) + per vital: track+minTick+maxTick+indicator(4) + regen blocks
  assert.equal(newRects, 1 + vitalCount * 4 + totalRegenBlocks,
    `expected ${1 + vitalCount * 4 + totalRegenBlocks} rectangles, got ${newRects}`);
  // regen must NOT be rendered as +N text nodes
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text));
  assert.ok(!newTexts.some((t) => t.startsWith("+")),
    "regen must not produce any +N text node");
  renderer.dispose();
});

test("showQuickView creates bar-chart rectangles for each vital", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const rectsBefore = records.rectangles.length;
  renderer.showQuickView(QUICK_VIEW_MODEL_FULL);
  const newRects = records.rectangles.length - rectsBefore;
  // bg + track + min tick + max tick + indicator per vital + regen blocks
  const vitalCount = Object.keys(QUICK_VIEW_MODEL_FULL.vitals).length;
  const totalRegenBlocks = 1 + 2; // health=1, mana=2
  assert.equal(newRects, 1 + vitalCount * 4 + totalRegenBlocks,
    `expected ${1 + vitalCount * 4 + totalRegenBlocks} new rectangles, got ${newRects}`);
  renderer.dispose();
});

test("showQuickView uses distinct colors for health and mana label texts", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.showQuickView(QUICK_VIEW_MODEL_FULL);
  const newTextNodes = records.texts.slice(textsBefore);
  const hpNode = newTextNodes.find((t) => String(t.text) === "HP");
  const mpNode = newTextNodes.find((t) => String(t.text) === "MP");
  assert.ok(hpNode, "HP label node must exist");
  assert.ok(mpNode, "MP label node must exist");
  assert.notEqual(hpNode.style?.color, mpNode.style?.color,
    "health and mana labels must have different colors");
  renderer.dispose();
});

test("showQuickView with partial vitals renders only the present vitals", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  const rectsBefore = records.rectangles.length;
  renderer.showQuickView(QUICK_VIEW_MODEL_PARTIAL);
  const newTexts = records.texts.slice(textsBefore);
  const labels = newTexts.map((t) => String(t.text));
  assert.ok(labels.includes("HP"), "HP label must appear");
  assert.ok(labels.includes("ST"), "ST label must appear");
  assert.ok(!labels.includes("MP"), "MP label must NOT appear");
  assert.ok(!labels.includes("DU"), "DU label must NOT appear");
  const hpVal = newTexts.find((t) => String(t.text) === "5/10");
  assert.ok(hpVal, "HP value 5/10 must appear");
  const stVal = newTexts.find((t) => String(t.text) === "3/6");
  assert.ok(stVal, "ST value 3/6 must appear");
  const newRects = records.rectangles.length - rectsBefore;
  const vitalCount = 2;
  assert.ok(newRects >= 1 + vitalCount * 3,
    `expected at least ${1 + vitalCount * 3} new rectangles, got ${newRects}`);
  renderer.dispose();
});

test("showQuickView with single vital renders that vital as a bar chart", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  const rectsBefore = records.rectangles.length;
  renderer.showQuickView(QUICK_VIEW_MODEL_SINGLE);
  const newTexts = records.texts.slice(textsBefore);
  const labels = newTexts.map((t) => String(t.text));
  assert.ok(labels.includes("HP"), "HP label must appear for single-vital entity");
  assert.ok(!labels.includes("MP"), "MP must not appear");
  assert.ok(!labels.includes("ST"), "ST must not appear");
  assert.ok(!labels.includes("DU"), "DU must not appear");
  const valNode = newTexts.find((t) => String(t.text) === "2/8");
  assert.ok(valNode, "value text 2/8 must appear");
  const newRects = records.rectangles.length - rectsBefore;
  assert.ok(newRects >= 1 + 1 * 3,
    `expected at least 4 new rectangles for 1 vital, got ${newRects}`);
  renderer.dispose();
});

test("showQuickView with no vitals renders only the id label", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.showQuickView({ ...QUICK_VIEW_MODEL_SINGLE, vitals: null });
  const newTexts = records.texts.slice(textsBefore);
  const labels = newTexts.map((t) => String(t.text));
  assert.ok(!labels.includes("HP"), "HP must not appear when vitals is null");
  assert.ok(!labels.includes("MP"), "MP must not appear when vitals is null");
  renderer.dispose();
});

test("showQuickView creates a Phaser container with vitals text", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const containersBefore = records.containers.length;
  renderer.showQuickView(QUICK_VIEW_MODEL);
  assert.ok(records.containers.length > containersBefore, "expected a new container for quick-view");
  const allText = records.texts.map((t) => String(t.text)).join(" ").toLowerCase();
  assert.match(allText, /8/, "expected HP current value in quick-view text");
  renderer.dispose();
});

test("showQuickView includes equipped affinity kind in the overlay", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.showQuickView(QUICK_VIEW_MODEL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text)).join(" ").toLowerCase();
  assert.match(newTexts, /fire/, "expected equipped affinity kind in quick-view");
  renderer.dispose();
});

test("showQuickView does not include expression, stack count, or motivation text", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.showQuickView(QUICK_VIEW_MODEL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text)).join(" ").toLowerCase();
  assert.doesNotMatch(newTexts, /ward/, "quick-view must not show affinity expression");
  assert.doesNotMatch(newTexts, /explore/, "quick-view must not show motivation");
  assert.doesNotMatch(newTexts, /loot/, "quick-view must not show motivation");
  assert.doesNotMatch(newTexts, /stack/, "quick-view must not show stack count label");
  renderer.dispose();
});

test("hideQuickView destroys the overlay container", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.showQuickView(QUICK_VIEW_MODEL);
  const overlayContainer = records.containers[records.containers.length - 1];
  renderer.hideQuickView();
  assert.equal(overlayContainer.destroyed, true, "quick-view container must be destroyed by hideQuickView");
  renderer.dispose();
});

test("hideQuickView before showQuickView does not throw", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  assert.doesNotThrow(() => renderer.hideQuickView());
  renderer.dispose();
});

test("showQuickView replaces any existing quick-view overlay", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.showQuickView(QUICK_VIEW_MODEL);
  const first = records.containers[records.containers.length - 1];
  renderer.showQuickView({ ...QUICK_VIEW_MODEL, id: "warden-1", position: { x: 2, y: 3 } });
  assert.equal(first.destroyed, true, "first overlay must be destroyed when second is shown");
  renderer.dispose();
});

// --- M3: actor selection highlight and keyboard capture ---

const SELECTION_TINT = 0xffd700;

test("highlightActor returns true when an actor exists at the position", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  assert.equal(renderer.highlightActor({ x: 2, y: 2 }), true);
  renderer.dispose();
});

test("highlightActor returns false when no actor is at the position", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  assert.equal(renderer.highlightActor({ x: 0, y: 0 }), false);
  renderer.dispose();
});

test("highlightActor applies a selection tint to the actor circle", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  // DEFAULT_TILE_SIZE=32, delver at {x:2,y:2} → circle center at (80,80)
  renderer.highlightActor({ x: 2, y: 2 });
  const actorCircle = records.circles.find((c) => c.x === 80 && c.y === 80);
  assert.ok(actorCircle, "actor circle must exist at tile (2,2)");
  assert.equal(actorCircle.tint, SELECTION_TINT, "actor circle must have selection tint");
  renderer.dispose();
});

test("clearHighlight restores the actor circle's original tint", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.highlightActor({ x: 2, y: 2 });
  renderer.clearHighlight();
  const actorCircle = records.circles.find((c) => c.x === 80 && c.y === 80);
  assert.ok(actorCircle);
  assert.notEqual(actorCircle.tint, SELECTION_TINT, "selection tint must be cleared after clearHighlight");
  renderer.dispose();
});

test("highlightActor clears previous selection when called on a different actor", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  // delver at (2,2), warden at (2,3) → circle centers (80,80) and (80,112)
  renderer.highlightActor({ x: 2, y: 2 });
  renderer.highlightActor({ x: 2, y: 3 });
  const delverCircle = records.circles.find((c) => c.x === 80 && c.y === 80);
  const wardenCircle = records.circles.find((c) => c.x === 80 && c.y === 112);
  assert.notEqual(delverCircle.tint, SELECTION_TINT, "previous actor tint must be cleared");
  assert.equal(wardenCircle.tint, SELECTION_TINT, "newly selected actor must have selection tint");
  renderer.dispose();
});

test("renderer fires onKeyPress for actor movement keys", async () => {
  const records = {};
  const container = makeContainer();
  const keyPresses = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onKeyPress: (e) => keyPresses.push(e),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  records.inputHandlers.keydown?.({ key: "ArrowUp" });
  records.inputHandlers.keydown?.({ key: "ArrowDown" });
  records.inputHandlers.keydown?.({ key: "w" });
  assert.equal(keyPresses.length, 3);
  assert.equal(keyPresses[0].key, "arrowup");
  assert.equal(keyPresses[1].key, "arrowdown");
  assert.equal(keyPresses[2].key, "w");
  renderer.dispose();
});

test("renderer fires onKeyPress for action keys C, X, Z, and Escape", async () => {
  const records = {};
  const container = makeContainer();
  const keyPresses = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onKeyPress: (e) => keyPresses.push(e),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  records.inputHandlers.keydown?.({ key: "c" });
  records.inputHandlers.keydown?.({ key: "x" });
  records.inputHandlers.keydown?.({ key: "z" });
  records.inputHandlers.keydown?.({ key: "Escape" });
  assert.equal(keyPresses.length, 4);
  assert.equal(keyPresses[2].key, "z");
  assert.equal(keyPresses[3].key, "escape");
  renderer.dispose();
});

test("renderer does not fire onKeyPress for non-control keys", async () => {
  const records = {};
  const container = makeContainer();
  const keyPresses = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onKeyPress: (e) => keyPresses.push(e),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  records.inputHandlers.keydown?.({ key: "q" });
  records.inputHandlers.keydown?.({ key: "1" });
  records.inputHandlers.keydown?.({ key: "=" });
  assert.equal(keyPresses.length, 0, "non-control keys must not trigger onKeyPress");
  renderer.dispose();
});

// --- M4: Player Panel ---

const PLAYER_PANEL_MODEL = {
  id: "delver-1",
  entityType: "actor",
  position: { x: 2, y: 2 },
  vitals: {
    health: { current: 8, max: 10 },
    mana: { current: 5, max: 8 },
    stamina: { current: 7, max: 7 },
  },
  affinities: [
    { kind: "fire", expression: "ward", stacks: 2 },
    { kind: "ice", expression: "surge", stacks: 1 },
  ],
  motivations: ["explore", "loot"],
  equippedAffinity: { kind: "fire", expression: "ward", stacks: 2 },
};

test("openPlayerPanel creates a new Phaser container", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const containersBefore = records.containers.length;
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  assert.ok(records.containers.length > containersBefore, "openPlayerPanel must create a new container");
  renderer.dispose();
});

test("openPlayerPanel includes actor identity in panel text", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text)).join(" ").toLowerCase();
  assert.match(newTexts, /delver-1/, "panel must show actor id");
  renderer.dispose();
});

test("openPlayerPanel includes full vitals for health, mana, and stamina", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text)).join(" ").toLowerCase();
  assert.match(newTexts, /8\/10/, "panel must show HP current/max");
  assert.match(newTexts, /5\/8/, "panel must show MP current/max");
  assert.match(newTexts, /7\/7/, "panel must show ST current/max");
  renderer.dispose();
});

test("openPlayerPanel includes all affinities with stacks and expression", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text)).join(" ").toLowerCase();
  assert.match(newTexts, /fire/, "panel must show fire affinity");
  assert.match(newTexts, /ward/, "panel must show ward expression");
  assert.match(newTexts, /2/, "panel must show stack count");
  assert.match(newTexts, /ice/, "panel must show ice affinity");
  assert.match(newTexts, /surge/, "panel must show surge expression");
  renderer.dispose();
});

test("openPlayerPanel includes motivations list", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text)).join(" ").toLowerCase();
  assert.match(newTexts, /explore/, "panel must list explore motivation");
  assert.match(newTexts, /loot/, "panel must list loot motivation");
  renderer.dispose();
});

test("openPlayerPanel includes EQUIP visual control label", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text)).join(" ").toUpperCase();
  assert.match(newTexts, /EQUIP/, "panel must include EQUIP visual control");
  renderer.dispose();
});

test("openPlayerPanel includes PRIORITY control label", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text)).join(" ").toUpperCase();
  assert.match(newTexts, /PRIORITY/, "panel must include PRIORITY control label");
  renderer.dispose();
});

test("openPlayerPanel includes a close hint", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const textsBefore = records.texts.length;
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const newTexts = records.texts.slice(textsBefore).map((t) => String(t.text)).join(" ").toLowerCase();
  assert.match(newTexts, /esc/, "panel must include close hint referencing Escape");
  renderer.dispose();
});

test("openPlayerPanel sets container depth to 300 or above", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const panelContainer = records.containers[records.containers.length - 1];
  assert.ok(panelContainer.depth >= 300, "player panel must be above other overlays (depth >= 300)");
  renderer.dispose();
});

test("closePlayerPanel destroys the panel container", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const panelContainer = records.containers[records.containers.length - 1];
  renderer.closePlayerPanel();
  assert.equal(panelContainer.destroyed, true, "panel container must be destroyed on close");
  renderer.dispose();
});

test("closePlayerPanel before openPlayerPanel does not throw", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  assert.doesNotThrow(() => renderer.closePlayerPanel());
  renderer.dispose();
});

test("openPlayerPanel replaces an existing panel", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  const firstPanel = records.containers[records.containers.length - 1];
  renderer.openPlayerPanel({ ...PLAYER_PANEL_MODEL, id: "warden-1", entityType: "warden" });
  assert.equal(firstPanel.destroyed, true, "first panel must be destroyed when second opens");
  renderer.dispose();
});

test("isPlayerPanelOpen returns true when panel is open", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  assert.equal(renderer.isPlayerPanelOpen(), true);
  renderer.dispose();
});

test("isPlayerPanelOpen returns false after closePlayerPanel", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  renderer.closePlayerPanel();
  assert.equal(renderer.isPlayerPanelOpen(), false);
  renderer.dispose();
});

test("isPlayerPanelOpen returns false before any openPlayerPanel call", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  assert.equal(renderer.isPlayerPanelOpen(), false);
  renderer.dispose();
});

test("onHover is suppressed while Player Panel is open", async () => {
  const records = {};
  const container = makeContainer();
  const hovered = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onHover: (pos) => hovered.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  records.inputHandlers.pointermove({ worldX: 80, worldY: 80, isDown: false, buttons: 0 });
  assert.equal(hovered.length, 0, "onHover must be suppressed while player panel is open");
  renderer.dispose();
});

test("onSelect is suppressed while Player Panel is open", async () => {
  const records = {};
  const container = makeContainer();
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect: (pos) => selected.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  records.inputHandlers.pointerdown({ x: 80, y: 80, worldX: 80, worldY: 80 });
  records.inputHandlers.pointerup({ x: 80, y: 80, worldX: 80, worldY: 80 });
  assert.equal(selected.length, 0, "onSelect must be suppressed while player panel is open");
  renderer.dispose();
});

/*
## TODO: Test Permutations
- renderRun with empty actors array renders only tiles without throwing
- renderRun with null observation renders tiles only without throwing
- renderRun with empty hazards and resources arrays produces no extra shapes
- renderRun with resourceBundle containing asset mappings passes texture keys to image nodes
- renderRun with resourceBundle absent falls back to shape/text primitives for all element types
- renderFrame advances to a new tick and re-renders actor positions
- renderFrame with no actors in the frame observation does not throw
- dispose before any renderRun call does not throw
- dispose called twice does not throw or create a second Game instance
- highlightActor before renderRun returns false without throwing
- highlightActor on a hazard position returns false
- clearHighlight before any highlight is a no-op
- clearHighlight after dispose does not throw
- openPlayerPanel with no vitals shows entity id but omits HP/MP/ST rows
- openPlayerPanel with no affinities omits affinity rows and EQUIP labels
- openPlayerPanel with no motivations omits motivation rows and PRIORITY label
- openPlayerPanel before renderRun does not throw
- onHover resumes after closePlayerPanel
- onSelect resumes after closePlayerPanel
*/

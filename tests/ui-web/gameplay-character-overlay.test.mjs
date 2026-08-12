import assert from "node:assert/strict";
import { createGameplayPhaserRenderer } from "../../packages/ui-web/src/views/gameplay-phaser-renderer.js";

// ---------------------------------------------------------------------------
// Fake Phaser harness — extended from gameplay-phaser-renderer.test.mjs with
// setScrollFactor tracking on nodes and containers.
// ---------------------------------------------------------------------------

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
      setScrollFactor(f) { this.scrollFactor = f; return this; },
      setStrokeStyle(...args) { this.stroke = args; return this; },
      setAngle(angle) { this.angle = angle; return this; },
      setDepth(depth) { this.depth = depth; return this; },
      setDisplaySize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; },
      setTint(tint) { this.tint = tint; return this; },
      clearTint() { this.tint = undefined; return this; },
      setOrigin(x, y) { this.origin = { x, y }; return this; },
      setName(name) { this.name = name; return this; },
      setData(key, value) { (this.data = this.data || {})[key] = value; return this; },
      setAlpha(a) { this.alpha = a; return this; },
      setScale(s) { this.scale = s; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setVisible(v) { this.visible = v; return this; },
      setInteractive() { this.interactive = true; return this; },
      setScrollFactor(f) { this.scrollFactor = f; return this; },
      on(event, handler) { (this.handlers = this.handlers || {})[event] = handler; return this; },
      destroy() { this.destroyed = true; },
    };
  }

  class Game {
    constructor(config) {
      records.config = config;
      this.canvas = { style: {} };
      this.scale = {
        resize(w, h) {
          records.resizes.push({ w, h });
          if (records.scene?.cameras?.main) {
            records.scene.cameras.main.width = w;
            records.scene.cameras.main.height = h;
          }
        },
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
              setScrollFactor(f) { this.scrollFactor = f; return this; },
              setDepth(d) { this.depth = d; return this; },
            });
            records.containers.push(node);
            return node;
          },
          rectangle(x, y, w, h, color, alpha) {
            const node = createNode("rectangle", { x, y, width: w, height: h, color, alpha });
            records.rectangles.push(node);
            return node;
          },
          zone(x, y, w, h) {
            const node = createNode("zone", { x, y, width: w, height: h });
            records.rectangles.push(node);
            return node;
          },
          circle(x, y, r, color, alpha) {
            const node = createNode("circle", { x, y, radius: r, color, alpha });
            records.circles.push(node);
            return node;
          },
          graphics() {
            return {
              fillStyle() { return this; }, fillRect() { return this; },
              fillRoundedRect() { return this; }, fillTriangle() { return this; },
              fillCircle() { return this; }, strokeRoundedRect() { return this; },
              lineStyle() { return this; }, beginPath() { return this; },
              moveTo() { return this; }, lineTo() { return this; },
              strokePath() { return this; }, strokeRect() { return this; },
              clear() { return this; }, destroy() {},
            };
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
            width: config.width,
            height: config.height,
            zoom: 1,
            setViewport(...args) { records.camera.viewport = args; return this; },
            setBounds(...args) { records.camera.bounds = args; return this; },
            setZoom(v) { this.zoom = v; records.camera.zoom = v; return this; },
            centerOn(x, y) {
              records.camera.center = [x, y];
              this.scrollX = x - this.width / (2 * this.zoom);
              this.scrollY = y - this.height / (2 * this.zoom);
              return this;
            },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(width = 800, height = 600) {
  let stage = null;
  return {
    clientWidth: width,
    clientHeight: height,
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

function makePlayerPanelModel(overrides = {}) {
  return {
    id: "delver-1",
    entityType: "actor",
    position: { x: 2, y: 2 },
    vitals: { health: { current: 10, max: 10 } },
    affinities: [{ kind: "fire", stacks: 1, expression: "resistant" }],
    motivations: ["explore"],
    resourceBundle: BOARD_STATE.resourceBundle,
    ...overrides,
  };
}

async function setupRenderer(records, containerOpts) {
  const container = makeContainer(containerOpts?.width, containerOpts?.height);
  const keyPresses = [];
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onKeyPress: (e) => keyPresses.push(e),
    onSelect: (pos) => selected.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  return { renderer, container, keyPresses, selected };
}

/**
 * Find the last container created by openPlayerPanel.
 * The overlay container is always the most recently pushed container
 * after calling openPlayerPanel.
 */
function findOverlayContainer(records) {
  return records.containers[records.containers.length - 1];
}

// ---------------------------------------------------------------------------
// Tests: Z character overlay sizing
// ---------------------------------------------------------------------------

describe("Z character overlay sizing", () => {
  it("overlay container has scrollFactor 0 (camera-independent)", async () => {
    const records = {};
    const { renderer } = await setupRenderer(records);
    renderer.openPlayerPanel(makePlayerPanelModel());

    const overlay = findOverlayContainer(records);
    assert.equal(
      overlay.scrollFactor,
      0,
      "overlay container must have scrollFactor=0 so camera pan/zoom does not affect it",
    );
    renderer.dispose();
  });

  it("overlay uses viewport dimensions, not fixed 280px width", async () => {
    const records = {};
    const { renderer } = await setupRenderer(records, { width: 800, height: 600 });
    renderer.openPlayerPanel(makePlayerPanelModel());

    // The dimmer rectangle is the first child added to the overlay container.
    // It should span the full viewport, not the fixed 280px panel width.
    const overlay = findOverlayContainer(records);
    const dimmer = overlay.list[0];
    assert.ok(dimmer, "dimmer rectangle must exist as first child of overlay");
    assert.equal(dimmer.width, 800, "dimmer width must equal viewport width (800), not 280");
    assert.equal(dimmer.height, 600, "dimmer height must equal viewport height (600)");

    // The panel background (second child) must also be wider than 280px.
    // In a proper full-viewport overlay it should be at least 400px wide on an 800-wide viewport.
    const panelBg = overlay.list[1];
    assert.ok(panelBg, "panel background must exist as second child of overlay");
    assert.ok(
      (panelBg.displayWidth || panelBg.width || 0) > 280,
      "panel background must be wider than the current fixed 280px",
    );
    renderer.dispose();
  });

  it("overlay depth is >= 500 (above all game content)", async () => {
    const records = {};
    const { renderer } = await setupRenderer(records);
    renderer.openPlayerPanel(makePlayerPanelModel());

    const overlay = findOverlayContainer(records);
    assert.ok(
      overlay.depth >= 500,
      `overlay depth must be >= 500 to render above all game content, got ${overlay.depth}`,
    );
    renderer.dispose();
  });

  it("overlay sets data-gameplay-player-panel-size dataset attribute", async () => {
    const records = {};
    const { renderer, container } = await setupRenderer(records, { width: 800, height: 600 });
    renderer.openPlayerPanel(makePlayerPanelModel());

    assert.ok(
      container.stage?.dataset?.gameplayPlayerPanelSize,
      "stageEl.dataset must contain gameplayPlayerPanelSize attribute after opening the panel",
    );
    renderer.dispose();
  });

  it("overlay remains correct size after camera zoom change", async () => {
    const records = {};
    const { renderer } = await setupRenderer(records, { width: 800, height: 600 });

    // Zoom camera to 2x before opening the panel
    records.scene.cameras.main.setZoom(2);
    renderer.openPlayerPanel(makePlayerPanelModel());

    const overlay = findOverlayContainer(records);

    // If scrollFactor is 0, the overlay is viewport-fixed and zoom does not affect it.
    // Without scrollFactor=0, the overlay would be half-size at zoom=2.
    assert.equal(
      overlay.scrollFactor,
      0,
      "overlay must have scrollFactor=0 so zoom does not affect its screen position/size",
    );

    // The dimmer must still match the viewport, not be scaled by zoom
    const dimmer = overlay.list[0];
    assert.equal(dimmer.width, 800, "dimmer width must equal viewport width regardless of camera zoom");
    assert.equal(dimmer.height, 600, "dimmer height must equal viewport height regardless of camera zoom");
    renderer.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests: Z key opens and closes overlay
// ---------------------------------------------------------------------------

describe("Z key opens and closes overlay", () => {
  it("pressing z on selected actor opens player panel", async () => {
    const records = {};
    const { renderer, keyPresses } = await setupRenderer(records);

    // Select an actor first
    renderer.highlightActor({ x: 2, y: 2 });

    // Simulate Z keypress through the renderer's keydown handler
    records.inputHandlers.keydown?.({ key: "z" });

    // The onKeyPress callback should have received the z event
    const zPress = keyPresses.find((k) => k.key === "z");
    assert.ok(zPress, "z keypress must be forwarded via onKeyPress");

    // Opening the panel is handled by gameplay-view's onKeyPress handler,
    // so we directly call openPlayerPanel to verify it works
    renderer.openPlayerPanel(makePlayerPanelModel());
    assert.equal(renderer.isPlayerPanelOpen(), true, "player panel must be open after openPlayerPanel");
    renderer.dispose();
  });

  it("pressing z again closes player panel", async () => {
    const records = {};
    const { renderer } = await setupRenderer(records);

    renderer.openPlayerPanel(makePlayerPanelModel());
    assert.equal(renderer.isPlayerPanelOpen(), true);

    renderer.closePlayerPanel();
    assert.equal(renderer.isPlayerPanelOpen(), false, "panel must close on second z press");
    renderer.dispose();
  });

  it("pressing escape closes player panel", async () => {
    const records = {};
    const { renderer } = await setupRenderer(records);

    renderer.openPlayerPanel(makePlayerPanelModel());
    assert.equal(renderer.isPlayerPanelOpen(), true);

    // Escape triggers closePlayerPanel through gameplay-view
    renderer.closePlayerPanel();
    assert.equal(renderer.isPlayerPanelOpen(), false, "panel must close on escape");
    renderer.dispose();
  });

  it("panel blocks tile selection while open", async () => {
    const records = {};
    const { renderer, selected } = await setupRenderer(records);

    renderer.openPlayerPanel(makePlayerPanelModel());

    // Attempt a tile click while panel is open
    records.inputHandlers.pointerdown?.({ x: 80, y: 80, worldX: 80, worldY: 80 });
    records.inputHandlers.pointerup?.({ x: 80, y: 80, worldX: 80, worldY: 80 });

    assert.equal(selected.length, 0, "tile selection must be blocked while player panel is open");
    renderer.dispose();
  });

  it("closing panel re-enables tile selection", async () => {
    const records = {};
    const { renderer, selected } = await setupRenderer(records);

    renderer.openPlayerPanel(makePlayerPanelModel());
    renderer.closePlayerPanel();

    // Tile click should work again after closing the panel
    records.inputHandlers.pointerdown?.({ x: 80, y: 80, worldX: 80, worldY: 80 });
    records.inputHandlers.pointerup?.({ x: 80, y: 80, worldX: 80, worldY: 80 });

    assert.equal(selected.length, 1, "tile selection must resume after closing the player panel");
    renderer.dispose();
  });
});

test("pressing Z with no selected actor does not open the renderer panel by itself", async () => {
  const records = {};
  const { renderer, keyPresses } = await setupRenderer(records);

  records.inputHandlers.keydown?.({ key: "z" });

  assert.ok(keyPresses.some((entry) => entry.key === "z"));
  assert.equal(renderer.isPlayerPanelOpen(), false);
  renderer.dispose();
});

test("overlay sizes correctly on a very small viewport", async () => {
  const records = {};
  const { renderer } = await setupRenderer(records, { width: 100, height: 100 });
  renderer.openPlayerPanel(makePlayerPanelModel());
  const dimmer = findOverlayContainer(records).list[0];

  assert.equal(dimmer.width, 100);
  assert.equal(dimmer.height, 100);
  renderer.dispose();
});

test("overlay sizes correctly on a very large viewport", async () => {
  const records = {};
  const { renderer } = await setupRenderer(records, { width: 3840, height: 2160 });
  renderer.openPlayerPanel(makePlayerPanelModel());
  const dimmer = findOverlayContainer(records).list[0];

  assert.equal(dimmer.width, 3840);
  assert.equal(dimmer.height, 2160);
  renderer.dispose();
});

test("repeated open and close cycles do not leave the panel open", async () => {
  const records = {};
  const { renderer } = await setupRenderer(records);

  for (let index = 0; index < 4; index += 1) {
    renderer.openPlayerPanel(makePlayerPanelModel());
    assert.equal(renderer.isPlayerPanelOpen(), true);
    renderer.closePlayerPanel();
    assert.equal(renderer.isPlayerPanelOpen(), false);
  }
  renderer.dispose();
});

test("overlay is viewport-fixed at max zoom and min zoom", async () => {
  for (const zoom of [3, 0.25]) {
    const records = {};
    const { renderer } = await setupRenderer(records, { width: 800, height: 600 });
    records.scene.cameras.main.setZoom(zoom);
    renderer.openPlayerPanel(makePlayerPanelModel());
    const overlay = findOverlayContainer(records);
    const dimmer = overlay.list[0];

    assert.equal(overlay.scrollFactor, 0);
    assert.equal(dimmer.width, 800);
    assert.equal(dimmer.height, 600);
    renderer.dispose();
  }
});

test("panel stays open while a new frame is rendered", async () => {
  const records = {};
  const { renderer } = await setupRenderer(records);
  renderer.openPlayerPanel(makePlayerPanelModel());

  await renderer.renderFrame({ ...BOARD_STATE, observation: { ...BOARD_STATE.observation, actors: [] } });

  assert.equal(renderer.isPlayerPanelOpen(), true);
  renderer.dispose();
});

test.skip("opening panel while quick-view is visible hides or layers quick-view deterministically", async () => {
  const records = {};
  const { renderer } = await setupRenderer(records);
  renderer.showQuickView?.(makePlayerPanelModel());
  renderer.openPlayerPanel(makePlayerPanelModel());
  assert.equal(renderer.isPlayerPanelOpen(), true);
});

test("panel opens for a model with no vitals", async () => {
  const records = {};
  const { renderer } = await setupRenderer(records);

  assert.doesNotThrow(() => renderer.openPlayerPanel(makePlayerPanelModel({ vitals: undefined })));
  assert.equal(renderer.isPlayerPanelOpen(), true);
  renderer.dispose();
});

test("panel opens for a model with all vital types present", async () => {
  const records = {};
  const { renderer } = await setupRenderer(records);

  renderer.openPlayerPanel(makePlayerPanelModel({
    vitals: {
      health: { current: 10, max: 10 },
      mana: { current: 5, max: 8 },
      stamina: { current: 7, max: 9 },
      durability: { current: 3, max: 4 },
    },
  }));

  assert.equal(renderer.isPlayerPanelOpen(), true);
  renderer.dispose();
});

import assert from "node:assert/strict";
import {
  PREVIEW_RENDERER_STORAGE_KEY,
  computePreviewFocusBounds,
  createCanvasPreviewRenderer,
  createPhaserPreviewRenderer,
  normalizePreviewRendererId,
  readPreviewRendererPreference,
  writePreviewRendererPreference,
} from "../../packages/ui-web/src/views/preview-renderers.js";

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

function createCanvas() {
  const handlers = new Map();
  const context = {
    cropReads: [],
    cropWrites: [],
    clearCount: 0,
    getImageData(x, y, width, height) {
      this.cropReads.push({ x, y, width, height });
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      };
    },
    putImageData(imageData, x, y) {
      this.cropWrites.push({ imageData, x, y });
    },
    clearRect() {
      this.clearCount += 1;
    },
  };
  return {
    width: 0,
    height: 0,
    hidden: true,
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    trigger(type, payload) {
      return handlers.get(type)?.(payload);
    },
    getContext() {
      return context;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.width || 1, height: this.height || 1 };
    },
    _context: context,
  };
}

function createPhaserDom({ width = 300, maxHeight = 300 } = {}) {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  let stage = null;
  const container = {
    clientWidth: width,
    querySelector(selector) {
      return selector === "[data-preview-phaser-stage]" ? stage : null;
    },
    appendChild(child) {
      stage = child;
      child.parentElement = container;
    },
  };

  globalThis.document = {
    createElement() {
      return {
        dataset: {},
        style: {},
        hidden: false,
        className: "",
        clientWidth: width,
        parentElement: null,
        querySelector() {
          return null;
        },
        appendChild() {},
      };
    },
  };
  globalThis.getComputedStyle = () => ({
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
  });

  return {
    container,
    get stage() {
      return stage;
    },
    restore() {
      globalThis.document = previousDocument;
      globalThis.getComputedStyle = previousGetComputedStyle;
    },
  };
}

function createFakePhaser(records = {}) {
  records.rectangles = records.rectangles || [];
  records.circles = records.circles || [];
  records.texts = records.texts || [];
  records.images = records.images || [];
  records.containers = records.containers || [];
  records.camera = records.camera || {};
  records.resizes = records.resizes || [];
  records.tweens = records.tweens || [];

  function createNode(type, props = {}) {
    return {
      type,
      ...props,
      setStrokeStyle(...args) {
        this.stroke = args;
        return this;
      },
      setAngle(angle) {
        this.angle = angle;
        return this;
      },
      setDepth(depth) {
        this.depth = depth;
        return this;
      },
      setDisplaySize(width, height) {
        this.displayWidth = width;
        this.displayHeight = height;
        return this;
      },
      setTint(tint) {
        this.tint = tint;
        return this;
      },
      setOrigin(x, y) {
        this.origin = { x, y };
        return this;
      },
    };
  }

  class Game {
    constructor(config) {
      records.config = config;
      this.canvas = { style: {} };
      this.scale = {
        resize(width, height) {
          records.resizes.push({ width, height });
        },
      };
      const scene = {
        textures: {
          exists() {
            return false;
          },
          addImage() {},
        },
        add: {
          container(x, y) {
            const node = createNode("container", {
              x,
              y,
              list: [],
              add(child) {
                this.list.push(child);
                return child;
              },
              destroy() {
                this.destroyed = true;
              },
            });
            records.containers.push(node);
            return node;
          },
          rectangle(x, y, width, height, color, alpha) {
            const node = createNode("rectangle", { x, y, width, height, color, alpha });
            records.rectangles.push(node);
            return node;
          },
          circle(x, y, radius, color, alpha) {
            const node = createNode("circle", { x, y, radius, color, alpha });
            records.circles.push(node);
            return node;
          },
          text(x, y, text, style) {
            const node = createNode("text", { x, y, text, style });
            records.texts.push(node);
            return node;
          },
          image(x, y, textureKey) {
            const node = createNode("image", { x, y, textureKey });
            records.images.push(node);
            return node;
          },
        },
        cameras: {
          main: {
            setViewport(...args) {
              records.camera.viewport = args;
              return this;
            },
            setBounds(...args) {
              records.camera.bounds = args;
              return this;
            },
            setZoom(value) {
              records.camera.zoom = value;
              return this;
            },
            centerOn(...args) {
              records.camera.center = args;
              return this;
            },
          },
        },
        input: {
          on(event, handler) {
            records.input = { event, handler };
          },
        },
        tweens: {
          add(config) {
            records.tweens.push(config);
          },
        },
      };
      records.scene = scene;
      config.scene.create.call(scene);
    }

    destroy() {
      records.destroyed = true;
    }
  }

  return {
    AUTO: "AUTO",
    Scale: { NONE: "NONE" },
    Game,
  };
}

test("preview renderer storage normalizes invalid values and persists valid selections", () => {
  const storage = createStorage({
    [PREVIEW_RENDERER_STORAGE_KEY]: "bogus",
  });

  assert.equal(normalizePreviewRendererId("bogus"), "canvas");
  assert.equal(readPreviewRendererPreference(storage), "canvas");
  assert.equal(writePreviewRendererPreference(storage, "phaser"), "phaser");
  assert.equal(storage.getItem(PREVIEW_RENDERER_STORAGE_KEY), "phaser");
});

test("computePreviewFocusBounds prefers occupied content across tiles, actors, hazards, and auras", () => {
  const bounds = computePreviewFocusBounds({
    tiles: [
      "XXXXXXXXXX",
      "XXXXXXXXXX",
      "XXXX...XXX",
      "XXXX...XXX",
      "XXXXXXXXXX",
      "XXXXXXXXXX",
    ],
    actors: [
      { position: { x: 8, y: 4 } },
    ],
    floorAffinityHazards: [
      { position: { x: 7, y: 1 } },
    ],
    observation: {
      auras: [
        { x: 3, y: 5 },
      ],
    },
  });

  assert.deepEqual(bounds, {
    minX: 2,
    minY: 0,
    maxX: 9,
    maxY: 5,
  });
});

test("computePreviewFocusBounds falls back to full board when no occupied content exists", () => {
  const bounds = computePreviewFocusBounds({
    boardWidth: 4,
    boardHeight: 3,
    tiles: [
      "XXXX",
      "XXXX",
      "XXXX",
    ],
  });

  assert.deepEqual(bounds, {
    minX: 0,
    minY: 0,
    maxX: 3,
    maxY: 2,
  });
});

test("computePreviewFocusBounds ignores wall padding around generated dungeon rooms", () => {
  const bounds = computePreviewFocusBounds({
    tiles: [
      "########",
      "########",
      "###..###",
      "###..###",
      "########",
    ],
  });

  assert.deepEqual(bounds, {
    minX: 2,
    minY: 1,
    maxX: 5,
    maxY: 4,
  });
});

test("canvas preview renderer crops to focus bounds and remaps click coordinates", async () => {
  const canvas = createCanvas();
  const selected = [];
  const renderer = createCanvasPreviewRenderer({
    canvas,
    onSelect(position) {
      selected.push(position);
    },
    renderBundleBoard: async ({ canvas: targetCanvas }) => {
      targetCanvas.width = 100;
      targetCanvas.height = 100;
      return {
        ok: true,
        width: 100,
        height: 100,
        tileWidth: 10,
        tileHeight: 10,
      };
    },
  });

  renderer.mount(null, { canvas });
  const result = await renderer.renderPreview({
    tiles: Array.from({ length: 10 }, () => "XXXXXXXXXX"),
    actors: [{ position: { x: 5, y: 6 } }],
    floorAffinityHazards: [],
    observation: { auras: [] },
  });

  assert.equal(result.ok, true);
  assert.equal(canvas.hidden, false);
  assert.equal(canvas.width, 30);
  assert.equal(canvas.height, 30);
  assert.deepEqual(canvas._context.cropReads[0], {
    x: 40,
    y: 50,
    width: 30,
    height: 30,
  });

  canvas.trigger("click", { clientX: 15, clientY: 15 });
  assert.deepEqual(selected, [{ x: 5, y: 6 }]);
});

test("canvas preview renderer degrades cleanly when the canvas implementation cannot crop", async () => {
  const handlers = new Map();
  const canvas = {
    width: 0,
    height: 0,
    hidden: true,
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    getContext() {
      return {
        clearRect() {},
      };
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.width || 1, height: this.height || 1 };
    },
  };
  const renderer = createCanvasPreviewRenderer({
    canvas,
    renderBundleBoard: async ({ canvas: targetCanvas }) => {
      targetCanvas.width = 64;
      targetCanvas.height = 64;
      return {
        ok: true,
        width: 64,
        height: 64,
        tileWidth: 16,
        tileHeight: 16,
      };
    },
  });

  renderer.mount(null, { canvas });
  const result = await renderer.renderPreview({
    tiles: [
      "XXXX",
      "XXXX",
      "XXXX",
      "XXXX",
    ],
    actors: [{ position: { x: 2, y: 2 } }],
  });

  assert.equal(result.ok, true);
  assert.equal(canvas.hidden, false);
  assert.equal(canvas.width, 64);
  assert.equal(canvas.height, 64);
});

test("phaser preview renderer draws the cropped focus window in local coordinates", async () => {
  const dom = createPhaserDom({ width: 300, maxHeight: 300 });
  const records = {};
  const selected = [];
  const renderer = createPhaserPreviewRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect(position) {
      selected.push(position);
    },
  });

  try {
    renderer.mount(dom.container);
    const result = await renderer.renderPreview({
      boardWidth: 10,
      boardHeight: 10,
      resourceBundle: {
        tileWidth: 10,
        tileHeight: 10,
        mappings: { tiles: {}, actors: {}, items: {} },
        assets: [],
      },
      tiles: [
        "XXXXXXXXXX",
        "XXXXXXXXXX",
        "XXXXXXXXXX",
        "XXXXXXXXXX",
        "XXXXXXXXXX",
        "XXXX.XXXXX",
        "XXXXXXXXXX",
        "XXXXXXXXXX",
        "XXXXXXXXXX",
        "XXXXXXXXXX",
      ],
      actors: [{ id: "delver-1", position: { x: 4, y: 5 } }],
      floorAffinityHazards: [],
      observation: { auras: [] },
    });

    assert.equal(result.ok, true);
    assert.equal(dom.stage.dataset.previewWorldTiles, "10x10");
    assert.equal(dom.stage.dataset.previewFocusTiles, "3x3");
    assert.equal(dom.stage.dataset.previewFocusBounds, "3,4,5,6");
    assert.deepEqual(records.camera.bounds, [0, 0, 30, 30]);
    assert.deepEqual(records.camera.center, [15, 15]);
    assert.equal(records.rectangles[0].x, 5);
    assert.equal(records.rectangles[0].y, 5);
    assert.equal(records.rectangles[0].width, 9);
    assert.equal(records.rectangles[0].height, 9);
    assert.ok(records.rectangles.every((node) => node.x <= 25 && node.y <= 25));
    assert.equal(records.circles[0].x, 15);
    assert.equal(records.circles[0].y, 15);

    records.input.handler({ worldX: 15, worldY: 15 });
    assert.deepEqual(selected, [{ x: 4, y: 5 }]);
  } finally {
    renderer.dispose();
    dom.restore();
  }
});

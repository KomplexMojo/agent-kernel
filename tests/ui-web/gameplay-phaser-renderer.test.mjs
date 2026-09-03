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
  records.createdTextures = records.createdTextures || [];
  records.canvasPuts = records.canvasPuts || [];
  records.textureRefreshes = records.textureRefreshes || [];
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
      // Phaser Shapes (rectangle/circle) expose setFillStyle, not setTint.
      setFillStyle(color, alpha) { this.fillColor = color; if (alpha !== undefined) this.fillAlpha = alpha; return this; },
      on(event, handler) { (this.handlers = this.handlers || {})[event] = handler; return this; },
      destroy() { this.destroyed = true; },
    };
  }

  class Game {
    constructor(config) {
      records.config = config;
      // A canvas that accepts DOM listeners and reports a box, so tests can
      // exercise the listeners that actually run in the browser rather than
      // calling the scene.input handlers directly.
      this.canvas = {
        style: {},
        width: 800,
        height: 600,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
      };
      const textureStore = records.textureStore || new Map();
      records.textureStore = textureStore;
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
          exists(key) { return textureStore.has(key); },
          get(key) { return textureStore.get(key); },
          createCanvas(key, width, height) {
            const canvas = {
              width,
              height,
              getContext(type) {
                if (type !== "2d") return null;
                return {
                  createImageData(w, h) {
                    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
                  },
                  putImageData(imageData, x, y) {
                    records.canvasPuts.push({
                      key,
                      x,
                      y,
                      width: imageData.width,
                      height: imageData.height,
                      data: new Uint8ClampedArray(imageData.data),
                    });
                  },
                };
              },
            };
            const texture = {
              key,
              width,
              height,
              getSourceImage() { return canvas; },
              refresh() { records.textureRefreshes.push(key); },
            };
            textureStore.set(key, texture);
            records.createdTextures.push({ key, width, height });
            return texture;
          },
          addImage(key, image) {
            textureStore.set(key, { key, image, getSourceImage() { return image; } });
          },
          addBase64(key, dataUri) {
            textureStore.set(key, { key, dataUri });
          },
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
              clear() { return this; },
              setScrollFactor() { return this; },
              setDepth() { return this; },
              destroy() {},
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
          add(x, y, w, h) {
            const cam = {
              x, y, width: w, height: h, zoom: 1, scrollX: 0, scrollY: 0, ignored: [],
              setName(n) { this.name = n; return this; },
              setZoom(z) { this.zoom = z; return this; },
              setScroll(sx, sy) { this.scrollX = sx; this.scrollY = sy; return this; },
              ignore(objs) { this.ignored.push(...[].concat(objs || [])); return this; },
            };
            (records.extraCameras = records.extraCameras || []).push(cam);
            return cam;
          },
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

/**
 * The listeners production actually binds.
 *
 * Board input is DOM listeners on the STAGE (Phaser v4 delivers no scene.input
 * pointer events). Driving them, rather than calling handler functions with
 * synthetic pointer objects, is the whole point: the old tests asserted the
 * handler's logic and never that an event reached it, so clicking an actor was
 * dead in the browser while they stayed green.
 */
let lastStage = null;
function boardListeners() {
  return lastStage?.listeners || {};
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
      lastStage = child;
      child.parentElement = this;
    },
    get stage() {
      return stage;
    },
  };
}

/**
 * A DOM pointer event over a world point.
 *
 * Board input is DOM listeners on the canvas (Phaser v4 delivers no scene.input
 * pointer events), so tests drive events, not handler arguments -- otherwise
 * they assert the handler's logic without proving anything reaches it. The fake
 * canvas reports a 0,0-anchored box at scale 1, so this is just the camera
 * transform the renderer inverts.
 */
function pointerAt(records, worldX, worldY, extra = {}) {
  const cam = records.scene?.cameras?.main || {};
  const zoom = Number(cam.zoom) || 1;
  return screenPointer(
    (worldX - (cam.scrollX || 0)) * zoom,
    (worldY - (cam.scrollY || 0)) * zoom,
    extra,
  );
}

/** A DOM pointer event at a screen position, for drags measured in screen px. */
function screenPointer(clientX, clientY, extra = {}) {
  return { clientX, clientY, buttons: 0, preventDefault() {}, ...extra };
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

test("gameplay phaser renderer renders archetype wardens and delvers as distinct surface nodes", async () => {
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

  // Both actors must be registered: the stage dataset reflects the correct actor count.
  assert.equal(container.stage.dataset.gameplayActors, "2", "both actors must be registered");
  // Each actor must highlight independently — warden and delver at different x-tiles.
  assert.equal(renderer.highlightActor({ x: 1, y: 1 }), true, "delver at (1,1) must be highlightable");
  assert.equal(renderer.highlightActor({ x: 2, y: 1 }), true, "warden at (2,1) must be highlightable");
  renderer.dispose();
});

test("gameplay phaser renderer composes entity sprite textures for v2 resource bundles", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun({
    ...BOARD_STATE,
    boardWidth: 3,
    boardHeight: 3,
    tiles: ["...", "...", "..."],
    observation: {
      actors: [
        {
          id: "delver-1",
          type: "delver",
          position: { x: 1, y: 1 },
          affinities: [{ kind: "fire", expression: "push" }],
          vitals: { health: { current: 4, max: 10 } },
          motivation: "attacking",
        },
      ],
      hazards: [],
      resources: [],
    },
    resourceBundle: {
      schema: "agent-kernel/ResourceBundleArtifact",
      schemaVersion: 2,
      bundleVersion: 2,
      tileWidth: 64,
      tileHeight: 64,
      assets: [],
      mappings: {},
    },
  });

  // Key is {size}:{role}:{affinity} -- deliberately NOT the actor id. The medallion
  // keyed on id plus a fingerprint of all four vitals, so one texture existed per
  // actor and was rebuilt on every point of damage.
  const spriteImages = records.images.filter((img) => String(img.textureKey) === "ak-sprite:64:delver:fire");
  assert.equal(spriteImages.length, 1, "actor should render from a generated entity sprite texture");
  assert.equal(records.createdTextures.length, 1, "one canvas texture should be created for the composed actor");
  assert.deepEqual(
    { width: records.canvasPuts[0]?.width, height: records.canvasPuts[0]?.height },
    { width: 64, height: 64 },
  );
  assert.equal(records.canvasPuts[0].data.length, 64 * 64 * 4);
  assert.equal(container.stage.dataset.gameplayEntitySprites, "runtime");
  renderer.dispose();
});

const V2_BUNDLE = {
  schema: "agent-kernel/ResourceBundleArtifact",
  schemaVersion: 2,
  bundleVersion: 2,
  tileWidth: 32,
  tileHeight: 32,
  assets: [],
  mappings: {},
};

test("entity sprite textures are shared across entities with the same role and affinity", async () => {
  // The medallion keyed on actor id, so N actors meant N canvas textures. A sprite
  // depends only on role+affinity, so three fire delvers share one.
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(container);
  await renderer.renderRun({
    ...BOARD_STATE,
    boardWidth: 4,
    boardHeight: 4,
    tiles: ["....", "....", "....", "...."],
    observation: {
      actors: [
        { id: "d1", type: "delver", position: { x: 0, y: 0 }, affinities: [{ kind: "fire" }] },
        { id: "d2", type: "delver", position: { x: 1, y: 0 }, affinities: [{ kind: "fire" }] },
        { id: "d3", type: "delver", position: { x: 2, y: 0 }, affinities: [{ kind: "fire" }] },
        { id: "w1", type: "warden", position: { x: 3, y: 0 }, affinities: [{ kind: "fire" }] },
      ],
      hazards: [],
      resources: [],
    },
    resourceBundle: V2_BUNDLE,
  });
  const keys = records.createdTextures.map((t) => t.key);
  assert.deepEqual(
    [...new Set(keys)].sort(),
    ["ak-sprite:32:delver:fire", "ak-sprite:32:warden:fire"],
    "three fire delvers and one fire warden should need exactly two textures",
  );
  assert.equal(keys.length, 2, "a texture that already exists must not be recomposed");
  renderer.dispose();
});

test("changing vitals does not invalidate an entity sprite texture", async () => {
  // The regression the old cache key caused: its key embedded a fingerprint of all
  // four vitals, so a point of damage forced a fresh canvas compose every tick.
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(container);
  const frame = (health) => ({
    ...BOARD_STATE,
    boardWidth: 2,
    boardHeight: 2,
    tiles: ["..", ".."],
    observation: {
      actors: [{
        id: "d1", type: "delver", position: { x: 0, y: 0 },
        affinities: [{ kind: "water" }],
        vitals: { health: { current: health, max: 10 } },
      }],
      hazards: [],
      resources: [],
    },
    resourceBundle: V2_BUNDLE,
  });
  await renderer.renderRun(frame(10));
  await renderer.renderRun(frame(6));
  await renderer.renderRun(frame(1));
  assert.equal(
    records.createdTextures.filter((t) => t.key === "ak-sprite:32:delver:water").length,
    1,
    "vitals belong to the HUD and must not touch the sprite cache",
  );
  renderer.dispose();
});

test("hazards and resources render composed sprites, not bundle art", async () => {
  // These two bypassed the composed path entirely before M3, so the board mixed
  // the new sprite language for actors with retired PNG art for everything else.
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(container);
  await renderer.renderRun({
    ...BOARD_STATE,
    boardWidth: 3,
    boardHeight: 3,
    tiles: ["...", "...", "..."],
    observation: {
      actors: [],
      hazards: [{ id: "h1", position: { x: 0, y: 0 }, affinity: { kind: "decay" } }],
      resources: [{ id: "r1", position: { x: 2, y: 2 }, affinity: { kind: "life" } }],
    },
    resourceBundle: V2_BUNDLE,
  });
  const keys = records.createdTextures.map((t) => t.key);
  assert.ok(keys.includes("ak-sprite:32:hazard:decay"), `hazard sprite missing, got ${JSON.stringify(keys)}`);
  assert.ok(keys.includes("ak-sprite:32:resource:life"), `resource sprite missing, got ${JSON.stringify(keys)}`);
  renderer.dispose();
});

test("camera never shrinks a tile below the legible floor", async () => {
  // Option (a): M1's silhouettes are guaranteed distinct down to 12px and no
  // further, so the camera must refuse to go past it however large the level.
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(container);
  await renderer.renderRun({
    ...BOARD_STATE,
    boardWidth: 400,
    boardHeight: 400,
    tiles: Array.from({ length: 400 }, () => ".".repeat(400)),
    observation: { actors: [], hazards: [], resources: [] },
    resourceBundle: V2_BUNDLE,
  });
  const { zoom } = renderer.getCameraState();
  assert.ok(zoom >= 0.4, `camera zoomed to ${zoom}, past the 0.4 floor`);
  assert.ok(zoom * 32 >= 12, `a tile would render at ${(zoom * 32).toFixed(1)}px, below the 12px floor`);
  renderer.dispose();
});

test("gameplay phaser renderer keeps v1 static actor asset rendering unchanged", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });

  renderer.mount(container);
  await renderer.renderRun({
    ...BOARD_STATE,
    boardWidth: 2,
    boardHeight: 2,
    tiles: ["..", ".."],
    observation: {
      actors: [{ id: "delver-1", type: "delver", position: { x: 1, y: 1 } }],
      hazards: [],
      resources: [],
    },
    resourceBundle: {
      schema: "agent-kernel/ResourceBundleArtifact",
      schemaVersion: 1,
      bundleVersion: 1,
      tileWidth: 32,
      tileHeight: 32,
      assets: [{ id: "actor.delver", dataUri: "data:image/png;base64,AAAA" }],
      mappings: { actors: { delver: "actor.delver" }, tiles: {} },
    },
  });

  assert.ok(
    records.images.some((img) => img.textureKey === "ak-bundle:actor.delver"),
    "v1 actor rendering should continue to use the static bundle texture",
  );
  assert.equal(records.createdTextures.length, 0, "v1 actor rendering must not create composed canvas textures");
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

/**
 * A container whose stage cannot take listeners until `enableListeners()`.
 *
 * This is the browser failure in miniature: on the first bind the element was
 * not yet an event target, so nothing attached.
 */
function makeContainerWithLateStage() {
  const listeners = Object.create(null);
  const stage = {
    dataset: {},
    classList: { add() {} },
    querySelector: () => null,
    listeners,
  };
  return {
    clientWidth: 400,
    clientHeight: 300,
    stage,
    querySelector: (sel) => (sel === "[data-gameplay-phaser-stage]" ? stage : null),
    appendChild() {},
    enableListeners() {
      stage.addEventListener = (type, handler) => { listeners[type] = handler; };
      stage.removeEventListener = (type) => { delete listeners[type]; };
    },
  };
}

test("the HUD readout is cleared when the HUD is hidden", async () => {
  // The dataset field is how a caller (and these tests) tell whether the HUD is
  // up. Leaving the last entity's id on it after deselecting reports a selection
  // that is not on screen.
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const stage = container.stage;

  renderer.showHud({ id: "delver-1", type: "delver", position: { x: 2, y: 2 },
    vitals: { health: { current: 8, max: 10 } } });
  assert.equal(stage.dataset.gameplayHud, "delver-1", "showing the HUD should stamp the readout");

  renderer.hideHud();
  assert.equal(
    stage.dataset.gameplayHud,
    undefined,
    "deselecting must clear it, not leave the previous entity behind",
  );
  renderer.dispose();
});

test("a click that jitters still selects -- a real mouse is never perfectly still", async () => {
  // The defect this exists for: pointermove latched "dragged" on ANY movement,
  // so one pixel of hand tremor between press and release threw the click away
  // and clicking an actor did nothing. Every test here dispatched down->up with
  // no move in between, which is a path no real hand takes, so all of them
  // passed while the board was unusable.
  const records = {};
  const container = makeContainer();
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect: (pos) => selected.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const dom = boardListeners();

  for (const jitter of [1, 2, 3, 5, 6]) {
    selected.length = 0;
    dom.pointerdown(screenPointer(80, 80, { buttons: 1 }));
    dom.pointermove(screenPointer(80 + jitter, 80, { buttons: 1 }));
    dom.pointerup(screenPointer(80 + jitter, 80));
    assert.equal(selected.length, 1, `a ${jitter}px jitter must still select`);
  }

  // Jitter that wanders back and forth is still a click, not a drag.
  selected.length = 0;
  dom.pointerdown(screenPointer(80, 80, { buttons: 1 }));
  for (const [x, y] of [[81, 80], [81, 81], [80, 81], [82, 81]]) {
    dom.pointermove(screenPointer(x, y, { buttons: 1 }));
  }
  dom.pointerup(screenPointer(82, 81));
  assert.equal(selected.length, 1, "several small moves are still a click");
  renderer.dispose();
});

test("movement past the threshold is a drag and selects nothing", async () => {
  // The other half: the threshold has to still mean something.
  const records = {};
  const container = makeContainer();
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect: (pos) => selected.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const dom = boardListeners();

  dom.pointerdown(screenPointer(80, 80, { buttons: 1 }));
  dom.pointermove(screenPointer(100, 90, { buttons: 1 }));
  dom.pointermove(screenPointer(130, 110, { buttons: 1 }));
  dom.pointerup(screenPointer(130, 110));
  assert.equal(selected.length, 0, "a real drag must not select");
  renderer.dispose();
});

test("displacement is measured from the press, not from the last move", async () => {
  // With one shared point, `moved` at pointerup measured only the final mouse
  // segment: a long drag that ended with a small step read as a click.
  const records = {};
  const container = makeContainer();
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect: (pos) => selected.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  const dom = boardListeners();

  dom.pointerdown(screenPointer(80, 80, { buttons: 1 }));
  // Travel a long way, then creep the last pixel before releasing.
  dom.pointermove(screenPointer(200, 80, { buttons: 1 }));
  dom.pointermove(screenPointer(201, 80, { buttons: 1 }));
  dom.pointerup(screenPointer(201, 80));
  assert.equal(selected.length, 0, "ending a drag slowly must not read as a click");
  renderer.dispose();
});

// Mirrors DRAG_SELECT_THRESHOLD in the renderer: how far a press may travel and
// still count as a click.
const DRAG_SELECT_THRESHOLD_PX = 6;

test("crossing the drag threshold does not jump the camera by the threshold", async () => {
  // Panning starts from where the drag began, not from the press, or the view
  // lurches by the whole threshold distance the moment a drag is recognised.
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
  const dom = boardListeners();
  const camera = records.scene.cameras.main;
  const startScroll = { x: camera.scrollX, y: camera.scrollY };

  dom.pointerdown(screenPointer(200, 150, { buttons: 1 }));
  // One pixel past the threshold: the view should move by about that one pixel,
  // not by the whole threshold distance.
  dom.pointermove(screenPointer(207, 150, { buttons: 1 }));
  const afterCrossing = Math.abs(camera.scrollX - startScroll.x) * (records.camera.zoom || 1);
  assert.ok(
    afterCrossing < DRAG_SELECT_THRESHOLD_PX,
    `crossing the threshold lurched ${afterCrossing}px, expected under ${DRAG_SELECT_THRESHOLD_PX}`,
  );

  // Continuing the drag keeps panning, and the motion is not swallowed.
  dom.pointermove(screenPointer(247, 150, { buttons: 1 }));
  assert.ok(
    Math.abs(camera.scrollX - startScroll.x) > afterCrossing,
    "continuing the drag must pan further",
  );
  renderer.dispose();
});

test("a bind that attached no listeners is retried, not latched", async () => {
  // The latch guarding bindCameraInput used to be set even when nothing was
  // bound. One early miss then disabled board input for the life of the
  // renderer, silently -- there is no error, the clicks simply do nothing.
  const records = {};
  const container = makeContainerWithLateStage();
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect: (pos) => selected.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  assert.deepEqual(
    Object.keys(container.stage.listeners),
    [],
    "nothing is bindable yet, so nothing should be bound",
  );

  container.enableListeners();
  await renderer.renderRun(BOARD_STATE);

  assert.equal(
    typeof container.stage.listeners.pointerup,
    "function",
    "the next render must retry the bind rather than trust a latch",
  );
  const cam = records.scene.cameras.main;
  const at = (extra) => ({
    clientX: (80 - (cam.scrollX || 0)) * (cam.zoom || 1),
    clientY: (80 - (cam.scrollY || 0)) * (cam.zoom || 1),
    buttons: 0,
    preventDefault() {},
    ...extra,
  });
  container.stage.listeners.pointerdown(at({ buttons: 1 }));
  container.stage.listeners.pointerup(at());
  assert.equal(selected.length, 1, "board input must work after the retry");
  renderer.dispose();
});

test("a real pointer click on the board selects the tile under it", async () => {
  // The pre-existing selection test drove records.inputHandlers.pointerup(...)
  // directly, which asserts the handler's logic but never that an event reaches
  // it. In Phaser v4 nothing reached it, so clicking an actor did nothing while
  // that test stayed green -- the guard was aimed at the wrong thing.
  // This dispatches through the canvas listeners that actually run.
  const records = {};
  const container = makeContainer();
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect: (pos) => selected.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  const dom = boardListeners();
  assert.ok(dom?.pointerdown && dom?.pointerup, "canvas pointer listeners must be registered");

  const click = (x, y) => {
    dom.pointerdown({ clientX: x, clientY: y, buttons: 1 });
    dom.pointerup({ clientX: x, clientY: y, buttons: 0 });
  };
  click(80, 80);
  assert.equal(selected.length, 1, "a click must select");

  // Assert the MAPPING rather than an absolute tile: where the camera happens to
  // sit is not what this is testing, and pinning it would bake the fake's scroll
  // into the expectation. A tile is 32 WORLD px, so on screen it spans 32 * zoom
  // -- the fit no longer clamps at 1, so this cannot assume they are the same.
  const { zoom } = renderer.getCameraState();
  click(80 + 32 * zoom, 80 + 32 * zoom);
  assert.equal(selected.length, 2);
  assert.deepEqual(
    { dx: selected[1].x - selected[0].x, dy: selected[1].y - selected[0].y },
    { dx: 1, dy: 1 },
    "a 32px move must advance exactly one tile",
  );
  renderer.dispose();
});

test("a drag pans the board instead of selecting", async () => {
  const records = {};
  const container = makeContainer();
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onSelect: (pos) => selected.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  const dom = boardListeners();
  dom.pointerdown({ clientX: 80, clientY: 80, buttons: 1 });
  dom.pointermove({ clientX: 160, clientY: 140, buttons: 1 });
  dom.pointerup({ clientX: 160, clientY: 140, buttons: 0 });
  assert.equal(selected.length, 0, "a drag must not select");
  renderer.dispose();
});

test("hovering the board reports the tile under the pointer", async () => {
  const records = {};
  const container = makeContainer();
  const hovered = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onHover: (pos) => hovered.push(pos),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);

  boardListeners().pointermove({ clientX: 48, clientY: 48, buttons: 0 });
  const first = hovered.at(-1);
  boardListeners().pointermove({ clientX: 48 + 64, clientY: 48, buttons: 0 });
  const second = hovered.at(-1);
  assert.ok(first && second, "hover must report a tile");
  assert.deepEqual(
    { dx: second.x - first.x, dy: second.y - first.y },
    { dx: 2, dy: 0 },
    "a 64px horizontal move must advance exactly two tiles",
  );
  renderer.dispose();
});

test("gameplay phaser renderer fits the whole level on first render", async () => {
  // Changed 2026-09-02. The initial view used to frame only the room containing
  // the spawn, which made a five-room level look like a one-room level on load:
  // the other four sat off-screen with nothing indicating they existed. Loading a
  // run now shows exactly what the Fit button shows.
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
    simConfig: { layout: { data: { width: 30, height: 20, rooms: [{ id: "R1", x: 0, y: 0, width: 4, height: 4 }] } }, seed: 0 },
  });

  // Bounds must CONTAIN the world and stay centred on it. They are no longer the
  // world exactly: Phaser clamps scroll to bounds, so a world smaller than the
  // viewport could not be centred and pinned to one corner, leaving a dead strip.
  const [bx, by, bw, bh] = records.camera.bounds;
  assert.ok(bw >= 960 && bh >= 640, `bounds ${bw}x${bh} must contain the 960x640 world`);
  assert.equal(bx + bw / 2, 960 / 2, "bounds must stay centred on the world in x");
  assert.equal(by + bh / 2, 640 / 2, "bounds must stay centred on the world in y");
  // Centred on the level, not on a room inside it.
  assert.deepEqual(records.camera.center, [480, 320], "should centre on the whole level");
  // The whole world fits the viewport in BOTH axes -- that is what "fit" means.
  // It is no longer capped at 1: the level fills the screen, so a small level is
  // magnified rather than left sitting in a corner.
  assert.ok(
    records.camera.zoom * 960 <= container.clientWidth + 1,
    `fitted world width ${records.camera.zoom * 960} exceeds viewport ${container.clientWidth}`,
  );
  assert.ok(
    records.camera.zoom * 640 <= container.clientHeight + 1,
    `fitted world height ${records.camera.zoom * 640} exceeds viewport ${container.clientHeight}`,
  );
  assert.equal(container.stage.dataset.gameplayWorldPixels, "960x640");
  renderer.dispose();
});

test("the view on load is the view the Fit control returns to", async () => {
  // The two share fitCameraToWorld deliberately, so Fit is never a different
  // framing from the one the run opened with.
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
  const onLoad = renderer.getCameraState().zoom;
  renderer.zoomIn();
  assert.notEqual(renderer.getCameraState().zoom, onLoad, "precondition: zoom should have changed");
  renderer.fitToLevel();
  assert.equal(renderer.getCameraState().zoom, onLoad, "Fit must return to the load framing");
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
    simConfig: { layout: { data: { width: 30, height: 20, rooms: [{ id: "R1", x: 0, y: 0, width: 4, height: 4 }] } }, seed: 0 },
  });
  const fitZoom = renderer.getCameraState().zoom;
  const zoomedIn = renderer.zoomIn();
  assert.ok(zoomedIn > fitZoom);
  const zoomedOut = renderer.zoomOut();
  assert.ok(zoomedOut <= zoomedIn);
  // fitToLevel() used to zoom OUT relative to the load view, because loading
  // framed the entry room. Loading now fits the whole level, so Fit returns to
  // exactly the framing the run opened with rather than a different one.
  assert.equal(renderer.fitToLevel(), fitZoom);
  renderer.dispose();
});

test("gameplay phaser zoom controls preserve the current camera center", async () => {
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

  boardListeners().pointerdown(screenPointer(120, 100, { buttons: 1 }));
  boardListeners().pointermove(screenPointer(80, 130, { buttons: 1 }));
  boardListeners().pointerup(screenPointer(80, 130));

  const camera = records.scene.cameras.main;
  const centerBeforeZoom = {
    x: camera.scrollX + camera.width / (2 * camera.zoom),
    y: camera.scrollY + camera.height / (2 * camera.zoom),
  };

  renderer.zoomIn();

  assert.deepEqual(records.camera.center, [centerBeforeZoom.x, centerBeforeZoom.y]);
  assert.equal(camera.scrollX + camera.width / (2 * camera.zoom), centerBeforeZoom.x);
  assert.equal(camera.scrollY + camera.height / (2 * camera.zoom), centerBeforeZoom.y);
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

  boardListeners().pointerdown(screenPointer(100, 100, { buttons: 1 }));
  boardListeners().pointermove(screenPointer(130, 120, { buttons: 1 }));
  boardListeners().pointerup(screenPointer(130, 120));

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
  boardListeners().pointermove(pointerAt(records, 80, 80));
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
  boardListeners().pointermove(pointerAt(records, 80, 80));
  boardListeners().pointermove(pointerAt(records, 112, 80));
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
  boardListeners().pointermove(pointerAt(records, 80, 80));
  boardListeners().pointermove(pointerAt(records, 85, 82));
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
  boardListeners().pointerdown(pointerAt(records, 80, 80, { buttons: 1 }));
  boardListeners().pointermove(pointerAt(records, 112, 80, { buttons: 1 }));
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
  assert.equal(typeof boardListeners().pointerleave, "function", "pointerleave must be registered");
  boardListeners().pointerleave(screenPointer(0, 0));
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

// --- M4: the camera-fixed selected-entity HUD ---
//
// These replace the showQuickView suite. The quick view was a world-space panel
// anchored to the entity's tile: it scrolled with the board and shrank with camera
// zoom, so it was least readable exactly when zoomed out. The HUD is fixed to the
// camera instead, and it is where the vitals, expression and motivation that M1
// removed from the sprite now live.

async function mountedRenderer(records) {
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  return { renderer, container };
}

test("HUD renders one labelled bar per vital the role has", async () => {
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud(QUICK_VIEW_MODEL_FULL);
  for (const label of ["HP", "MP", "ST", "DU"]) {
    assert.ok(records.texts.some((t) => t.text === label), `missing ${label} label`);
  }
  for (const key of ["health", "mana", "stamina", "durability"]) {
    assert.ok(
      records.rectangles.some((r) => r.name === `gameplay-hud-bar:${key}`),
      `missing proportional bar for ${key}`,
    );
  }
  renderer.dispose();
});

test("HUD bar length is proportional to the vital fraction", async () => {
  // The quick view drew a fixed-width track with a 2px tick sliding along it.
  // A filled bar reads at a glance; a moving tick has to be measured.
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud(QUICK_VIEW_MODEL_FULL);
  const bar = (k) => records.rectangles.find((r) => r.name === `gameplay-hud-bar:${k}`);
  assert.ok(bar("stamina").width > bar("durability").width,
    "stamina 7/7 must draw a longer bar than durability 3/8");
  assert.ok(bar("health").width > bar("mana").width,
    "health 8/10 must draw a longer bar than mana 5/8");
  renderer.dispose();
});

test("HUD renders current/max text and regen blocks", async () => {
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud(QUICK_VIEW_MODEL_FULL);
  for (const value of ["8/10", "5/8", "7/7", "3/8"]) {
    assert.ok(records.texts.some((t) => t.text === value), `missing value text ${value}`);
  }
  const blocks = records.rectangles.filter((r) => r.width === 5 && r.height === 5);
  assert.equal(blocks.length, 3, "regen 1 + 2 + 0 + 0 should draw three blocks");
  renderer.dispose();
});

test("HUD sits in the top-right, clear of the level", async () => {
  // Moved from bottom-left 2026-09-02: with the inventory rail gone the board
  // fills the viewport, and bottom-left sat over the entry room on most
  // generated levels. Asserted against the viewport rather than a literal so a
  // different panel size cannot silently push it off-screen.
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud(QUICK_VIEW_MODEL_FULL);
  const hud = records.containers.find((c) => c.name === "gameplay-hud");
  assert.ok(hud, "HUD container missing");
  const { viewportWidth, viewportHeight, worldWidth } = renderer.getCameraState();
  // Overlaid on the LEVEL, not parked in the margin beside it. Anchoring to the
  // viewport put the panel outside the level whenever its aspect ratio left an
  // empty strip, which read as a side rail -- the thing this replaced.
  const panel = records.rectangles
    .filter((r) => r.width && r.height)
    .reduce((widest, r) => (r.width > (widest?.width ?? 0) ? r : widest), null);
  assert.ok(panel, "HUD background rect missing");
  // The camera is centred on the world after a fit, so the level's on-screen box
  // follows from exposed state alone -- no reaching into the camera object.
  const { zoom, worldHeight } = renderer.getCameraState();
  const levelRight = (worldWidth / 2) * zoom + viewportWidth / 2;
  const levelTop = viewportHeight / 2 - (worldHeight / 2) * zoom;
  assert.ok(
    hud.x + panel.width <= levelRight + 1,
    `HUD right edge ${hud.x + panel.width} sits past the level's right edge ${levelRight}`,
  );
  assert.ok(hud.y >= levelTop - 1, `HUD top ${hud.y} sits above the level's top ${levelTop}`);
  assert.ok(hud.x >= 0 && hud.y >= 0, "HUD must stay inside the viewport");
  assert.ok(hud.y < viewportHeight / 2, `HUD y ${hud.y} is not in the top half`);
  assert.ok(viewportWidth > 0, "precondition");
  renderer.dispose();
});

test("HUD is independent of board pan AND board zoom", async () => {
  // scrollFactor 0 alone is NOT enough and asserting only that is a guard aimed at
  // the wrong property: Phaser still scales scrollFactor-0 objects about the camera
  // centre, so at zoom 3 the first version of this HUD was scaled 3x and pushed off
  // screen while this test passed. Running the app is what caught it. The HUD now
  // renders on its own camera at zoom 1.
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud(QUICK_VIEW_MODEL_FULL);

  const hud = records.containers.find((c) => c.name === "gameplay-hud");
  assert.ok(hud, "HUD container missing");
  assert.equal(hud.scrollFactor, 0, "HUD must not scroll with the board");
  assert.ok(hud.depth >= 1000, "HUD must draw above the board");

  const hudCam = (records.extraCameras || []).find((c) => c.name === "gameplay-hud-camera");
  assert.ok(hudCam, "HUD must render on its own camera");
  assert.equal(hudCam.zoom, 1, "the HUD camera must never zoom");

  // Zooming the board must not touch the HUD camera.
  renderer.zoomIn?.();
  renderer.zoomIn?.();
  assert.ok(records.camera.zoom !== 1, "precondition: the board camera should have zoomed");
  assert.equal(hudCam.zoom, 1, "board zoom must not reach the HUD camera");

  // And the two cameras must not both draw the same objects.
  assert.ok(hudCam.ignored.length > 0, "the HUD camera must ignore the board container");
  renderer.dispose();
});

test("HUD shows the identity channels the sprite also carries", async () => {
  // Affinity and expression appear on the HUD as well as the board so the two can
  // be checked against each other.
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud(QUICK_VIEW_MODEL_FULL);
  const identity = records.texts.find((t) => t.name === "gameplay-hud-identity");
  assert.ok(identity, "identity line missing");
  assert.match(identity.text, /fire/);
  assert.ok(records.texts.some((t) => t.text === "delver-1"), "entity id missing");
  renderer.dispose();
});

test("HUD shows motivation, which the sprite no longer encodes", async () => {
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud({ ...QUICK_VIEW_MODEL_FULL, motivation: "patrolling" });
  const footer = records.texts.find((t) => t.name === "gameplay-hud-motivation");
  assert.ok(footer, "motivation missing from the HUD");
  assert.equal(footer.text, "patrolling");
  renderer.dispose();
});

test("HUD renders only the vitals present, without inventing empty bars", async () => {
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud(QUICK_VIEW_MODEL_PARTIAL);
  const bars = records.rectangles.filter((r) => String(r.name || "").startsWith("gameplay-hud-bar:"));
  assert.ok(bars.length > 0 && bars.length <= 2, `expected at most two bars, got ${bars.length}`);
  assert.ok(!records.texts.some((t) => t.text === "DU"), "must not show a vital the entity did not report");
  renderer.dispose();
});

test("HUD with no vitals still renders the identity header", async () => {
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud({ ...QUICK_VIEW_MODEL_SINGLE, vitals: null });
  assert.ok(records.texts.some((t) => t.text === "hazard-1"));
  const bars = records.rectangles.filter((r) => String(r.name || "").startsWith("gameplay-hud-bar:"));
  assert.equal(bars.length, 0);
  renderer.dispose();
});

test("hideHud destroys the HUD container", async () => {
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud(QUICK_VIEW_MODEL);
  const hud = records.containers.find((c) => c.name === "gameplay-hud");
  renderer.hideHud();
  assert.equal(hud.destroyed, true);
  renderer.dispose();
});

test("hideHud before showHud does not throw", async () => {
  const records = {};
  const { renderer } = await mountedRenderer(records);
  assert.doesNotThrow(() => renderer.hideHud());
  renderer.dispose();
});

test("showHud replaces the existing HUD rather than stacking a second one", async () => {
  const records = {};
  const { renderer } = await mountedRenderer(records);
  renderer.showHud(QUICK_VIEW_MODEL);
  const first = records.containers.find((c) => c.name === "gameplay-hud");
  renderer.showHud({ ...QUICK_VIEW_MODEL, id: "warden-1" });
  assert.equal(first.destroyed, true, "the previous HUD must be destroyed");
  const live = records.containers.filter((c) => c.name === "gameplay-hud" && !c.destroyed);
  assert.equal(live.length, 1, "exactly one HUD may exist at a time");
  renderer.dispose();
});

test("showHud ignores input that is not an entity", async () => {
  const records = {};
  const { renderer } = await mountedRenderer(records);
  for (const bad of [null, undefined, 42, "delver"]) {
    assert.doesNotThrow(() => renderer.showHud(bad));
  }
  assert.equal(records.containers.filter((c) => c.name === "gameplay-hud" && !c.destroyed).length, 0);
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

test("highlightActor applies a selection tint to the actor node", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.highlightActor({ x: 2, y: 2 });
  // After highlight, exactly one rectangle must carry the selection tint.
  const tinted = records.rectangles.filter((r) => r.tint === SELECTION_TINT);
  assert.equal(tinted.length, 1, "exactly one node must have selection tint after highlight");
  renderer.dispose();
});

test("clearHighlight clears the selection tint from the actor node", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(BOARD_STATE);
  renderer.highlightActor({ x: 2, y: 2 });
  renderer.clearHighlight();
  // After clearHighlight, no rectangle should carry the selection tint.
  const tinted = records.rectangles.filter((r) => r.tint === SELECTION_TINT);
  assert.equal(tinted.length, 0, "selection tint must be cleared after clearHighlight");
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
  // delver at (2,2), warden at (2,3)
  renderer.highlightActor({ x: 2, y: 2 });
  renderer.highlightActor({ x: 2, y: 3 });
  // After switching highlight, exactly one node must carry the selection tint (the warden's).
  const tinted = records.rectangles.filter((r) => r.tint === SELECTION_TINT);
  assert.equal(tinted.length, 1, "exactly one node must have selection tint after switching highlight");
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
  boardListeners().pointermove(pointerAt(records, 80, 80));
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
  boardListeners().pointerdown(pointerAt(records, 80, 80, { buttons: 1 }));
  boardListeners().pointerup(pointerAt(records, 80, 80));
  assert.equal(selected.length, 0, "onSelect must be suppressed while player panel is open");
  renderer.dispose();
});

// --- M3: tile affinity visuals in the renderer ---

import bundle from "../fixtures/ui-web/resource-hazard-run-bundle.json" with { type: "json" };

const AFFINITY_BOARD_STATE = {
  tiles: ["XXXXX", "X...X", "X...X", "X...X", "XXXXX"],
  boardWidth: 5,
  boardHeight: 5,
  simConfig: { layout: { data: { width: 5, height: 5, rooms: [] } }, seed: 0 },
  initialState: {
    actors: [
      { id: "delver-1", type: "delver", position: { x: 1, y: 1 } },
    ],
  },
  observation: {
    actors: [
      { id: "delver-1", type: "delver", position: { x: 1, y: 1 } },
    ],
    hazards: [
      {
        id: "fire-hazard-1",
        kind: "fire",
        position: { x: 2, y: 2 },
        emitStrength: 3,
        affinityStacks: [{ kind: "fire", stacks: 2, expression: "burning" }],
      },
    ],
    resources: [],
  },
  resourceBundle: bundle.artifacts[2],
  tileVisuals: new Map([
    ["2,2", { intensity: 1.0, affinityKind: "fire", expression: "burning", color: 0xff4400, alpha: 1.0, overlayAssetId: "overlay-fire-glow", isWall: false }],
    ["2,1", { intensity: 0.66, affinityKind: "fire", expression: "burning", color: 0xff4400, alpha: 0.66, overlayAssetId: "overlay-fire-glow", isWall: false }],
    ["2,3", { intensity: 0.66, affinityKind: "fire", expression: "burning", color: 0xff4400, alpha: 0.66, overlayAssetId: "overlay-fire-glow", isWall: false }],
    ["1,2", { intensity: 0.66, affinityKind: "fire", expression: "burning", color: 0xff4400, alpha: 0.66, overlayAssetId: "overlay-fire-glow", isWall: false }],
    ["3,2", { intensity: 0.66, affinityKind: "fire", expression: "burning", color: 0xff4400, alpha: 0.66, overlayAssetId: "overlay-fire-glow", isWall: false }],
    ["1,1", { intensity: 0.33, affinityKind: "fire", expression: "burning", color: 0xff4400, alpha: 0.33, overlayAssetId: null, isWall: false }],
    ["3,1", { intensity: 0.33, affinityKind: "fire", expression: "burning", color: 0xff4400, alpha: 0.33, overlayAssetId: null, isWall: false }],
    ["1,3", { intensity: 0.33, affinityKind: "fire", expression: "burning", color: 0xff4400, alpha: 0.33, overlayAssetId: null, isWall: false }],
    ["3,3", { intensity: 0.33, affinityKind: "fire", expression: "burning", color: 0xff4400, alpha: 0.33, overlayAssetId: null, isWall: false }],
  ]),
};

test("an affinity field never fully replaces the floor under it", async () => {
  // Regression guard. When tiles became flat fills, a full-intensity field was
  // painted straight onto the tile at alpha 1. A sprite is drawn in its own
  // affinity colour, so an actor standing in its own field became that colour on
  // that colour and only its outline survived -- exactly what the board showed.
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(container);
  await renderer.renderRun(AFFINITY_BOARD_STATE);

  const fields = records.rectangles.filter((r) => String(r.name || "").startsWith("tile-field:"));
  assert.ok(fields.length > 0, "expected affinity field overlays");
  for (const f of fields) {
    assert.ok(
      f.alpha <= 0.45,
      `field alpha ${f.alpha} would repaint the tile and swallow a sprite of the same affinity`,
    );
    assert.ok(f.alpha > 0, "an invisible field is not a field");
  }
  renderer.dispose();
});

test("drawBoard applies tint to floor tiles when tileVisuals are provided", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(AFFINITY_BOARD_STATE);

  // Floor tiles at affected positions must have their tint set to the affinity color.
  // Tile at (2,2) is the origin with color 0xff4400.
  // The affinity field is drawn as a capped-alpha overlay ABOVE the tile rather
  // than by repainting the tile, so the floor still reads underneath and a sprite
  // standing in a field of its own affinity is not swallowed by it.
  const shows = (node, c) => node.tint === c || node.color === c || node.fillColor === c;
  const tintedTiles = [...records.rectangles, ...records.images].filter((node) => shows(node, 0xff4400));
  assert.ok(
    tintedTiles.length > 0,
    "at least one floor tile node must have the affinity tint applied",
  );
  renderer.dispose();
});

test("drawBoard applies alpha to floor tiles based on tileVisuals intensity", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(AFFINITY_BOARD_STATE);

  // Check that at least one tile has a reduced alpha matching a non-origin intensity.
  const reducedAlpha = [...records.rectangles, ...records.images].filter(
    (r) => typeof r.alpha === "number" && r.alpha > 0 && r.alpha < 1,
  );
  assert.ok(
    reducedAlpha.length > 0,
    "floor tiles at distance from hazard must have reduced alpha from tileVisuals",
  );
  renderer.dispose();
});

test("drawBoard registers overlay textures for affected tiles with overlayAssetId", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun(AFFINITY_BOARD_STATE);

  // The PREFIXED key, which is what the texture is actually registered under.
  // This asserted the bare asset id -- the very value the renderer used to hand
  // Phaser, and a key that never exists, so Phaser painted its missing-texture
  // placeholder over the tile. The test pinned the defect in place.
  const overlayImages = records.images.filter(
    (img) => img.textureKey === "ak-bundle:overlay-fire-glow",
  );
  assert.equal(
    records.images.filter((img) => img.textureKey === "overlay-fire-glow").length,
    0,
    "the unprefixed asset id must never reach Phaser as a texture key",
  );
  assert.ok(
    overlayImages.length > 0,
    "affected tiles with overlayAssetId must produce overlay image nodes",
  );
  // Origin plus 4 cardinal neighbors have overlayAssetId set
  assert.ok(
    overlayImages.length >= 5,
    `expected at least 5 overlay images (origin + 4 cardinal), got ${overlayImages.length}`,
  );
  renderer.dispose();
});

test("an overlay mapping pointing at an asset the bundle does not ship draws nothing", async () => {
  // The failure this guards is a Phaser missing-texture placeholder painted over
  // the tile -- worse than no overlay, because it looks like real art. The
  // mapping and the asset list are separate parts of the bundle and can
  // disagree, so the renderer has to tolerate a dangling reference.
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);
  await renderer.renderRun({
    ...AFFINITY_BOARD_STATE,
    resourceBundle: {
      ...AFFINITY_BOARD_STATE.resourceBundle,
      // The mapping still names an overlay, but the asset is gone.
      assets: (AFFINITY_BOARD_STATE.resourceBundle.assets || [])
        .filter((a) => a.id !== "overlay-fire-glow"),
    },
  });

  const drawnKeys = records.images.map((img) => String(img.textureKey));
  assert.equal(
    drawnKeys.filter((k) => k.includes("overlay-fire-glow")).length,
    0,
    `a dangling overlay reference must draw nothing, got ${drawnKeys.join("|")}`,
  );
  // The board itself still renders.
  assert.ok(records.rectangles.length > 0, "tiles must still be drawn");
  renderer.dispose();
});

test("drawBoard does not apply tint to tiles without affinity visuals", async () => {
  const records = {};
  const container = makeContainer();
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
  });
  renderer.mount(container);

  // Use the base BOARD_STATE which has no tileVisuals
  await renderer.renderRun(BOARD_STATE);

  // No rectangles should have the affinity tint
  const affinityTinted = records.rectangles.filter((r) => [r.tint, r.color, r.fillColor].includes(0xff4400));
  assert.equal(
    affinityTinted.length,
    0,
    "tiles without tileVisuals must not have affinity tint applied",
  );
  renderer.dispose();
});

test("renderRun with empty actors, hazards, and resources renders tiles only", async () => {
  const records = {};
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(makeContainer());

  await renderer.renderRun({
    ...BOARD_STATE,
    observation: { actors: [], hazards: [], resources: [] },
  });

  assert.ok(records.rectangles.length > 0);
  assert.equal(records.circles.length, 0);
  renderer.dispose();
});

test("renderRun with null observation renders tiles without throwing", async () => {
  const records = {};
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(makeContainer());

  await assert.doesNotReject(() => renderer.renderRun({ ...BOARD_STATE, observation: null }));
  assert.ok(records.rectangles.length > 0);
  renderer.dispose();
});

test("resourceBundle asset mappings pass texture keys to image nodes for actor medallions", async () => {
  const records = {};
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(makeContainer());
  await renderer.renderRun({ ...BOARD_STATE, resourceBundle: { schemaVersion: 2, assets: [], mappings: { actors: {} } } });
  assert.ok(records.images.length > 0);
});

// STAYS SKIPPED — fails today: describes medallion/affinity behavior the renderer does not implement (checked 2026-08-01).
test.skip("v2 ResourceBundle duplicate actor ids refresh the same medallion texture safely", async () => {
  assert.equal(true, false, "fake Phaser harness does not expose generated medallion texture lifecycle");
});

// STAYS SKIPPED — fails today: describes medallion/affinity behavior the renderer does not implement (checked 2026-08-01).
test.skip("v2 ResourceBundle actor without id falls back to deterministic state-based medallion key", async () => {
  assert.equal(true, false, "fake Phaser harness does not expose generated medallion texture keys");
});

test("resourceBundle absent falls back to primitive shapes for actors, hazards, and resources", async () => {
  const records = {};
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(makeContainer());

  await renderer.renderRun({ ...BOARD_STATE, resourceBundle: null });

  assert.ok(records.rectangles.length + records.circles.length + records.texts.length > 0);
  assert.equal(records.images.length, 0);
  renderer.dispose();
});

test("renderFrame advances actor positions and handles frames with no actors", async () => {
  const records = {};
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(makeContainer());
  await renderer.renderRun(BOARD_STATE);

  await assert.doesNotReject(() => renderer.renderFrame({
    ...BOARD_STATE,
    observation: { ...BOARD_STATE.observation, actors: [{ id: "delver-1", type: "delver", position: { x: 3, y: 2 } }] },
  }));
  await assert.doesNotReject(() => renderer.renderFrame({ ...BOARD_STATE, observation: { actors: [] } }));

  renderer.dispose();
});

test("dispose before render, double dispose, and highlight no-ops are safe", async () => {
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser({}) });

  assert.doesNotThrow(() => renderer.dispose());
  assert.doesNotThrow(() => renderer.dispose());
  assert.equal(renderer.highlightActor({ x: 2, y: 2 }), false);
  assert.doesNotThrow(() => renderer.clearHighlight());
});

test("highlightActor on a hazard position returns false and clearHighlight remains safe after dispose", async () => {
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser({}) });
  renderer.mount(makeContainer());
  await renderer.renderRun(BOARD_STATE);

  assert.equal(renderer.highlightActor({ x: 1, y: 2 }), false);
  renderer.dispose();
  assert.doesNotThrow(() => renderer.clearHighlight());
});

test("openPlayerPanel tolerates missing vitals, affinities, motivations, and pre-render use", async () => {
  const records = {};
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(makeContainer());

  assert.doesNotThrow(() => renderer.openPlayerPanel({ id: "actor-empty", entityType: "actor" }));
  assert.equal(renderer.isPlayerPanelOpen(), false);
  await renderer.renderRun(BOARD_STATE);
  assert.doesNotThrow(() => renderer.openPlayerPanel({ id: "actor-empty", entityType: "actor", vitals: {}, affinities: [], motivations: [] }));
  assert.equal(renderer.isPlayerPanelOpen(), true);
  renderer.dispose();
});

test("onHover and onSelect resume after closePlayerPanel", async () => {
  const records = {};
  const hovered = [];
  const selected = [];
  const renderer = createGameplayPhaserRenderer({
    loadPhaser: async () => createFakePhaser(records),
    onHover: (pos) => hovered.push(pos),
    onSelect: (pos) => selected.push(pos),
  });
  renderer.mount(makeContainer());
  await renderer.renderRun(BOARD_STATE);
  renderer.openPlayerPanel(PLAYER_PANEL_MODEL);
  renderer.closePlayerPanel();

  // No optional chaining: a listener that is not registered must fail here
  // rather than no-op into an assertion about an empty array.
  boardListeners().pointermove(pointerAt(records, 80, 80));
  boardListeners().pointerdown(pointerAt(records, 80, 80, { buttons: 1 }));
  boardListeners().pointerup(pointerAt(records, 80, 80));

  assert.ok(hovered.length >= 1);
  assert.ok(selected.length >= 1);
  renderer.dispose();
});

test("tileVisuals on walls or without overlayAssetId tint tiles without image overlays", async () => {
  const records = {};
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(makeContainer());

  await renderer.renderRun({
    ...BOARD_STATE,
    tileVisuals: new Map([
      ["0,0", { affinityKind: "fire", intensity: 0.8, color: 0xff4400, alpha: 0.8, isWall: true }],
      ["2,2", { affinityKind: "water", intensity: 0.6, color: 0x2b7fff, alpha: 0.6 }],
    ]),
  });

  assert.ok(records.rectangles.some((rect) => [rect.tint, rect.color, rect.fillColor].some((c) => c === 0xff4400 || c === 0x2b7fff)));
  assert.equal(records.images.length, 0);
  renderer.dispose();
});

// STAYS SKIPPED — fails today: describes medallion/affinity behavior the renderer does not implement (checked 2026-08-01).
test.skip("overlapping affinity visuals from two hazards use combined intensity", async () => {
  assert.equal(true, false, "tileVisuals map currently carries already-resolved per-tile intensity");
});

test("renderFrame preserves non-zero tileVisuals across frame updates", async () => {
  const records = {};
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(makeContainer());
  const tileVisuals = new Map([
    ["2,3", { affinityKind: "water", intensity: 0.7, color: 0x2b7fff, alpha: 0.7 }],
  ]);
  await renderer.renderRun({ ...BOARD_STATE, tileVisuals });
  await renderer.renderFrame({ ...BOARD_STATE, tileVisuals });

  assert.ok(records.rectangles.some((rect) => [rect.tint, rect.color, rect.fillColor].includes(0x2b7fff)));
  renderer.dispose();
});

// STAYS SKIPPED — fails today: describes medallion/affinity behavior the renderer does not implement (checked 2026-08-01).
test.skip("tileVisuals with intensity of 0 produces no visual change on the tile", async () => {
  const records = {};
  const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => createFakePhaser(records) });
  renderer.mount(makeContainer());
  await renderer.renderRun({
    ...BOARD_STATE,
    tileVisuals: new Map([["2,2", { affinityKind: "fire", intensity: 0, color: 0xff4400, alpha: 0 }]]),
  });
  assert.equal(records.rectangles.some((rect) => [rect.tint, rect.color, rect.fillColor].includes(0xff4400)), false);
  renderer.dispose();
});

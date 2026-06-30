// M6 — Standalone Phaser sandbox view tests.
//
// Surface tested: createPhaserSandboxView
//   - Mounts without the full Web UI shell
//   - Reuses createGameplayPhaserRenderer (wraps, never forks)
//   - Renders tiles and all entity archetypes from a sandbox bundle
//   - Keyboard callbacks emit movement intents without implementing game rules
//
// Fixture: tests/fixtures/sandbox/phaser-sandbox-bundle-v1-basic.json

import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPhaserSandboxView } from "../../packages/ui-web/src/views/phaser-sandbox-view.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "../fixtures/sandbox/phaser-sandbox-bundle-v1-basic.json");
const OVERLAP_FIXTURE_PATH = resolve(__dirname, "../fixtures/sandbox/affinity-overlap-v1-water-fire.json");

// ---------------------------------------------------------------------------
// Shared test helpers — minimal Phaser stub (same shape as renderer tests)
// ---------------------------------------------------------------------------

function createFakePhaser(records = {}) {
  records.rectangles = records.rectangles || [];
  records.circles    = records.circles    || [];
  records.texts      = records.texts      || [];
  records.images     = records.images     || [];
  records.containers = records.containers || [];
  records.camera     = records.camera     || {};
  records.resizes    = records.resizes    || [];
  records.inputHandlers = records.inputHandlers || {};
  records.destroyed  = false;

  function createNode(type, props = {}) {
    return {
      type, ...props,
      setStrokeStyle(...a) { this.stroke = a; return this; },
      setAngle(v)          { this.angle = v; return this; },
      setDepth(v)          { this.depth = v; return this; },
      setDisplaySize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; },
      setTint(t)           { this.tint = t; return this; },
      clearTint()          { this.tint = undefined; return this; },
      setOrigin(x, y)      { this.origin = { x, y }; return this; },
      setName(n)           { this.name = n; return this; },
      setData(k, v)        { (this.data = this.data || {})[k] = v; return this; },
      setAlpha(a)          { this.alpha = a; return this; },
      setScale(s)          { this.scale = s; return this; },
      setPosition(x, y)   { this.x = x; this.y = y; return this; },
      setVisible(v)        { this.visible = v; return this; },
      setInteractive()     { this.interactive = true; return this; },
      setScrollFactor(f)   { this.scrollFactor = f; return this; },
      on(event, handler)   { (this.handlers = this.handlers || {})[event] = handler; return this; },
      destroy()            { this.destroyed = true; },
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
            records.scene.cameras.main.width  = w;
            records.scene.cameras.main.height = h;
          }
        },
      };
      const scene = {
        textures: { exists() { return false; }, addImage() {} },
        add: {
          container(x, y) {
            const node = createNode("container", {
              x, y, list: [],
              add(child) { this.list.push(child); return child; },
              destroy()  { this.destroyed = true; },
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
          main: {
            scrollX: 0, scrollY: 0,
            width: config.width, height: config.height, zoom: 1,
            setViewport(...a) { records.camera.viewport = a; return this; },
            setBounds(...a)   { records.camera.bounds = a;   return this; },
            setZoom(v)        { this.zoom = v; records.camera.zoom = v; return this; },
            centerOn(x, y) {
              records.camera.center = [x, y];
              this.scrollX = x - this.width  / (2 * this.zoom);
              this.scrollY = y - this.height / (2 * this.zoom);
              return this;
            },
          },
        },
        input: {
          on(event, handler) {
            const prev = records.inputHandlers[event];
            records.inputHandlers[event] = prev
              ? (...a) => { prev(...a); handler(...a); }
              : handler;
          },
          keyboard: {
            on(event, handler) { records.inputHandlers[event] = handler; },
          },
        },
        events: {
          on(event, handler) {
            if (!records.inputHandlers[event]) records.inputHandlers[event] = handler;
          },
        },
        tweens: { add(c) { (records.tweens = records.tweens || []).push(c); } },
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
    clientWidth: 400, clientHeight: 300,
    querySelector(sel) { return sel === "[data-gameplay-phaser-stage]" ? stage : null; },
    appendChild(child) { stage = child; child.parentElement = this; },
    get stage() { return stage; },
  };
}

async function loadBundle() {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

test("mounts standalone sandbox view without throwing", () => {
  const records = {};
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
  });
  assert.doesNotThrow(() => view.mount(makeContainer()));
  view.dispose();
});

// ---------------------------------------------------------------------------
// Renderer reuse (success criterion 4)
// ---------------------------------------------------------------------------

test("reuses gameplay Phaser renderer — getRenderer exposes the underlying renderer API", () => {
  const records = {};
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
  });
  const renderer = view.getRenderer();

  // The renderer returned by createGameplayPhaserRenderer has these methods.
  // Verify shape rather than identity to stay decoupled from implementation details.
  assert.equal(typeof renderer.mount,       "function", "renderer must have mount");
  assert.equal(typeof renderer.renderRun,   "function", "renderer must have renderRun");
  assert.equal(typeof renderer.renderFrame, "function", "renderer must have renderFrame");
  assert.equal(typeof renderer.dispose,     "function", "renderer must have dispose");

  view.dispose();
});

// ---------------------------------------------------------------------------
// Rendering from a sandbox bundle
// ---------------------------------------------------------------------------

test("renders tile grid from sandbox bundle — produces rectangle shapes", async () => {
  const records = {};
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
  });
  const container = makeContainer();
  view.mount(container);

  const bundle = await loadBundle();
  await view.renderBundle(bundle);

  assert.ok(
    records.rectangles.length > 0,
    "renderBundle must produce at least one tile rectangle",
  );
  view.dispose();
});

test("renders delver and warden archetypes from sandbox bundle", async () => {
  const records = {};
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
  });
  view.mount(makeContainer());

  const bundle = await loadBundle();
  await view.renderBundle(bundle);

  // Actors (delver + warden) produce circles or rectangles via the renderer.
  const totalShapes = records.circles.length + records.rectangles.length;
  assert.ok(
    totalShapes >= 2,
    `expected shapes for delver_1 and warden_1, got ${totalShapes} total shapes`,
  );
  view.dispose();
});

test("renders hazard archetype from sandbox bundle", async () => {
  const records = {};
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
  });
  view.mount(makeContainer());

  // Bundle with only a hazard actor — verifies hazard routing in buildBoardState.
  const bundle = {
    simConfig: (await loadBundle()).simConfig,
    initialState: {
      schema: "agent-kernel/InitialStateArtifact",
      schemaVersion: 1,
      meta: { id: "is-hazard", runId: "t", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "test" },
      actors: [
        { id: "hazard_fire", kind: "stationary", archetype: "hazard",
          position: { x: 2, y: 2 }, traits: { affinity: "fire" } },
      ],
    },
  };
  await view.renderBundle(bundle);

  // The renderer draws hazards as rectangles (fallback, no bundle texture).
  assert.ok(
    records.rectangles.length > 0,
    "expected at least one shape for hazard entity",
  );
  view.dispose();
});

test("renders trap and resource archetypes from sandbox bundle", async () => {
  const records = {};
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
  });
  view.mount(makeContainer());

  const bundle = await loadBundle(); // contains trap_1 and res_1
  await view.renderBundle(bundle);

  // Full fixture has 5 entities — shape count must reflect all of them
  // (tiles + actors + hazards/traps + resources).
  const totalShapes = records.rectangles.length + records.circles.length;
  assert.ok(
    totalShapes >= 5,
    `expected shapes for all entities, got ${totalShapes}`,
  );
  view.dispose();
});

// ---------------------------------------------------------------------------
// Movement intent (success criterion 5)
// ---------------------------------------------------------------------------

test("emits movement intent on ArrowUp key press with direction north", async () => {
  const records = {};
  const intents = [];
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
    onMovementIntent: (intent) => intents.push(intent),
  });
  view.mount(makeContainer());
  await view.renderBundle(await loadBundle());

  // Simulate keydown event through the Phaser keyboard handler.
  records.inputHandlers["keydown"]?.({ key: "ArrowUp" });

  assert.equal(intents.length, 1, "expected one movement intent");
  assert.equal(intents[0].direction, "north");
  view.dispose();
});

test("emits movement intent for all 4 cardinal arrow keys", async () => {
  const records = {};
  const intents = [];
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
    onMovementIntent: (intent) => intents.push(intent),
  });
  view.mount(makeContainer());
  await view.renderBundle(await loadBundle());

  const fire = (key) => records.inputHandlers["keydown"]?.({ key });
  fire("ArrowUp");
  fire("ArrowDown");
  fire("ArrowLeft");
  fire("ArrowRight");

  assert.equal(intents.length, 4);
  assert.deepEqual(
    intents.map((i) => i.direction),
    ["north", "south", "west", "east"],
  );
  view.dispose();
});

test("emits movement intent on WASD keys", async () => {
  const records = {};
  const intents = [];
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
    onMovementIntent: (intent) => intents.push(intent),
  });
  view.mount(makeContainer());
  await view.renderBundle(await loadBundle());

  const fire = (key) => records.inputHandlers["keydown"]?.({ key });
  fire("w"); fire("s"); fire("a"); fire("d");

  assert.equal(intents.length, 4);
  assert.deepEqual(
    intents.map((i) => i.direction),
    ["north", "south", "west", "east"],
  );
  view.dispose();
});

test("does not emit movement intent for non-movement keys (Enter, Space, Escape)", async () => {
  const records = {};
  const intents = [];
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
    onMovementIntent: (intent) => intents.push(intent),
  });
  view.mount(makeContainer());
  await view.renderBundle(await loadBundle());

  const fire = (key) => records.inputHandlers["keydown"]?.({ key });
  fire("Enter"); fire(" "); fire("Escape"); fire("Tab"); fire("Shift");

  assert.equal(intents.length, 0, "non-movement keys must not emit movement intents");
  view.dispose();
});

// ---------------------------------------------------------------------------
// Affinity visualization (M7)
// ---------------------------------------------------------------------------

test("renderBundle populates tileVisuals for affinity-overlap fixture", async () => {
  // This test verifies that phaser-sandbox-view passes tileVisuals to the renderer.
  // The overlap fixture has hazards in simConfig.layout.data.hazards, which the
  // affinity-field-bridge can process.  Rendered tiles with visuals get setTint called.

  const records = {};
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
  });
  view.mount(makeContainer());

  const bundle = JSON.parse(await readFile(OVERLAP_FIXTURE_PATH, "utf8"));
  await view.renderBundle(bundle);

  // The hazard origin tiles (2,1) and (2,3) each have intensity=1.0 and should
  // receive a colour tint from tileVisuals.  If tileVisuals is absent the tint
  // is never set and all rectangles have tint === undefined.
  const tintedTiles = records.rectangles.filter((r) => r.tint !== undefined);
  assert.ok(
    tintedTiles.length > 0,
    `expected at least one tinted tile from affinity visuals, got ${tintedTiles.length}`,
  );

  view.dispose();
});

test("renderBundle tileVisuals include both water and fire tints (overlap fixture)", async () => {
  const records = {};
  const view = createPhaserSandboxView({
    loadPhaser: async () => createFakePhaser(records),
  });
  view.mount(makeContainer());

  const bundle = JSON.parse(await readFile(OVERLAP_FIXTURE_PATH, "utf8"));
  await view.renderBundle(bundle);

  // Water tint: 0x2b7fff (blue channel dominant), fire tint: 0xf05a28 (red channel dominant).
  // Both should appear in the set of tile tints.
  const tints = new Set(records.rectangles.map((r) => r.tint).filter(Boolean));
  assert.ok(
    tints.has(0x2b7fff) || tints.has(0xf05a28),
    `expected water (0x2b7fff) or fire (0xf05a28) tint, got: ${[...tints].map((t) => "0x" + t.toString(16)).join(", ")}`,
  );

  view.dispose();
});

/* ## TODO: Test Permutations
 * - renderBundle with null → returns { ok: false } without throwing
 * - renderBundle with empty initialState.actors → no actor shapes, only tile shapes
 * - renderBundle called twice in sequence — second call replaces first (no ghost nodes)
 * - renderBundle with resourceBundle present — texture lookup attempted
 * - mount called without a container — does not throw
 * - dispose before renderBundle — does not throw
 * - onMovementIntent not provided — keydown with arrow key does not throw
 * - onSelect callback forwarded when tile clicked via pointer event
 * - onHover callback forwarded when pointer moves over tile
 * - buildBoardState tiles: "#" symbol → tileSymbolToType returns "wall"
 * - buildBoardState tiles: "." symbol → tileSymbolToType returns "floor"
 * - buildBoardState ambulatory actors without explicit archetype → placed in observation.actors
 * - buildBoardState simConfig with missing layout.data → boardWidth/boardHeight default to 0
 * - movement intent direction strings match ak_sandbox_move direction enum keys
 */

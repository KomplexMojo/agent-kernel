import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGameplayPhaserRenderer } from "../../packages/ui-web/src/views/gameplay-phaser-renderer.js";
import { resolveCanvasBoardPosition } from "../../packages/ui-web/src/views/simulation-view.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const htmlPath = path.resolve(root, "packages", "ui-web", "index.html");

function readHtml() {
  return fs.readFileSync(htmlPath, "utf8");
}

function slicePanel(html, tabId) {
  const marker = `data-tab-panel="${tabId}"`;
  const startIndex = html.indexOf(marker);
  assert.ok(startIndex >= 0);
  const panelStart = html.lastIndexOf("<div", startIndex);
  const nextPanelIndex = html.indexOf('data-tab-panel="', startIndex + marker.length);
  return nextPanelIndex === -1 ? html.slice(panelStart) : html.slice(panelStart, nextPanelIndex);
}

function createFakePhaserHarness() {
  const calls = {
    addBase64: [],
    images: [],
    rectangles: [],
    containers: [],
  };
  const camera = {
    width: 320,
    height: 240,
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
    setBounds() {},
    setZoom(nextZoom) { this.zoom = nextZoom; },
    centerOn() {},
  };
  const scene = {
    textures: {
      seen: new Set(),
      exists(key) {
        return this.seen.has(key);
      },
      addBase64(key, dataUri) {
        this.seen.add(key);
        calls.addBase64.push({ key, dataUri });
      },
    },
    add: {
      container(x, y) {
        const node = {
          x,
          y,
          children: [],
          add(child) {
            this.children.push(child);
            return child;
          },
          destroy() {},
          setDepth() {},
        };
        calls.containers.push(node);
        return node;
      },
      image(x, y, textureKey) {
        const node = {
          kind: "image",
          x,
          y,
          textureKey,
          displaySize: null,
          origin: null,
          name: "",
          setDisplaySize(width, height) {
            this.displaySize = { width, height };
          },
          setOrigin(origin) {
            this.origin = origin;
          },
          setName(name) {
            this.name = name;
          },
          setTint() {},
          clearTint() {},
        };
        calls.images.push(node);
        return node;
      },
      rectangle(x, y, width, height, color, alpha) {
        const node = {
          kind: "rectangle",
          x,
          y,
          width,
          height,
          color,
          alpha,
          data: {},
          setStrokeStyle() {},
          setData(key, value) {
            this.data[key] = value;
          },
        };
        calls.rectangles.push(node);
        return node;
      },
      text() {
        return { setDepth() {}, destroy() {} };
      },
    },
    cameras: { main: camera },
    input: {
      on() {},
      keyboard: { on() {} },
    },
  };
  const Phaser = {
    AUTO: "AUTO",
    Scale: { NONE: "NONE" },
    Game: class {
      constructor(config) {
        this.config = config;
        this.scale = { resize() {} };
        config.scene.create.call(scene);
      }
      destroy() {}
    },
  };
  return { calls, Phaser };
}

function createRendererContainer() {
  return {
    clientWidth: 320,
    clientHeight: 240,
    children: [],
    querySelector(selector) {
      if (selector !== "[data-gameplay-phaser-stage]") return null;
      return this.children.find((child) => child.dataset?.gameplayPhaserStage === "true") || null;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}

test("simulation view keeps a Phaser-owned playing surface and shell controls", () => {
  const html = readHtml();
  const simulationPanel = slicePanel(html, "simulation");
  assert.match(simulationPanel, /id="simulation-phaser-host"/);
  assert.match(simulationPanel, /id="frame-buffer"/);
  assert.match(simulationPanel, /id="frame-buffer"[^>]*hidden/);
  assert.match(simulationPanel, /id="play-pause"/);
  assert.match(simulationPanel, /id="step-back"/);
  assert.match(simulationPanel, /id="step-forward"/);
  assert.match(simulationPanel, /id="reset-run"/);
  assert.doesNotMatch(simulationPanel, /aria-label="Runtime movement controls"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-move-up"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-move-up-right"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-move-down"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-move-down-right"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-move-down-left"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-move-left"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-move-right"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-move-up-left"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-cast"/);
  assert.doesNotMatch(simulationPanel, /aria-label="Runtime affinity choice placeholders"/);
  assert.doesNotMatch(simulationPanel, /aria-label="Runtime affinity expression placeholders"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-affinity-choice-fire"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-affinity-expression-expand"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-inspector-toggle"/);
  assert.doesNotMatch(simulationPanel, /id="actor-id-display"/);
  assert.doesNotMatch(simulationPanel, /id="actor-pos"/);
  assert.doesNotMatch(simulationPanel, /id="actor-hp"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-visibility-mode"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-viewer-actor"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-viewport-size"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-vision-radius"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-exploration-hud"/);
  assert.doesNotMatch(simulationPanel, /id="event-stream"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-viewport"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-delver-card"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-visible-wardens"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-offscreen-wardens"/);
  assert.doesNotMatch(simulationPanel, /Selected Actor View/);
});

test("simulation view mounts the gameplay Phaser renderer", () => {
  const viewPath = path.resolve(root, "packages", "ui-web", "src", "views", "simulation-view.js");
  const source = fs.readFileSync(viewPath, "utf8");
  assert.match(source, /createGameplayPhaserRenderer/);
  assert.match(source, /renderer\.mount\(phaserHost\)/);
  assert.match(source, /renderer\.renderFrame\(/);
});

test("simulation view loads wasm from ui-web assets", () => {
  const viewPath = path.resolve(root, "packages", "ui-web", "src", "views", "simulation-view.js");
  const source = fs.readFileSync(viewPath, "utf8");
  const match = source.match(/new URL\((['"`])([^'"`]+core-as\.wasm)\1,\s*import\.meta\.url\)/);
  assert.ok(match, "expected simulation view to resolve core-as.wasm via new URL");
  const wasmRelative = match[2];
  const wasmUrl = new URL(wasmRelative, pathToFileURL(viewPath));
  const wasmPath = fileURLToPath(wasmUrl);
  assert.ok(fs.existsSync(wasmPath), `expected wasm file at ${wasmPath}`);
  assert.match(wasmPath, /packages\/ui-web\/assets\/core-as\.wasm$/);
});

test("simulation canvas hit-testing translates viewport-local tile positions back to board coordinates", () => {
  assert.deepEqual(
    resolveCanvasBoardPosition(
      { x: 2, y: 3 },
      { viewport: { startX: 10, startY: 20, width: 5, height: 5, endX: 15, endY: 25 } },
    ),
    { x: 12, y: 23 },
  );
  assert.deepEqual(resolveCanvasBoardPosition({ x: 1, y: 1 }, null), { x: 1, y: 1 });
  assert.equal(resolveCanvasBoardPosition(null, { viewport: { startX: 4, startY: 7 } }), null);
});

test("simulation view forwards observation traps into level regeneration render options", () => {
  const viewPath = path.resolve(root, "packages", "ui-web", "src", "views", "simulation-view.js");
  const source = fs.readFileSync(viewPath, "utf8");
  assert.match(
    source,
    /regenerateLevelArtifacts\(\{\s*tiles:\s*baseTiles,\s*renderOptions:\s*\{\s*floorAffinityTraps:/s,
  );
});

test("simulation view renders bundle without requiring inline asset gating", () => {
  const viewPath = path.resolve(root, "packages", "ui-web", "src", "views", "simulation-view.js");
  const source = fs.readFileSync(viewPath, "utf8");
  assert.doesNotMatch(source, /canRenderGeneratedBundle/);
  assert.doesNotMatch(source, /renderBundleBoardToCanvas\(\{/);
  assert.match(source, /renderer\.renderFrame\(/);
});

test("gameplay Phaser renderer resolves live surface visuals through bundle textures", () => {
  const rendererPath = path.resolve(root, "packages", "ui-web", "src", "views", "gameplay-phaser-renderer.js");
  const source = fs.readFileSync(rendererPath, "utf8");
  assert.match(source, /ensureBundleTexture/);
  assert.match(source, /scene\.textures\.addBase64/);
  assert.match(source, /addSurfaceImageOrFallback/);
  assert.match(source, /resolveSurfaceAsset\(resourceBundle,\s*category,\s*key,\s*model\)/);
  assert.match(source, /intentionalMissingBundleFallback/);
  assert.doesNotMatch(source, /tileColorForType/);
  assert.doesNotMatch(source, /scene\.add\.circle\(cx,\s*cy/);
  assert.doesNotMatch(source, /role === "warden" \? "W" : "D"/);
});

test("gameplay Phaser renderer draws tiles, actors, items, and fallback from the resource bundle", async () => {
  const originalDocument = globalThis.document;
  const { calls, Phaser } = createFakePhaserHarness();
  globalThis.document = {
    createElement() {
      return {
        dataset: {},
        classList: { add() {} },
        appendChild() {},
      };
    },
  };

  try {
    const renderer = createGameplayPhaserRenderer({ loadPhaser: async () => Phaser });
    renderer.mount(createRendererContainer());

    await renderer.renderFrame({
      boardWidth: 3,
      boardHeight: 2,
      tiles: ["S#E", "..X"],
      resourceBundle: {
        tileWidth: 16,
        tileHeight: 20,
        mappings: {
          tiles: {
            floor: "asset-tile-floor",
            wall: "asset-tile-wall",
            spawn: "asset-tile-spawn",
            inaccessible: "asset-tile-void",
          },
          actors: {
            delver: "asset-actor-delver",
            warden: "asset-actor-warden",
            byRoleAndAffinity: {
              delver: { fire: "asset-actor-delver-fire" },
            },
          },
          items: {
            hazard: "asset-item-hazard",
            resource: "asset-item-resource",
          },
          overlays: {
            darknessMask: "asset-overlay-darkness",
          },
        },
        assets: [
          { id: "asset-tile-floor", dataUri: "data:image/png;base64,FLOOR" },
          { id: "asset-tile-wall", dataUri: "data:image/png;base64,WALL" },
          { id: "asset-tile-spawn", dataUri: "data:image/png;base64,SPAWN" },
          { id: "asset-tile-void", dataUri: "data:image/png;base64,VOID" },
          { id: "asset-actor-delver", dataUri: "data:image/png;base64,DELVER" },
          { id: "asset-actor-delver-fire", dataUri: "data:image/png;base64,DELVERFIRE" },
          { id: "asset-actor-warden", dataUri: "data:image/png;base64,WARDEN" },
          { id: "asset-item-hazard", dataUri: "data:image/png;base64,HAZARD" },
          { id: "asset-item-resource", dataUri: "data:image/png;base64,RESOURCE" },
          { id: "asset-overlay-darkness", dataUri: "data:image/png;base64,DARKNESS" },
        ],
      },
      observation: {
        actors: [
          { id: "delver-1", role: "delver", affinity: "fire", position: { x: 0, y: 0 } },
          { id: "warden-1", role: "warden", position: { x: 1, y: 1 } },
        ],
        hazards: [{ id: "hazard-1", position: { x: 2, y: 0 } }],
        resources: [{ id: "resource-1", position: { x: 2, y: 1 } }],
      },
    });

    const imageNames = calls.images.map((node) => node.name);
    assert.ok(imageNames.includes("asset-tile-spawn"));
    assert.ok(imageNames.includes("asset-tile-wall"));
    assert.ok(imageNames.includes("asset-tile-floor"));
    assert.ok(imageNames.includes("asset-tile-void"));
    assert.ok(imageNames.includes("asset-actor-delver-fire"));
    assert.ok(imageNames.includes("asset-actor-warden"));
    assert.ok(imageNames.includes("asset-item-hazard"));
    assert.ok(imageNames.includes("asset-item-resource"));
    assert.equal(imageNames.includes("asset-actor-delver"), false, "affinity-specific actor mapping should win");
    assert.ok(calls.addBase64.some((entry) => entry.key === "ak-bundle:asset-tile-spawn"));
    assert.ok(calls.addBase64.some((entry) => entry.key === "ak-bundle:asset-actor-delver-fire"));
    assert.ok(calls.addBase64.some((entry) => entry.key === "ak-bundle:asset-item-resource"));
    assert.equal(
      calls.rectangles.some((node) => node.data.intentionalMissingBundleFallback === true),
      true,
      "exit tile intentionally falls back when no bundle mapping exists",
    );

    renderer.showQuickView({
      id: "delver-1",
      role: "delver",
      affinity: "fire",
      position: { x: 0, y: 0 },
      vitals: { health: { current: 3, max: 5 } },
      resourceBundle: {
        tileWidth: 16,
        tileHeight: 20,
        mappings: {
          actors: {
            delver: "asset-actor-delver",
            byRoleAndAffinity: {
              delver: { fire: "asset-actor-delver-fire" },
            },
          },
          overlays: {
            darknessMask: "asset-overlay-darkness",
          },
        },
        assets: [
          { id: "asset-actor-delver", dataUri: "data:image/png;base64,DELVER" },
          { id: "asset-actor-delver-fire", dataUri: "data:image/png;base64,DELVERFIRE" },
          { id: "asset-overlay-darkness", dataUri: "data:image/png;base64,DARKNESS" },
        ],
      },
    });

    assert.ok(calls.images.map((node) => node.name).includes("asset-overlay-darkness"));
    assert.ok(calls.addBase64.some((entry) => entry.key === "ak-bundle:asset-overlay-darkness"));
  } finally {
    globalThis.document = originalDocument;
  }
});

test("simulation view routes manual movement through the shared cli worker command host", () => {
  const viewPath = path.resolve(root, "packages", "ui-web", "src", "views", "simulation-view.js");
  const source = fs.readFileSync(viewPath, "utf8");
  assert.match(source, /commandHost\.manualMove\(\{/);
  assert.doesNotMatch(source, /controller\.performRealtimeAction/);
});

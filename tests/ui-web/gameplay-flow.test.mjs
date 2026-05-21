import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wireGameplayView } from "../../packages/ui-web/src/views/gameplay-view.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.resolve(__dirname, "..", "..", "packages", "ui-web", "index.html");

function readHtml() {
  return fs.readFileSync(htmlPath, "utf8");
}

function makeRoot() {
  return {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function makeButtonRoot() {
  const handlers = {};
  const elements = new Map([
    ["#gameplay-zoom-in", "button"],
    ["#gameplay-zoom-out", "button"],
    ["#gameplay-fit-level", "button"],
  ].map(([selector]) => [
    selector,
    {
      addEventListener(event, handler) {
        handlers[selector] = handlers[selector] || {};
        handlers[selector][event] = handler;
      },
      click() {
        handlers[selector]?.click?.();
      },
    },
  ]));
  return {
    root: {
      querySelector(selector) { return elements.get(selector) || null; },
      querySelectorAll() { return []; },
    },
    elements,
  };
}

test("design-auto-generate button label remains Auto-generate", () => {
  const html = readHtml();
  assert.match(html, /id="design-auto-generate"[^>]*>\s*Auto-generate\s*</);
  assert.doesNotMatch(html, /id="design-auto-generate"[^>]*>\s*Run\s*</);
});

test("HTML contains a gameplay tab button and panel", () => {
  const html = readHtml();
  assert.match(html, /data-tab="gameplay"/);
  assert.match(html, /data-tab-panel="gameplay"/);
});

test("HTML exposes gameplay camera controls", () => {
  const html = readHtml();
  assert.match(html, /id="gameplay-zoom-out"/);
  assert.match(html, /id="gameplay-fit-level"/);
  assert.match(html, /id="gameplay-zoom-in"/);
  assert.match(html, /id="gameplay-phaser-host"/);
});

test("wireGameplayView returns expected API surface", () => {
  const view = wireGameplayView({ root: makeRoot() });
  assert.equal(typeof view.loadRun, "function");
  assert.equal(typeof view.stepForward, "function");
  assert.equal(typeof view.stepBack, "function");
  assert.equal(typeof view.dispose, "function");
  assert.equal(typeof view.isRunActive, "function");
  assert.equal(typeof view.clear, "function");
  assert.equal(typeof view.requestDesignTransition, "function");
  assert.equal(typeof view.getSelectedEntity, "function");
  assert.equal(typeof view.selectEntity, "function");
  assert.equal(typeof view.resolveDisplayModel, "function");
  assert.equal(typeof view.handleInspectorSelect, "function");
  assert.equal(typeof view.openPlayerPanel, "function");
  assert.equal(typeof view.closePlayerPanel, "function");
  assert.equal(typeof view.isPlayerPanelOpen, "function");
  assert.equal(typeof view.zoomIn, "function");
  assert.equal(typeof view.zoomOut, "function");
  assert.equal(typeof view.fitToLevel, "function");
});

test("gameplay camera buttons delegate to the renderer controls", () => {
  const calls = [];
  const { root, elements } = makeButtonRoot();
  wireGameplayView({
    root,
    createRenderer: () => ({
      mount() {},
      renderRun() {},
      renderFrame() {},
      dispose() {},
      zoomIn: () => calls.push("zoomIn"),
      zoomOut: () => calls.push("zoomOut"),
      fitToLevel: () => calls.push("fitToLevel"),
    }),
  });

  elements.get("#gameplay-zoom-in").click();
  elements.get("#gameplay-zoom-out").click();
  elements.get("#gameplay-fit-level").click();

  assert.deepEqual(calls, ["zoomIn", "zoomOut", "fitToLevel"]);
});

test("isRunActive returns false before any loadRun call", () => {
  const view = wireGameplayView({ root: makeRoot() });
  assert.equal(view.isRunActive(), false);
});

test("loadRun activates the run and invokes onRunLoaded callback", async () => {
  let loadedBundle = null;
  const view = wireGameplayView({
    root: makeRoot(),
    onRunLoaded: (b) => { loadedBundle = b; },
  });
  const bundle = { artifacts: [] };
  await view.loadRun(bundle);
  assert.equal(view.isRunActive(), true);
  assert.strictEqual(loadedBundle, bundle);
});

test("clear deactivates the run", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun({ artifacts: [] });
  assert.equal(view.isRunActive(), true);
  view.clear();
  assert.equal(view.isRunActive(), false);
});

test("getSelectedEntity returns null before any selection", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun({ artifacts: [] });
  assert.equal(view.getSelectedEntity(), null);
});

test("stepForward does not throw when at the last frame", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun({ artifacts: [] });
  assert.doesNotThrow(() => view.stepForward());
});

test("stepBack does not throw when at the first frame", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun({ artifacts: [] });
  assert.doesNotThrow(() => view.stepBack());
});

test("stepForward and stepBack are no-ops before loadRun", () => {
  const view = wireGameplayView({ root: makeRoot() });
  assert.doesNotThrow(() => view.stepForward());
  assert.doesNotThrow(() => view.stepBack());
});

test("isPlayerPanelOpen returns false before any panel operation", () => {
  const view = wireGameplayView({ root: makeRoot() });
  assert.equal(view.isPlayerPanelOpen(), false);
});

test("openPlayerPanel and closePlayerPanel before loadRun do not throw", () => {
  const view = wireGameplayView({ root: makeRoot() });
  assert.doesNotThrow(() => view.openPlayerPanel());
  assert.doesNotThrow(() => view.closePlayerPanel());
});

test("HTML contains actor-inspector and gameplay-status elements", () => {
  const html = readHtml();
  assert.match(html, /id="actor-inspector"/);
  assert.match(html, /id="gameplay-status"/);
});

test("HTML contains gameplay step-back and step-forward controls", () => {
  const html = readHtml();
  assert.match(html, /id="gameplay-step-back"/);
  assert.match(html, /id="gameplay-step-forward"/);
});

test("HTML contains gameplay-run-id-label element", () => {
  const html = readHtml();
  assert.match(html, /id="gameplay-run-id-label"/);
});

test("loadRun calls deriveTileAffinityVisuals and includes tileVisuals in board state", async () => {
  let renderedBoardState = null;
  const view = wireGameplayView({
    root: makeRoot(),
    createRenderer: () => ({
      mount() {},
      renderRun(boardState) { renderedBoardState = boardState; },
      renderFrame() {},
      dispose() {},
    }),
  });

  const bundle = {
    artifacts: [
      {
        schema: "agent-kernel/SimConfigArtifact",
        schemaVersion: 1,
        layout: {
          kind: "grid",
          data: {
            width: 4,
            height: 4,
            tiles: ["....", "....", "....", "...."],
            hazards: [
              {
                id: "h1",
                entityType: "hazard",
                position: { x: 2, y: 2 },
                emitStrength: 2,
                affinityStacks: [{ kind: "fire", stacks: 1, expression: "emit" }],
              },
            ],
          },
        },
      },
      {
        schema: "agent-kernel/InitialStateArtifact",
        schemaVersion: 1,
        actors: [{ id: "delver-1", position: { x: 0, y: 0 } }],
      },
      {
        schema: "agent-kernel/ResourceBundleArtifact",
        schemaVersion: 1,
        mappings: { overlays: {} },
      },
    ],
  };

  await view.loadRun(bundle);
  assert.ok(renderedBoardState, "renderer received board state");
  assert.ok(renderedBoardState.tileVisuals instanceof Map, "tileVisuals is a Map");
  assert.ok(renderedBoardState.tileVisuals.size > 0, "tileVisuals has entries from hazard");
  const origin = renderedBoardState.tileVisuals.get("2,2");
  assert.ok(origin, "hazard origin tile in tileVisuals");
  assert.equal(origin.intensity, 1.0, "origin has full intensity");
  assert.equal(origin.affinityKind, "fire", "fire kind");
});

test("loadRun uses injected buildTileAffinityVisualsFromBundleFn when provided", async () => {
  let renderedBoardState = null;
  const customVisuals = new Map([["5,5", { intensity: 0.9, affinityKind: "water", color: 0x2b7fff, alpha: 0.9 }]]);

  const view = wireGameplayView({
    root: makeRoot(),
    createRenderer: () => ({
      mount() {},
      renderRun(boardState) { renderedBoardState = boardState; },
      renderFrame() {},
      dispose() {},
    }),
    buildTileAffinityVisualsFromBundleFn: () => customVisuals,
  });

  const bundle = {
    artifacts: [
      {
        schema: "agent-kernel/SimConfigArtifact",
        schemaVersion: 1,
        layout: {
          kind: "grid",
          data: {
            width: 6,
            height: 6,
            tiles: ["......", "......", "......", "......", "......", "......"],
            hazards: [{ id: "h1", position: { x: 2, y: 2 }, emitStrength: 2, affinityStacks: [{ kind: "fire", stacks: 1, expression: "emit" }] }],
          },
        },
      },
      { schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1, actors: [] },
      { schema: "agent-kernel/ResourceBundleArtifact", schemaVersion: 1, mappings: { overlays: {} } },
    ],
  };

  await view.loadRun(bundle);
  assert.ok(renderedBoardState, "renderer received board state");
  assert.strictEqual(renderedBoardState.tileVisuals, customVisuals, "custom facade used instead of default");
  assert.ok(renderedBoardState.tileVisuals.has("5,5"), "custom visuals present");
  assert.ok(!renderedBoardState.tileVisuals.has("2,2"), "hazard NOT spread — facade overrides");
});

test("loadRun with no hazards produces empty tileVisuals", async () => {
  let renderedBoardState = null;
  const view = wireGameplayView({
    root: makeRoot(),
    createRenderer: () => ({
      mount() {},
      renderRun(boardState) { renderedBoardState = boardState; },
      renderFrame() {},
      dispose() {},
    }),
  });

  const bundle = {
    artifacts: [
      {
        schema: "agent-kernel/SimConfigArtifact",
        schemaVersion: 1,
        layout: { kind: "grid", data: { width: 3, height: 3, tiles: ["...", "...", "..."] } },
      },
      { schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1, actors: [] },
      { schema: "agent-kernel/ResourceBundleArtifact", schemaVersion: 1, mappings: { overlays: {} } },
    ],
  };

  await view.loadRun(bundle);
  assert.ok(renderedBoardState.tileVisuals instanceof Map, "tileVisuals is Map");
  assert.equal(renderedBoardState.tileVisuals.size, 0, "no hazards → empty tileVisuals");
});

/*
## TODO: Test Permutations
- loadRun with null bundle must not activate the run
- loadRun with bundle missing SimConfigArtifact must not activate
- loadRun called twice replaces the previous run without throwing
- stepForward before loadRun is a no-op and does not throw
- stepBack before loadRun is a no-op and does not throw
- dispose cleans up internal state and does not throw on repeated calls
- onRunLoaded is not called when loadRun receives a null or invalid bundle
- isPlayerPanelOpen returns false after dispose
- buildTileAffinityVisualsFromBundleFn receives the full bundle as argument
- tileVisuals persists across stepForward/stepBack calls
- fieldRecords path: injected facade returns fieldRecord-derived visuals with contributions
*/

import assert from "node:assert/strict";
import { wireGameplayView } from "../../packages/ui-web/src/views/gameplay-view.js";

function makeRoot() {
  return {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

const ACTOR_WITH_FULL_PROPERTIES = {
  id: "delver-1",
  type: "delver",
  position: { x: 3, y: 4 },
  affinities: [
    { kind: "fire", expression: "ward", stacks: 2 },
    { kind: "ice", expression: "surge", stacks: 1 },
  ],
  vitals: {
    health: { current: 10, max: 10 },
    mana: { current: 5, max: 8 },
    stamina: { current: 7, max: 7 },
  },
  motivations: ["explore", "loot"],
};

const BUNDLE_WITH_ACTORS = {
  artifacts: [
    {
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
      meta: { id: "sim-1", runId: "run-1", createdAt: "2026-05-12T00:00:00Z", producedBy: "director" },
        layout: { data: { width: 5, height: 5, rooms: [] } },
      seed: 0,
    },
    {
      schema: "agent-kernel/InitialStateArtifact",
      schemaVersion: 1,
      meta: { id: "state-1", runId: "run-1", createdAt: "2026-05-12T00:00:00Z", producedBy: "director" },
      actors: [ACTOR_WITH_FULL_PROPERTIES],
    },
  ],
};

const BUNDLE_WITH_RENDERED_NON_ACTORS = {
  artifacts: [
    {
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
      meta: { id: "sim-2", runId: "run-2", createdAt: "2026-05-12T00:00:00Z", producedBy: "director" },
      layout: {
        data: {
          width: 5,
          height: 5,
          rooms: [],
          hazards: [{ id: "hazard-1", position: { x: 1, y: 2 }, affinity: { kind: "fire" } }],
          resources: [{ id: "resource-1", position: { x: 4, y: 2 }, kind: "mana" }],
        },
      },
      seed: 0,
    },
    {
      schema: "agent-kernel/InitialStateArtifact",
      schemaVersion: 1,
      meta: { id: "state-2", runId: "run-2", createdAt: "2026-05-12T00:00:00Z", producedBy: "director" },
      actors: [],
    },
  ],
};

test("selectEntity returns null when no entity matches the position", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const entity = view.selectEntity({ x: 99, y: 99 });
  assert.equal(entity, null);
});

test("selectEntity returns the entity at the given position", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const entity = view.selectEntity({ x: 3, y: 4 });
  assert.ok(entity, "expected an entity at (3, 4)");
  assert.equal(entity.id, "delver-1");
});

test("selectEntity centers the Phaser camera on the selected entity", async () => {
  const centered = [];
  const view = wireGameplayView({
    root: makeRoot(),
    createRenderer: () => ({
      mount() {},
      renderRun() {},
      renderFrame() {},
      dispose() {},
      centerOnTile: (position) => centered.push(position),
    }),
  });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const entity = view.selectEntity({ x: 3, y: 4 });

  assert.ok(entity);
  assert.deepEqual(centered, [{ x: 3, y: 4 }]);
});

test("selectEntity updates getSelectedEntity", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.selectEntity({ x: 3, y: 4 });
  const selected = view.getSelectedEntity();
  assert.ok(selected);
  assert.equal(selected.id, "delver-1");
});

test("selected entity exposes affinities from run configuration", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const entity = view.selectEntity({ x: 3, y: 4 });
  assert.ok(Array.isArray(entity.affinities), "entity must have affinities array");
  assert.equal(entity.affinities.length, 2);
  assert.equal(entity.affinities[0].kind, "fire");
  assert.equal(entity.affinities[0].expression, "ward");
  assert.equal(entity.affinities[0].stacks, 2);
});

test("selected entity exposes vitals from run configuration", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const entity = view.selectEntity({ x: 3, y: 4 });
  assert.ok(entity.vitals, "entity must have vitals");
  assert.equal(entity.vitals.health.current, 10);
  assert.equal(entity.vitals.health.max, 10);
});

test("selected entity exposes motivations from run configuration", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const entity = view.selectEntity({ x: 3, y: 4 });
  assert.ok(Array.isArray(entity.motivations), "entity must have motivations array");
  assert.deepEqual(entity.motivations, ["explore", "loot"]);
});

test("selectEntity resolves entity properties from run config without making fetch calls", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetchCalled = true;
    return originalFetch?.(...args);
  };

  try {
    const view = wireGameplayView({ root: makeRoot() });
    await view.loadRun(BUNDLE_WITH_ACTORS);
    view.selectEntity({ x: 3, y: 4 });
    assert.equal(fetchCalled, false, "selectEntity must not make network requests");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("clear resets selected entity to null", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.selectEntity({ x: 3, y: 4 });
  assert.ok(view.getSelectedEntity());
  view.clear();
  assert.equal(view.getSelectedEntity(), null);
});

test("selectEntity resolves rendered hazards from the run layout", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_RENDERED_NON_ACTORS);
  const entity = view.selectEntity({ x: 1, y: 2 });
  assert.ok(entity);
  assert.equal(entity.id, "hazard-1");
  assert.equal(entity.entityType, "hazard");
});

test("selectEntity resolves rendered resources from the run layout", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_RENDERED_NON_ACTORS);
  const entity = view.selectEntity({ x: 4, y: 2 });
  assert.ok(entity);
  assert.equal(entity.id, "resource-1");
  assert.equal(entity.entityType, "resource");
});

// --- M1: resolveDisplayModel and bidirectional inspector sync ---

test("resolveDisplayModel returns normalized model for actor position", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const model = view.resolveDisplayModel({ x: 3, y: 4 });
  assert.ok(model, "expected a display model at (3, 4)");
  assert.equal(model.id, "delver-1");
  assert.equal(model.entityType, "actor");
  assert.ok(model.vitals, "model must have vitals");
  assert.ok(Array.isArray(model.affinities), "model must have affinities array");
  assert.ok(Array.isArray(model.motivations), "model must have motivations array");
  assert.equal(model.equippedAffinity?.kind, "fire");
});

test("resolveDisplayModel equippedAffinity is the first affinity in the array", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const model = view.resolveDisplayModel({ x: 3, y: 4 });
  assert.ok(model);
  assert.equal(model.equippedAffinity?.kind, model.affinities[0]?.kind);
});

test("resolveDisplayModel returns normalized model for hazard position", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_RENDERED_NON_ACTORS);
  const model = view.resolveDisplayModel({ x: 1, y: 2 });
  assert.ok(model);
  assert.equal(model.id, "hazard-1");
  assert.equal(model.entityType, "hazard");
});

test("resolveDisplayModel returns normalized model for resource position", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_RENDERED_NON_ACTORS);
  const model = view.resolveDisplayModel({ x: 4, y: 2 });
  assert.ok(model);
  assert.equal(model.id, "resource-1");
  assert.equal(model.entityType, "resource");
});

test("resolveDisplayModel returns null for unknown position", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const model = view.resolveDisplayModel({ x: 99, y: 99 });
  assert.equal(model, null);
});

test("resolveDisplayModel returns null before loadRun", () => {
  const view = wireGameplayView({ root: makeRoot() });
  const model = view.resolveDisplayModel({ x: 3, y: 4 });
  assert.equal(model, null);
});

test("handleInspectorSelect centers camera when payload has a position", async () => {
  const centered = [];
  const view = wireGameplayView({
    root: makeRoot(),
    createRenderer: () => ({
      mount() {},
      renderRun() {},
      renderFrame() {},
      dispose() {},
      centerOnTile: (pos) => centered.push(pos),
    }),
  });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.handleInspectorSelect({ position: { x: 3, y: 4 }, type: "actor", actorId: "delver-1" });
  assert.deepEqual(centered, [{ x: 3, y: 4 }]);
});

test("handleInspectorSelect updates selectedEntity", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.handleInspectorSelect({ position: { x: 3, y: 4 }, type: "actor", actorId: "delver-1" });
  assert.equal(view.getSelectedEntity()?.id, "delver-1");
});

test("handleInspectorSelect is a no-op when payload has no position", async () => {
  const centered = [];
  const view = wireGameplayView({
    root: makeRoot(),
    createRenderer: () => ({
      mount() {},
      renderRun() {},
      renderFrame() {},
      dispose() {},
      centerOnTile: (pos) => centered.push(pos),
    }),
  });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.handleInspectorSelect({ type: "room", roomBounds: { x: 0, y: 0, width: 4, height: 4 } });
  assert.deepEqual(centered, []);
});

// --- M2: view-level hover wiring ---

function makeCapturingRenderer() {
  let capturedOnHover = null;
  let capturedOnHoverEnd = null;
  const quickViews = [];
  let hideCount = 0;
  const renderer = {
    mount() {},
    async renderRun() {},
    async renderFrame() {},
    dispose() {},
    showQuickView: (model) => quickViews.push(model),
    hideQuickView: () => hideCount++,
  };
  return {
    factory: (opts) => { capturedOnHover = opts?.onHover; capturedOnHoverEnd = opts?.onHoverEnd; return renderer; },
    get onHover() { return capturedOnHover; },
    get onHoverEnd() { return capturedOnHoverEnd; },
    get quickViews() { return quickViews; },
    get hideCount() { return hideCount; },
  };
}

test("view passes onHover and onHoverEnd to the renderer factory", () => {
  const cap = makeCapturingRenderer();
  wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  assert.equal(typeof cap.onHover, "function", "onHover must be passed to renderer");
  assert.equal(typeof cap.onHoverEnd, "function", "onHoverEnd must be passed to renderer");
});

test("onHover callback resolves entity and calls renderer.showQuickView", async () => {
  const cap = makeCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  cap.onHover({ x: 3, y: 4 });
  assert.equal(cap.quickViews.length, 1);
  assert.equal(cap.quickViews[0].id, "delver-1");
  assert.equal(cap.quickViews[0].entityType, "actor");
  assert.ok(cap.quickViews[0].equippedAffinity, "display model must include equippedAffinity");
});

test("onHover over empty position calls renderer.hideQuickView", async () => {
  const cap = makeCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  cap.onHover({ x: 99, y: 99 });
  assert.equal(cap.hideCount, 1);
  assert.equal(cap.quickViews.length, 0);
});

test("onHoverEnd calls renderer.hideQuickView", async () => {
  const cap = makeCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  cap.onHoverEnd();
  assert.equal(cap.hideCount, 1);
});

// --- M3: actor highlight wiring ---

function makeHighlightCapturingRenderer() {
  const highlights = [];
  let clearCount = 0;
  let capturedOnKeyPress = null;
  const renderer = {
    mount() {},
    async renderRun() {},
    async renderFrame() {},
    dispose() {},
    centerOnTile() {},
    showQuickView() {},
    hideQuickView() {},
    highlightActor: (pos) => { highlights.push(pos); return true; },
    clearHighlight: () => { clearCount++; },
  };
  return {
    factory: (opts) => { capturedOnKeyPress = opts?.onKeyPress; return renderer; },
    get highlights() { return highlights; },
    get clearCount() { return clearCount; },
    get onKeyPress() { return capturedOnKeyPress; },
  };
}

test("selectEntity calls renderer.highlightActor with the entity position", async () => {
  const cap = makeHighlightCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.selectEntity({ x: 3, y: 4 });
  assert.deepEqual(cap.highlights, [{ x: 3, y: 4 }]);
});

test("clear calls renderer.clearHighlight", async () => {
  const cap = makeHighlightCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.selectEntity({ x: 3, y: 4 });
  view.clear();
  assert.ok(cap.clearCount >= 1, "clearHighlight must be called when view is cleared");
});

test("handleInspectorSelect calls renderer.highlightActor with the entity position", async () => {
  const cap = makeHighlightCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.handleInspectorSelect({ position: { x: 3, y: 4 }, type: "actor", actorId: "delver-1" });
  assert.deepEqual(cap.highlights, [{ x: 3, y: 4 }]);
});

test("wireGameplayView passes onKeyPress callback to renderer factory", () => {
  const cap = makeHighlightCapturingRenderer();
  wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  assert.equal(typeof cap.onKeyPress, "function", "onKeyPress must be wired to renderer");
});

// --- M4: Player Panel view wiring ---

function makePlayerPanelCapturingRenderer() {
  const panelOpens = [];
  let closePanelCount = 0;
  let capturedOnKeyPress = null;
  let _panelOpen = false;
  const renderer = {
    mount() {},
    async renderRun() {},
    async renderFrame() {},
    dispose() {},
    centerOnTile() {},
    showQuickView() {},
    hideQuickView() {},
    highlightActor() { return false; },
    clearHighlight() {},
    openPlayerPanel: (model) => { panelOpens.push(model); _panelOpen = true; },
    closePlayerPanel: () => { closePanelCount++; _panelOpen = false; },
    isPlayerPanelOpen: () => _panelOpen,
  };
  return {
    factory: (opts) => { capturedOnKeyPress = opts?.onKeyPress; return renderer; },
    get panelOpens() { return panelOpens; },
    get closePanelCount() { return closePanelCount; },
    get onKeyPress() { return capturedOnKeyPress; },
  };
}

test("Z key with actor selected opens Player Panel with display model", async () => {
  const cap = makePlayerPanelCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.selectEntity({ x: 3, y: 4 });
  cap.onKeyPress?.({ key: "z" });
  assert.equal(cap.panelOpens.length, 1, "openPlayerPanel must be called when Z pressed with actor selected");
  assert.equal(cap.panelOpens[0].id, "delver-1");
});

test("Escape key calls renderer.closePlayerPanel", async () => {
  const cap = makePlayerPanelCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  cap.onKeyPress?.({ key: "escape" });
  assert.ok(cap.closePanelCount >= 1, "closePlayerPanel must be called when Escape pressed");
});

test("Z key before loadRun does not open Player Panel", () => {
  const cap = makePlayerPanelCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  cap.onKeyPress?.({ key: "z" });
  assert.equal(cap.panelOpens.length, 0, "panel must not open before loadRun");
});

test("Z key with no actor selected does not open Player Panel", async () => {
  const cap = makePlayerPanelCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  cap.onKeyPress?.({ key: "z" });
  assert.equal(cap.panelOpens.length, 0, "panel must not open when no actor is selected");
});

test("Z key with hazard selected does not open Player Panel", async () => {
  const cap = makePlayerPanelCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_RENDERED_NON_ACTORS);
  view.selectEntity({ x: 1, y: 2 }); // hazard-1
  cap.onKeyPress?.({ key: "z" });
  assert.equal(cap.panelOpens.length, 0, "panel must not open for non-actor entities");
});

test("clear closes the Player Panel", async () => {
  const cap = makePlayerPanelCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  view.selectEntity({ x: 3, y: 4 });
  cap.onKeyPress?.({ key: "z" });
  const closeBefore = cap.closePanelCount;
  view.clear();
  assert.ok(cap.closePanelCount > closeBefore, "clear must close the player panel");
});

test("bundle is not mutated by openPlayerPanel and closePlayerPanel", async () => {
  const cap = makePlayerPanelCapturingRenderer();
  const view = wireGameplayView({ root: makeRoot(), createRenderer: cap.factory });
  await view.loadRun(BUNDLE_WITH_ACTORS);
  const snapshot = JSON.stringify(BUNDLE_WITH_ACTORS);
  view.selectEntity({ x: 3, y: 4 });
  cap.onKeyPress?.({ key: "z" });
  cap.onKeyPress?.({ key: "escape" });
  assert.equal(JSON.stringify(BUNDLE_WITH_ACTORS), snapshot, "bundle must not be mutated");
});

/*
## TODO: Test Permutations
- selectEntity with entity having no affinities returns entity with empty affinities array
- selectEntity with entity having no vitals returns entity with null or empty vitals
- selectEntity with entity having no motivations returns entity with empty motivations array
- selectEntity with warden at a position returns the warden with its properties
- selectEntity with overlapping actor and hazard positions prefers the actor
- selectEntity called before loadRun returns null without throwing
- selectEntity called after clear returns null without throwing
- resolveDisplayModel with actor having no affinities returns equippedAffinity null
- resolveDisplayModel called after clear returns null
- handleInspectorSelect with null payload is a no-op
- selectEntity on a hazard position returns false from highlightActor but entity is still returned
- Z key with resource selected does not open Player Panel
- openPlayerPanel with actor having no vitals does not throw
- pressing Escape when panel is already closed is a no-op
*/

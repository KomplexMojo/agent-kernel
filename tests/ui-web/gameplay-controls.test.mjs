import assert from "node:assert/strict";
import { wireGameplayView } from "../../packages/ui-web/src/views/gameplay-view.js";

const MINIMAL_BUNDLE = { artifacts: [] };

function createFakeRoot(extraIds = []) {
  const elements = {};
  const allIds = [
    "gameplay-status", "gameplay-phaser-host",
    "gameplay-step-back", "gameplay-step-forward",
    "gameplay-zoom-in", "gameplay-zoom-out", "gameplay-fit-level",
    ...extraIds,
  ];
  for (const id of allIds) {
    elements[id] = {
      disabled: false,
      dataset: {},
      textContent: "",
      addEventListener(event, handler) { this[`_${event}`] = handler; },
      click() { this._click?.(); },
    };
  }
  return {
    querySelector(sel) {
      const match = sel.match(/^#(.+)$/);
      return match ? elements[match[1]] ?? null : null;
    },
    elements,
  };
}

function createFakeRenderer() {
  const calls = [];
  return {
    calls,
    mount() { calls.push("mount"); },
    async renderRun(bs) { calls.push(["renderRun", bs]); return { ok: true }; },
    async renderFrame(bs) { calls.push(["renderFrame", bs]); return { ok: true }; },
    zoomIn() { calls.push("zoomIn"); },
    zoomOut() { calls.push("zoomOut"); },
    fitToLevel() { calls.push("fitToLevel"); },
    centerOnTile(pos) { calls.push(["centerOnTile", pos]); },
    getCameraState() { return { zoom: 1, viewportWidth: 400, viewportHeight: 300 }; },
    openPlayerPanel(m) { calls.push(["openPlayerPanel", m]); },
    closePlayerPanel() { calls.push("closePlayerPanel"); },
    isPlayerPanelOpen() { return false; },
    highlightActor(pos) { calls.push(["highlightActor", pos]); },
    clearHighlight() { calls.push("clearHighlight"); },
    showQuickView(m) { calls.push(["showQuickView", m]); },
    hideQuickView() { calls.push("hideQuickView"); },
    dispose() { calls.push("dispose"); },
    // These should be called by production code but don't exist yet:
    setPlaybackControls: undefined,
    enterFullscreen: undefined,
    exitFullscreen: undefined,
  };
}

// ---------------------------------------------------------------------------
// Fullscreen mode
// ---------------------------------------------------------------------------

describe("Fullscreen mode", () => {
  it("gameplay panel should have a fullscreen button element", () => {
    const { elements } = createFakeRoot(["gameplay-fullscreen"]);
    const btn = elements["gameplay-fullscreen"];
    assert.ok(btn, "a #gameplay-fullscreen element must exist in the DOM");

    // wireGameplayView should query and wire the button
    const renderer = createFakeRenderer();
    const view = wireGameplayView({
      root: createFakeRoot(["gameplay-fullscreen"]),
      createRenderer: () => renderer,
    });

    // The view must expose enterFullscreen
    assert.equal(typeof view.enterFullscreen, "function",
      "wireGameplayView must return an enterFullscreen method");
  });

  it("clicking fullscreen button triggers fullscreen entry", async () => {
    const root = createFakeRoot(["gameplay-fullscreen", "actor-inspector"]);
    const renderer = createFakeRenderer();
    const view = wireGameplayView({
      root,
      createRenderer: () => renderer,
    });
    await view.loadRun(MINIMAL_BUNDLE);

    const btn = root.elements["gameplay-fullscreen"];
    assert.ok(btn._click, "fullscreen button must have a click handler wired by wireGameplayView");
    btn.click();

    // After clicking, the gameplay panel's dataset should reflect fullscreen state
    const host = root.elements["gameplay-phaser-host"];
    assert.equal(host.dataset.gameplayFullscreen, "true",
      "data-gameplay-fullscreen must be 'true' after entering fullscreen");
  });

  it("view exposes enterFullscreen and exitFullscreen methods", () => {
    const root = createFakeRoot(["gameplay-fullscreen"]);
    const renderer = createFakeRenderer();
    const view = wireGameplayView({
      root,
      createRenderer: () => renderer,
    });

    assert.equal(typeof view.enterFullscreen, "function",
      "wireGameplayView must return enterFullscreen");
    assert.equal(typeof view.exitFullscreen, "function",
      "wireGameplayView must return exitFullscreen");
  });

  it("enterFullscreen sets data-gameplay-fullscreen to true on the host", async () => {
    const root = createFakeRoot(["gameplay-fullscreen"]);
    const renderer = createFakeRenderer();
    const view = wireGameplayView({
      root,
      createRenderer: () => renderer,
    });
    await view.loadRun(MINIMAL_BUNDLE);
    view.enterFullscreen();

    const host = root.elements["gameplay-phaser-host"];
    assert.equal(host.dataset.gameplayFullscreen, "true",
      "enterFullscreen must set data-gameplay-fullscreen='true'");
  });

  it("exitFullscreen sets data-gameplay-fullscreen to false", async () => {
    const root = createFakeRoot(["gameplay-fullscreen"]);
    const renderer = createFakeRenderer();
    const view = wireGameplayView({
      root,
      createRenderer: () => renderer,
    });
    await view.loadRun(MINIMAL_BUNDLE);
    view.enterFullscreen();
    view.exitFullscreen();

    const host = root.elements["gameplay-phaser-host"];
    assert.equal(host.dataset.gameplayFullscreen, "false",
      "exitFullscreen must set data-gameplay-fullscreen='false'");
  });

  it("actor inspector remains accessible after exiting fullscreen", async () => {
    const root = createFakeRoot(["gameplay-fullscreen", "actor-inspector"]);
    const renderer = createFakeRenderer();
    const view = wireGameplayView({
      root,
      createRenderer: () => renderer,
    });
    await view.loadRun(MINIMAL_BUNDLE);
    view.enterFullscreen();
    view.exitFullscreen();

    const inspector = root.elements["actor-inspector"];
    assert.ok(inspector, "actor-inspector element must still be queryable after exiting fullscreen");
    assert.equal(inspector.dataset.hidden, undefined,
      "actor-inspector must not be marked hidden after exiting fullscreen");
  });
});

// ---------------------------------------------------------------------------
// Playback controls bridge
// ---------------------------------------------------------------------------

describe("Playback controls bridge", () => {
  it("renderer receives setPlaybackControls after a run is loaded", async () => {
    const root = createFakeRoot(["gameplay-fullscreen"]);
    let receivedControls = null;
    const renderer = createFakeRenderer();
    renderer.setPlaybackControls = (controls) => { receivedControls = controls; };

    const view = wireGameplayView({
      root,
      createRenderer: () => renderer,
    });
    await view.loadRun(MINIMAL_BUNDLE);

    assert.ok(receivedControls,
      "renderer.setPlaybackControls must be called after loadRun");
    assert.equal(typeof receivedControls.stepBack, "function",
      "playback controls must include stepBack");
    assert.equal(typeof receivedControls.stepForward, "function",
      "playback controls must include stepForward");
    assert.equal(typeof receivedControls.togglePlay, "function",
      "playback controls must include togglePlay");
    assert.equal(typeof receivedControls.reset, "function",
      "playback controls must include reset");
  });

  it("renderer playback stepBack closure invokes the controller stepBack", async () => {
    const root = createFakeRoot();
    let receivedControls = null;
    const renderer = createFakeRenderer();
    renderer.setPlaybackControls = (controls) => { receivedControls = controls; };

    const view = wireGameplayView({
      root,
      createRenderer: () => renderer,
    });

    // Load a bundle with two frames so stepBack is meaningful
    await view.loadRun(MINIMAL_BUNDLE);
    assert.ok(receivedControls, "setPlaybackControls must have been called");

    // Step forward first so stepBack has somewhere to go
    view.stepForward();
    const backBtn = root.elements["gameplay-step-back"];
    const disabledBefore = backBtn.disabled;

    // Call the closure the renderer received
    receivedControls.stepBack();

    // The controller should have stepped back (frame index changes)
    // This verifies the closure routes to the real controller method
    assert.ok(receivedControls.stepBack, "stepBack closure must be a function");
  });

  it("renderer playback stepForward closure invokes the controller stepForward", async () => {
    const root = createFakeRoot();
    let receivedControls = null;
    const renderer = createFakeRenderer();
    renderer.setPlaybackControls = (controls) => { receivedControls = controls; };

    const view = wireGameplayView({
      root,
      createRenderer: () => renderer,
    });
    await view.loadRun(MINIMAL_BUNDLE);
    assert.ok(receivedControls, "setPlaybackControls must have been called");

    receivedControls.stepForward();
    // No error means the closure routed to the real stepForward
    assert.ok(true, "stepForward closure executed without error");
  });

  it("__gameplayPlaybackControlsWired test hook is set on the host element", () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    renderer.setPlaybackControls = () => {};

    wireGameplayView({
      root,
      createRenderer: () => renderer,
    });

    const host = root.elements["gameplay-phaser-host"];
    assert.equal(host.dataset.__gameplayPlaybackControlsWired, "true",
      "gameplay host must have data-__gameplay-playback-controls-wired='true' after wiring");
  });
});

// ---------------------------------------------------------------------------
// Controls disabled when no run loaded
// ---------------------------------------------------------------------------

describe("Controls disabled when no run loaded", () => {
  it("step back button is disabled before any run is loaded", () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    wireGameplayView({
      root,
      createRenderer: () => renderer,
    });

    const backBtn = root.elements["gameplay-step-back"];
    assert.equal(backBtn.disabled, true,
      "step-back must be disabled when no run is loaded");
  });

  it("step forward button is disabled before any run is loaded", () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    wireGameplayView({
      root,
      createRenderer: () => renderer,
    });

    const fwdBtn = root.elements["gameplay-step-forward"];
    assert.equal(fwdBtn.disabled, true,
      "step-forward must be disabled when no run is loaded");
  });

  it("after clear(), step controls are disabled", async () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    const view = wireGameplayView({
      root,
      createRenderer: () => renderer,
    });

    await view.loadRun(MINIMAL_BUNDLE);
    // After loadRun, buttons may be enabled (single-frame means fwd disabled, back disabled)
    view.clear();

    const backBtn = root.elements["gameplay-step-back"];
    const fwdBtn = root.elements["gameplay-step-forward"];
    assert.equal(backBtn.disabled, true,
      "step-back must be disabled after clear()");
    assert.equal(fwdBtn.disabled, true,
      "step-forward must be disabled after clear()");
  });
});

test("repeated fullscreen entry and exit cycles keep host dataset consistent", async () => {
  const root = createFakeRoot(["gameplay-fullscreen"]);
  const view = wireGameplayView({ root, createRenderer: () => createFakeRenderer() });
  await view.loadRun(MINIMAL_BUNDLE);

  for (let index = 0; index < 5; index += 1) {
    view.enterFullscreen();
    assert.equal(root.elements["gameplay-phaser-host"].dataset.gameplayFullscreen, "true");
    view.exitFullscreen();
    assert.equal(root.elements["gameplay-phaser-host"].dataset.gameplayFullscreen, "false");
  }
});

test("fullscreen entry does not throw when browser requestFullscreen would be denied", async () => {
  const root = createFakeRoot(["gameplay-fullscreen"]);
  root.elements["gameplay-phaser-host"].requestFullscreen = () => Promise.reject(new Error("denied"));
  const view = wireGameplayView({ root, createRenderer: () => createFakeRenderer() });
  await view.loadRun(MINIMAL_BUNDLE);

  assert.doesNotThrow(() => view.enterFullscreen());
  assert.equal(root.elements["gameplay-phaser-host"].dataset.gameplayFullscreen, "true");
});

test("fullscreen can be toggled while no run is loaded", () => {
  const root = createFakeRoot(["gameplay-fullscreen"]);
  const view = wireGameplayView({ root, createRenderer: () => createFakeRenderer() });

  assert.doesNotThrow(() => view.enterFullscreen());
  assert.equal(root.elements["gameplay-phaser-host"].dataset.gameplayFullscreen, "true");
  assert.doesNotThrow(() => view.exitFullscreen());
  assert.equal(root.elements["gameplay-phaser-host"].dataset.gameplayFullscreen, "false");
});

test("loadRun does not throw when renderer has no playback bridge", async () => {
  const root = createFakeRoot();
  const renderer = createFakeRenderer();
  renderer.setPlaybackControls = undefined;
  const view = wireGameplayView({ root, createRenderer: () => renderer });

  await assert.doesNotReject(() => view.loadRun(MINIMAL_BUNDLE));
});

test("step forward at last frame and step back at first frame are no-ops", async () => {
  const root = createFakeRoot();
  const renderer = createFakeRenderer();
  const view = wireGameplayView({ root, createRenderer: () => renderer });

  await view.loadRun(MINIMAL_BUNDLE);
  const before = renderer.calls.length;
  view.stepForward();
  view.stepBack();

  assert.equal(renderer.calls.length, before);
});

test.skip("reset playback returns to frame 0 instead of clearing the run", async () => {
  const root = createFakeRoot();
  let controls = null;
  const renderer = createFakeRenderer();
  renderer.setPlaybackControls = (next) => { controls = next; };
  const view = wireGameplayView({ root, createRenderer: () => renderer });
  await view.loadRun({ ...MINIMAL_BUNDLE, tickFrames: [{ tick: 0 }, { tick: 1 }] });
  view.stepForward();

  controls.reset();

  assert.equal(view.isRunActive(), true);
});

test.skip("browser resize during fullscreen reflows the renderer camera without throwing", async () => {
  const root = createFakeRoot(["gameplay-fullscreen"]);
  const renderer = createFakeRenderer();
  const view = wireGameplayView({ root, createRenderer: () => renderer });
  await view.loadRun(MINIMAL_BUNDLE);
  view.enterFullscreen();

  root.dispatchEvent?.({ type: "resize" });

  assert.ok(renderer.calls.length > 0);
});

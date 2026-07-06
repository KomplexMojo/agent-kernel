import assert from "node:assert/strict";
import { wireGameplayView } from "../../packages/ui-web/src/views/gameplay-view.js";

// A bundle whose tickFrames drive 4 accepted "move" ticks for delver_1, producing
// 5 frames total (frame 0 = initial state, frames 1-4 = post-tick snapshots).
// Mirrors the shape wireGameplayView expects from buildTickBoardStates:
// each tickFrame carries { tick, acceptedActions: [{ kind: "move", actorId, params: { to } }] }.
const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";

function buildMultiTickBundle() {
  const simConfig = {
    schema: SIM_CONFIG_SCHEMA,
    schemaVersion: 1,
    meta: { id: "sim1", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 5,
        height: 1,
        tiles: ["....."],
        spawn: { x: 0, y: 0 },
        exit: { x: 4, y: 0 },
        rooms: [],
        traps: [],
      },
    },
  };
  const initialState = {
    schema: INITIAL_STATE_SCHEMA,
    schemaVersion: 1,
    meta: { id: "state1", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z" },
    simConfigRef: { id: "sim1", schema: SIM_CONFIG_SCHEMA, schemaVersion: 1 },
    actors: [
      { id: "delver_1", kind: "ambulatory", archetype: "delver", role: "delver", position: { x: 0, y: 0 } },
    ],
  };
  const tickFrames = [1, 2, 3, 4].map((tick) => ({
    tick,
    acceptedActions: [
      { kind: "move", actorId: "delver_1", params: { to: { x: tick, y: 0 } } },
    ],
  }));
  return {
    artifacts: [simConfig, initialState],
    tickFrames,
  };
}

function createFakeRoot(extraIds = []) {
  const elements = {};
  const allIds = [
    "gameplay-status", "gameplay-phaser-host",
    "gameplay-step-back", "gameplay-step-forward", "gameplay-run-to-end",
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
    setPlaybackControls(controls) { calls.push(["setPlaybackControls", controls]); this.receivedControls = controls; },
    enterFullscreen: undefined,
    exitFullscreen: undefined,
  };
}

function lastActorPosition(frame, actorId) {
  const actor = (frame?.observation?.actors || []).find((a) => a.id === actorId);
  return actor?.position ?? null;
}

// ---------------------------------------------------------------------------
// Baseline: stepForward / stepBack / runToEnd already exist (M1-era controls)
// ---------------------------------------------------------------------------

describe("Existing tick playback controls (baseline)", () => {
  it("stepForward advances the actor position by one tick", async () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    const view = wireGameplayView({ root, createRenderer: () => renderer });

    await view.loadRun(buildMultiTickBundle());
    view.stepForward();

    const lastCall = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").pop();
    const frame = lastCall[1];
    assert.deepEqual(lastActorPosition(frame, "delver_1"), { x: 1, y: 0 },
      "after one stepForward, delver_1 should be at tick-1 position");
  });

  it("runToEnd jumps straight to the final tick", async () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    const view = wireGameplayView({ root, createRenderer: () => renderer });

    await view.loadRun(buildMultiTickBundle());
    view.runToEnd();

    const lastCall = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").pop();
    const frame = lastCall[1];
    assert.deepEqual(lastActorPosition(frame, "delver_1"), { x: 4, y: 0 },
      "runToEnd should land on the final tick frame (tick 4)");
  });
});

// ---------------------------------------------------------------------------
// M4/M5 gap: jump-to-start (the mirror image of runToEnd) does not exist yet.
// ---------------------------------------------------------------------------

describe("Jump-to-start playback control (M5 gap)", () => {
  it.skip("wireGameplayView exposes a jump-to-start function", async () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    const view = wireGameplayView({ root, createRenderer: () => renderer });
    await view.loadRun(buildMultiTickBundle());

    // Mirrors runToEnd; production code has no equivalent "runToStart"/"jumpToStart" yet.
    assert.equal(typeof view.runToStart, "function",
      "wireGameplayView must expose a runToStart (jump-to-first-tick) method, mirroring runToEnd");
  });

  it.skip("runToStart resets the cursor to tick 0 from a mid-run position", async () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    const view = wireGameplayView({ root, createRenderer: () => renderer });
    await view.loadRun(buildMultiTickBundle());

    view.stepForward();
    view.stepForward();
    view.stepForward();
    assert.equal(typeof view.runToStart, "function",
      "runToStart must exist before it can be invoked");
    view.runToStart();

    const lastCall = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").pop();
    const frame = lastCall[1];
    assert.deepEqual(lastActorPosition(frame, "delver_1"), { x: 0, y: 0 },
      "runToStart should return the actor to the initial (tick 0) position");
  });
});

// ---------------------------------------------------------------------------
// M4/M5 gap: keyboard routing (Cmd+Arrow) to playback navigation does not exist.
// The renderer's keydown handler ignores event.metaKey entirely today
// (gameplay-phaser-renderer.js ~line 382-395) — onKeyPress only fires for
// ACTOR_CONTROL_KEYS (plain arrows/wasd/etc.), and there is no channel by which
// a Cmd+Arrow keypress reaches stepForward/stepBack/runToEnd/runToStart.
// ---------------------------------------------------------------------------

describe("Keyboard routing to playback navigation (M5 gap)", () => {
  it.skip("setPlaybackControls payload includes a jump-to-start closure for the renderer to invoke on Cmd+ArrowUp", async () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    const view = wireGameplayView({ root, createRenderer: () => renderer });
    await view.loadRun(buildMultiTickBundle());

    const controlsCall = renderer.calls.find((c) => Array.isArray(c) && c[0] === "setPlaybackControls");
    assert.ok(controlsCall, "setPlaybackControls must have been called on the renderer");
    const controls = controlsCall[1];

    // Today's controls payload is { stepBack, stepForward, togglePlay, reset } —
    // there is no "jumpToStart" or "jumpToEnd" member for the renderer's
    // Cmd+Arrow keydown branch to call.
    assert.equal(typeof controls.jumpToStart, "function",
      "playback controls passed to the renderer must include a jumpToStart closure " +
      "so a future Cmd+ArrowUp keydown handler in gameplay-phaser-renderer.js can invoke it");
    assert.equal(typeof controls.jumpToEnd, "function",
      "playback controls passed to the renderer must include a jumpToEnd closure " +
      "so a future Cmd+ArrowDown keydown handler in gameplay-phaser-renderer.js can invoke it");
  });

  it("onKeyPress simulation of Cmd+ArrowRight does not currently step the playback cursor", async () => {
    // This test documents the missing wiring: onKeyPress (the callback wired in
    // wireGameplayView's createRenderer options, gameplay-view.js ~line 172) has
    // no branch for metaKey/Cmd+Arrow combinations at all, so simulating the only
    // channel that exists today (the `key` string) cannot advance the cursor.
    const root = createFakeRoot();
    let capturedOnKeyPress = null;
    const renderer = createFakeRenderer();
    const view = wireGameplayView({
      root,
      createRenderer: (opts) => {
        capturedOnKeyPress = opts.onKeyPress;
        return renderer;
      },
    });
    await view.loadRun(buildMultiTickBundle());

    const beforeCall = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").length;

    // Simulate what a metaKey-aware keydown handler would need to forward, using
    // the only shape onKeyPress currently accepts: { key }. There is no metaKey
    // field in the contract, so this cannot represent "Cmd+ArrowRight" distinctly
    // from plain "ArrowRight" today.
    capturedOnKeyPress?.({ key: "arrowright", metaKey: true });

    const afterCall = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").length;
    assert.equal(afterCall, beforeCall,
      "onKeyPress has no Cmd+Arrow branch yet, so no renderFrame should occur — " +
      "this must change once M5 wires Cmd+Arrow to stepForward/stepBack/jumpToStart/jumpToEnd");
  });
});

// ---------------------------------------------------------------------------
// Cursor bounds behavior (should hold once jump-to-start exists too)
// ---------------------------------------------------------------------------

describe("Cursor bounds at first/last frame", () => {
  it("stepBack at frame 0 is a no-op", async () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    const view = wireGameplayView({ root, createRenderer: () => renderer });
    await view.loadRun(buildMultiTickBundle());

    const beforeCount = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").length;
    view.stepBack();
    const afterCount = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").length;

    assert.equal(afterCount, beforeCount, "stepBack at the first frame must not render a new frame");
  });

  it("stepForward at the last frame is a no-op", async () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    const view = wireGameplayView({ root, createRenderer: () => renderer });
    await view.loadRun(buildMultiTickBundle());

    view.runToEnd();
    const beforeCount = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").length;
    view.stepForward();
    const afterCount = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").length;

    assert.equal(afterCount, beforeCount, "stepForward at the last frame must not render a new frame");
  });

  it.skip("runToStart at frame 0 is a no-op", async () => {
    const root = createFakeRoot();
    const renderer = createFakeRenderer();
    const view = wireGameplayView({ root, createRenderer: () => renderer });
    await view.loadRun(buildMultiTickBundle());

    assert.equal(typeof view.runToStart, "function",
      "runToStart must exist to evaluate its no-op-at-frame-0 behavior");
    const beforeCount = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").length;
    view.runToStart();
    const afterCount = renderer.calls.filter((c) => Array.isArray(c) && c[0] === "renderFrame").length;

    assert.equal(afterCount, beforeCount, "runToStart already at frame 0 must not render a new frame");
  });
});

describe.skip("Cmd+Arrow playback navigation permutations", () => {
  it("Cmd+ArrowRight repeated past the last frame clamps without throwing", () => {});
  it("Cmd+ArrowLeft repeated past frame 0 clamps without throwing", () => {});
  it("Cmd+ArrowDown then Cmd+ArrowUp jumps end to start", () => {});
  it("Cmd+Arrow keys before any loaded run are no-ops", () => {});
  it("plain arrow keys without modifier never change the playback cursor", () => {});
  it("Cmd+Shift+ArrowRight follows the Cmd+ArrowRight clamp contract", () => {});
  it("rapid alternating stepForward and stepBack around a single-frame bundle is stable", () => {});
  it("jumpToStart and jumpToEnd closures are safe before loadRun", () => {});
});

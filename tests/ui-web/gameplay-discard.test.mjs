import assert from "node:assert/strict";
import { wireGameplayView } from "../../packages/ui-web/src/views/gameplay-view.js";

function makeRoot() {
  return {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

const MINIMAL_BUNDLE = { artifacts: [] };

// The gameplay view is read-only — nothing on it is ever edited, so there is
// no "unsaved changes" to confirm discarding. requestDesignTransition (the
// back-arrow handler) must navigate back immediately, every time, without
// prompting.

test("requestDesignTransition with no active run calls onDiscardToDesign without prompting", () => {
  let discarded = false;
  let confirmCalled = false;
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => { confirmCalled = true; return false; };
  try {
    const view = wireGameplayView({
      root: makeRoot(),
      onDiscardToDesign: () => { discarded = true; },
    });
    view.requestDesignTransition();
    assert.equal(confirmCalled, false, "confirm must never be called");
    assert.equal(discarded, true, "onDiscardToDesign must be called immediately when no run is active");
  } finally {
    globalThis.confirm = originalConfirm;
  }
});

test("requestDesignTransition with active run navigates back immediately without prompting", async () => {
  let confirmCalled = false;
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => { confirmCalled = true; return false; };
  try {
    let discarded = false;
    const view = wireGameplayView({
      root: makeRoot(),
      onDiscardToDesign: () => { discarded = true; },
    });
    await view.loadRun(MINIMAL_BUNDLE);
    view.requestDesignTransition();
    assert.equal(confirmCalled, false, "confirm must never be called, even with an active run");
    assert.equal(discarded, true, "onDiscardToDesign must be called immediately");
    assert.equal(view.isRunActive(), false, "run must be cleared on transition");
  } finally {
    globalThis.confirm = originalConfirm;
  }
});

test("requestDesignTransition fires onDiscardToDesign on every call while a run is active", async () => {
  let calls = 0;
  const view = wireGameplayView({
    root: makeRoot(),
    onDiscardToDesign: () => { calls += 1; },
  });
  await view.loadRun(MINIMAL_BUNDLE);
  view.requestDesignTransition();
  await view.loadRun(MINIMAL_BUNDLE);
  view.requestDesignTransition();
  assert.equal(calls, 2, "onDiscardToDesign must fire every time Design is requested");
});

test("requestDesignTransition with active run and no onDiscardToDesign does not throw", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(MINIMAL_BUNDLE);

  assert.doesNotThrow(() => view.requestDesignTransition());
  assert.equal(view.isRunActive(), false);
});

test("requestDesignTransition after clear does not throw", async () => {
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(MINIMAL_BUNDLE);
  view.clear();

  assert.doesNotThrow(() => view.requestDesignTransition());
  assert.equal(view.isRunActive(), false);
});

test("requestDesignTransition clears renderer state without throwing", async () => {
  const calls = [];
  const view = wireGameplayView({
    root: makeRoot(),
    createRenderer: () => ({
      mount() {},
      renderRun() {},
      renderFrame() {},
      closePlayerPanel() { calls.push("closePlayerPanel"); },
      clearHighlight() { calls.push("clearHighlight"); },
      dispose() {},
    }),
  });
  await view.loadRun(MINIMAL_BUNDLE);

  assert.doesNotThrow(() => view.requestDesignTransition());
  assert.ok(calls.includes("closePlayerPanel"));
  assert.ok(calls.includes("clearHighlight"));
});

test("requestDesignTransition clears selected entity", async () => {
  const bundle = {
    artifacts: [
      { schema: "agent-kernel/SimConfigArtifact", layout: { kind: "grid", data: { width: 2, height: 2, tiles: ["..", ".."] } } },
      { schema: "agent-kernel/InitialStateArtifact", actors: [{ id: "actor-1", position: { x: 1, y: 1 } }] },
    ],
  };
  const view = wireGameplayView({ root: makeRoot() });
  await view.loadRun(bundle);
  view.selectEntity({ x: 1, y: 1 });
  assert.ok(view.getSelectedEntity());

  view.requestDesignTransition();

  assert.equal(view.getSelectedEntity(), null);
});

test("requestDesignTransition clears tick position back to initial state on next load", async () => {
  const bundle = {
    artifacts: [
      { schema: "agent-kernel/SimConfigArtifact", layout: { kind: "grid", data: { width: 2, height: 2, tiles: ["..", ".."] } } },
      { schema: "agent-kernel/InitialStateArtifact", actors: [{ id: "actor-1", position: { x: 0, y: 0 } }] },
    ],
    tickFrames: [{ tick: 0, acceptedActions: [{ kind: "move", actorId: "actor-1", params: { to: { x: 1, y: 0 } } }] }],
  };
  const renderedFrames = [];
  const view = wireGameplayView({
    root: makeRoot(),
    createRenderer: () => ({ mount() {}, renderRun() {}, renderFrame(frame) { renderedFrames.push(frame); }, closePlayerPanel() {}, clearHighlight() {}, dispose() {} }),
  });
  await view.loadRun(bundle);
  view.stepForward();
  view.requestDesignTransition();
  await view.loadRun(bundle);
  view.stepForward();

  assert.equal(renderedFrames.at(-1).observation.actors[0].position.x, 1);
});

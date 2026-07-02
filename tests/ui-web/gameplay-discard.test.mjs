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

/*
## TODO: Test Permutations
- requestDesignTransition with active run and onDiscardToDesign undefined does not throw
- requestDesignTransition after clear does not throw (run is no longer active)
- requestDesignTransition clears renderer state without throwing
- requestDesignTransition clears selected entity
- requestDesignTransition clears tick position back to initial state
*/

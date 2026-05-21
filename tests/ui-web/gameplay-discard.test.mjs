import assert from "node:assert/strict";
import { wireGameplayView } from "../../packages/ui-web/src/views/gameplay-view.js";

function makeRoot() {
  return {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

const MINIMAL_BUNDLE = { artifacts: [] };

async function withConfirm(returnValue, fn) {
  const original = globalThis.confirm;
  const calls = [];
  globalThis.confirm = (message) => {
    calls.push(message);
    return returnValue;
  };
  try {
    await fn(calls);
  } finally {
    globalThis.confirm = original;
  }
}

test("requestDesignTransition with no active run calls onDiscardToDesign without prompting", () => {
  let discarded = false;
  withConfirm(false, (confirmCalls) => {
    const view = wireGameplayView({
      root: makeRoot(),
      onDiscardToDesign: () => { discarded = true; },
    });
    view.requestDesignTransition();
    assert.equal(confirmCalls.length, 0, "confirm must not be called when no run is active");
    assert.equal(discarded, true, "onDiscardToDesign must be called immediately when no run is active");
  });
});

test("requestDesignTransition with active run prompts the user before discarding", async () => {
  await withConfirm(true, async (confirmCalls) => {
    const view = wireGameplayView({ root: makeRoot() });
    await view.loadRun(MINIMAL_BUNDLE);
    view.requestDesignTransition();
    assert.equal(confirmCalls.length, 1, "confirm must be called exactly once");
    assert.ok(
      confirmCalls[0].includes("Discard"),
      `confirm message must mention discard, got: "${confirmCalls[0]}"`,
    );
  });
});

test("requestDesignTransition confirm prompt uses the exact required message text", async () => {
  await withConfirm(true, async (confirmCalls) => {
    const view = wireGameplayView({ root: makeRoot() });
    await view.loadRun(MINIMAL_BUNDLE);
    view.requestDesignTransition();
    assert.equal(
      confirmCalls[0],
      "Discard current run and return to design?",
    );
  });
});

test("requestDesignTransition confirmed: calls onDiscardToDesign and clears run state", async () => {
  let discarded = false;
  await withConfirm(true, async () => {
    const view = wireGameplayView({
      root: makeRoot(),
      onDiscardToDesign: () => { discarded = true; },
    });
    await view.loadRun(MINIMAL_BUNDLE);
    view.requestDesignTransition();
    assert.equal(discarded, true, "onDiscardToDesign must be called on confirm");
    assert.equal(view.isRunActive(), false, "run must be deactivated after confirmed discard");
  });
});

test("requestDesignTransition cancelled: does not call onDiscardToDesign and preserves run state", async () => {
  let discarded = false;
  await withConfirm(false, async () => {
    const view = wireGameplayView({
      root: makeRoot(),
      onDiscardToDesign: () => { discarded = true; },
    });
    await view.loadRun(MINIMAL_BUNDLE);
    view.requestDesignTransition();
    assert.equal(discarded, false, "onDiscardToDesign must not be called when cancelled");
    assert.equal(view.isRunActive(), true, "run must remain active when discard is cancelled");
  });
});

test("requestDesignTransition fires the prompt on every call while run is active", async () => {
  await withConfirm(false, async (confirmCalls) => {
    const view = wireGameplayView({ root: makeRoot() });
    await view.loadRun(MINIMAL_BUNDLE);
    view.requestDesignTransition();
    view.requestDesignTransition();
    assert.equal(confirmCalls.length, 2, "confirm must fire every time Design is requested");
  });
});

/*
## TODO: Test Permutations
- requestDesignTransition with active run and onDiscardToDesign undefined does not throw on confirm
- requestDesignTransition after clear does not prompt (run is no longer active)
- requestDesignTransition confirm clears renderer state without throwing
- requestDesignTransition confirm clears selected entity
- requestDesignTransition confirm clears tick position back to initial state
*/

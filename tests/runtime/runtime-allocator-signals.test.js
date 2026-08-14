const assert = require("node:assert/strict");

/**
 * P5.5 rewrote what this file pins.
 *
 * It used to assert that runtime SIGNALS drive the rebalance transition, and they did:
 * `signals` are counts of effects, fulfilments and actions, and any non-empty array
 * admitted REBALANCING. That made the state enterable on "a tick happened", with nothing
 * to do once inside it — the label-only state the charter calls a defect.
 *
 * Entry now requires the budget LEDGER (issued caps beside core's actual spend), which is
 * what the Allocator's chartered reconciliation consumes. So the pair below is the real
 * contract: a core that exposes its usage counter reaches `rebalancing`; a core that does
 * not stays in `monitoring` and claims nothing. The second case is the important one —
 * before P5.5 that same core reported `rebalancing` while reconciling nothing.
 */

/** A minimal core, with the budget ledger as the single variable. */
function fakeCore({ withLedger }) {
  const core = {
    init() {},
    applyAction() {},
    getCounter() { return 0; },
    getEffectCount() { return 1; },
    getEffectKind() { return 1; },
    getEffectValue() { return 0; },
    clearEffects() {},
    setBudget() {},
  };
  if (withLedger) {
    core.getBudgetUsage = () => 3;
  }
  return core;
}

const simConfig = {
  constraints: {
    categoryCaps: {
      caps: {
        movement: 1,
      },
    },
  },
};

async function lastAllocatorView(core) {
  const { createRuntime } = await import(
    "../../packages/runtime/src/runner/runtime.js"
  );
  const runtime = createRuntime({
    core,
    adapters: { logger: { log() {}, warn() {}, error() {} } },
  });

  await runtime.init({ seed: 0, simConfig });
  await runtime.step();
  await runtime.step();

  const summarizeFrames = runtime.getTickFrames().filter((frame) => frame.phaseDetail === "summarize");
  return summarizeFrames[summarizeFrames.length - 1].personaViews.allocator;
}

test("allocator rebalance is driven by the budget ledger, and reconciles on arrival", async () => {
  const view = await lastAllocatorView(fakeCore({ withLedger: true }));

  assert.equal(view.state, "rebalancing");
  // The state is not the claim — the reconciliation is. Spend 3 against an issued cap
  // of 1 is an overspend, and the persona must say so rather than merely arrive.
  assert.equal(view.context.reconciliation.disposition, "exceeded");
  assert.deepEqual(
    view.context.reconciliation.adjustments,
    [{ kind: "reduce_scope", category: "movement", overspend: 2 }],
  );
});

test("a core with no usage counter stays in monitoring rather than claiming a reconciliation", async () => {
  const view = await lastAllocatorView(fakeCore({ withLedger: false }));

  assert.equal(
    view.state,
    "monitoring",
    "with no ledger there is nothing to reconcile, so the reconciling state must not be entered",
  );
  assert.equal(view.context.reconciliation, undefined);
});

// ## TODO: Test Permutations
// - a cap the run stays inside: disposition "within", no adjustments
// - spend landing exactly on the cap: disposition "at_limit", a single "hold" adjustment
// - two capped categories where only one is exceeded: the run verdict takes the worst
// - an uncapped run (no categoryCaps at all): no ledger, so no rebalance and no claim

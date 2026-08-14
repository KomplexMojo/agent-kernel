/**
 * G1 allocator/reconciliation (A1 + A2) — P5.5, 2026-08-13.
 *
 * The charter's persona table has named reconciliation as Allocator work since the
 * persona model was enforced, and this persona's README has described it under
 * "Reconciliation and Adjustment" for just as long. Neither was implemented: the
 * registry carried the entry as `blockedBy: "P5.5"` with `invocation: "none"`, because
 * a G1 test cannot come before the behavior.
 *
 * The behavior exists now, so this is the test. It is an ABLATION rather than an output
 * check, for the reason CR.8 established: driving `reconcileBudget` directly proves the
 * function works and says nothing about whether production consults the persona. The two
 * runs below differ in exactly one thing — whether the Allocator in the registry
 * reconciles anything — and the tick must be unable to make up the difference.
 *
 * ⚠️ **THE CONTROL IS HALF THE TEST.** An ablation that only asserts "no verdict when
 * stubbed" passes just as well when the fixture never overspent at all. The control run
 * asserts the same core, caps and steps DO produce an `exceeded` verdict with a real
 * Allocator, so the ablation is not vacuous.
 *
 * ⚠️ **A1 as well as A2, and the two are separable here.** The disposition boundaries
 * (`within` / `at_limit` / `exceeded`) and the adjustment vocabulary are the Allocator's
 * to author — the third case pins that nothing else gets to define what "over budget"
 * means. That is why the overspend arithmetic is asserted, not just its presence.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../../..");
const MODULES = "../../../packages/runtime/src/personas/";
const CLOCK = () => "2026-08-13T00:00:00.000Z";

function fixture(name) {
  return JSON.parse(readFileSync(resolve(ROOT, `tests/fixtures/artifacts/${name}`), "utf8"));
}

/**
 * The shared movement fixture, plus one `effects` cap set low enough that a three-tick
 * run passes it. The cap is added here rather than committed to the fixture because the
 * fixture is the actor-movement baseline several other tests share, and giving it a
 * budget would change what THEY are measuring.
 *
 * ⚠️ **The cap is on `effects`, NOT `movement`, and that is not a stylistic choice.**
 * `core.applyAction` returns for `ActionKind.Move` BEFORE `chargeBudgetForAction`
 * (core-ts/src/index.ts), so moves are never charged to any category — a `movement` cap
 * is inert against them, and a run that moves 300 times reconciles as spend 0. That is a
 * pre-existing core defect, out of scope here and reported separately; this test caps the
 * category production actually charges so that it measures reconciliation rather than
 * that bug.
 */
const simConfig = {
  ...fixture("sim-config-artifact-v1-mvp-grid.json"),
  constraints: {
    categoryCaps: {
      caps: {
        effects: 1,
      },
    },
  },
};
const initialState = fixture("initial-state-artifact-v1-mvp-actor.json");

/**
 * The tick-plane registry, with the Allocator as the one variable. Built the same way
 * for both runs: a caller-supplied registry REPLACES the defaults, so constructing one
 * run from defaults and the other by hand would vary two things at once.
 */
async function buildRegistry(allocator) {
  const { createActorPersona } = await import(`${MODULES}actor/persona.js`);
  const { createModeratorPersona } = await import(`${MODULES}moderator/persona.js`);
  const { createAnnotatorPersona } = await import(`${MODULES}annotator/persona.js`);
  return {
    allocator,
    actor: createActorPersona({ clock: CLOCK, admitProposals: allocator.admitProposals }),
    moderator: createModeratorPersona({ clock: CLOCK }),
    annotator: createAnnotatorPersona({ clock: CLOCK }),
  };
}

async function runTicks(allocator) {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");
  const { createCore } = await import("../../../packages/core-ts/src/index.ts");

  const runtime = createRuntime({
    core: createCore(),
    adapters: { logger: { log() {}, warn() {}, error() {} } },
    personas: await buildRegistry(allocator),
  });
  await runtime.init({ seed: 0, simConfig, initialState, runId: "run_g1_allocator_reconciliation" });
  // Solver prompts are what make this run SPEND: the Allocator turns them into
  // `request_solver` actions and core charges those to the Effects category. The
  // fixture's moves charge nothing (see the simConfig note above), so without these
  // the run would reconcile a ledger that never moves off zero and the verdict would
  // be the same whether or not the budget worked at all.
  for (let i = 0; i < 3; i += 1) {
    await runtime.step({
      personaPayloads: {
        allocator: { solverPrompts: [{ requestId: `solver_${i}`, problem: { language: "custom", data: {} } }] },
      },
    });
  }

  return runtime.getTickFrames();
}

/** Every reconciliation verdict any frame carries, from any persona. */
function verdicts(frames) {
  return frames
    .map((frame) => frame?.personaViews?.allocator?.context?.reconciliation)
    .filter(Boolean);
}

/**
 * An Allocator that does everything the real one does EXCEPT reconcile.
 *
 * ⚠️ **It delegates to a real persona rather than returning empty arrays, and that is
 * the whole reason this ablation means anything.** The Allocator's tick work is
 * payload-driven — it turns effects and prompts into budget-limited request actions —
 * and those actions are what core CHARGES. A stub that emitted nothing would spend
 * nothing, so the ablated run would have no signals, the runner would never send
 * `rebalance`, and "no reconciliation" would follow from the missing spend rather than
 * from the missing persona. Same vacuity that let eight façade violations survive a
 * green suite, one level further back: in the INPUT rather than in the assertion.
 *
 * So the twin is exact — same actions, same effects, same spend — and the single
 * difference is that `rebalance` is forwarded to the real persona as `observe`, the
 * state-preserving self-loop. The delegate therefore never reaches its reconciliation
 * branch, and this stub reports the states without doing the work behind them: exactly
 * what the FSM did before P5.5.
 */
async function stubAllocator() {
  const { createAllocatorPersona } = await import(`${MODULES}allocator/persona.js`);
  const real = createAllocatorPersona({ clock: CLOCK });
  const strip = (view) => ({ state: view.state, context: {} });
  return {
    subscribePhases: real.subscribePhases,
    advance(args = {}) {
      const event = args.event === "rebalance" ? "observe" : args.event;
      const result = real.advance({ ...args, event });
      return { ...result, ...strip(result) };
    },
    view: () => strip(real.view()),
    admitProposals: real.admitProposals,
  };
}

test("G1 allocator/reconciliation: with the Allocator neutered, nothing reconciles the run", async () => {
  const { createAllocatorPersona } = await import(`${MODULES}allocator/persona.js`);

  // CONTROL — the real Allocator, same core, same caps, same steps.
  const control = verdicts(await runTicks(createAllocatorPersona({ clock: CLOCK })));
  assert.ok(
    control.length > 0,
    "precondition: this run must actually reconcile, or the ablation below is vacuous — "
      + "the exact way a façade passes an output test",
  );
  assert.equal(
    control[control.length - 1].disposition,
    "exceeded",
    "precondition: the caps must actually be passed, or 'no verdict' and 'a clean verdict' "
      + "are indistinguishable",
  );

  // ABLATION — the only change is an Allocator that reconciles nothing.
  const ablated = verdicts(await runTicks(await stubAllocator()));
  assert.deepEqual(
    ablated,
    [],
    "production reported a reconciliation while the Allocator produced none — something "
      + "other than the Allocator is judging spend against budget, which is an A2 "
      + "violation however the call is routed",
  );
});

test("G1 allocator/reconciliation: the Allocator authors the verdict, not just its presence", async () => {
  const { createAllocatorPersona } = await import(`${MODULES}allocator/persona.js`);

  const found = verdicts(await runTicks(createAllocatorPersona({ clock: CLOCK })));
  const last = found[found.length - 1];

  const effects = last.categories.find((row) => row.category === "effects");
  assert.equal(effects.issued, 1, "the issued half is the cap the run was given");
  assert.ok(effects.spent > effects.issued, "the actual half is what core charged");
  assert.equal(effects.remaining, effects.issued - effects.spent);

  // The chartered adjustment: "require simplification". Expressed as data, not performed.
  assert.deepEqual(
    last.adjustments,
    [{ kind: "reduce_scope", category: "effects", overspend: effects.spent - effects.issued }],
  );
});

// ## TODO: Test Permutations
// - a run that stays inside its cap: disposition "within" and an EMPTY adjustment list —
//   the verdict must still be produced, because "reconciled and found nothing" is a claim
// - spend landing exactly on the cap: "at_limit" with a single "hold" adjustment
// - two capped categories, one exceeded: the run-level disposition takes the worst, and
//   the clean category still appears in `categories`
// - a run with no categoryCaps at all: no ledger, so no rebalance and no verdict anywhere
// - replay: the verdict in a restored personaView must match the one the live run produced

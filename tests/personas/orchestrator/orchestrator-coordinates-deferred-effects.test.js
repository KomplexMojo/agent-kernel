/**
 * G1 orchestrator/deferred-side-effects (A2 + A5) — P5.5, 2026-08-13.
 *
 * The charter, this persona's README and the Moderator's have all described post-run
 * coordination since the persona model was enforced: effects that cannot be satisfied
 * deterministically during execution are recorded, and the Orchestrator fulfils them AFTER
 * the run, capturing the results for future deterministic runs. **None of it existed.**
 * `dispatchEffect` marked effects `deferred`, the Moderator's plan recorded the disposition,
 * and the only thing downstream was `ak inspect`, which COUNTED them. The registry carried
 * the entry as blocked with `invocation: "none"` for that reason — a G1 test cannot come
 * before the behavior.
 *
 * ⚠️ **Why the ablation is not the whole test here.** A2 asks whether production breaks
 * without the persona, and the honest answer for a behavior this new is that production
 * used to do NOTHING, so "nothing happens without the Orchestrator" was true before the
 * feature and is not evidence of ownership. So the first test is the one that would have
 * failed yesterday — deferrals are coordinated at all — and the ablation guards the
 * direction it can regress in: glue growing its own fulfilment.
 */
const assert = require("node:assert/strict");

const RUNTIME = "../../../packages/runtime/src/runner/runtime.js";
const CORE = "../../../packages/core-ts/src/index.ts";
const MODULES = "../../../packages/runtime/src/personas/";
const CLOCK = () => "2026-08-13T00:00:00.000Z";

/**
 * A core that emits one `need_external_fact` WITHOUT a sourceRef per flush.
 *
 * `ports/effects.js` marks a fact effect `deferred` exactly when its encoded payload has no
 * source, and the Moderator's fulfilment plan then resolves it to DEFER. That is the only
 * shape production actually defers, so the fixture produces that shape rather than a
 * hand-written record — a test that synthesized its own "deferred" entry would pass just as
 * well if the runtime stopped producing them.
 */
function coreEmittingUnsourcedFacts() {
  let flushes = 0;
  return {
    init() {},
    applyAction() {},
    getCounter() { return 0; },
    // EffectKind.NeedExternalFact is 6; an odd detail encodes "no sourceRef".
    getEffectCount() { return flushes++ < 6 ? 1 : 0; },
    getEffectKind() { return 6; },
    getEffectValue() { return 1; },
    clearEffects() {},
  };
}

async function runtimeWith({ personas, adapters = {} } = {}) {
  const { createRuntime } = await import(RUNTIME);
  const runtime = createRuntime({
    core: coreEmittingUnsourcedFacts(),
    adapters: { logger: { log() {}, warn() {}, error() {} }, ...adapters },
    ...(personas ? { personas } : {}),
  });
  await runtime.init({ seed: 0, runId: "run_g1_deferred", clock: CLOCK });
  await runtime.step();
  await runtime.step();
  return runtime;
}

test("the run defers effects, and they are visible as deferred before anyone coordinates", async () => {
  const runtime = await runtimeWith();
  const { collectDeferredEffects } = await import(`${MODULES}orchestrator/persona.js`);

  const deferred = collectDeferredEffects(runtime.getTickFrames());
  assert.ok(
    deferred.length > 0,
    "precondition: this fixture must actually defer effects, or every assertion below is "
      + "vacuous — the state this item was opened to fix looked exactly like a clean run",
  );
  assert.equal(deferred[0].effect.kind, "need_external_fact");
});

test("G1 orchestrator/deferred-side-effects: the Orchestrator coordinates them after the run", async () => {
  const runtime = await runtimeWith({
    // An external-fact adapter, so the coordination has something to fulfil WITH. Without
    // one the port refuses (missing_external_fact_adapter) rather than reporting a fact it
    // never fetched — which is the second half of this test, below.
    adapters: { externalFacts: { fetch: (effect) => ({ answered: effect.requestId }) } },
  });

  const result = runtime.coordinateDeferredEffects();

  assert.ok(result, "a run that deferred effects must produce a settlement");
  assert.equal(result.deferredCount, result.captures.length + result.outstanding.length);
  assert.ok(result.captures.length > 0, "the adapter answered, so there must be captures");
  assert.deepEqual(result.outstanding, [], "nothing was left unanswered");

  // The capture is the chartered artifact — a fact obtained post-run, recorded so a future
  // run can be deterministic — and it is stamped by the round, not by the host.
  const capture = result.captures[0];
  assert.equal(capture.schema, "agent-kernel/CapturedInputArtifact");
  assert.equal(capture.schemaVersion, 1);
  assert.equal(capture.meta.producedBy, "orchestrator");
  assert.equal(capture.meta.runId, "run_g1_deferred");
  assert.equal(capture.source.requestId, capture.source.requestId);
});

test("with no adapter, deferrals are reported OUTSTANDING and never captured as fulfilled", async () => {
  const runtime = await runtimeWith();

  const result = runtime.coordinateDeferredEffects();

  assert.deepEqual(result.captures, [], "nothing was fetched, so nothing may be captured");
  assert.ok(result.outstanding.length > 0);
  assert.equal(
    result.outstanding[0].reason,
    "missing_external_fact_adapter",
    "the port must name the missing adapter rather than fall through to the default branch, "
      + "which warns and then reports `fulfilled` — a fact that was never fetched wearing a "
      + "success status, and the round would capture it as provenance",
  );
});

test("a run that deferred nothing does not open a coordination round", async () => {
  const { createRuntime } = await import(RUNTIME);
  const { createCore } = await import(CORE);
  const runtime = createRuntime({
    core: createCore(),
    adapters: { logger: { log() {}, warn() {}, error() {} } },
  });
  await runtime.init({ seed: 0, runId: "run_g1_clean", clock: CLOCK });
  await runtime.step();

  assert.equal(
    runtime.coordinateDeferredEffects(),
    null,
    "null, not an empty settlement: 'nothing was deferred' and 'everything was coordinated' "
      + "must stay distinguishable, which is the failure this whole item exists to end",
  );
});

test("G1 A5: the runtime refuses to coordinate without the Orchestrator that ran the run", async () => {
  const { createModeratorPersona } = await import(`${MODULES}moderator/persona.js`);
  const { createAnnotatorPersona } = await import(`${MODULES}annotator/persona.js`);

  // An Orchestrator that ticks but cannot host a round — the CR.8 façade shape, one
  // artifact over: glue must not mint a fresh persona purely to sign the captures.
  const runtime = await runtimeWith({
    personas: {
      orchestrator: {
        subscribePhases: ["observe", "decide", "emit"],
        advance: () => ({ state: "idle", context: {}, actions: [], effects: [], telemetry: null }),
        view: () => ({ state: "idle", context: {} }),
      },
      moderator: createModeratorPersona({ clock: CLOCK }),
      annotator: createAnnotatorPersona({ clock: CLOCK }),
    },
  });

  assert.throws(
    () => runtime.coordinateDeferredEffects(),
    (err) => err.code === "orchestrator_required",
  );
});

// ## TODO: Test Permutations
// - an adapter that answers some requests and declines others: captures and outstanding
//   must partition the deferred set exactly, with no record in both or neither
// - a `need_external_fact` that DOES carry a sourceRef: resolved deterministically during
//   the tick, so it must never reach the post-run round at all
// - calling coordinateDeferredEffects twice: the second call must not re-coordinate an
//   already-settled set
// - an adapter that throws: the requestId must land in outstanding with the failure reason,
//   not abort the whole settlement

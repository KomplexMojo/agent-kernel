const assert = require("node:assert/strict");

/**
 * CR.5 — CHARACTERIZATION TESTS. Written BEFORE the ordering/fulfilment policy
 * moves out of `runner/runtime-fsm.mjs` and into the Moderator, per the plan's
 * explicit instruction ("pin current ordering with a characterization test
 * BEFORE moving anything") and the PX.5 lesson: the tick plane's glue looked
 * like ceremony twice and was not.
 *
 * These assert OBSERVABLE runtime behavior only — persona execution order as
 * seen through personaViews key order, and effect dispositions as seen through
 * fulfilledEffects / the effect log. Nothing here names `orderPersonas` or
 * `flushEffects`, so the file must pass UNCHANGED after the move. If it needs
 * editing to stay green, the refactor changed behavior and that is the bug.
 *
 * The charter assigns "ordering, affinity resolution, effect fulfillment and
 * pausing" to the Moderator; today only the pause gate (P3.1, covered by
 * moderator-pause-gates-tick.test.js) is genuinely persona-owned.
 */

const CANONICAL_ORDER = [
  "orchestrator",
  "director",
  "configurator",
  "allocator",
  "actor",
  "moderator",
  "annotator",
];

function makeFakeCore({ effectCount = 0 } = {}) {
  let count = effectCount;
  return {
    init() {},
    step() {},
    applyAction() {},
    getCounter() { return 0; },
    getEffectCount() { return count; },
    getEffectKind(i) { return i; },
    getEffectValue(i) { return i; },
    clearEffects() { count = 0; },
  };
}

// Minimal persona satisfying registerPersona()'s contract: subscribePhases,
// advance(), view(). Subscribes to nothing, so it is only ever view()-read.
function makeStubPersona(label) {
  return {
    subscribePhases: [],
    advance() { return { state: label, context: {} }; },
    view() { return { state: label, context: {} }; },
  };
}

// The Moderator cannot be stubbed in these tests: since CR.5 it is the persona
// the runner asks for the order, so a stub that cannot answer plan_persona_order
// is not a valid substitute. That is the A2 property working — production cannot
// order personas without consulting a real Moderator.
async function makeRealModerator() {
  const { createModeratorPersona } = await import(
    "../../../packages/runtime/src/personas/moderator/persona.js"
  );
  return createModeratorPersona({ clock: () => "2026-01-01T00:00:00.000Z" });
}

// ---------------------------------------------------------------------------
// A · Persona execution order
//
// Order is load-bearing, not cosmetic: the tick orchestrator holds personas in
// a Map and iterates it in insertion order, so registration order decides the
// order personas advance in and the order their actions/effects accumulate.
// ---------------------------------------------------------------------------

// TEETH NOTE (verified by perturbation, 2026-07-31): this first test DOCUMENTS the
// canonical order but cannot on its own detect a broken ordering policy, because
// buildDefaultPersonas() already constructs the registry in canonical order — so
// insertion order and canonical order coincide here. Replacing orderPersonas with
// plain insertion order leaves it green. The two tests after it are the ones with
// teeth: both were confirmed to FAIL under that perturbation.
test("CR.5 characterization: the default registry executes in canonical persona order", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  const runtime = createRuntime({ core: makeFakeCore(), adapters: {} });
  await runtime.init({ seed: 0 });
  await runtime.step({});

  const frame = runtime.getTickFrames().at(-1);
  assert.deepEqual(
    Object.keys(frame.personaViews),
    CANONICAL_ORDER,
    "all seven personas must advance in the canonical order",
  );
});

test("CR.5 characterization: a partial registry keeps canonical order, not insertion order", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  // Deliberately supplied in REVERSE canonical order: if the runtime honoured
  // insertion order this would come back reversed. The moderator is supplied
  // explicitly so this test measures ORDERING ONLY — it asserts the same result
  // before and after CR.5, independent of the registry change tested separately
  // below.
  const runtime = createRuntime({
    core: makeFakeCore(),
    adapters: {},
    personas: {
      annotator: makeStubPersona("annotator"),
      moderator: await makeRealModerator(),
      actor: makeStubPersona("actor"),
      director: makeStubPersona("director"),
    },
  });
  await runtime.init({ seed: 0 });
  await runtime.step({});

  const frame = runtime.getTickFrames().at(-1);
  assert.deepEqual(
    Object.keys(frame.personaViews),
    ["director", "actor", "moderator", "annotator"],
    "a subset must still be ordered canonically, ignoring the order it was supplied in",
  );
});

test("CR.5 characterization: personas outside the canonical order are appended, in insertion order", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  const runtime = createRuntime({
    core: makeFakeCore(),
    adapters: {},
    personas: {
      zeta: makeStubPersona("zeta"),
      actor: makeStubPersona("actor"),
      alpha: makeStubPersona("alpha"),
      orchestrator: makeStubPersona("orchestrator"),
      moderator: await makeRealModerator(),
    },
  });
  await runtime.init({ seed: 0 });
  await runtime.step({});

  const frame = runtime.getTickFrames().at(-1);
  assert.deepEqual(
    Object.keys(frame.personaViews),
    ["orchestrator", "actor", "moderator", "zeta", "alpha"],
    "known personas first in canonical order, then unknown ones in the order supplied",
  );
});

// ---------------------------------------------------------------------------
// A' · The registry invariant CR.5 introduces
//
// DELIBERATE BEHAVIOR CHANGE, recorded rather than absorbed: before CR.5 a
// caller-supplied registry was used verbatim, so a runtime could run ticks with
// no Moderator at all. Since CR.5 the ordering and fulfilment policies live only
// in the Moderator, so the runner ensures one rather than keeping a fallback copy
// of either policy in glue — a second origin is the defect this milestone removes.
// Production is unaffected: buildDefaultPersonas has always supplied all seven,
// and no production call site passes a `personas` override.
// ---------------------------------------------------------------------------

test("CR.5: a caller-supplied registry without a Moderator still gets one", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  const runtime = createRuntime({
    core: makeFakeCore(),
    adapters: {},
    personas: { actor: makeStubPersona("actor") },
  });
  await runtime.init({ seed: 0 });
  await runtime.step({});

  const frame = runtime.getTickFrames().at(-1);
  assert.deepEqual(
    Object.keys(frame.personaViews),
    ["actor", "moderator"],
    "tick control is not optional — the Moderator is added when the caller omits it",
  );
});

test("CR.5: the runner refuses to proceed if the Moderator will not answer", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  // A "moderator" that cannot plan is not a Moderator. Without an explicit check
  // this surfaced as `undefined is not iterable` from deep inside the runner.
  const runtime = createRuntime({
    core: makeFakeCore(),
    adapters: {},
    personas: { moderator: makeStubPersona("moderator") },
  });

  await assert.rejects(
    () => runtime.init({ seed: 0 }),
    /Moderator did not return a persona order/,
  );
});

// ---------------------------------------------------------------------------
// B · Effect fulfilment disposition
//
// Four dispositions, in the order the runtime decides them. The first two are
// partially covered by tests/runtime/runner-effects.test.js; the deferred-effect
// branch and the sort are pinned here for the first time.
// ---------------------------------------------------------------------------

function runWithEffects(effectList, { adapters } = {}) {
  const dispatched = [];
  const recordingAdapters = adapters || {
    logger: {
      log: (...args) => { dispatched.push({ via: "logger.log", args }); return "logged"; },
      warn: (...args) => { dispatched.push({ via: "logger.warn", args }); return "warned"; },
      error: (...args) => { dispatched.push({ via: "logger.error", args }); return "errored"; },
    },
    telemetry: { emit: (record) => { dispatched.push({ via: "telemetry.emit", record }); return record; } },
    solver: { solve: (request) => { dispatched.push({ via: "solver.solve", request }); return { status: "ok" }; } },
  };

  return { dispatched, recordingAdapters, effectList };
}

test("CR.5 characterization: need_external_fact with a sourceRef is fulfilled deterministically, never dispatched", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  const effectList = [{
    id: "eff-a",
    kind: "need_external_fact",
    requestId: "req-a",
    targetAdapter: "fixtures",
    sourceRef: { id: "src-a", schema: "agent-kernel/IntentEnvelope", schemaVersion: 1 },
    data: { query: "a" },
  }];
  const { dispatched, recordingAdapters } = runWithEffects(effectList);

  const runtime = createRuntime({
    core: makeFakeCore({ effectCount: effectList.length }),
    adapters: recordingAdapters,
    effectFactory: ({ index }) => effectList[index],
  });
  await runtime.init({ seed: 0 });

  const frame = runtime.getTickFrames()[0];
  const [entry] = frame.fulfilledEffects;
  assert.equal(entry.status, "fulfilled");
  assert.equal(entry.effect.fulfillment, "deterministic", "the runtime stamps the effect deterministic");
  assert.deepEqual(entry.result, {
    sourceRef: effectList[0].sourceRef,
    requestId: "req-a",
    targetAdapter: "fixtures",
  });
  assert.equal(dispatched.length, 0, "a deterministic fulfilment must not reach any adapter");
});

test("CR.5 characterization: need_external_fact without a sourceRef defers with missing_source_ref", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  const effectList = [{
    id: "eff-b",
    kind: "need_external_fact",
    requestId: "req-b",
    targetAdapter: "fixtures",
    data: { query: "b" },
  }];
  const { dispatched, recordingAdapters } = runWithEffects(effectList);

  const runtime = createRuntime({
    core: makeFakeCore({ effectCount: effectList.length }),
    adapters: recordingAdapters,
    effectFactory: ({ index }) => effectList[index],
  });
  await runtime.init({ seed: 0 });

  const [entry] = runtime.getTickFrames()[0].fulfilledEffects;
  assert.equal(entry.status, "deferred");
  assert.equal(entry.reason, "missing_source_ref");
  assert.equal(entry.effect.fulfillment, "deferred", "the runtime stamps the effect deferred");
  assert.equal(dispatched.length, 0);
});

test("CR.5 characterization: a non-fact effect already marked deferred is not dispatched", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  // This branch is NOT reachable through the effects-routing fixture (its only
  // deferred entry is a need_external_fact, which the earlier branch claims
  // first), so this is the first coverage of `deferred_effect`.
  const effectList = [{
    id: "eff-c",
    kind: "telemetry",
    fulfillment: "deferred",
    data: { metric: 1 },
  }];
  const { dispatched, recordingAdapters } = runWithEffects(effectList);

  const runtime = createRuntime({
    core: makeFakeCore({ effectCount: effectList.length }),
    adapters: recordingAdapters,
    effectFactory: ({ index }) => effectList[index],
  });
  await runtime.init({ seed: 0 });

  const [entry] = runtime.getTickFrames()[0].fulfilledEffects;
  assert.equal(entry.status, "deferred");
  assert.equal(entry.reason, "deferred_effect");
  assert.equal(dispatched.length, 0, "a pre-deferred effect must bypass the adapter entirely");
});

test("CR.5 characterization: every other effect is dispatched through the effects port", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  const effectList = [
    { id: "eff-d1", kind: "log", severity: "info", data: { message: "hello" } },
    { id: "eff-d2", kind: "telemetry", data: { metric: 7 } },
  ];
  const { dispatched, recordingAdapters } = runWithEffects(effectList);

  const runtime = createRuntime({
    core: makeFakeCore({ effectCount: effectList.length }),
    adapters: recordingAdapters,
    effectFactory: ({ index }) => effectList[index],
  });
  await runtime.init({ seed: 0 });

  const entries = runtime.getTickFrames()[0].fulfilledEffects;
  assert.deepEqual(entries.map((e) => e.status), ["fulfilled", "fulfilled"]);
  assert.deepEqual(
    dispatched.map((d) => d.via),
    ["logger.log", "telemetry.emit"],
    "dispatch goes through the effects port to the matching adapter",
  );
});

test("CR.5 characterization: emitted effects are sorted by effect id, ties broken by core index", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  // Supplied in non-alphabetical order; two share an id so the index tiebreak
  // is exercised. Effect ids are the sort key, NOT the order core emitted them.
  const effectList = [
    { id: "eff-z", kind: "telemetry", data: { seq: 0 } },
    { id: "eff-m", kind: "telemetry", data: { seq: 1 } },
    { id: "eff-a", kind: "telemetry", data: { seq: 2 } },
    { id: "eff-m", kind: "telemetry", data: { seq: 3 } },
  ];
  const { recordingAdapters } = runWithEffects(effectList);

  const runtime = createRuntime({
    core: makeFakeCore({ effectCount: effectList.length }),
    adapters: recordingAdapters,
    effectFactory: ({ index }) => effectList[index],
  });
  await runtime.init({ seed: 0 });

  const frame = runtime.getTickFrames()[0];
  assert.deepEqual(
    frame.emittedEffects.map((e) => e.data.seq),
    [2, 1, 3, 0],
    "eff-a, then the two eff-m in core-index order, then eff-z",
  );

  // The effect log mirrors the same order, carrying status alongside.
  assert.deepEqual(
    runtime.getEffectLog().map((entry) => entry.effectId),
    ["eff-a", "eff-m", "eff-m", "eff-z"],
  );
});

test("CR.5 characterization: mixed dispositions coexist in one flush and all reach the effect log", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  const effectList = [
    { id: "eff-1-fact-ok", kind: "need_external_fact", requestId: "r1", targetAdapter: "fixtures", sourceRef: { id: "s1" }, data: {} },
    { id: "eff-2-fact-no", kind: "need_external_fact", requestId: "r2", targetAdapter: "fixtures", data: {} },
    { id: "eff-3-deferred", kind: "telemetry", fulfillment: "deferred", data: {} },
    { id: "eff-4-dispatch", kind: "log", severity: "warn", data: { message: "w" } },
  ];
  const { dispatched, recordingAdapters } = runWithEffects(effectList);

  const runtime = createRuntime({
    core: makeFakeCore({ effectCount: effectList.length }),
    adapters: recordingAdapters,
    effectFactory: ({ index }) => effectList[index],
  });
  await runtime.init({ seed: 0 });

  // NOTE: these ids are deliberately already in sorted order — this test pins the
  // four DISPOSITIONS coexisting, not the sort. The sort has its own test above.
  const log = runtime.getEffectLog();
  assert.deepEqual(
    log.map((entry) => [entry.effectId, entry.status, entry.reason ?? null]),
    [
      ["eff-1-fact-ok", "fulfilled", null],
      ["eff-2-fact-no", "deferred", "missing_source_ref"],
      ["eff-3-deferred", "deferred", "deferred_effect"],
      ["eff-4-dispatch", "fulfilled", null],
    ],
    "one flush, four dispositions, logged in sorted-id order",
  );
  assert.deepEqual(dispatched.map((d) => d.via), ["logger.warn"], "only the dispatchable one reached an adapter");
});

/**
 * ## TODO: Test Permutations
 *
 * - ordering with every proper subset of the canonical seven
 * - ordering when a persona name collides with an Object.prototype key
 * - fulfilment when effectFactory returns null (falls back to buildEffectFromCore)
 * - fulfilment when an adapter throws rather than returning a status
 * - sort stability across >2 effects sharing one id
 * - effect ids that differ only by case / numeric suffix ordering
 */

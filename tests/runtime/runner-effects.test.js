const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixturePath = resolve(__dirname, "../fixtures/adapters/effects-routing.json");

test("runtime routes rich effect records and preserves ids/requestIds from fixtures", async () => {
  const { createRuntime } = await import(
    "../../packages/runtime/src/runner/runtime.js"
  );

  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  let index = 0;
  const effectCount = fixture.effects.length;

  const core = {
    init() {},
    step() {},
    applyAction() {},
    getCounter() { return 0; },
    getEffectCount() { return effectCount; },
    getEffectKind() { return index; },
    getEffectValue() { return index; },
    clearEffects() { index = 0; },
  };

  const adapters = {
    logger: { log: () => "logged", warn: () => "warned", error: () => "errored" },
    telemetry: { emit: (record) => record },
    solver: { solve: (request) => ({ status: "fulfilled", request }) },
  };

  const runtime = createRuntime({
    core,
    adapters,
    effectFactory: ({ index: effectIndex }) => fixture.effects[effectIndex],
  });
  await runtime.init({ seed: 0 });
  const frames = runtime.getTickFrames();
  assert.equal(frames.length, 1);
  const frame = frames[0];
  assert.equal(frame.emittedEffects.length, effectCount);
  assert.ok(frame.emittedEffects.every((eff) => eff.id));

  const needFacts = frame.fulfilledEffects.filter((f) => f.effect.kind === "need_external_fact");
  assert.equal(needFacts.length, 2);
  const fulfilledFact = needFacts.find((f) => f.status === "fulfilled");
  assert.ok(fulfilledFact?.result?.sourceRef);
  assert.equal(fulfilledFact.result.requestId, fulfilledFact.effect.requestId);
  const deferredFact = needFacts.find((f) => f.status === "deferred");
  assert.equal(deferredFact.reason, "missing_source_ref");

  const solver = frame.fulfilledEffects.find((f) => f.effect.kind === "solver_request");
  assert.ok(solver);
  assert.equal(solver.status, "fulfilled");
  assert.equal(solver.effect.requestId, solver.result.request.requestId);

  const logEffect = frame.fulfilledEffects.find((f) => f.effect.kind === "log");
  assert.ok(logEffect);
  const telemetryRecords = frame.fulfilledEffects.filter((f) => f.effect.kind === "telemetry");
  assert.ok(telemetryRecords.length >= 1);

  const logEntries = runtime.getEffectLog();
  assert.ok(logEntries.every((entry) => entry.effectId));
  assert.ok(logEntries.some((entry) => entry.requestId && entry.status === "deferred"));
});

test("runtime threads structured core effect payloads into telemetry", async () => {
  const [{ createRuntime }, { EffectKind }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/ports/effects.ts"),
  ]);

  let effectCount = 3;
  const kinds = [EffectKind.ActorMoved, EffectKind.DurabilityChanged, EffectKind.ActorBlocked];
  const core = {
    init() {},
    step() {},
    applyAction() {},
    getCounter() { return 0; },
    getEffectCount() { return effectCount; },
    getEffectKind(index) { return kinds[index]; },
    getEffectValue() { return 0; },
    getEffectActorId(index) { return [101, 102, 103][index]; },
    getEffectX(index) { return [4, 0, 8][index]; },
    getEffectY(index) { return [7, 0, 9][index]; },
    getEffectReason(index) { return [0, 0, 5][index]; },
    getEffectDelta(index) { return [0, -2, 0][index]; },
    clearEffects() { effectCount = 0; },
  };
  const emitted = [];
  const runtime = createRuntime({
    core,
    adapters: { telemetry: { emit(effect) { emitted.push(effect); return effect.data; } } },
  });

  await runtime.init({ seed: 0 });

  const effects = runtime.getTickFrames()[0].emittedEffects;
  assert.deepEqual(effects.map((effect) => effect.data), [
    { event: "actor_moved", actorId: 101, x: 4, y: 7 },
    { event: "durability_changed", actorId: 102, delta: -2 },
    { event: "actor_blocked", actorId: 103, x: 8, y: 9, reason: 5 },
  ]);
  assert.equal(effects.some((effect) => effect.kind === "custom"), false);
  assert.equal(emitted.length, 3);
});

// ## TODO: Test Permutations
// - a mixed generic/structured core effect flush preserves Moderator ordering
// - an injected effectFactory receives the optional structured payload fields

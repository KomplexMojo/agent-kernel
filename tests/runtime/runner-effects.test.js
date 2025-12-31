const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const runtimeModule = moduleUrl("packages/runtime/src/runner/runtime.js");

test("runtime routes rich effect records and preserves ids/requestIds from fixtures", () => {
  const script = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRuntime } from ${JSON.stringify(runtimeModule)};

const fixture = JSON.parse(readFileSync(resolve(${JSON.stringify(resolve(__dirname, "../fixtures/adapters/effects-routing.json"))}), "utf8"));
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
runtime.init({ seed: 0 });
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
`;
  runEsm(script);
});

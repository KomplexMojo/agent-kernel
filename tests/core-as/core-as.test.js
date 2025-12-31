const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const EFFECT_KIND = Object.freeze({
  Log: 1,
  InitInvalid: 2,
  ActionRejected: 3,
  LimitReached: 4,
  LimitViolated: 5,
  NeedExternalFact: 6,
  Telemetry: 7,
  SolverRequest: 8,
  EffectFulfilled: 9,
  EffectDeferred: 10,
});

const ACTION_KIND = Object.freeze({
  IncrementCounter: 1,
  EmitLog: 2,
  EmitTelemetry: 3,
  RequestExternalFact: 4,
  RequestSolver: 5,
  FulfillRequest: 6,
  DeferRequest: 7,
});

const VALIDATION_ERROR = Object.freeze({
  InvalidSeed: 1,
  InvalidActionKind: 2,
  InvalidActionValue: 3,
  MissingPendingRequest: 4,
});

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

test("core init rejects invalid seed", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  core.init(-1);
  assert.equal(core.getEffectCount(), 1);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.InitInvalid);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.InvalidSeed);
});

test("core applyAction rejects invalid kind/value", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  core.init(0);
  core.clearEffects();
  core.applyAction(99, 1);
  assert.equal(core.getEffectCount(), 1);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActionRejected);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.InvalidActionKind);

  core.clearEffects();
  core.applyAction(ACTION_KIND.IncrementCounter, 2);
  assert.equal(core.getEffectCount(), 1);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActionRejected);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.InvalidActionValue);

  core.clearEffects();
  core.applyAction(ACTION_KIND.EmitLog, 9);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActionRejected);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.InvalidActionValue);
});

test("core budget caps emit limit reached/violated", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  core.init(0);
  core.clearEffects();
  core.setBudget(0, 2);

  core.applyAction(ACTION_KIND.IncrementCounter, 1);
  core.applyAction(ACTION_KIND.IncrementCounter, 1);
  core.applyAction(ACTION_KIND.IncrementCounter, 1);

  const effects = [];
  for (let i = 0; i < core.getEffectCount(); i += 1) {
    effects.push(core.getEffectKind(i));
  }

  assert.ok(effects.includes(EFFECT_KIND.LimitReached));
  assert.ok(effects.includes(EFFECT_KIND.LimitViolated));
  assert.equal(core.getBudgetUsage(0), 3);
  assert.equal(core.getBudget(0), 2);
});

test("core emits external fact requests and fulfillment/defer effects deterministically", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  core.init(0);
  core.clearEffects();

  core.applyAction(ACTION_KIND.RequestExternalFact, 2);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.NeedExternalFact);
  const requestValue = core.getEffectValue(0);
  const requestSeq = requestValue >> 8;
  const requestDetail = requestValue & 0xff;
  assert.ok(requestSeq > 0);
  assert.equal(requestDetail, 2);

  core.clearEffects();
  core.applyAction(ACTION_KIND.FulfillRequest, requestSeq);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.EffectFulfilled);
  assert.equal(core.getEffectValue(0), requestSeq);

  core.clearEffects();
  core.applyAction(ACTION_KIND.RequestExternalFact, 3);
  const pendingValue = core.getEffectValue(0);
  const pendingSeq = pendingValue >> 8;
  assert.ok(pendingSeq > requestSeq);
  core.clearEffects();
  core.applyAction(ACTION_KIND.DeferRequest, pendingSeq);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.EffectDeferred);
});

test("core guards missing pending requests and emits telemetry/solver requests", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  core.init(0);
  core.clearEffects();
  core.applyAction(ACTION_KIND.FulfillRequest, 1);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActionRejected);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.MissingPendingRequest);

  core.clearEffects();
  core.applyAction(ACTION_KIND.EmitTelemetry, 2);
  core.applyAction(ACTION_KIND.RequestSolver, 7);
  const kinds = [];
  const values = [];
  for (let i = 0; i < core.getEffectCount(); i += 1) {
    kinds.push(core.getEffectKind(i));
    values.push(core.getEffectValue(i));
  }
  assert.ok(kinds.includes(EFFECT_KIND.Telemetry));
  const solverIndex = kinds.indexOf(EFFECT_KIND.SolverRequest);
  assert.ok(solverIndex >= 0);
  const solverValue = values[solverIndex];
  const solverSeq = solverValue >> 8;
  const solverDetail = solverValue & 0xff;
  assert.ok(solverSeq > 0);
  assert.equal(solverDetail, 7);
});

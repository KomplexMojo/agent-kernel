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
});

const VALIDATION_ERROR = Object.freeze({
  InvalidSeed: 1,
  InvalidActionKind: 2,
  InvalidActionValue: 3,
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
  core.applyAction(2, 1);
  assert.equal(core.getEffectCount(), 1);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActionRejected);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.InvalidActionKind);

  core.clearEffects();
  core.applyAction(1, 2);
  assert.equal(core.getEffectCount(), 1);
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

  core.applyAction(1, 1);
  core.applyAction(1, 1);
  core.applyAction(1, 1);

  const effects = [];
  for (let i = 0; i < core.getEffectCount(); i += 1) {
    effects.push(core.getEffectKind(i));
  }

  assert.ok(effects.includes(EFFECT_KIND.LimitReached));
  assert.ok(effects.includes(EFFECT_KIND.LimitViolated));
  assert.equal(core.getBudgetUsage(0), 3);
  assert.equal(core.getBudget(0), 2);
});

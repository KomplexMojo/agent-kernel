const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const EFFECT_KIND = Object.freeze({
  ConfigInvalid: 12,
});

const VALIDATION_ERROR = Object.freeze({
  None: 0,
  OutOfBounds: 9,
});

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

test("core-as configures tiered grid sizes", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const cases = [
    { width: 1, height: 1 },
    { width: 5, height: 5 },
    { width: 10, height: 10 },
    { width: 100, height: 100 },
  ];

  core.init(0);
  for (const { width, height } of cases) {
    core.clearEffects();
    const error = core.configureGrid(width, height);
    assert.equal(error, VALIDATION_ERROR.None);
    assert.equal(core.getMapWidth(), width);
    assert.equal(core.getMapHeight(), height);
    assert.equal(core.getTileActorCount(), width * height);
  }
});

test("core-as rejects grids over the max cell limit", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  core.init(0);
  core.configureGrid(5, 5);

  core.clearEffects();
  const error = core.configureGrid(1001, 1000);
  assert.equal(error, VALIDATION_ERROR.OutOfBounds);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ConfigInvalid);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.OutOfBounds);
  assert.equal(core.getMapWidth(), 5);
  assert.equal(core.getMapHeight(), 5);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

function setAllFloors(core, width, height) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      core.setTileAt(x, y, 1);
    }
  }
}

test("core-as raises/destroys barriers and arms/disarms static traps", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  if (
    typeof core.raiseBarrierAt !== "function"
    || typeof core.destroyBarrierAt !== "function"
    || typeof core.armStaticTrapAt !== "function"
  ) {
    t.skip("WASM binary does not expose affinity environment helpers yet.");
    return;
  }

  core.init(0);
  core.configureGrid(4, 4);
  setAllFloors(core, 4, 4);

  core.setTileAt(1, 1, 4);
  assert.equal(core.getTileActorKind(1, 1), 1);
  assert.equal(core.destroyBarrierAt(1, 1), 1);
  assert.equal(core.getTileActorKind(1, 1), 0);
  assert.equal(core.raiseBarrierAt(1, 1), 1);
  assert.equal(core.getTileActorKind(1, 1), 1);

  assert.equal(core.armStaticTrapAt(2, 2, 1, 1, 2, 5), 1);
  assert.equal(core.getStaticTrapCount(), 1);
  assert.equal(core.getStaticTrapAffinityAt(2, 2), 1);
  assert.equal(core.getStaticTrapExpressionAt(2, 2), 1);
  assert.equal(core.getStaticTrapStacksAt(2, 2), 2);
  assert.equal(core.getStaticTrapManaReserveAt(2, 2), 5);

  // Traps only arm on floor tiles.
  assert.equal(core.armStaticTrapAt(1, 1, 2, 3, 3, 4), 0);
  assert.equal(core.getStaticTrapCount(), 1);

  assert.equal(core.disarmStaticTrapAt(2, 2), 1);
  assert.equal(core.getStaticTrapCount(), 0);
});

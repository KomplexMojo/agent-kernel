const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const SNAPSHOT_FIXTURE_PATH = resolve(ROOT, "tests/fixtures/snapshot-v1-mvp-barrier.json");

const ACTOR_KIND_LABEL = Object.freeze({
  0: "stationary",
  1: "barrier",
  2: "motivated",
});

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

function readSnapshotFixture() {
  return JSON.parse(readFileSync(SNAPSHOT_FIXTURE_PATH, "utf8"));
}

function readTileActorKinds(core, { width, height }) {
  const kinds = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      row.push(ACTOR_KIND_LABEL[core.getTileActorKind(x, y)]);
    }
    kinds.push(row);
  }
  return kinds;
}

test("core-as snapshot data is deterministic for barrier scenario", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const fixture = readSnapshotFixture();
  core.init(0);
  core.loadMvpBarrierScenario();

  const snapshot = {
    width: core.getMapWidth(),
    height: core.getMapHeight(),
    tick: core.getCurrentTick(),
    actor: {
      id: core.getActorId(),
      kind: ACTOR_KIND_LABEL[core.getActorKind()],
      position: { x: core.getActorX(), y: core.getActorY() },
    },
    tileActorKinds: readTileActorKinds(core, fixture),
    barrier: {
      x: fixture.barrier.x,
      y: fixture.barrier.y,
      durability: core.getTileActorDurability(fixture.barrier.x, fixture.barrier.y),
    },
  };

  assert.deepEqual(snapshot, fixture);
});

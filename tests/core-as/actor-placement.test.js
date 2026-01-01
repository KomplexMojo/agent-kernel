const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const FIXTURE_ROOT = resolve(ROOT, "tests/fixtures");

const EFFECT_KIND = Object.freeze({
  ConfigInvalid: 12,
});

const VALIDATION_ERROR = Object.freeze({
  ActorOutOfBounds: 14,
  ActorSpawnMismatch: 15,
  ActorBlocked: 16,
  ActorCollision: 17,
});

const ERROR_KIND = Object.freeze({
  actor_out_of_bounds: VALIDATION_ERROR.ActorOutOfBounds,
  actor_spawn_mismatch: VALIDATION_ERROR.ActorSpawnMismatch,
  actor_blocked: VALIDATION_ERROR.ActorBlocked,
  actor_collision: VALIDATION_ERROR.ActorCollision,
});

const FIXTURE_CASES = [
  { name: "actor-placement-v1-out-of-bounds.json", scenario: "mvp" },
  { name: "actor-placement-v1-spawn-mismatch.json", scenario: "mvp" },
  { name: "actor-placement-v1-spawn-barrier.json", scenario: "barrier" },
  { name: "actor-placement-v1-overlap.json", scenario: "mvp" },
];

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

function readFixture(name) {
  return JSON.parse(readFileSync(resolve(FIXTURE_ROOT, name), "utf8"));
}

function applyPlacements(core, fixture) {
  core.clearActorPlacements();
  if (fixture.spawn) {
    core.setSpawnPosition(fixture.spawn.x, fixture.spawn.y);
  }
  for (const placement of fixture.placements || []) {
    core.addActorPlacement(placement.id, placement.x, placement.y);
  }
}

for (const fixtureCase of FIXTURE_CASES) {
  test(`core-as rejects invalid actor placement: ${fixtureCase.name}`, async (t) => {
    const core = await loadCoreOrSkip(t);
    if (!core) {
      return;
    }
    const fixture = readFixture(fixtureCase.name);
    core.init(0);
    if (fixtureCase.scenario === "barrier") {
      core.loadMvpBarrierScenario();
    } else {
      core.loadMvpScenario();
    }
    applyPlacements(core, fixture);
    core.clearEffects();
    const error = core.validateActorPlacement();
    assert.equal(error, ERROR_KIND[fixture.expectedError]);
    assert.equal(core.getEffectKind(0), EFFECT_KIND.ConfigInvalid);
    assert.equal(core.getEffectValue(0), ERROR_KIND[fixture.expectedError]);
  });
}

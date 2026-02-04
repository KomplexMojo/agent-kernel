const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");
const { readFixture } = require("../helpers/fixtures");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const VALIDATION_ERROR = Object.freeze({
  None: 0,
  InvalidCapability: 20,
});

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

function setCapabilitiesFromFixture(core, fixture) {
  const caps = fixture.actor?.capabilities ?? {};
  if (typeof caps.movementCost === "number") {
    core.setActorMovementCost(caps.movementCost);
  }
  if (typeof caps.actionCostMana === "number") {
    core.setActorActionCostMana(caps.actionCostMana);
  }
  if (typeof caps.actionCostStamina === "number") {
    core.setActorActionCostStamina(caps.actionCostStamina);
  }
}

test("core-as defaults capability costs to deterministic values", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  core.init(0);
  core.loadMvpScenario();
  assert.equal(core.getActorMovementCost(), 1);
  assert.equal(core.getActorActionCostMana(), 0);
  assert.equal(core.getActorActionCostStamina(), 0);
  assert.equal(core.validateActorCapabilities(), VALIDATION_ERROR.None);
});

test("core-as accepts capability fixtures with non-negative values", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const fixture = readFixture("actor-state-v1-mvp.json");
  core.init(0);
  core.loadMvpScenario();
  setCapabilitiesFromFixture(core, fixture);
  assert.equal(core.getActorMovementCost(), fixture.actor.capabilities.movementCost);
  assert.equal(core.validateActorCapabilities(), VALIDATION_ERROR.None);
});

test("core-as rejects negative capability costs", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const invalid = readFixture("invalid/actor-state-v1-negative-movement-cost.json");
  core.init(0);
  core.loadMvpScenario();
  setCapabilitiesFromFixture(core, invalid);
  assert.equal(core.validateActorCapabilities(), VALIDATION_ERROR.InvalidCapability);
});

test("core-as applies tick regen and clamps vitals", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  core.init(0);
  core.loadMvpScenario();
  core.setActorVital(0, 5, 10, 3); // health
  core.setActorVital(1, 1, 4, 2); // mana
  core.setActorVital(2, 4, 6, 5); // stamina
  core.setActorVital(3, 1, 5, 2); // durability (regen ignored)
  core.advanceTick();
  assert.equal(core.getCurrentTick(), 1);
  assert.equal(core.getActorVitalCurrent(0), 8);
  assert.equal(core.getActorVitalCurrent(1), 3);
  assert.equal(core.getActorVitalCurrent(2), 6);
  assert.equal(core.getActorVitalCurrent(3), 1);
});

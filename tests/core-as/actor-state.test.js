const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");
const { readFixture } = require("../helpers/fixtures");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const ACTOR_KIND_LABEL = Object.freeze({
  0: "stationary",
  1: "barrier",
  2: "motivated",
});

const VITAL_KIND = Object.freeze({
  health: 0,
  mana: 1,
  stamina: 2,
  durability: 3,
});

const VALIDATION_ERROR = Object.freeze({
  None: 0,
  MissingVital: 12,
  InvalidVital: 13,
});

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

function readVital(core, kind) {
  return {
    current: core.getActorVitalCurrent(kind),
    max: core.getActorVitalMax(kind),
    regen: core.getActorVitalRegen(kind),
  };
}

function buildActorState(core, { schema, schemaVersion }) {
  return {
    schema,
    schemaVersion,
    actor: {
      id: String(core.getActorId()),
      kind: ACTOR_KIND_LABEL[core.getActorKind()],
      position: { x: core.getActorX(), y: core.getActorY() },
      vitals: {
        health: readVital(core, VITAL_KIND.health),
        mana: readVital(core, VITAL_KIND.mana),
        stamina: readVital(core, VITAL_KIND.stamina),
        durability: readVital(core, VITAL_KIND.durability),
      },
      capabilities: {
        movementCost: core.getActorMovementCost(),
        actionCostMana: core.getActorActionCostMana(),
        actionCostStamina: core.getActorActionCostStamina(),
      },
    },
  };
}

function setVitalsFromFixture(core, fixture) {
  const vitals = fixture.actor?.vitals ?? {};
  const entries = [
    ["health", VITAL_KIND.health],
    ["mana", VITAL_KIND.mana],
    ["stamina", VITAL_KIND.stamina],
    ["durability", VITAL_KIND.durability],
  ];

  for (const [name, kind] of entries) {
    const vital = vitals[name];
    if (!vital) {
      continue;
    }
    const current = typeof vital.current === "number" ? vital.current : -1;
    const max = typeof vital.max === "number" ? vital.max : -1;
    const regen = typeof vital.regen === "number" ? vital.regen : -1;
    core.setActorVital(kind, current, max, regen);
  }
}

test("core-as exposes canonical actor state with vitals", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const expected = readFixture("actor-state-v1-mvp.json");
  core.init(0);
  core.loadMvpScenario();
  assert.equal(core.validateActorVitals(), VALIDATION_ERROR.None);
  const actual = buildActorState(core, expected);
  assert.deepEqual(actual, expected);
});

test("core-as rejects actor states missing a vital", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const invalid = readFixture("invalid/actor-state-v1-missing-vital.json");
  core.init(0);
  setVitalsFromFixture(core, invalid);
  assert.equal(core.validateActorVitals(), VALIDATION_ERROR.MissingVital);
});

test("core-as rejects actor states missing stamina", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const invalid = readFixture("invalid/actor-state-v1-missing-stamina.json");
  core.init(0);
  setVitalsFromFixture(core, invalid);
  assert.equal(core.validateActorVitals(), VALIDATION_ERROR.MissingVital);
});

test("core-as rejects actor states missing vital regen values", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const invalid = readFixture("invalid/actor-state-v1-missing-regen.json");
  core.init(0);
  setVitalsFromFixture(core, invalid);
  assert.equal(core.validateActorVitals(), VALIDATION_ERROR.InvalidVital);
});

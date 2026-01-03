const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/state-machine.mts");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-transitions-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createConfiguratorStateMachine, ConfiguratorStates } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(happyFixture)};
const machine = createConfiguratorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  const before = machine.view();
  const result = machine.advance(entry.event, entry.payload);
  assert.equal(result.state, ConfiguratorStates[entry.expectState.toUpperCase()]);
  assert.equal(result.context.lastEvent, entry.event);
  assert.equal(result.context.updatedAt, "fixed");
  if (entry.expectConfigRef) {
    assert.equal(result.context.lastConfigRef, entry.expectConfigRef);
  } else {
    assert.equal(result.context.lastConfigRef, before.context.lastConfigRef);
  }
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createConfiguratorStateMachine } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(guardFixture)};
const machine = createConfiguratorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  let threw = false;
  try {
    machine.advance(entry.event, entry.payload);
  } catch (err) {
    threw = true;
    assert.match(err.message, new RegExp(entry.expectError));
  }
  assert.equal(threw, true);
});
`;

test("configurator state machine follows happy path transitions", () => {
  runEsm(happyScript);
});

test("configurator state machine enforces guard and invalid transitions", () => {
  runEsm(guardScript);
});

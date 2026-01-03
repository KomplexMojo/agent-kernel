const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.mts");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-fsm-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-fsm-guards.json"), "utf8"));
const debugLogs = [];

const happyScript = `
import assert from "node:assert/strict";
import { createTickStateMachine, TickPhases } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(happyFixture)};
const machine = createTickStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  const result = machine.advance(entry.event, entry.payload);
  const expectedState = TickPhases[entry.expect.state.toUpperCase()];
  assert.equal(result.state, expectedState);
  assert.equal(result.phase, expectedState);
  assert.equal(result.tick, entry.expect.tick);
  assert.equal(result.context.tick, entry.expect.tick);
  assert.equal(result.context.phase, expectedState);
  assert.equal(result.context.lastEvent, entry.event);
  assert.equal(result.context.updatedAt, "fixed");
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createTickStateMachine } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(guardFixture)};
const machine = createTickStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  if (entry.expectError) {
    let threw = false;
    try {
      machine.advance(entry.event, entry.payload);
    } catch (err) {
      threw = true;
      assert.match(err.message, new RegExp(entry.expectError));
    }
    assert.equal(threw, true);
    return;
  }
  const result = machine.advance(entry.event, entry.payload);
  assert.equal(result.state, entry.expect.state);
  assert.equal(result.tick, entry.expect.tick);
});
`;

const debugScript = `
import assert from "node:assert/strict";
import { createTickStateMachine } from ${JSON.stringify(modulePath)};

const logs = [];
const machine = createTickStateMachine({ clock: () => "fixed", debug: true, logger: (entry) => logs.push(entry) });
machine.advance("observe", {});
machine.advance("decide", {});
assert.equal(logs.length, 2);
assert.equal(logs[0].kind, "tick_transition");
assert.equal(logs[0].to, "observe");
`;

test("tick state machine follows happy path transitions", () => {
  runEsm(happyScript);
});

test("tick state machine enforces guard cases", () => {
  runEsm(guardScript);
});

test("tick state machine emits debug logs when enabled", () => {
  runEsm(debugScript);
});

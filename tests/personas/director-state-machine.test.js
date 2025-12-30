const test = require("node:test");
const assert = require("node:assert/strict");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const modulePath = moduleUrl("packages/runtime/src/personas/director/state-machine.js");
const happyCases = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/director-transitions-happy.json"), "utf8"));
const guardCases = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/director-transitions-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createDirectorStateMachine, DirectorStates } from ${JSON.stringify(modulePath)};

const cases = ${JSON.stringify(happyCases.cases)};
const machine = createDirectorStateMachine({ initialState: ${JSON.stringify(happyCases.initialState)}, clock: () => "fixed-time" });

cases.forEach((entry) => {
  const result = machine.advance(entry.event, entry.payload);
  assert.equal(result.state, DirectorStates[entry.expectState.toUpperCase()]);
  if (entry.payload.intentRef) {
    assert.equal(result.context.intentRef, entry.payload.intentRef);
  }
  if (entry.payload.planRef) {
    assert.equal(result.context.planRef, entry.payload.planRef);
  }
  assert.equal(result.context.lastEvent, entry.event);
  assert.equal(result.context.updatedAt, "fixed-time");
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createDirectorStateMachine } from ${JSON.stringify(modulePath)};

const machine = createDirectorStateMachine({ initialState: ${JSON.stringify(guardCases.initialState)}, clock: () => "fixed" });
const cases = ${JSON.stringify(guardCases.cases)};

cases.forEach((entry) => {
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

test("director state machine advances through table-driven happy path", () => {
  runEsm(happyScript);
});

test("director state machine enforces table-driven guard and missing transition errors", () => {
  runEsm(guardScript);
});

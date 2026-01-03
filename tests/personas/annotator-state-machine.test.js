const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/annotator/state-machine.mts");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/annotator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/annotator-transitions-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createAnnotatorStateMachine, AnnotatorStates } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(happyFixture)};
const machine = createAnnotatorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  const before = machine.view();
  const result = machine.advance(entry.event, entry.payload);
  assert.equal(result.state, AnnotatorStates[entry.expectState.toUpperCase()]);
  assert.equal(result.context.lastEvent, entry.event);
  assert.equal(result.context.updatedAt, "fixed");
  if (entry.expectObservationCount !== undefined) {
    assert.equal(result.context.lastObservationCount, entry.expectObservationCount);
  }
  if (entry.event === "reset") {
    assert.equal(result.context.lastObservationCount, before.context.lastObservationCount);
  }
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createAnnotatorStateMachine } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(guardFixture)};
const machine = createAnnotatorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

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

test("annotator state machine follows happy path transitions", () => {
  runEsm(happyScript);
});

test("annotator state machine enforces guard and invalid transitions", () => {
  runEsm(guardScript);
});

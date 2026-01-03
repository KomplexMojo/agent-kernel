const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/actor/state-machine.mts");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/actor-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/actor-transitions-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createActorStateMachine, ActorStates } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(happyFixture)};
const machine = createActorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  const before = machine.view();
  const result = machine.advance(entry.event, entry.payload);
  assert.equal(result.state, ActorStates[entry.expectState.toUpperCase()]);
  assert.equal(result.context.lastEvent, entry.event);
  assert.equal(result.context.updatedAt, "fixed");
  if (entry.expectProposalCount !== undefined) {
    assert.equal(result.context.lastProposalCount, entry.expectProposalCount);
  }
  if (entry.event === "observe" && before.state !== "idle") {
    assert.equal(result.context.lastProposalCount, before.context.lastProposalCount);
  }
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createActorStateMachine } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(guardFixture)};
const machine = createActorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

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

test("actor state machine follows happy path transitions", () => {
  runEsm(happyScript);
});

test("actor state machine enforces guard and invalid transitions", () => {
  runEsm(guardScript);
});

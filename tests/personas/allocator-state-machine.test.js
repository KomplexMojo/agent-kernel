const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/allocator/state-machine.mts");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/allocator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/allocator-transitions-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createAllocatorStateMachine, AllocatorStates } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(happyFixture)};
const machine = createAllocatorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  const before = machine.view();
  const result = machine.advance(entry.event, entry.payload);
  assert.equal(result.state, AllocatorStates[entry.expectState.toUpperCase()]);
  assert.equal(result.context.lastEvent, entry.event);
  assert.equal(result.context.updatedAt, "fixed");
  if (entry.expectBudgetCount !== undefined) {
    assert.equal(result.context.lastBudgetCount, entry.expectBudgetCount);
  }
  if (entry.expectSignalCount !== undefined) {
    assert.equal(result.context.lastSignalCount, entry.expectSignalCount);
  }
  if (entry.event === "monitor") {
    assert.equal(result.context.lastBudgetCount, before.context.lastBudgetCount);
    assert.equal(result.context.lastSignalCount, before.context.lastSignalCount);
  }
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createAllocatorStateMachine } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(guardFixture)};
const machine = createAllocatorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

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

test("allocator state machine follows happy path transitions", () => {
  runEsm(happyScript);
});

test("allocator state machine enforces guard and invalid transitions", () => {
  runEsm(guardScript);
});

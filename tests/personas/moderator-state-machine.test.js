const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/moderator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/moderator-transitions-guards.json"), "utf8"));



test("moderator state machine follows happy path transitions", async () => {
const { createModeratorStateMachine, ModeratorStates } = await import("../../packages/runtime/src/personas/moderator/state-machine.mts");

const fixture = happyFixture;
const machine = createModeratorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  const result = machine.advance(entry.event, entry.payload);
  assert.equal(result.state, ModeratorStates[entry.expectState.toUpperCase()]);
  assert.equal(result.context.lastEvent, entry.event);
  assert.equal(result.context.updatedAt, "fixed");
});
});

test("moderator state machine enforces guard and invalid transitions", async () => {
const { createModeratorStateMachine } = await import("../../packages/runtime/src/personas/moderator/state-machine.mts");

const fixture = guardFixture;
const machine = createModeratorStateMachine({ initialState: fixture.initialState, clock: () => "fixed" });

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
});

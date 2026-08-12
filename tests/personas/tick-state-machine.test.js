const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-fsm-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-fsm-guards.json"), "utf8"));
const debugLogs = [];




test("tick state machine follows happy path transitions", async () => {
const { createTickStateMachine, TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const fixture = happyFixture;
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
});

test("tick state machine enforces guard cases", async () => {
const { createTickStateMachine } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const fixture = guardFixture;
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
});

test("tick state machine emits debug logs when enabled", async () => {
const { createTickStateMachine } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const logs = [];
const machine = createTickStateMachine({ clock: () => "fixed", debug: true, logger: (entry) => logs.push(entry) });
machine.advance("observe", {});
machine.advance("decide", {});
assert.equal(logs.length, 2);
assert.equal(logs[0].kind, "tick_transition");
assert.equal(logs[0].to, "observe");
});

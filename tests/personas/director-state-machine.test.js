const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyCases = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/director-transitions-happy.json"), "utf8"));
const guardCases = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/director-transitions-guards.json"), "utf8"));

test("director state machine advances through table-driven happy path", async () => {
  const { createDirectorStateMachine, DirectorStates } = await import(
    "../../packages/runtime/src/personas/director/state-machine.mts"
  );

  const machine = createDirectorStateMachine({ initialState: happyCases.initialState, clock: () => "fixed-time" });

  happyCases.cases.forEach((entry) => {
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
});

test("director state machine enforces table-driven guard and missing transition errors", async () => {
  const { createDirectorStateMachine } = await import(
    "../../packages/runtime/src/personas/director/state-machine.mts"
  );

  const machine = createDirectorStateMachine({ initialState: guardCases.initialState, clock: () => "fixed" });

  guardCases.cases.forEach((entry) => {
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

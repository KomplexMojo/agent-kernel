const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-transitions-guards.json"), "utf8"));

test("configurator state machine follows happy path transitions", async () => {
  const { createConfiguratorStateMachine, ConfiguratorStates } = await import(
    "../../packages/runtime/src/personas/configurator/state-machine.mts"
  );

  const machine = createConfiguratorStateMachine({ initialState: happyFixture.initialState, clock: () => "fixed" });

  happyFixture.cases.forEach((entry) => {
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
});

test("configurator state machine enforces guard and invalid transitions", async () => {
  const { createConfiguratorStateMachine } = await import(
    "../../packages/runtime/src/personas/configurator/state-machine.mts"
  );

  const machine = createConfiguratorStateMachine({ initialState: guardFixture.initialState, clock: () => "fixed" });

  guardFixture.cases.forEach((entry) => {
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

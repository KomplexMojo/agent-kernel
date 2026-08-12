const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/orchestrator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/orchestrator-transitions-guards.json"), "utf8"));

test("orchestrator state machine follows happy path transitions", async () => {
  const { createOrchestratorStateMachine, OrchestratorStates } = await import(
    "../../packages/runtime/src/personas/orchestrator/state-machine.mts"
  );

  const machine = createOrchestratorStateMachine({ initialState: happyFixture.initialState, clock: () => "fixed" });

  happyFixture.cases.forEach((entry) => {
    const before = machine.view();
    const result = machine.advance(entry.event, entry.payload);
    assert.equal(result.state, OrchestratorStates[entry.expectState.toUpperCase()]);
    assert.equal(result.context.lastEvent, entry.event);
    assert.equal(result.context.updatedAt, "fixed");
    if (entry.expectPlanRef) {
      assert.equal(result.context.planRef, entry.expectPlanRef);
    } else {
      assert.equal(result.context.planRef, before.context.planRef);
    }
  });
});

test("orchestrator state machine enforces guard and invalid transitions", async () => {
  const { createOrchestratorStateMachine } = await import(
    "../../packages/runtime/src/personas/orchestrator/state-machine.mts"
  );

  const machine = createOrchestratorStateMachine({ initialState: guardFixture.initialState, clock: () => "fixed" });

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

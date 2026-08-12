const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/actor-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/actor-transitions-guards.json"), "utf8"));

test("actor state machine follows happy path transitions", async () => {
  const { createActorStateMachine, ActorStates } = await import(
    "../../packages/runtime/src/personas/actor/state-machine.mts"
  );

  const machine = createActorStateMachine({ initialState: happyFixture.initialState, clock: () => "fixed" });

  happyFixture.cases.forEach((entry) => {
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
});

test("actor state machine enforces guard and invalid transitions", async () => {
  const { createActorStateMachine } = await import(
    "../../packages/runtime/src/personas/actor/state-machine.mts"
  );

  const machine = createActorStateMachine({ initialState: guardFixture.initialState, clock: () => "fixed" });

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

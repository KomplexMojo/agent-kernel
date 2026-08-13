const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/orchestrator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/orchestrator-transitions-guards.json"), "utf8"));

/**
 * P2.6 — label assertions removed; see the header of
 * `tests/personas/actor/actor-state-machine.test.js` for the full rationale.
 * Short form: `result.state` and `context.lastEvent` asserted that a LABEL changed
 * (charter §6 calls that legacy; G1 answers ownership), and `context.updatedAt`
 * duplicated the repo-wide `new Date(` ban in `single-origin.test.js`.
 *
 * `planRef` survives, and as in the Configurator's file the else-branch carries the
 * weight: an event with no new plan must not drop the plan already in hand.
 */
test("orchestrator state machine walks the happy path and holds its plan ref", async () => {
  const { createOrchestratorStateMachine } = await import(
    "../../../packages/runtime/src/personas/orchestrator/state-machine.js"
  );

  const machine = createOrchestratorStateMachine({ initialState: happyFixture.initialState, clock: () => "fixed" });

  happyFixture.cases.forEach((entry) => {
    const before = machine.view();
    // advance() throws on an illegal transition — driving the sequence proves it walks.
    const result = machine.advance(entry.event, entry.payload);
    if (entry.expectPlanRef) {
      assert.equal(result.context.planRef, entry.expectPlanRef);
    } else {
      assert.equal(result.context.planRef, before.context.planRef);
    }
  });
});

test("orchestrator state machine enforces guard and invalid transitions", async () => {
  const { createOrchestratorStateMachine } = await import(
    "../../../packages/runtime/src/personas/orchestrator/state-machine.js"
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

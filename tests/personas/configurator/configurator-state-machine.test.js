const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/configurator-transitions-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/configurator-transitions-guards.json"), "utf8"));

/**
 * P2.6 — label assertions removed; see the header of
 * `tests/personas/actor/actor-state-machine.test.js` for the full rationale.
 * Short form: `result.state` and `context.lastEvent` asserted that a LABEL changed
 * (charter §6 calls that legacy; G1 answers ownership), and `context.updatedAt`
 * duplicated the repo-wide `new Date(` ban in `single-origin.test.js`.
 *
 * `lastConfigRef` survives, and its else-branch is the load-bearing half: a case that
 * carries no new ref must leave the previous one INTACT. A Configurator that dropped
 * the ref it was locked against would still walk every state in this table.
 */
test("configurator state machine walks the happy path and holds its config ref", async () => {
  const { createConfiguratorStateMachine } = await import(
    "../../../packages/runtime/src/personas/configurator/state-machine.js"
  );

  const machine = createConfiguratorStateMachine({ initialState: happyFixture.initialState, clock: () => "fixed" });

  happyFixture.cases.forEach((entry) => {
    const before = machine.view();
    // advance() throws on an illegal transition — driving the sequence proves it walks.
    const result = machine.advance(entry.event, entry.payload);
    if (entry.expectConfigRef) {
      assert.equal(result.context.lastConfigRef, entry.expectConfigRef);
    } else {
      assert.equal(result.context.lastConfigRef, before.context.lastConfigRef);
    }
  });
});

test("configurator state machine enforces guard and invalid transitions", async () => {
  const { createConfiguratorStateMachine } = await import(
    "../../../packages/runtime/src/personas/configurator/state-machine.js"
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

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyCases = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/director-transitions-happy.json"), "utf8"));
const guardCases = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/director-transitions-guards.json"), "utf8"));

/**
 * P2.6 — label assertions removed; see the header of
 * `tests/personas/actor/actor-state-machine.test.js` for the full rationale.
 * Short form: `result.state` and `context.lastEvent` asserted that a LABEL changed
 * (charter §6 calls that legacy; G1 answers ownership), and `context.updatedAt`
 * duplicated the repo-wide `new Date(` ban in `single-origin.test.js`.
 *
 * The ref propagation survives and is the substantive claim in this file: the
 * intentRef and planRef handed in by the payload reach context unchanged, which is
 * the Director's whole job — intent in, plan out, traceable between. `director/plan-artifact`
 * (G1, owned since CR.3) is where that becomes an ownership claim about production.
 */
test("director state machine walks the happy path and carries intent/plan refs into context", async () => {
  const { createDirectorStateMachine } = await import(
    "../../../packages/runtime/src/personas/director/state-machine.js"
  );

  const machine = createDirectorStateMachine({ initialState: happyCases.initialState, clock: () => "fixed-time" });

  happyCases.cases.forEach((entry) => {
    // advance() throws on an illegal transition — driving the sequence proves it walks.
    const result = machine.advance(entry.event, entry.payload);
    if (entry.payload.intentRef) {
      assert.equal(result.context.intentRef, entry.payload.intentRef);
    }
    if (entry.payload.planRef) {
      assert.equal(result.context.planRef, entry.payload.planRef);
    }
  });
});

test("director state machine enforces table-driven guard and missing transition errors", async () => {
  const { createDirectorStateMachine } = await import(
    "../../../packages/runtime/src/personas/director/state-machine.js"
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

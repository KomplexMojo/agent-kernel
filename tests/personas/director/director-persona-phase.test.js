const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/director-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/director-phases-guards.json"), "utf8"));



/**
 * P2.6 — label assertions removed (charter §6): `result.state === expectState` and
 * `context.lastEvent` watched a label change, and `context.updatedAt` duplicated the
 * repo-wide `new Date(` ban in `single-origin.test.js`. The Director's ownership lives
 * in G1 — `director/plan-artifact`, `director/pool-mapping`, `director/card-set-translation`,
 * `director/pricing-relay`.
 *
 * WHAT STAYS: the Director subscribes to DECIDE and to nothing else, and any other
 * phase leaves it where it was. That second clause was already here (`entry.phase !==
 * "decide"`) and is the only assertion in the file that was ever about behavior.
 */
test("director persona subscribes to decide alone and ignores every other phase", async () => {
const { createDirectorPersona, directorSubscribePhases } = await import("../../../packages/runtime/src/personas/director/persona.js");
const { TickPhases } = await import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const fixture = happyFixture;
const persona = createDirectorPersona({ initialState: fixture.initialState, clock: () => fixture.clock });

assert.deepEqual(directorSubscribePhases, [TickPhases.DECIDE]);

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  if (entry.phase !== "decide") {
    assert.equal(result.state, before.state, "a phase the Director does not subscribe to must not advance it");
  }
});
});

test("director persona ignores non-subscribed phases and surfaces guard errors", async () => {
const { createDirectorPersona } = await import("../../../packages/runtime/src/personas/director/persona.js");

const fixture = guardFixture;
const persona = createDirectorPersona({ initialState: fixture.initialState, clock: () => fixture.clock });

fixture.cases.forEach((entry) => {
  if (entry.expectError) {
    let threw = false;
    try {
      persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
    } catch (err) {
      threw = true;
      assert.match(err.message, new RegExp(entry.expectError));
    }
    assert.equal(threw, true);
    return;
  }
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  assert.equal(result.state, before.state);
});
});

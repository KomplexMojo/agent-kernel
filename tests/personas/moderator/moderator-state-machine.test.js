const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * P2.6 — this file is the ONE case where the happy-path test was deleted outright
 * rather than narrowed, and the reason is worth stating so nobody restores it.
 *
 * Its every assertion was a label — `result.state`, `context.lastEvent`,
 * `context.updatedAt` — with no context payload underneath, so stripping the labels
 * (charter §6: legacy, replace don't extend) left nothing to keep. The other six
 * `<persona>-state-machine` files kept a narrowed test because each carries real
 * residue: proposal counts, budget/signal counts, config and plan refs.
 *
 * ⚠️ REMOVED ONLY BECAUSE THE REPLACEMENT ALREADY EXISTS, and it is strictly better.
 * `moderator/moderator-pause-gates-tick.test.js` (G1 `moderator/pausing-gates-advancement`)
 * drives pause → resume → stop through a REAL runtime and asserts that a paused
 * moderator refuses to advance the tick — the behavior the label is supposed to gate.
 * The four transitions this file walked are covered there, against production rather
 * than against a bare FSM. Its header records that it was written to replace exactly
 * this kind of test; the checklist's "never remove first" is satisfied because the
 * replacement predates the removal by two milestones.
 *
 * `moderator-transitions-happy.json` was deleted with it — this file was its only
 * reader, and a fixture nothing loads is the orphan rot this branch keeps finding.
 * The GUARD half below stays: invalid-transition rejection has no other home.
 */
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/moderator-transitions-guards.json"), "utf8"));

test("moderator state machine enforces guard and invalid transitions", async () => {
const { createModeratorStateMachine } = await import("../../../packages/runtime/src/personas/moderator/state-machine.js");

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

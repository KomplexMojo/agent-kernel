const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * P2.6 — the label loop is gone; the SUBSCRIPTION CONTRACT is what this file is for.
 *
 * The loop walked start → pause → resume → stop asserting only the resulting state
 * name (charter §6: legacy). Those four transitions are covered behaviorally, against
 * a REAL runtime, by `moderator-pause-gates-tick.test.js` — the G1 entry
 * `moderator/pausing-gates-advancement`, which asserts a paused moderator actually
 * refuses to advance the tick rather than merely being labelled `pausing`. Driving the
 * same sequence against a bare FSM added nothing that test does not already prove.
 * `moderator-phases-happy.json` was deleted with the loop; this was its only reader.
 *
 * ⚠️ THE ASSERTION THAT REMAINS IS NOT A LABEL AND HAS NO OTHER HOME. The charter's
 * persona table gives the Moderator "all" tick phases, and `moderatorSubscribePhases`
 * is what makes that true: `controller.js:44` returns early for any phase not in the
 * list, so the list GATES whether the Moderator is consulted at all. This file is the
 * only place it is pinned — checked, not assumed — so a Moderator that quietly stopped
 * subscribing to a phase would go silent there with every state name still correct.
 */
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/moderator-phases-guards.json"), "utf8"));

test("moderator subscribes to every tick phase — the charter's 'all' is real, not declared", async () => {
const { moderatorSubscribePhases } = await import("../../../packages/runtime/src/personas/moderator/persona.js");
const { TickPhases } = await import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

assert.deepEqual(moderatorSubscribePhases, Object.values(TickPhases));
});

test("moderator persona ignores non-advancing cases", async () => {
const { createModeratorPersona } = await import("../../../packages/runtime/src/personas/moderator/persona.js");

const fixture = guardFixture;
const persona = createModeratorPersona({ clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  assert.equal(result.state, before.state);
});
});

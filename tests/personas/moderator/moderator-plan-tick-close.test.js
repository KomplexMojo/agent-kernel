// #158 — split out of tests/runtime/affinity-field-per-tick.test.js: these two tests call
// createModeratorPersona().advance() directly and assert on the Moderator's own plan_tick_close
// decision, with no runtime or core-ts involved — pure Moderator persona behavior (AM.3b). The
// third test from that file (the field actually following its source actor across real runtime
// ticks) stays in tests/runtime/ as the integration counterpart; it shares no helper with these.

const assert = require("node:assert/strict");

test("the Moderator decides to close the tick, and says so as data", async () => {
  const { createModeratorPersona } = await import(
    "../../../packages/runtime/src/personas/moderator/persona.js"
  );
  const { TickPhases } = await import(
    "../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );
  const moderator = createModeratorPersona({ clock: () => "fixed" });

  const plan = moderator.advance({
    phase: TickPhases.SUMMARIZE,
    event: "plan_tick_close",
    payload: {},
    tick: 1,
  })?.tickClose;

  assert.ok(plan, "the Moderator must answer plan_tick_close");
  assert.equal(plan.advanceTick, true);
  assert.equal(
    plan.recomputeAffinityField,
    true,
    "advancing and recomputing describe the same instant, so they travel together",
  );
});

test("a paused Moderator closes nothing — neither the tick nor the field", async () => {
  const { createModeratorPersona } = await import(
    "../../../packages/runtime/src/personas/moderator/persona.js"
  );
  const { TickPhases } = await import(
    "../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );
  const moderator = createModeratorPersona({ clock: () => "fixed" });
  moderator.advance({ phase: TickPhases.INIT, event: "start", payload: {}, tick: 0 });
  moderator.advance({ phase: TickPhases.OBSERVE, event: "pause", payload: {}, tick: 1 });

  const plan = moderator.advance({
    phase: TickPhases.SUMMARIZE,
    event: "plan_tick_close",
    payload: {},
    tick: 1,
  })?.tickClose;

  assert.equal(plan.advanceTick, false, "a paused tick must not advance");
  assert.equal(
    plan.recomputeAffinityField,
    false,
    "and must not publish a field for a tick that never happened",
  );
});

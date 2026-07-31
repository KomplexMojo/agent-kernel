const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/persona-behavior-v1-actor-filter.json"), "utf8"));

test("actor persona filters proposals to motivated actors", async () => {
  const { createActorPersona } = await import(
    "../../packages/runtime/src/personas/actor/controller.mts"
  );
  const { TickPhases } = await import(
    "../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );

  fixture.cases.forEach((entry) => {
    const persona = createActorPersona({ clock: () => "fixed" });
    // CR.6 — the observation travels with every advance; deciding which actors are
    // motivated needs it on the propose call, not just the observe call.
    const base = { actorId: entry.actorId, observation: entry.observation };
    persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: base, tick: 0 });
    persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: base, tick: 0 });
    const result = persona.advance({
      phase: TickPhases.DECIDE,
      event: "propose",
      payload: { ...base, proposals: entry.proposals },
      tick: 1,
    });
    assert.deepEqual(result.actions.map((action) => action.kind), entry.expectedKinds);
    result.actions.forEach((action) => {
      assert.equal(action.actorId, entry.actorId);
    });
  });
});

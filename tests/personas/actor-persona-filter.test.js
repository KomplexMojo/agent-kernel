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
    persona.advance({
      phase: TickPhases.OBSERVE,
      event: "observe",
      payload: { actorId: entry.actorId, observation: entry.observation },
      tick: 0,
    });
    persona.advance({
      phase: TickPhases.DECIDE,
      event: "decide",
      payload: { actorId: entry.actorId },
      tick: 0,
    });
    const result = persona.advance({
      phase: TickPhases.DECIDE,
      event: "propose",
      payload: { actorId: entry.actorId, proposals: entry.proposals },
      tick: 1,
    });
    assert.deepEqual(result.actions.map((action) => action.kind), entry.expectedKinds);
    result.actions.forEach((action) => {
      assert.equal(action.actorId, entry.actorId);
    });
  });
});

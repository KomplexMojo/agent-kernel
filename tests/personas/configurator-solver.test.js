const assert = require("node:assert/strict");

test("configurator persona emits solver_request when provided", async () => {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.mts"
  );
  const { TickPhases } = await import(
    "../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );

  const persona = createConfiguratorPersona({ clock: () => "fixed" });
  const payload = { solverRequest: { id: "cfg_req", meta: { id: "cfg_req" }, problem: { language: "custom" } }, config: { foo: "bar" } };
  const result = persona.advance({ phase: TickPhases.OBSERVE, event: "provide_config", payload, tick: 0 });
  assert.equal(result.effects.length, 1);
  assert.equal(result.effects[0].kind, "solver_request");
  assert.equal(result.effects[0].request.id, "cfg_req");
  assert.equal(result.context.lastSolverRequest.id, "cfg_req");
});

test("configurator persona has no solver_request when missing payload", async () => {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.mts"
  );
  const { TickPhases } = await import(
    "../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );

  const persona = createConfiguratorPersona({ clock: () => "fixed" });
  const result = persona.advance({ phase: TickPhases.OBSERVE, event: "provide_config", payload: { config: { foo: "bar" } }, tick: 0 });
  assert.equal(result.effects.length, 0);
});

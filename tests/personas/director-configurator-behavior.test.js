const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/persona-behavior-v1-director-configurator.json"), "utf8"));


test("director/configurator personas emit deterministic solver_request effects", async () => {
const { createDirectorPersona } = await import("../../packages/runtime/src/personas/director/controller.mts");
const { createConfiguratorPersona } = await import("../../packages/runtime/src/personas/configurator/controller.mts");
const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");


const director = createDirectorPersona({ clock: () => "fixed" });
const dirPayload = { ...fixture.director };
director.advance({ phase: TickPhases.DECIDE, event: "bootstrap", payload: dirPayload, tick: 0 });
const dirResult = director.advance({ phase: TickPhases.DECIDE, event: "ingest_plan", payload: dirPayload, tick: 1 });
assert.equal(dirResult.effects.length, 1);
const dirEffect = dirResult.effects[0];
assert.equal(dirEffect.kind, "solver_request");
assert.equal(dirEffect.requestId, "solver-director");
assert.equal(dirEffect.targetAdapter, "fixtures");
assert.equal(dirEffect.request.planRef.id, "plan-1");
assert.equal(dirResult.context.lastSolverRequest.id, "solver-director");

const configurator = createConfiguratorPersona({ clock: () => "fixed" });
const cfgPayload = { ...fixture.configurator, config: { id: "sim-config" } };
const cfgResult = configurator.advance({ phase: TickPhases.INIT, event: "provide_config", payload: cfgPayload, tick: 0 });
assert.equal(cfgResult.effects.length, 1);
const cfgEffect = cfgResult.effects[0];
assert.equal(cfgEffect.kind, "solver_request");
assert.equal(cfgEffect.requestId, "solver-config");
assert.equal(cfgEffect.targetAdapter, "solver");
assert.equal(cfgEffect.request.planRef.id, "plan-1");
assert.equal(cfgResult.context.lastSolverRequest.id, "solver-config");
});

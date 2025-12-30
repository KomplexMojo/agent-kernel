const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/configurator/persona.js");

const happyScript = `
import assert from "node:assert/strict";
import { createConfiguratorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js"))};

const persona = createConfiguratorPersona({ clock: () => "fixed" });
const payload = { solverRequest: { id: "cfg_req", meta: { id: "cfg_req" }, problem: { language: "custom" } }, config: { foo: "bar" } };
const result = persona.advance({ phase: TickPhases.OBSERVE, event: "provide_config", payload, tick: 0 });
assert.equal(result.effects.length, 1);
assert.equal(result.effects[0].kind, "solver_request");
assert.equal(result.effects[0].request.id, "cfg_req");
assert.equal(result.context.lastSolverRequest.id, "cfg_req");
`;

const deferredScript = `
import assert from "node:assert/strict";
import { createConfiguratorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js"))};

const persona = createConfiguratorPersona({ clock: () => "fixed" });
const result = persona.advance({ phase: TickPhases.OBSERVE, event: "provide_config", payload: { config: { foo: "bar" } }, tick: 0 });
assert.equal(result.effects.length, 0);
`;

test("configurator persona emits solver_request when provided", () => {
  runEsm(happyScript);
});

test("configurator persona has no solver_request when missing payload", () => {
  runEsm(deferredScript);
});

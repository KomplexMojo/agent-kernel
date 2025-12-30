const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/director/persona.js");

const script = `
import assert from "node:assert/strict";
import { createDirectorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js"))};

const persona = createDirectorPersona({ clock: () => "fixed" });
const payload = {
  solverRequest: { id: "solver_req", meta: { id: "solver_req" }, problem: { language: "custom", data: {} }, planRef: { id: "plan" } },
  planRef: { id: "plan" },
};
// enter intake state
persona.advance({ phase: TickPhases.DECIDE, event: "bootstrap", payload: { planRef: { id: "plan" } }, tick: 0 });
// ingest plan with solver request
const result = persona.advance({ phase: TickPhases.DECIDE, event: "ingest_plan", payload, tick: 0 });
assert.equal(result.effects.length, 1);
assert.equal(result.effects[0].kind, "solver_request");
assert.equal(result.effects[0].request.id, "solver_req");
assert.equal(result.context.lastSolverRequest.id, "solver_req");
`;

test("director persona emits solver_request effect when provided", () => {
  runEsm(script);
});

const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/allocator/persona.js");

const happyScript = `
import assert from "node:assert/strict";
import { createAllocatorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js"))};

const persona = createAllocatorPersona({ clock: () => "fixed" });
const payload = { solverRequest: { id: "alloc_req", meta: { id: "alloc_req" }, problem: { language: "custom" } } };
const result = persona.advance({ phase: TickPhases.DECIDE, event: "budget", payload, tick: 0 });
assert.equal(result.effects.length, 1);
assert.equal(result.effects[0].kind, "solver_request");
assert.equal(result.effects[0].request.id, "alloc_req");
assert.equal(result.context.lastSolverRequest.id, "alloc_req");
`;

const deferredScript = `
import assert from "node:assert/strict";
import { createAllocatorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js"))};

const persona = createAllocatorPersona({ clock: () => "fixed" });
const result = persona.advance({ phase: TickPhases.DECIDE, event: "budget", payload: {}, tick: 0 });
assert.equal(result.effects.length, 0);
`;

test("allocator persona emits solver_request when provided", () => {
  runEsm(happyScript);
});

test("allocator persona has no solver_request when missing payload", () => {
  runEsm(deferredScript);
});

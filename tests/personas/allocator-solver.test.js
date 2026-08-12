const assert = require("node:assert/strict");




test("allocator persona emits solver_request when provided", async () => {
const { createAllocatorPersona } = await import("../../packages/runtime/src/personas/allocator/controller.mts");
const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const persona = createAllocatorPersona({ clock: () => "fixed" });
const payload = { solverRequest: { id: "alloc_req", meta: { id: "alloc_req" }, problem: { language: "custom" } } };
const result = persona.advance({ phase: TickPhases.DECIDE, event: "budget", payload, tick: 0 });
assert.equal(result.effects.length, 1);
assert.equal(result.effects[0].kind, "solver_request");
assert.equal(result.effects[0].request.id, "alloc_req");
assert.equal(result.context.lastSolverRequest.id, "alloc_req");
});

test("allocator persona has no solver_request when missing payload", async () => {
const { createAllocatorPersona } = await import("../../packages/runtime/src/personas/allocator/controller.mts");
const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const persona = createAllocatorPersona({ clock: () => "fixed" });
const result = persona.advance({ phase: TickPhases.DECIDE, event: "budget", payload: {}, tick: 0 });
assert.equal(result.effects.length, 0);
});

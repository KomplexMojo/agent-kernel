const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const allocatorModule = moduleUrl("packages/runtime/src/personas/allocator/persona.js");
const actorModule = moduleUrl("packages/runtime/src/personas/actor/persona.js");
const tickModule = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js");
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/persona-behavior-v1-allocator-actor.json"), "utf8"));

const script = `
import assert from "node:assert/strict";
import { createAllocatorPersona } from ${JSON.stringify(allocatorModule)};
import { createActorPersona } from ${JSON.stringify(actorModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const fixture = ${JSON.stringify(fixture)};

const allocator = createAllocatorPersona({ clock: () => "fixed" });
allocator.advance({ phase: TickPhases.DECIDE, event: "budget", payload: { budgets: [{ category: "effects", cap: fixture.allocator.budget.effects }] }, tick: 0 });
const allocPayload = {
  budgets: [{ category: "effects", cap: fixture.allocator.budget.effects }],
  budget: fixture.allocator.budget,
  effects: fixture.allocator.effects,
  solverPrompts: fixture.allocator.solverPrompts,
};
const allocResult = allocator.advance({ phase: TickPhases.DECIDE, event: "allocate", payload: allocPayload, tick: 1 });
assert.equal(allocResult.actions.length, 3);
const allocKinds = allocResult.actions.map((a) => a.kind);
assert.deepEqual(allocKinds, ["fulfill_request", "defer_request", "request_solver"]);
assert.equal(allocResult.actions[0].params.requestId, "fact-1");
assert.equal(allocResult.actions[1].params.requestId, "fact-2");
assert.equal(allocResult.actions[2].params.requestId, "solve-1");
assert.equal(allocResult.context.budgetRemaining, 0);

const actor = createActorPersona({ clock: () => "fixed" });
const observation = {
  tick: 0,
  actors: [{ id: "actor", kind: 2, position: { x: 0, y: 0 } }],
  tiles: { kinds: [[0]] },
};
actor.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: { actorId: "actor", observation }, tick: 0 });
actor.advance({ phase: TickPhases.DECIDE, event: "decide", payload: { actorId: "actor" }, tick: 0 });
const actorPayload = {
  actorId: "actor",
  proposals: fixture.actor.proposals,
  effects: fixture.actor.effects,
  trace: fixture.actor.trace,
  telemetry: fixture.actor.telemetry,
};
const actorResult = actor.advance({ phase: TickPhases.DECIDE, event: "propose", payload: actorPayload, tick: 1 });
const actorKinds = actorResult.actions.map((a) => a.kind);
assert.ok(actorKinds.includes("custom_action"));
assert.ok(actorKinds.includes("emit_log"));
assert.ok(actorKinds.includes("emit_telemetry"));
assert.ok(actorKinds.includes("fulfill_request"));
assert.ok(actorKinds.includes("defer_request"));
const requestIds = actorResult.actions.filter((a) => a.kind.endsWith("request")).map((a) => a.params.requestId);
assert.deepEqual(requestIds, ["fact-3", "fact-4"]);
`;

test("allocator and actor personas emit budget-aware actions and close request loops", () => {
  runEsm(script);
});

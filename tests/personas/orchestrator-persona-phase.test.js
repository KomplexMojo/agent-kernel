const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/orchestrator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/orchestrator-phases-guards.json"), "utf8"));



test("orchestrator persona handles phase-driven cases", async () => {
const { createOrchestratorPersona, orchestratorSubscribePhases } = await import("../../packages/runtime/src/personas/orchestrator/controller.mts");
const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const fixture = happyFixture;
const persona = createOrchestratorPersona({ clock: () => "fixed" });
assert.deepEqual(orchestratorSubscribePhases, [TickPhases.OBSERVE, TickPhases.DECIDE, TickPhases.EMIT]);

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  if (!entry.event || !orchestratorSubscribePhases.includes(entry.phase)) {
    assert.equal(result.state, before.state);
    return;
  }
  assert.equal(result.state, entry.expectState);
  if (entry.expectPlanRef) {
    assert.equal(result.context.planRef, entry.expectPlanRef);
  }
});
});

test("orchestrator persona enforces guard/invalid events", async () => {
const { createOrchestratorPersona } = await import("../../packages/runtime/src/personas/orchestrator/controller.mts");

const fixture = guardFixture;
const persona = createOrchestratorPersona({ initialState: fixture.initialState || undefined, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  if (entry.expectError) {
    let threw = false;
    try {
      persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
    } catch (err) {
      threw = true;
      assert.match(err.message, new RegExp(entry.expectError));
    }
    assert.equal(threw, true);
  } else {
    const before = persona.view();
    const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
    assert.equal(result.state, before.state);
  }
});
});

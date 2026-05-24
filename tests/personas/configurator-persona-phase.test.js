const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-phases-guards.json"), "utf8"));



test("configurator persona handles phase-driven cases", async () => {
const { createConfiguratorPersona, configuratorSubscribePhases } = await import("../../packages/runtime/src/personas/configurator/controller.mts");
const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const fixture = happyFixture;
const persona = createConfiguratorPersona({ clock: () => "fixed" });
assert.deepEqual(configuratorSubscribePhases, [TickPhases.INIT, TickPhases.OBSERVE]);

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  if (!entry.event || !configuratorSubscribePhases.includes(entry.phase)) {
    assert.equal(result.state, before.state);
    return;
  }
  assert.equal(result.state, entry.expectState);
  if (entry.expectConfigRef) {
    assert.equal(result.context.lastConfigRef, entry.expectConfigRef);
  }
});
});

test("configurator persona enforces guard/invalid events", async () => {
const { createConfiguratorPersona } = await import("../../packages/runtime/src/personas/configurator/controller.mts");

const fixture = guardFixture;
const persona = createConfiguratorPersona({ clock: () => "fixed" });

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

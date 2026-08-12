const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/allocator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/allocator-phases-guards.json"), "utf8"));

test("allocator persona handles phase-driven cases", async () => {
  const { createAllocatorPersona, allocatorSubscribePhases } = await import(
    "../../packages/runtime/src/personas/allocator/controller.mts"
  );
  const { TickPhases } = await import(
    "../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );

  const persona = createAllocatorPersona({ initialState: happyFixture.initialState, clock: () => "fixed" });
  assert.deepEqual(allocatorSubscribePhases, [TickPhases.OBSERVE, TickPhases.DECIDE]);

  happyFixture.cases.forEach((entry) => {
    const before = persona.view();
    const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
    if (!entry.event || !allocatorSubscribePhases.includes(entry.phase)) {
      assert.equal(result.state, before.state);
      return;
    }
    assert.equal(result.state, entry.expectState);
  });
});

test("allocator persona enforces guard/invalid events", async () => {
  const { createAllocatorPersona } = await import(
    "../../packages/runtime/src/personas/allocator/controller.mts"
  );

  const persona = createAllocatorPersona({ initialState: guardFixture.initialState, clock: () => "fixed" });

  guardFixture.cases.forEach((entry) => {
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

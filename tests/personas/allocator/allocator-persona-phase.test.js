const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/allocator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/allocator-phases-guards.json"), "utf8"));

/**
 * P2.6 — the bare label assertion is gone (charter §6); the Allocator's ownership is
 * answered by G1 — `allocator/spend-authority`, `allocator/budget-maximization`,
 * `allocator/judges-not-authors` — not by watching a state name change here.
 *
 * WHAT STAYS IS THE SUBSCRIPTION CONTRACT: `allocatorSubscribePhases`, and the branch
 * asserting that a phase this persona does NOT subscribe to leaves it untouched. That
 * second one is the load-bearing half — it is the difference between a subscription
 * list that is honoured and one that is merely declared, and no state name would move
 * if the persona started acting on every phase.
 */
test("allocator persona subscribes to observe/decide and does not advance on other phases", async () => {
  const { createAllocatorPersona, allocatorSubscribePhases } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );
  const { TickPhases } = await import(
    "../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"
  );

  const persona = createAllocatorPersona({ initialState: happyFixture.initialState, clock: () => "fixed" });
  assert.deepEqual(allocatorSubscribePhases, [TickPhases.OBSERVE, TickPhases.DECIDE]);

  happyFixture.cases.forEach((entry) => {
    const before = persona.view();
    const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
    if (!entry.event || !allocatorSubscribePhases.includes(entry.phase)) {
      assert.equal(
        result.state,
        before.state,
        "an unsubscribed phase (or a case with no event) must not advance the persona",
      );
    }
  });
});

test("allocator persona enforces guard/invalid events", async () => {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
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

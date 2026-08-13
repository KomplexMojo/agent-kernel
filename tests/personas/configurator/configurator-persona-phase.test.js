const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/configurator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/configurator-phases-guards.json"), "utf8"));



/**
 * P2.6 — the bare label assertion is gone (charter §6).
 *
 * ⚠️ THIS PERSONA IS THE REASON THE DISTINCTION MATTERS. PX.5 found the Configurator's
 * validate/lock genuinely owned on the BUILD plane and label-only on the TICK plane —
 * one charter sentence, two ownership answers — and this is a tick-plane file. A test
 * here asserting `result.state === "configured"` was asserting a state the persona had
 * not earned, which is precisely how the tick plane came to claim build-plane work it
 * never did. G1 splits the two: `configurator/validate-lock@build` vs `@tick`.
 *
 * WHAT STAYS: the subscribed-phase contract (INIT + OBSERVE), the unsubscribed-phase
 * no-op, and `lastConfigRef` — the ref actually carried, not the name of a state.
 */
test("configurator persona subscribes to init/observe and carries its config ref", async () => {
const { createConfiguratorPersona, configuratorSubscribePhases } = await import("../../../packages/runtime/src/personas/configurator/persona.js");
const { TickPhases } = await import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const fixture = happyFixture;
const persona = createConfiguratorPersona({ clock: () => "fixed" });
assert.deepEqual(configuratorSubscribePhases, [TickPhases.INIT, TickPhases.OBSERVE]);

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  if (!entry.event || !configuratorSubscribePhases.includes(entry.phase)) {
    assert.equal(
      result.state,
      before.state,
      "an unsubscribed phase (or a case with no event) must not advance the persona",
    );
    return;
  }
  if (entry.expectConfigRef) {
    assert.equal(result.context.lastConfigRef, entry.expectConfigRef);
  }
});
});

test("configurator persona enforces guard/invalid events", async () => {
const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/persona.js");

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

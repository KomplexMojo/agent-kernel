const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/actor-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/personas/actor-phases-guards.json"), "utf8"));



/**
 * P2.6 — the bare label assertion (`result.state === entry.expectState`) is gone;
 * charter §6 calls a test that only watches a label change legacy, and G1
 * (`persona-authority-registry.js`) is where Actor ownership is actually answered —
 * `actor/motivation-to-proposal`, an ablation against a real runtime.
 *
 * TWO THINGS HERE ARE NOT LABELS AND STAY:
 *   1. `actorSubscribePhases` — which tick phases this persona is wired into is a
 *      contract, not a state name. The charter's persona table has a Tick Phases
 *      column, and a persona that quietly started subscribing to EMIT would change
 *      the shape of every tick while every state name stayed correct.
 *   2. the no-event branch — a case with no event must leave the persona exactly
 *      where it was. That is the subscription being REAL rather than decorative,
 *      which is the same question the charter asks of states.
 * `lastProposalCount` stays for the reason given in this persona's state-machine file.
 */
test("actor persona subscribes to observe/decide and ignores cases carrying no event", async () => {
const { createActorPersona, actorSubscribePhases } = await import("../../../packages/runtime/src/personas/actor/persona.js");
const { TickPhases } = await import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const fixture = happyFixture;
const persona = createActorPersona({ initialState: fixture.initialState, clock: () => "fixed" });
assert.deepEqual(actorSubscribePhases, [TickPhases.OBSERVE, TickPhases.DECIDE]);

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  if (!entry.event) {
    assert.equal(result.state, before.state, "a case with no event must not advance the persona");
    return;
  }
  if (entry.expectProposalCount !== undefined) {
    assert.equal(result.context.lastProposalCount, entry.expectProposalCount);
  }
});
});

test("actor persona enforces guard/invalid events", async () => {
const { createActorPersona } = await import("../../../packages/runtime/src/personas/actor/persona.js");

const fixture = guardFixture;
const persona = createActorPersona({ initialState: fixture.initialState, clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  let threw = false;
  try {
    persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  } catch (err) {
    threw = true;
    assert.match(err.message, new RegExp(entry.expectError));
  }
  assert.equal(threw, true);
});
});

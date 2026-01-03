const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/actor/controller.mts");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/actor-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/actor-phases-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createActorPersona, actorSubscribePhases } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.mts"))};

const fixture = ${JSON.stringify(happyFixture)};
const persona = createActorPersona({ initialState: fixture.initialState, clock: () => "fixed" });
assert.deepEqual(actorSubscribePhases, [TickPhases.OBSERVE, TickPhases.DECIDE]);

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  if (!entry.event) {
    assert.equal(result.state, before.state);
    return;
  }
  assert.equal(result.state, entry.expectState);
  if (entry.expectProposalCount !== undefined) {
    assert.equal(result.context.lastProposalCount, entry.expectProposalCount);
  }
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createActorPersona } from ${JSON.stringify(personaModule)};

const fixture = ${JSON.stringify(guardFixture)};
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
`;

test("actor persona handles phase-driven cases", () => {
  runEsm(happyScript);
});

test("actor persona enforces guard/invalid events", () => {
  runEsm(guardScript);
});

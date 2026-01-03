const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/configurator/controller.mts");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-phases-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createConfiguratorPersona, configuratorSubscribePhases } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.mts"))};

const fixture = ${JSON.stringify(happyFixture)};
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
`;

const guardScript = `
import assert from "node:assert/strict";
import { createConfiguratorPersona } from ${JSON.stringify(personaModule)};

const fixture = ${JSON.stringify(guardFixture)};
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
`;

test("configurator persona handles phase-driven cases", () => {
  runEsm(happyScript);
});

test("configurator persona enforces guard/invalid events", () => {
  runEsm(guardScript);
});

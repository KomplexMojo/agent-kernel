const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/director/persona.js");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/director-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/director-phases-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createDirectorPersona, directorSubscribePhases } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js"))};

const fixture = ${JSON.stringify(happyFixture)};
const persona = createDirectorPersona({ initialState: fixture.initialState, clock: () => fixture.clock });

assert.deepEqual(directorSubscribePhases, [TickPhases.DECIDE]);

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  const expectedState = entry.expectState;
  assert.equal(result.state, expectedState);
  assert.equal(result.context.lastEvent, entry.event);
  assert.equal(result.context.updatedAt, fixture.clock);
  if (entry.phase !== "decide") {
    assert.equal(result.state, before.state);
  }
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createDirectorPersona } from ${JSON.stringify(personaModule)};

const fixture = ${JSON.stringify(guardFixture)};
const persona = createDirectorPersona({ initialState: fixture.initialState, clock: () => fixture.clock });

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
    return;
  }
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  assert.equal(result.state, before.state);
});
`;

test("director persona handles subscribed phases via table", () => {
  runEsm(happyScript);
});

test("director persona ignores non-subscribed phases and surfaces guard errors", () => {
  runEsm(guardScript);
});

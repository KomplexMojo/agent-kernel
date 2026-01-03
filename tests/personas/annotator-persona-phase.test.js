const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/annotator/controller.mts");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/annotator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/annotator-phases-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createAnnotatorPersona, annotatorSubscribePhases } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.mts"))};

const fixture = ${JSON.stringify(happyFixture)};
const persona = createAnnotatorPersona({ clock: () => "fixed" });
assert.deepEqual(annotatorSubscribePhases, [TickPhases.EMIT, TickPhases.SUMMARIZE]);

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  if (!entry.event || !annotatorSubscribePhases.includes(entry.phase)) {
    assert.equal(result.state, before.state);
    return;
  }
  assert.equal(result.state, entry.expectState);
  if (entry.expectObservationCount !== undefined) {
    assert.equal(result.context.lastObservationCount, entry.expectObservationCount);
  }
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createAnnotatorPersona } from ${JSON.stringify(personaModule)};

const fixture = ${JSON.stringify(guardFixture)};
const persona = createAnnotatorPersona({ initialState: fixture.initialState || undefined, clock: () => "fixed" });

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

test("annotator persona handles phase-driven cases", () => {
  runEsm(happyScript);
});

test("annotator persona enforces guard/invalid events", () => {
  runEsm(guardScript);
});

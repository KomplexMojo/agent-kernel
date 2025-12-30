const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/moderator/persona.js");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/moderator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/moderator-phases-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createModeratorPersona, moderatorSubscribePhases } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js"))};

const fixture = ${JSON.stringify(happyFixture)};
const persona = createModeratorPersona({ clock: () => "fixed" });
assert.deepEqual(moderatorSubscribePhases, Object.values(TickPhases));

fixture.cases.forEach((entry) => {
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  assert.equal(result.state, entry.expectState);
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createModeratorPersona } from ${JSON.stringify(personaModule)};

const fixture = ${JSON.stringify(guardFixture)};
const persona = createModeratorPersona({ clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  assert.equal(result.state, before.state);
});
`;

test("moderator persona handles phase-driven cases", () => {
  runEsm(happyScript);
});

test("moderator persona ignores non-advancing cases", () => {
  runEsm(guardScript);
});

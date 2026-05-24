const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/moderator-phases-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/moderator-phases-guards.json"), "utf8"));



test("moderator persona handles phase-driven cases", async () => {
const { createModeratorPersona, moderatorSubscribePhases } = await import("../../packages/runtime/src/personas/moderator/controller.mts");
const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const fixture = happyFixture;
const persona = createModeratorPersona({ clock: () => "fixed" });
assert.deepEqual(moderatorSubscribePhases, Object.values(TickPhases));

fixture.cases.forEach((entry) => {
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  assert.equal(result.state, entry.expectState);
});
});

test("moderator persona ignores non-advancing cases", async () => {
const { createModeratorPersona } = await import("../../packages/runtime/src/personas/moderator/controller.mts");

const fixture = guardFixture;
const persona = createModeratorPersona({ clock: () => "fixed" });

fixture.cases.forEach((entry) => {
  const before = persona.view();
  const result = persona.advance({ phase: entry.phase, event: entry.event, payload: entry.payload, tick: 0 });
  assert.equal(result.state, before.state);
});
});

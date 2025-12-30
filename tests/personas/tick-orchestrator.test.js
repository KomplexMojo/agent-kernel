const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const orchestratorModule = moduleUrl("packages/runtime/src/personas/_shared/tick-orchestrator.js");
const tickModule = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-orchestrator-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-orchestrator-guards.json"), "utf8"));

const happyScript = `
import assert from "node:assert/strict";
import { createTickOrchestrator } from ${JSON.stringify(orchestratorModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const fixture = ${JSON.stringify(happyFixture)};
const appliedActions = [];

const stubPersona = {
  subscribePhases: [TickPhases.DECIDE],
  state: "idle",
  view() {
    return { state: this.state, context: { lastEvent: null } };
  },
  advance({ phase, event, tick }) {
    this.state = "ready";
    const actions = event ? [{ kind: "action", from: "stub", tick, phase }] : [];
    return {
      state: this.state,
      context: { lastEvent: event, phase },
      actions,
      effects: [],
      telemetry: null,
    };
  },
};

const orchestrator = createTickOrchestrator({ clock: () => "fixed", onActions: (acts) => appliedActions.push(...acts) });
orchestrator.registerPersona("stub", stubPersona);

fixture.sequence.forEach((entry) => {
  const result = orchestrator.stepPhase(entry.event, {});
  assert.equal(result.phase, entry.expect.phase);
  assert.equal(result.tick, entry.expect.tick);
  assert.equal(result.actions.length, entry.expect.actions);
  if (entry.expect.actions > 0) {
    assert.equal(appliedActions.length, entry.expect.actions);
    assert.equal(result.personaViews.stub.state, "ready");
  }
});
`;

const guardScript = `
import assert from "node:assert/strict";
import { createTickOrchestrator } from ${JSON.stringify(orchestratorModule)};

const fixture = ${JSON.stringify(guardFixture)};
const orchestrator = createTickOrchestrator({ clock: () => "fixed" });

let threw = false;
try {
  orchestrator.stepPhase(fixture.sequence[0].event, {});
} catch (err) {
  threw = true;
  assert.match(err.message, /No transition/);
}
assert.equal(threw, true);
`;

test("tick orchestrator drives phases and personas and collects actions", () => {
  runEsm(happyScript);
});

test("tick orchestrator surfaces invalid transitions", () => {
  runEsm(guardScript);
});

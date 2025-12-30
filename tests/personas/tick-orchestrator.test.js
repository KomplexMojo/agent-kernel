const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const orchestratorModule = moduleUrl("packages/runtime/src/personas/_shared/tick-orchestrator.js");
const tickModule = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-orchestrator-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-orchestrator-guards.json"), "utf8"));
const solverPortModule = moduleUrl("packages/runtime/src/ports/solver.js");

const happyScript = `
import assert from "node:assert/strict";
import { createTickOrchestrator } from ${JSON.stringify(orchestratorModule)};
import { createSolverPort } from ${JSON.stringify(solverPortModule)};
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
    const effects = event ? [{ kind: "solver_request", request: { id: "req", meta: { id: "req" } } }] : [];
    return {
      state: this.state,
      context: { lastEvent: event, phase },
      actions,
      effects,
      telemetry: null,
    };
  },
};

const solverPort = createSolverPort({ clock: () => "fixed" });
const solverAdapter = { async solve(request) { return { status: "fulfilled", request, meta: { id: "res", runId: "run", createdAt: "fixed" } }; } };
const orchestrator = createTickOrchestrator({ clock: () => "fixed", onActions: (acts) => appliedActions.push(...acts), solverPort, solverAdapter });
orchestrator.registerPersona("stub", stubPersona);

for (const entry of fixture.sequence) {
  const result = await orchestrator.stepPhase(entry.event, {});
  assert.equal(result.phase, entry.expect.phase);
  assert.equal(result.tick, entry.expect.tick);
  assert.equal(result.actions.length, entry.expect.actions);
  if (entry.expect.solverResults !== undefined) {
    assert.equal(result.solverResults.length, entry.expect.solverResults);
  }
  if (entry.expect.actions > 0) {
    assert.equal(appliedActions.length, entry.expect.actions);
    assert.equal(result.personaViews.stub.state, "ready");
  }
}
`;

const guardScript = `
import assert from "node:assert/strict";
import { createTickOrchestrator } from ${JSON.stringify(orchestratorModule)};

const fixture = ${JSON.stringify(guardFixture)};
const orchestrator = createTickOrchestrator({ clock: () => "fixed" });

let threw = false;
try {
  await orchestrator.stepPhase(fixture.sequence[0].event, {});
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

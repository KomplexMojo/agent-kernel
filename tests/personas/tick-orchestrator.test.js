const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const orchestratorModule = moduleUrl("packages/runtime/src/personas/_shared/tick-orchestrator.mts");
const tickModule = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.mts");
const happyFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-orchestrator-happy.json"), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-orchestrator-guards.json"), "utf8"));
const solverPortModule = moduleUrl("packages/runtime/src/ports/solver.js");
const runtimeDecisionModule = moduleUrl("packages/runtime/src/personas/_shared/runtime-decision.mts");

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

test("tick orchestrator converts solver runtime decisions into actions on the existing rail", () => {
  const script = `
import assert from "node:assert/strict";
import { createTickOrchestrator } from ${JSON.stringify(orchestratorModule)};
import { createSolverPort } from ${JSON.stringify(solverPortModule)};
import { buildRuntimeDecisionEnvelope } from ${JSON.stringify(runtimeDecisionModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const appliedActions = [];
const persona = {
  subscribePhases: [TickPhases.DECIDE],
  view() {
    return { state: "idle", context: {} };
  },
  advance() {
    return {
      state: "idle",
      context: {},
      actions: [],
      effects: [{
        kind: "solver_request",
        request: {
          id: "solver_req_runtime",
          meta: { id: "solver_req_runtime" },
          problem: {
            language: "custom",
            data: buildRuntimeDecisionEnvelope({
              tick: 7,
              actor: { id: "actor_runtime" },
              candidateActions: [
                {
                  id: "move_east",
                  action: {
                    kind: "move",
                    params: { to: { x: 5, y: 6 } },
                  },
                },
                {
                  id: "wait_here",
                  action: {
                    kind: "wait",
                    params: {},
                  },
                },
              ],
            }),
          },
        },
      }],
      telemetry: null,
    };
  },
};

const solverPort = createSolverPort({ clock: () => "fixed" });
const solverAdapter = {
  async solve(request) {
    return {
      status: "fulfilled",
      model: {
        decision: {
          contract: "runtime-decision-v1",
          decisionKind: "next_move",
          selectedActionId: "move_east",
          confidence: 0.91,
        },
      },
      request,
      meta: { id: "solver_res_runtime", runId: "run", createdAt: "fixed" },
    };
  },
};

const orchestrator = createTickOrchestrator({
  clock: () => "fixed",
  onActions: (actions) => appliedActions.push(...actions),
  solverPort,
  solverAdapter,
});
orchestrator.registerPersona("solver", persona);
await orchestrator.stepPhase("observe", {});
const result = await orchestrator.stepPhase("decide", {});

assert.equal(result.actions.length, 1);
assert.equal(result.actions[0].kind, "move");
assert.deepEqual(result.actions[0].params.to, { x: 5, y: 6 });
assert.equal(result.actions[0].actorId, "actor_runtime");
assert.equal(result.actions[0].tick, 7);
assert.equal(appliedActions.length, 1);
assert.equal(result.solverResults.length, 1);
assert.equal(result.solverResults[0].decision.selectedActionId, "move_east");
assert.equal(result.solverResults[0].action.kind, "move");
`;
  runEsm(script);
});

test("tick orchestrator fulfills manual-mode live LLM runtime decisions on the same rail and captures the exchange", () => {
  const script = `
import assert from "node:assert/strict";
import { createTickOrchestrator } from ${JSON.stringify(orchestratorModule)};
import { buildRuntimeDecisionEnvelope } from ${JSON.stringify(runtimeDecisionModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const appliedActions = [];
const persona = {
  subscribePhases: [TickPhases.DECIDE],
  view() {
    return { state: "idle", context: {} };
  },
  advance() {
    return {
      state: "idle",
      context: {},
      actions: [],
      effects: [{
        kind: "solver_request",
        request: {
          id: "runtime_llm_req",
          requestId: "runtime_llm_req",
          meta: { id: "runtime_llm_req", runId: "run_runtime_llm" },
          targetAdapter: "ollama",
          problem: {
            language: "custom",
            data: buildRuntimeDecisionEnvelope({
              tick: 4,
              actor: { id: "boss_llm", role: "boss" },
              providerPolicy: {
                mode: "llm",
                preferred: "llm",
                liveLlmMode: "manual_nondeterministic",
                model: "phi4",
              },
              candidateActions: [
                {
                  id: "cast_dark_bolt",
                  action: {
                    kind: "custom",
                    params: { abilityId: "dark_bolt", targetId: "def_1" },
                  },
                },
                {
                  id: "wait_here",
                  action: {
                    kind: "wait",
                    params: {},
                  },
                },
              ],
              visibleActors: [{ id: "def_1", role: "defender" }],
            }),
          },
        },
      }],
      telemetry: null,
    };
  },
};

const llmAdapter = {
  async generate({ model, prompt, format }) {
    assert.equal(model, "phi4");
    assert.equal(format, "json");
    assert.match(prompt, /candidateActions/);
    return {
      response: JSON.stringify({
        decision: {
          contract: "runtime-decision-v1",
          decisionKind: "next_move",
          selectedActionId: "cast_dark_bolt",
          selectedTargetId: "def_1",
          confidence: 0.81,
          rationaleTags: ["focus_target"],
        },
      }),
    };
  },
};

const orchestrator = createTickOrchestrator({
  clock: () => "fixed",
  onActions: (actions) => appliedActions.push(...actions),
  llmAdapter,
});
orchestrator.registerPersona("llm", persona);
await orchestrator.stepPhase("observe", {});
const result = await orchestrator.stepPhase("decide", {});

assert.equal(result.actions.length, 1);
assert.equal(result.actions[0].kind, "custom");
assert.equal(result.actions[0].params.abilityId, "dark_bolt");
assert.equal(result.solverResults.length, 1);
assert.equal(result.solverResults[0].provider.selected, "llm");
assert.equal(result.solverResults[0].captureRef.schema, "agent-kernel/CapturedInputArtifact");
assert.equal(result.artifacts.length, 1);
assert.equal(result.artifacts[0].source.adapter, "llm");
assert.equal(result.artifacts[0].payload.requestEnvelope.contract, "runtime-decision-v1");
assert.equal(result.artifacts[0].payload.responseParsed.decision.selectedActionId, "cast_dark_bolt");
assert.equal(appliedActions.length, 1);
`;
  runEsm(script);
});

test("tick orchestrator does not perform automatic solver-to-LLM fallback when solver is unfulfilled", () => {
  const script = `
import assert from "node:assert/strict";
import { createTickOrchestrator } from ${JSON.stringify(orchestratorModule)};
import { createSolverPort } from ${JSON.stringify(solverPortModule)};
import { buildRuntimeDecisionEnvelope } from ${JSON.stringify(runtimeDecisionModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

let llmCalls = 0;
const persona = {
  subscribePhases: [TickPhases.DECIDE],
  view() {
    return { state: "idle", context: {} };
  },
  advance() {
    return {
      state: "idle",
      context: {},
      actions: [],
      effects: [{
        kind: "solver_request",
        request: {
          id: "solver_req_no_fallback",
          meta: { id: "solver_req_no_fallback", runId: "run_solver_no_fallback" },
          problem: {
            language: "custom",
            data: buildRuntimeDecisionEnvelope({
              tick: 2,
              actor: { id: "boss_solver" },
              providerPolicy: {
                mode: "solver",
                preferred: "solver",
                allowLlmFallback: true,
              },
              candidateActions: [
                { id: "move_east", action: { kind: "move", params: { to: { x: 2, y: 1 } } } },
              ],
            }),
          },
        },
      }],
      telemetry: null,
    };
  },
};

const solverPort = createSolverPort({ clock: () => "fixed" });
const solverAdapter = {
  async solve() {
    return {
      status: "deferred",
      reason: "solver_unavailable",
      model: {},
      meta: { id: "solver_res_no_fallback", runId: "run_solver_no_fallback", createdAt: "fixed" },
    };
  },
};
const llmAdapter = {
  async generate() {
    llmCalls += 1;
    return { response: "{\\"decision\\":{\\"selectedActionId\\":\\"move_east\\"}}" };
  },
};

const orchestrator = createTickOrchestrator({
  clock: () => "fixed",
  solverPort,
  solverAdapter,
  llmAdapter,
});
orchestrator.registerPersona("solver", persona);
await orchestrator.stepPhase("observe", {});
const result = await orchestrator.stepPhase("decide", {});

assert.equal(llmCalls, 0);
assert.equal(result.actions.length, 0);
assert.equal(result.solverResults.length, 1);
assert.equal(result.solverResults[0].provider.selected, "solver");
assert.equal(result.solverResults[0].fallback.requested, true);
assert.equal(result.solverResults[0].fallback.performed, false);
assert.equal(result.solverResults[0].fallback.reason, "auto_llm_fallback_disabled");
`;
  runEsm(script);
});

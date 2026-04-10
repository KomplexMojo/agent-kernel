const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/actor/controller.mts");
const tickModule = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.mts");

test("actor persona emits runtime-decision solver requests from live observation context", () => {
  const script = `
import assert from "node:assert/strict";
import { createActorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const persona = createActorPersona({ clock: () => "2026-03-15T00:00:00Z" });
const actorId = "boss_1";
const initialState = {
  actors: [
    {
      id: actorId,
      role: "boss",
      kind: "motivated",
      runtimeDecisioning: true,
      decisionMode: "solver",
    },
  ],
};
const observation = {
  tick: 2,
  actors: [
    {
      id: actorId,
      kind: 2,
      role: "boss",
      position: { x: 1, y: 1 },
      vitals: {
        health: { current: 9, max: 10, regen: 0 },
        mana: { current: 3, max: 5, regen: 0 },
        stamina: { current: 2, max: 4, regen: 0 },
      },
    },
    { id: "def_1", kind: 2, role: "defender", position: { x: 2, y: 1 } },
    { id: "def_2", kind: 2, role: "defender", position: { x: 1, y: 2 } },
  ],
  tiles: {
    kinds: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  },
};

persona.advance({
  phase: TickPhases.OBSERVE,
  event: "observe",
  payload: {
    actorId,
    initialState,
    observation,
    baseTiles: [
      "...",
      "...",
      "..E",
    ],
    affinityEffects: {
      traps: [{ id: "trap_1", kind: "trap", position: { x: 0, y: 1 }, affinity: "fire", expression: "emit", stacks: 1 }],
    },
  },
  tick: 2,
});
persona.advance({
  phase: TickPhases.DECIDE,
  event: "decide",
  payload: { actorId, initialState },
  tick: 2,
});
const result = persona.advance({
  phase: TickPhases.DECIDE,
  event: "propose",
  payload: {
    actorId,
    initialState,
    runId: "run_actor_runtime_decision",
  },
  tick: 3,
});

assert.equal(result.actions.length, 0);
assert.equal(result.effects.length, 1);
assert.equal(result.effects[0].kind, "solver_request");
assert.equal(result.context.lastSolverRequest.options.engine, "z3");
const envelope = result.effects[0].request.problem.data;
assert.equal(envelope.contract, "runtime-decision-v1");
assert.equal(envelope.actor.id, actorId);
assert.equal(envelope.providerPolicy.preferred, "solver");
assert.equal(envelope.visibleActors.length, 2);
assert.equal(envelope.hazards.length, 1);
assert.ok(envelope.candidateActions.some((entry) => entry.id === "move_east"));
assert.ok(envelope.candidateActions.some((entry) => entry.id === "move_northeast"));
assert.ok(envelope.candidateActions.some((entry) => entry.id === "wait_here"));
assert.equal(result.context.lastRuntimeDecisionEnvelope.candidateActions.length, envelope.candidateActions.length);
`;
  runEsm(script);
});

test("actor persona keeps manual live LLM runtime requests on the same solver_request rail", () => {
  const script = `
import assert from "node:assert/strict";
import { createActorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const persona = createActorPersona({ clock: () => "2026-03-15T00:00:00Z" });
const actorId = "boss_llm_1";
const initialState = {
  actors: [
    {
      id: actorId,
      role: "boss",
      kind: "motivated",
      runtimeDecisioning: true,
      decisionMode: "llm",
      providerPolicy: {
        mode: "llm",
        preferred: "llm",
        liveLlmMode: "manual_nondeterministic",
        model: "phi4-mini",
      },
    },
  ],
};
const observation = {
  tick: 0,
  actors: [
    {
      id: actorId,
      kind: 2,
      role: "boss",
      position: { x: 1, y: 1 },
    },
    { id: "def_1", kind: 2, role: "defender", position: { x: 2, y: 1 } },
  ],
  tiles: {
    kinds: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  },
};

persona.advance({
  phase: TickPhases.OBSERVE,
  event: "observe",
  payload: {
    actorId,
    initialState,
    observation,
    baseTiles: [
      "...",
      "...",
      "..E",
    ],
  },
  tick: 0,
});
persona.advance({
  phase: TickPhases.DECIDE,
  event: "decide",
  payload: { actorId, initialState },
  tick: 0,
});
const result = persona.advance({
  phase: TickPhases.DECIDE,
  event: "propose",
  payload: {
    actorId,
    initialState,
  },
  tick: 1,
});

assert.equal(result.effects.length, 1);
assert.equal(result.effects[0].kind, "solver_request");
assert.equal(result.effects[0].targetAdapter, "ollama");
assert.equal(result.effects[0].request.options.engine, "custom");
assert.equal(result.effects[0].request.problem.data.providerPolicy.preferred, "llm");
assert.equal(result.effects[0].request.problem.data.providerPolicy.liveLlmMode, "manual_nondeterministic");
assert.equal(result.effects[0].request.problem.data.providerPolicy.model, "phi4-mini");
`;
  runEsm(script);
});

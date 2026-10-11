const assert = require("node:assert/strict");

test("buildRuntimeDecisionEnvelope normalizes actor context and candidate actions", async () => {
  const {
    buildRuntimeDecisionEnvelope,
    RUNTIME_DECISION_CONTRACT,
    RUNTIME_DECISION_LLM_LIVE_MODE,
  } = await import(
    "../../packages/runtime/src/personas/_shared/runtime-decision.mts"
  );

  const envelope = buildRuntimeDecisionEnvelope({
    tick: 3,
    actor: { id: "actor_1", role: "delver" },
    visibleActors: [{ id: "def_1", role: "warden" }],
    hazards: [{ kind: "hazard", position: { x: 1, y: 2 } }],
    candidateActions: [
      {
        id: "move_north",
        action: { kind: "move", params: { target: { x: 1, y: 1 } } },
      },
      {
        kind: "wait",
        params: {},
      },
    ],
  });

  assert.equal(envelope.contract, RUNTIME_DECISION_CONTRACT);
  assert.equal(envelope.tick, 3);
  assert.equal(envelope.actor.id, "actor_1");
  assert.equal(envelope.candidateActions.length, 2);
  assert.equal(envelope.candidateActions[0].action.schema, "agent-kernel/Action");
  assert.equal(envelope.candidateActions[0].action.actorId, "actor_1");
  assert.deepEqual(envelope.candidateActions[0].action.params, { target: { x: 1, y: 1 } });
  assert.equal(envelope.candidateActions[0].action.tick, 3);
  assert.equal(envelope.candidateActions[1].id, "candidate_2");
  assert.equal(envelope.providerPolicy.preferred, "solver");
  assert.equal(envelope.providerPolicy.liveLlmMode, RUNTIME_DECISION_LLM_LIVE_MODE.deferredOnly);
});

test("runtime decision provider policy only allows live Ollama in explicit manual mode", async () => {
  const {
    RUNTIME_DECISION_LLM_LIVE_MODE,
    allowsLiveLlmRuntime,
    resolveRuntimeDecisionProviderPolicy,
  } = await import(
    "../../packages/runtime/src/personas/_shared/runtime-decision.mts"
  );

  const defaultPolicy = resolveRuntimeDecisionProviderPolicy();
  assert.equal(defaultPolicy.preferred, "solver");
  assert.equal(defaultPolicy.liveLlmMode, RUNTIME_DECISION_LLM_LIVE_MODE.deferredOnly);
  assert.equal(defaultPolicy.allowLlmFallback, false);
  assert.equal(defaultPolicy.requireDeterministicFulfillment, true);
  assert.equal(allowsLiveLlmRuntime(defaultPolicy), false);

  const manualPolicy = resolveRuntimeDecisionProviderPolicy({
    mode: "llm",
    preferred: "llm",
    liveLlmMode: "manual_nondeterministic",
    allowLlmFallback: false,
  });
  assert.equal(manualPolicy.liveLlmMode, RUNTIME_DECISION_LLM_LIVE_MODE.manualNondeterministic);
  assert.equal(manualPolicy.requireDeterministicFulfillment, false);
  assert.equal(allowsLiveLlmRuntime(manualPolicy), true);
});

test("buildRuntimeDecisionEnvelope validates and clones Actor objective rows", async () => {
  const { buildRuntimeDecisionEnvelope } = await import(
    "../../packages/runtime/src/personas/_shared/runtime-decision.mts"
  );
  const actorDecision = {
    contract: "actor-decision-objective-v1",
    order: ["primary", "stableTieBreak"],
    candidates: [{
      candidateActionId: "wait_here",
      rank: [100, 0],
      features: { actionKind: "wait" },
      rationaleTags: ["wait"],
    }],
  };
  const envelope = buildRuntimeDecisionEnvelope({
    actor: { id: "actor_1" },
    candidateActions: [{ id: "wait_here", action: { kind: "wait", params: {} } }],
    objectives: { actorDecision },
  });

  assert.deepEqual(envelope.objectives.actorDecision, actorDecision);
  assert.notStrictEqual(envelope.objectives.actorDecision, actorDecision);
  assert.notStrictEqual(envelope.objectives.actorDecision.candidates[0], actorDecision.candidates[0]);
  actorDecision.candidates[0].rank[0] = 0;
  assert.equal(envelope.objectives.actorDecision.candidates[0].rank[0], 100);

  const malformed = buildRuntimeDecisionEnvelope({
    actor: { id: "actor_1" },
    candidateActions: [{ id: "wait_here", action: { kind: "wait", params: {} } }],
    objectives: {
      primary: "advance_to_exit",
      actorDecision: { ...actorDecision, candidates: [] },
    },
  });
  assert.equal(malformed.objectives.primary, "advance_to_exit");
  assert.equal(malformed.objectives.actorDecision, undefined);
});

test("captured LLM runtime decision resolves to an action without a live provider", async () => {
  const {
    buildRuntimeDecisionEnvelope,
    resolveActionFromLlmCapture,
  } = await import(
    "../../packages/runtime/src/personas/_shared/runtime-decision.mts"
  );
  const { buildLlmCaptureArtifact } = await import(
    "../../packages/runtime/src/personas/orchestrator/llm-capture.js"
  );

  const requestEnvelope = buildRuntimeDecisionEnvelope({
    tick: 9,
    actor: { id: "actor_llm", role: "boss" },
    providerPolicy: {
      mode: "llm",
      preferred: "llm",
      allowLlmFallback: false,
      requireDeterministicFulfillment: false,
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
  });

  const captureResult = buildLlmCaptureArtifact({
    prompt: "Choose the next action.",
    responseText: JSON.stringify({
      decision: {
        contract: "runtime-decision-v1",
        decisionKind: "next_move",
        selectedActionId: "cast_dark_bolt",
        selectedTargetId: "def_1",
        confidence: 0.73,
      },
    }),
    responseParsed: {
      decision: {
        contract: "runtime-decision-v1",
        decisionKind: "next_move",
        selectedActionId: "cast_dark_bolt",
        selectedTargetId: "def_1",
        confidence: 0.73,
      },
    },
    requestEnvelope,
    model: "fixture",
    runId: "run_llm_runtime_decision",
    clock: () => "2026-03-15T00:00:00Z",
  });

  assert.equal(captureResult.errors, undefined);
  assert.deepEqual(captureResult.capture.payload.requestEnvelope, requestEnvelope);

  const resolved = resolveActionFromLlmCapture({ captureArtifact: captureResult.capture });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.decision.selectedActionId, "cast_dark_bolt");
  assert.equal(resolved.action.kind, "custom");
  assert.equal(resolved.action.actorId, "actor_llm");
  assert.equal(resolved.action.tick, 9);
  assert.equal(resolved.action.params.abilityId, "dark_bolt");
  assert.equal(resolved.action.params.targetId, "def_1");
});

test("shared runtime-decision reader projects live actor records and drops legacy collections", async () => {
  const {
    buildRuntimeDecisionEnvelope,
    buildRuntimeDecisionLlmPrompt,
  } = await import(
    "../../packages/runtime/src/personas/_shared/runtime-decision.mts"
  );

  const actor = {
    id: "actor_1",
    role: "delver",
    kind: 2,
    alignment: "external",
    position: { x: 1, y: 1 },
    lifecycle: "alive",
    defeatVital: "health",
    vitals: { mana: { current: 4, max: 8, regen: 0 } },
    capabilities: { canMove: true, canCast: true },
    motivations: ["attacking"],
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    activeAffinityKey: "fire:push",
    holdings: [],
    affinityGrants: [{ kind: "water", expression: "emit", stacks: 2 }],
    vitalEffects: [{ kind: "fire", amount: 3 }],
    motivationProfile: { mobilityTier: 2 },
  };
  const visible = {
    id: "warden_1",
    role: "warden",
    kind: "hazard",
    alignment: "dungeon",
    position: { x: 2, y: 1 },
    lifecycle: "alive",
    defeatVital: "durability",
    vitals: { durability: { current: 3, max: 3, regen: 0 } },
    affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
    activeAffinityKey: "fire:emit",
    hostile: true,
    affinityGrants: [{ kind: "fire", expression: "emit", stacks: 9 }],
  };

  const envelope = buildRuntimeDecisionEnvelope({
    tick: 4,
    actor,
    visibleActors: [visible],
    hazards: [{ id: "hazard_1", kind: "hazard", position: { x: 0, y: 1 } }],
    candidateActions: [{ id: "wait_here", action: { kind: "wait" } }],
  });

  assert.equal(Object.hasOwn(envelope, "hazards"), false);
  assert.equal(Object.hasOwn(envelope.actor, "role"), false);
  assert.equal(Object.hasOwn(envelope.actor, "kind"), false);
  assert.equal(Object.hasOwn(envelope.actor, "affinityGrants"), false);
  assert.equal(Object.hasOwn(envelope.actor, "vitalEffects"), false);
  assert.equal(envelope.actor.alignment, "external");
  assert.equal(envelope.actor.activeAffinityKey, "fire:push");
  assert.deepEqual(envelope.actor.motivationProfile, { mobilityTier: 2 });
  assert.equal(Object.hasOwn(envelope.visibleActors[0], "kind"), false);
  assert.equal(Object.hasOwn(envelope.visibleActors[0], "role"), false);
  assert.equal(Object.hasOwn(envelope.visibleActors[0], "affinityGrants"), false);
  assert.equal(envelope.visibleActors[0].hostile, true);
  assert.equal(envelope.visibleActors[0].lifecycle, "alive");

  envelope.actor.vitals.mana.current = 0;
  envelope.visibleActors[0].position.x = 99;
  assert.equal(actor.vitals.mana.current, 4);
  assert.equal(visible.position.x, 2);

  const prompt = buildRuntimeDecisionLlmPrompt({ requestEnvelope: envelope });
  assert.equal(prompt.includes("\"hazards\""), false);
  assert.equal(prompt.includes("affinityGrants"), false);
});

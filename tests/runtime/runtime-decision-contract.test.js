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
        action: { kind: "move", params: { to: { x: 1, y: 1 } } },
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

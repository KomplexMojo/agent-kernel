const assert = require("node:assert/strict");
// CR.7 / WP-5: the session REQUIRES the Director's cardSet builder injected and no longer
// imports `director/summary-selections.js`. Wired from the shared helper so tests wire what
// production wires — a stub here would be the second implementation the refusal prevents.
const { directorBuildCapabilities } = require("../../helpers/orchestrator-capabilities.js");
const { configuratorRoomGeometry } = require("../../helpers/configurator-capabilities.js");

test("orchestrator llm session captures prompt/response", async () => {
  const { runLlmSession } = await import(
    "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );
  const { createLlmTestAdapter } = await import(
    "../../../packages/adapters-test/src/adapters/llm/index.js"
  );

  const adapter = createLlmTestAdapter();
  const prompt = "Return JSON only.";
  const responseRaw = JSON.stringify({ dungeonAffinity: "fire", rooms: [], actors: [] });
  adapter.setResponse("fixture", prompt, { response: responseRaw, done: true });

  const result = await runLlmSession({
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,adapter,
    model: "fixture",
    prompt,
    runId: "run_llm_session",
    clock: () => "2025-01-01T00:00:00Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.prompt, prompt);
  assert.equal(result.responseText, responseRaw);
  assert.equal(result.summary.dungeonAffinity, "fire");
  assert.equal(result.capture.schema, "agent-kernel/CapturedInputArtifact");
  assert.equal(result.capture.meta.runId, "run_llm_session");
  assert.equal(result.capture.payload.prompt, prompt);
  assert.equal(result.capture.payload.responseRaw, responseRaw);
  assert.equal(result.capture.payload.responseParsed.dungeonAffinity, "fire");
  assert.equal(result.capture.payload.summary.dungeonAffinity, "fire");
  assert.equal(result.capture.payload.phaseTiming.startedAt, "2025-01-01T00:00:00Z");
  assert.equal(result.capture.payload.phaseTiming.endedAt, "2025-01-01T00:00:00Z");
  assert.equal(result.capture.payload.phaseTiming.durationMs, 0);
});

test("orchestrator llm session honors strict vs resilient parsing", async () => {
  const { runLlmSession } = await import(
    "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );
  const { createLlmTestAdapter } = await import(
    "../../../packages/adapters-test/src/adapters/llm/index.js"
  );

  const prompt = "Return JSON only.";
  const responseRaw = JSON.stringify({
    rooms: [
      {
        motivation: "stationary",
        affinity: "fire",
        count: 1,
        affinities: [{ kind: "push", expression: "fire", stacks: 1 }],
      },
    ],
    actors: [],
  });

  const strictAdapter = createLlmTestAdapter();
  strictAdapter.setResponse("fixture", prompt, { response: responseRaw, done: true });
  const strictResult = await runLlmSession({
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,adapter: strictAdapter,
    model: "fixture",
    prompt,
    runId: "run_llm_strict",
    clock: () => "2025-01-01T00:00:00Z",
    strict: true,
  });
  assert.equal(strictResult.ok, false);
  assert.ok(strictResult.errors.length > 0);
  assert.equal(strictResult.summary, null);
  assert.equal(strictResult.capture.payload.responseRaw, responseRaw);

  const resilientAdapter = createLlmTestAdapter();
  resilientAdapter.setResponse("fixture", prompt, { response: responseRaw, done: true });
  const resilientResult = await runLlmSession({
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,adapter: resilientAdapter,
    model: "fixture",
    prompt,
    runId: "run_llm_resilient",
    clock: () => "2025-01-01T00:00:00Z",
    strict: false,
  });
  assert.equal(resilientResult.ok, true);
  assert.equal(resilientResult.sanitized, true);
  assert.equal(resilientResult.summary.rooms.length, 1);
  assert.deepEqual(resilientResult.summary.rooms[0].affinities[0], {
    kind: "fire",
    expression: "push",
    stacks: 1,
  });
});

test("orchestrator llm session enforces non-empty summary when configured", async () => {
  const { runLlmSession } = await import(
    "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );
  const { createLlmTestAdapter } = await import(
    "../../../packages/adapters-test/src/adapters/llm/index.js"
  );

  const adapter = createLlmTestAdapter();
  const prompt = "Return JSON only.";
  const repairPrompt = "Fix JSON.";
  const emptyResponse = JSON.stringify({ dungeonAffinity: "fire", rooms: [], actors: [] });
  const fixedResponse = JSON.stringify({
    dungeonAffinity: "fire",
    rooms: [{ motivation: "stationary", affinity: "fire", count: 1 }],
    actors: [{ motivation: "attacking", affinity: "fire", count: 1 }],
  });
  adapter.setResponse("fixture", prompt, { response: emptyResponse, done: true });
  adapter.setResponse("fixture", repairPrompt, { response: fixedResponse, done: true });

  const result = await runLlmSession({
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,adapter,
    model: "fixture",
    prompt,
    runId: "run_llm_require_summary",
    clock: () => "2025-01-01T00:00:00Z",
    requireSummary: { minRooms: 1, minActors: 1 },
    repairPromptBuilder: () => repairPrompt,
  });

  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.equal(result.summary.rooms.length, 1);
  assert.equal(result.summary.actors.length, 1);
});

test("orchestrator llm session captures phase metadata", async () => {
  const { runLlmSession } = await import(
    "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );
  const { createLlmTestAdapter } = await import(
    "../../../packages/adapters-test/src/adapters/llm/index.js"
  );

  const adapter = createLlmTestAdapter();
  const prompt = "Phase prompt";
  const responseRaw = JSON.stringify({ phase: "layout_only", layout: { floorTiles: 1, hallwayTiles: 0 } });
  adapter.setResponse("fixture", prompt, { response: responseRaw, done: true });

  const result = await runLlmSession({
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,adapter,
    model: "fixture",
    prompt,
    runId: "run_llm_phase",
    clock: () => "2025-01-01T00:00:00Z",
    phase: "layout_only",
  });

  assert.equal(result.ok, true);
  assert.equal(result.capture.payload.phase, "layout_only");
});

test("orchestrator llm session expands repair output budget when actor response is truncated", async () => {
  const { runLlmSession } = await import(
    "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );

  const calls = [];
  const responses = [
    {
      response: '{"phase":"actors_only","actors":[{"motivation":"patrolling","affinity":"wind","count":1',
      done: true,
    },
    {
      response: JSON.stringify({
        phase: "actors_only",
        actors: [{
          motivation: "patrolling",
          affinity: "wind",
          count: 1,
          vitals: {
            health: { current: 8, max: 8, regen: 0 },
            mana: { current: 4, max: 4, regen: 1 },
            stamina: { current: 4, max: 4, regen: 1 },
            durability: { current: 2, max: 2, regen: 0 },
          },
        }],
        missing: [],
        stop: "done",
      }),
      done: true,
    },
  ];

  const adapter = {
    async generate(payload) {
      calls.push(payload);
      return responses.shift();
    },
  };

  const result = await runLlmSession({
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,adapter,
    model: "fixture",
    prompt: "actors prompt",
    runId: "run_llm_session_repair_budget",
    clock: () => "2025-01-01T00:00:00Z",
    phase: "actors_only",
    options: { num_predict: 180 },
    requireSummary: { minActors: 1 },
    repairPromptBuilder: () => "repair prompt",
  });

  assert.equal(result.ok, true);
  assert.equal(result.retried, true);
  assert.equal(result.repaired, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.num_predict, 180);
  assert.ok(calls[1].options.num_predict >= 320);
  assert.equal(result.summary.actors.length, 1);
});

test("orchestrator llm session sanitizes invalid defender token hints and stamina regen", async () => {
  const { runLlmSession } = await import(
    "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );
  const { createLlmTestAdapter } = await import(
    "../../../packages/adapters-test/src/adapters/llm/index.js"
  );

  const adapter = createLlmTestAdapter();
  const prompt = "actors sanitize prompt";
  const responseRaw = JSON.stringify({
    phase: "actors_only",
    actors: [
      {
        motivation: "attacking",
        affinity: "fire",
        count: 1,
        tokenHint: 0,
        vitals: {
          health: { current: 8, max: 8, regen: 0 },
          mana: { current: 4, max: 4, regen: 1 },
          stamina: { current: 4, max: 4, regen: 0 },
          durability: { current: 2, max: 2, regen: 0 },
        },
      },
    ],
    missing: [],
    stop: "done",
  });
  adapter.setResponse("fixture", prompt, { response: responseRaw, done: true });

  const result = await runLlmSession({
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,adapter,
    model: "fixture",
    prompt,
    runId: "run_llm_session_actor_sanitize",
    clock: () => "2025-01-01T00:00:00Z",
    phase: "actors_only",
    strict: false,
    requireSummary: { minActors: 1 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.sanitized, true);
  assert.equal(result.summary.actors.length, 1);
  assert.equal(result.summary.actors[0].tokenHint, undefined);
  assert.equal(result.summary.actors[0].vitals.stamina.regen, 1);
});

test("orchestrator llm session recovers defender JSON with trailing commas", async () => {
  const { runLlmSession } = await import(
    "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );
  const { createLlmTestAdapter } = await import(
    "../../../packages/adapters-test/src/adapters/llm/index.js"
  );

  const adapter = createLlmTestAdapter();
  const prompt = "lenient defender recovery prompt";
  const responseRaw = [
    "{",
    '  "phase": "actors_only",',
    '  "actors": {',
    '    "motivation": "attacking",',
    '    "affinity": "water",',
    '    "count": 1,',
    '    "tokenHint": "40",',
    '    "vitals": {',
    '      "health": {"current": 8, "max": 8, "regen": 0},',
    '      "mana": {"current": 6, "max": 6, "regen": 1},',
    '      "stamina": {"current": 4, "max": 4, "regen": 1},',
    '      "durability": {"current": 2, "max": 2, "regen": 0}',
    '    }',
    '  },',
    '  "missing": [],',
    '}',
  ].join("\n");
  adapter.setResponse("fixture", prompt, { response: responseRaw, done: true });

  const result = await runLlmSession({
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,adapter,
    model: "fixture",
    prompt,
    runId: "run_llm_session_lenient_defender_recovery",
    clock: () => "2025-01-01T00:00:00Z",
    phase: "actors_only",
    strict: false,
    requireSummary: { minActors: 1 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.sanitized, true);
  assert.equal(result.summary.phase, "actors_only");
  assert.equal(result.summary.actors.length, 1);
  assert.equal(result.summary.actors[0].motivation, "attacking");
  assert.equal(result.summary.actors[0].affinity, "water");
  assert.equal(result.summary.actors[0].tokenHint, 40);
});

test("orchestrator llm session supports AI summary to card model to build spec round-trip", async () => {
  const { runLlmSession } = await import(
    "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );
  const { createLlmTestAdapter } = await import(
    "../../../packages/adapters-test/src/adapters/llm/index.js"
  );
  const { extractSummaryFromCardSet } = await import(
    "../../../packages/runtime/src/personas/director/summary-selections.js"
  );
  const { buildBuildSpecFromSummary } = await import(
    "../../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );

  const adapter = createLlmTestAdapter();
  const prompt = "Generate summary for card round-trip.";
  adapter.setResponse("fixture", prompt, {
    response: JSON.stringify({
      dungeonAffinity: "water",
      rooms: [{ motivation: "stationary", affinity: "water", count: 2, size: "small" }],
      actors: [{ motivation: "defending", affinity: "earth", count: 1 }],
      attackerConfigs: [{
        setupMode: "hybrid",
        vitalsMax: { health: 8, mana: 6, stamina: 5, durability: 3 },
        vitalsRegen: { health: 1, mana: 1, stamina: 1, durability: 0 },
        affinities: { water: ["emit"] },
        affinityStacks: { water: 2 },
      }],
    }),
    done: true,
  });

  const result = await runLlmSession({
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,adapter,
    model: "fixture",
    prompt,
    runId: "run_llm_card_roundtrip",
    clock: () => "2025-01-01T00:00:00Z",
    strict: false,
  });

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.cardSet));
  assert.ok(result.cardSet.length >= 2);

  const editedCardSet = result.cardSet.map((card) => {
    if (card.type !== "warden" && card.type !== "defender") return card;
    return {
      ...card,
      affinities: [...(card.affinities || []), { kind: "fire", expression: "push", stacks: 1 }],
    };
  });

  // D8.3 — room cards mean Configurator geometry, injected as production injects it.
  const summaryFromCards = extractSummaryFromCardSet({
    dungeonAffinity: "water",
    budgetTokens: 1200,
    cardSet: editedCardSet,
  }, await configuratorRoomGeometry());
  const built = buildBuildSpecFromSummary({
    summary: summaryFromCards,
    // The resolved summary still carries its cardSet, so the assembler resolves it again.
    roomGeometry: await configuratorRoomGeometry(),
    runId: "run_llm_card_roundtrip",
    source: "test",
    createdAt: "2025-01-01T00:00:00Z",
  });

  assert.equal(built.ok, true);
  assert.ok(Array.isArray(built.spec.plan.hints.cardSet));
  assert.ok(built.spec.configurator.inputs.levelGen);
  assert.ok(built.spec.configurator.inputs.actors.length >= 1);
});

/**
 * CR.7 / WP-5 — the session REFUSES without the Director's cardSet builder.
 *
 * The mirror of the round's refusal test, and it exists for the same reason: every other
 * session test in this file now supplies the capability, so a default added later would keep
 * them all green while returning the Orchestrator to authoring the Director's artifact.
 *
 * ⚠️ RETURNED, NOT THROWN — the asymmetry with `createLlmRound` is deliberate and is what
 * `commands/llm-host.js` documents: the session reports a bad precondition as
 * `{ ok: false, errors, capture: null }` where the round throws. Asserting the SHAPE here is
 * what stops the two from being quietly unified in one direction or the other.
 */
test("runLlmSession refuses without the Director's cardSet builder, and never calls the adapter", async () => {
  const { runLlmSession } = await import(
    "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );

  const calls = [];
  const adapter = {
    async generate(args) {
      calls.push(args);
      return { response: JSON.stringify({ dungeonAffinity: "fire", rooms: [], actors: [] }) };
    },
  };

  const result = await runLlmSession({
    adapter,
    model: "fixture",
    prompt: "Return JSON only.",
    phase: "layout_only",
    runId: "run_session_refusal",
    clock: () => "2025-01-01T00:00:00Z",
    // buildCardSet deliberately absent
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.code === "missing_card_set_builder"),
    `expected missing_card_set_builder, got ${JSON.stringify(result.errors)}`,
  );
  assert.equal(result.capture, null, "a refused precondition captures no exchange");
  assert.equal(calls.length, 0, "the refusal short-circuits BEFORE any adapter call");
});

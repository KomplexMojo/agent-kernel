const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const sessionModulePath = moduleUrl("packages/runtime/src/personas/orchestrator/llm-session.js");
const llmAdapterPath = moduleUrl("packages/adapters-test/src/adapters/llm/index.js");
const summarySelectionsPath = moduleUrl("packages/runtime/src/personas/director/summary-selections.js");
const buildspecAssemblerPath = moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js");

const happyScript = `
import assert from "node:assert/strict";
import { runLlmSession } from ${JSON.stringify(sessionModulePath)};
import { createLlmTestAdapter } from ${JSON.stringify(llmAdapterPath)};

const adapter = createLlmTestAdapter();
const prompt = "Return JSON only.";
const responseRaw = JSON.stringify({ dungeonAffinity: "fire", rooms: [], actors: [] });
adapter.setResponse("fixture", prompt, { response: responseRaw, done: true });

const result = await runLlmSession({
  adapter,
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
`;

const strictScript = `
import assert from "node:assert/strict";
import { runLlmSession } from ${JSON.stringify(sessionModulePath)};
import { createLlmTestAdapter } from ${JSON.stringify(llmAdapterPath)};

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
  adapter: strictAdapter,
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
  adapter: resilientAdapter,
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
`;

const requireSummaryScript = `
import assert from "node:assert/strict";
import { runLlmSession } from ${JSON.stringify(sessionModulePath)};
import { createLlmTestAdapter } from ${JSON.stringify(llmAdapterPath)};

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
  adapter,
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
`;

const phaseScript = `
import assert from "node:assert/strict";
import { runLlmSession } from ${JSON.stringify(sessionModulePath)};
import { createLlmTestAdapter } from ${JSON.stringify(llmAdapterPath)};

const adapter = createLlmTestAdapter();
const prompt = "Phase prompt";
const responseRaw = JSON.stringify({ phase: "layout_only", layout: { floorTiles: 1, hallwayTiles: 0 } });
adapter.setResponse("fixture", prompt, { response: responseRaw, done: true });

const result = await runLlmSession({
  adapter,
  model: "fixture",
  prompt,
  runId: "run_llm_phase",
  clock: () => "2025-01-01T00:00:00Z",
  phase: "layout_only",
});

assert.equal(result.ok, true);
assert.equal(result.capture.payload.phase, "layout_only");
`;

const repairBudgetExpansionScript = `
import assert from "node:assert/strict";
import { runLlmSession } from ${JSON.stringify(sessionModulePath)};

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
  adapter,
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
`;

const actorsSanitizationScript = `
import assert from "node:assert/strict";
import { runLlmSession } from ${JSON.stringify(sessionModulePath)};
import { createLlmTestAdapter } from ${JSON.stringify(llmAdapterPath)};

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
  adapter,
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
`;

const lenientDefenderRecoveryScript = `
import assert from "node:assert/strict";
import { runLlmSession } from ${JSON.stringify(sessionModulePath)};
import { createLlmTestAdapter } from ${JSON.stringify(llmAdapterPath)};

const adapter = createLlmTestAdapter();
const prompt = "lenient defender recovery prompt";
const responseRaw = [
  "{",
  "  \\"phase\\": \\"actors_only\\",",
  "  \\"actors\\": {",
  "    \\"motivation\\": \\"attacking\\",",
  "    \\"affinity\\": \\"water\\",",
  "    \\"count\\": 1,",
  "    \\"tokenHint\\": \\"40\\",",
  "    \\"vitals\\": {",
  "      \\"health\\": {\\"current\\": 8, \\"max\\": 8, \\"regen\\": 0},",
  "      \\"mana\\": {\\"current\\": 6, \\"max\\": 6, \\"regen\\": 1},",
  "      \\"stamina\\": {\\"current\\": 4, \\"max\\": 4, \\"regen\\": 1},",
  "      \\"durability\\": {\\"current\\": 2, \\"max\\": 2, \\"regen\\": 0}",
  "    }",
  "  },",
  "  \\"missing\\": [],",
  "}",
].join("\\n");
adapter.setResponse("fixture", prompt, { response: responseRaw, done: true });

const result = await runLlmSession({
  adapter,
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
`;

const cardRoundTripScript = `
import assert from "node:assert/strict";
import { runLlmSession } from ${JSON.stringify(sessionModulePath)};
import { createLlmTestAdapter } from ${JSON.stringify(llmAdapterPath)};
import { extractSummaryFromCardSet } from ${JSON.stringify(summarySelectionsPath)};
import { buildBuildSpecFromSummary } from ${JSON.stringify(buildspecAssemblerPath)};

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
  adapter,
  model: "fixture",
  prompt,
  runId: "run_llm_card_roundtrip",
  clock: () => "2025-01-01T00:00:00Z",
  strict: false,
});

assert.equal(result.ok, true);
assert.ok(Array.isArray(result.cardSet));
assert.ok(result.cardSet.length >= 3);

const editedCardSet = result.cardSet.map((card) => {
  if (card.type !== "defender") return card;
  return {
    ...card,
    affinities: [...(card.affinities || []), { kind: "fire", expression: "push", stacks: 1 }],
  };
});

const summaryFromCards = extractSummaryFromCardSet({
  dungeonAffinity: "water",
  budgetTokens: 1200,
  cardSet: editedCardSet,
});
const built = buildBuildSpecFromSummary({
  summary: summaryFromCards,
  runId: "run_llm_card_roundtrip",
  source: "test",
  createdAt: "2025-01-01T00:00:00Z",
});

assert.equal(built.ok, true);
assert.ok(Array.isArray(built.spec.plan.hints.cardSet));
assert.ok(built.spec.configurator.inputs.levelGen);
assert.ok(built.spec.configurator.inputs.actors.length >= 1);
`;

test("orchestrator llm session captures prompt/response", () => {
  runEsm(happyScript);
});

test("orchestrator llm session honors strict vs resilient parsing", () => {
  runEsm(strictScript);
});

test("orchestrator llm session enforces non-empty summary when configured", () => {
  runEsm(requireSummaryScript);
});

test("orchestrator llm session captures phase metadata", () => {
  runEsm(phaseScript);
});

test("orchestrator llm session expands repair output budget when actor response is truncated", () => {
  runEsm(repairBudgetExpansionScript);
});

test("orchestrator llm session sanitizes invalid defender token hints and stamina regen", () => {
  runEsm(actorsSanitizationScript);
});

test("orchestrator llm session recovers defender JSON with trailing commas", () => {
  runEsm(lenientDefenderRecoveryScript);
});

test("orchestrator llm session supports AI summary to card model to build spec round-trip", () => {
  runEsm(cardRoundTripScript);
});

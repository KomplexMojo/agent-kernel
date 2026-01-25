const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const sessionModulePath = moduleUrl("packages/runtime/src/personas/orchestrator/llm-session.js");
const llmAdapterPath = moduleUrl("packages/adapters-test/src/adapters/llm/index.js");

const happyScript = `
import assert from "node:assert/strict";
import { runLlmSession } from ${JSON.stringify(sessionModulePath)};
import { createLlmTestAdapter } from ${JSON.stringify(llmAdapterPath)};

const adapter = createLlmTestAdapter();
const prompt = "Return JSON only.";
const responseRaw = JSON.stringify({ dungeonTheme: "fire", rooms: [], actors: [] });
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
assert.equal(result.summary.dungeonTheme, "fire");
assert.equal(result.capture.schema, "agent-kernel/CapturedInputArtifact");
assert.equal(result.capture.meta.runId, "run_llm_session");
assert.equal(result.capture.payload.prompt, prompt);
assert.equal(result.capture.payload.responseRaw, responseRaw);
assert.equal(result.capture.payload.responseParsed.dungeonTheme, "fire");
assert.equal(result.capture.payload.summary.dungeonTheme, "fire");
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
const emptyResponse = JSON.stringify({ dungeonTheme: "fire", rooms: [], actors: [] });
const fixedResponse = JSON.stringify({
  dungeonTheme: "fire",
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

test("orchestrator llm session captures prompt/response", () => {
  runEsm(happyScript);
});

test("orchestrator llm session honors strict vs resilient parsing", () => {
  runEsm(strictScript);
});

test("orchestrator llm session enforces non-empty summary when configured", () => {
  runEsm(requireSummaryScript);
});

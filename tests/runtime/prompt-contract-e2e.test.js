const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const fixturePath = resolve(__dirname, "../fixtures/e2e/llm-summary-response.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("prompt/response fixture parses and matches summary contract", async () => {
  const { buildMenuPrompt, capturePromptResponse, normalizeSummary } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );

  const fixture = readJson(fixturePath);
  const scenario = readJson(resolve(__dirname, "../fixtures/e2e/e2e-scenario-v1-basic.json"));
  const expectedSummary = readJson(resolve(__dirname, "../..", scenario.summaryPath));
  assert.ok(typeof fixture.prompt === "string" && fixture.prompt.length > 0);
  assert.ok(typeof fixture.responseRaw === "string" && fixture.responseRaw.length > 0);
  assert.ok(fixture.prompt.includes("Budget tokens: 800"));

  const expectedPrompt = buildMenuPrompt({
    goal: scenario.goal,
    budgetTokens: scenario.budgetTokens,
  });
  assert.equal(fixture.prompt, expectedPrompt);

  const capture = capturePromptResponse({
    prompt: fixture.prompt,
    responseText: fixture.responseRaw,
  });

  assert.equal(capture.errors.length, 0);
  assert.deepEqual(capture.responseParsed, fixture.responseParsed);
  assert.deepEqual(capture.summary, fixture.responseParsed);
  assert.deepEqual(capture.summary, expectedSummary);

  const normalized = normalizeSummary(fixture.responseParsed);
  assert.equal(normalized.ok, true);
});

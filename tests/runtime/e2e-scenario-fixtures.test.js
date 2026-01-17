const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const FIXTURES_DIR = resolve(ROOT, "tests/fixtures/e2e");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("e2e scenario fixtures load and summary matches prompt contract", async () => {
  const scenarioFiles = readdirSync(FIXTURES_DIR)
    .filter((name) => name.startsWith("e2e-scenario-") && name.endsWith(".json"))
    .sort();

  assert.ok(scenarioFiles.length > 0);

  const { normalizeSummary } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );

  scenarioFiles.forEach((name) => {
    const scenarioPath = resolve(FIXTURES_DIR, name);
    const scenario = readJson(scenarioPath);

    assert.equal(scenario.schema, "agent-kernel/E2EScenario");
    assert.equal(scenario.schemaVersion, 1);
    assert.ok(typeof scenario.goal === "string" && scenario.goal.trim().length > 0);
    assert.ok(Number.isInteger(scenario.tier) && scenario.tier > 0);
    assert.ok(Number.isInteger(scenario.levelSize?.width) && scenario.levelSize.width > 0);
    assert.ok(Number.isInteger(scenario.levelSize?.height) && scenario.levelSize.height > 0);
    assert.ok(Number.isInteger(scenario.actorCount) && scenario.actorCount > 0);
    assert.ok(Number.isInteger(scenario.budgetTokens) && scenario.budgetTokens > 0);
    ["catalogPath", "summaryPath", "expectedSelectionsPath"].forEach((field) => {
      assert.ok(typeof scenario[field] === "string" && scenario[field].length > 0);
    });

    const catalogPath = resolve(ROOT, scenario.catalogPath);
    const summaryPath = resolve(ROOT, scenario.summaryPath);
    const expectedSelectionsPath = resolve(ROOT, scenario.expectedSelectionsPath);

    const catalog = readJson(catalogPath);
    assert.ok(catalog);

    const summary = readJson(summaryPath);
    const normalized = normalizeSummary(summary);
    assert.equal(normalized.ok, true);

    if (normalized.value?.budgetTokens !== undefined) {
      assert.equal(normalized.value.budgetTokens, scenario.budgetTokens);
    }

    const summaryActorCount = normalized.value.actors.reduce((sum, entry) => sum + entry.count, 0);
    assert.equal(summaryActorCount, scenario.actorCount);

    const expectedSelections = readJson(expectedSelectionsPath);
    assert.ok(Array.isArray(expectedSelections.selections));
  });
});

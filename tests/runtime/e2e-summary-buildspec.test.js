const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const scenarioPath = resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function applyBudgetToSelections(selections = []) {
  return selections.map((sel) => {
    const approvedCount = Number.isInteger(sel.approvedCount)
      ? sel.approvedCount
      : sel.requested?.count || sel.instances?.length || 0;
    const instances = Array.isArray(sel.instances) ? sel.instances.slice(0, approvedCount) : sel.instances;
    const requested = sel.requested ? { ...sel.requested, count: approvedCount } : sel.requested;
    const receipt = sel.receipt ? { ...sel.receipt, approvedCount } : sel.receipt;
    return { ...sel, requested, instances, receipt };
  });
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (value && typeof value === "object") {
    const next = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (entry === undefined) return;
      next[key] = stripUndefined(entry);
    });
    return next;
  }
  return value;
}

test("summary -> pool -> budget -> buildspec chain uses fixtures deterministically", async () => {
  const scenario = readJson(scenarioPath);
  const summaryFixture = readJson(resolve(ROOT, scenario.summaryPath));
  const catalog = readJson(resolve(ROOT, scenario.catalogPath));
  const expectedSelections = readJson(resolve(ROOT, scenario.expectedSelectionsPath));

  const { normalizeSummary } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );
  const { mapSummaryToPool } = await import(
    moduleUrl("packages/runtime/src/personas/director/pool-mapper.js")
  );
  const { enforceBudget } = await import(
    moduleUrl("packages/runtime/src/personas/director/budget-enforcer.js")
  );
  const { buildBuildSpecFromSummary } = await import(
    moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js")
  );

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true);

  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);
  assert.deepEqual(stripUndefined(mapped.selections), expectedSelections.selections);

  const enforcement = enforceBudget({ selections: mapped.selections, budgetTokens: normalized.value.budgetTokens });
  assert.ok(enforcement.totalApplied <= normalized.value.budgetTokens);
  assert.equal(enforcement.actions.length, 0);

  const trimmedSelections = applyBudgetToSelections(enforcement.selections);
  const result = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: trimmedSelections,
    runId: "e2e_buildspec",
    createdAt: "2025-01-01T00:00:00Z",
    source: "e2e-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.spec.schema, "agent-kernel/BuildSpec");

  const actorCount = trimmedSelections
    .filter((sel) => sel.kind === "actor")
    .reduce((sum, sel) => sum + (sel.instances?.length || 0), 0);
  assert.equal(result.spec.configurator.inputs.actors.length, actorCount);
});

test("budget enforcement trims selections when budget is tight", async () => {
  const scenario = readJson(scenarioPath);
  const summaryFixture = readJson(resolve(ROOT, scenario.summaryPath));
  const catalog = readJson(resolve(ROOT, scenario.catalogPath));

  const { normalizeSummary } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );
  const { mapSummaryToPool } = await import(
    moduleUrl("packages/runtime/src/personas/director/pool-mapper.js")
  );
  const { enforceBudget } = await import(
    moduleUrl("packages/runtime/src/personas/director/budget-enforcer.js")
  );
  const { buildBuildSpecFromSummary } = await import(
    moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js")
  );

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true);

  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);

  const tightBudget = 200;
  const enforcement = enforceBudget({ selections: mapped.selections, budgetTokens: tightBudget });
  assert.ok(enforcement.totalApplied <= tightBudget);
  assert.ok(enforcement.actions.length > 0);

  const trimmedSelections = applyBudgetToSelections(enforcement.selections);
  const trimmedActorCount = trimmedSelections
    .filter((sel) => sel.kind === "actor")
    .reduce((sum, sel) => sum + (sel.instances?.length || 0), 0);

  const result = buildBuildSpecFromSummary({
    summary: { ...normalized.value, budgetTokens: tightBudget },
    catalog,
    selections: trimmedSelections,
    runId: "e2e_buildspec_tight",
    createdAt: "2025-01-01T00:00:00Z",
    source: "e2e-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.spec.configurator.inputs.actors.length, trimmedActorCount);
});

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function runCliOk(args) {
  const result = runCli(args);
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readStdoutJson(result) {
  return JSON.parse((result.stdout || "").trim());
}

test("cli hazard-plan authors hazards directly from hazard flags", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-hazard-plan-basic-"));
  const result = runCliOk([
    "hazard-plan",
    "--hazard",
    "affinity=fire;expression=emit;proximityRadius=2;mana=regen:4:4:1",
    "--run-id",
    "run_hazard_plan_basic",
    "--created-at",
    "2026-06-29T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  const summary = readStdoutJson(result);

  assert.equal(summary.command, "hazard-plan");
  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "hazard-1.json")), true);

  const spec = readJson(join(outDir, "spec.json"));
  const hazards = spec.configurator?.inputs?.levelGen?.hazards;
  assert.equal(spec.meta.source, "cli-hazard-plan");
  assert.equal(spec.configurator.inputs.levelGen.budgetScaffold, true);
  assert.equal(Array.isArray(hazards), true);
  assert.equal(hazards.length, 1);
  assert.equal(hazards[0].affinity, "fire");
  assert.equal(hazards[0].expression, "emit");
  assert.equal(hazards[0].mana.regen, 1);
  assert.deepEqual(spec.intent.hints.poolWeights, [{ id: "hazards", weight: 1 }]);

  const artifact = readJson(join(outDir, "hazard-1.json"));
  assert.equal(artifact.schema, "agent-kernel/HazardArtifact");
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.meta.producedBy, "cli-hazard-plan");
});

test("cli hazard-plan writes hazard-only budget receipt categories", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-hazard-plan-budget-"));
  runCliOk([
    "hazard-plan",
    "--hazard",
    "affinity=fire;expression=emit;proximityRadius=2;mana=regen:4:4:1",
    "--budget-tokens",
    "200",
    "--run-id",
    "run_hazard_plan_budget",
    "--created-at",
    "2026-06-29T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const receipt = readJson(join(outDir, "budget-receipt.json"));
  assert.equal(receipt.status, "approved");
  assert.equal(receipt.lineItems.every((item) => item.category === "hazards"), true);
  const hazardPool = receipt.poolStatuses.find((pool) => pool.id === "hazards");
  const roomsPool = receipt.poolStatuses.find((pool) => pool.id === "rooms");
  assert.equal(hazardPool.capTokens, 200);
  assert.equal(hazardPool.spentTokens, receipt.totalCost);
  assert.equal(roomsPool.spentTokens, 0);
});

test("cli hazard-plan rejects insufficient hard budget", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-hazard-plan-budget-fail-"));
  const result = runCli([
    "hazard-plan",
    "--hazard",
    "affinity=fire;expression=emit;proximityRadius=2;mana=regen:4:4:1",
    "--budget-tokens",
    "10",
    "--run-id",
    "run_hazard_plan_budget_fail",
    "--created-at",
    "2026-06-29T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Budget receipt denied|budget/i);
  assert.equal(existsSync(join(outDir, "budget-receipt.json")), false);
});

test("cli resource-plan authors V3 resources directly from resource flags", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-resource-plan-basic-"));
  const result = runCliOk([
    "resource-plan",
    "--resource",
    "permanenceMode=permanent;vital=mana;delta=6",
    "--run-id",
    "run_resource_plan_basic",
    "--created-at",
    "2026-06-29T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  const summary = readStdoutJson(result);

  assert.equal(summary.command, "resource-plan");
  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "resource-1.json")), true);

  const spec = readJson(join(outDir, "spec.json"));
  const resources = spec.configurator?.inputs?.resources;
  assert.equal(spec.meta.source, "cli-resource-plan");
  assert.equal(spec.configurator.inputs.levelGen.budgetScaffold, true);
  assert.equal(Array.isArray(resources), true);
  assert.equal(resources.length, 1);
  assert.equal(resources[0].permanenceMode, "permanent");
  assert.deepEqual(resources[0].vitals, [{ key: "mana", delta: 6 }]);
  assert.deepEqual(spec.intent.hints.poolWeights, [{ id: "resources", weight: 1 }]);

  const artifact = readJson(join(outDir, "resource-1.json"));
  assert.equal(artifact.schema, "agent-kernel/ResourceArtifact");
  assert.equal(artifact.schemaVersion, 3);
  assert.equal(artifact.meta.producedBy, "cli-resource-plan");
});

test("cli resource-plan writes resource-only receipt categories and rejects low budgets", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-resource-plan-budget-"));
  runCliOk([
    "resource-plan",
    "--resource",
    "permanenceMode=permanent;vital=mana;delta=6",
    "--budget-tokens",
    "200",
    "--run-id",
    "run_resource_plan_budget",
    "--created-at",
    "2026-06-29T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const receipt = readJson(join(outDir, "budget-receipt.json"));
  assert.equal(receipt.status, "approved");
  assert.equal(receipt.lineItems.every((item) => item.category === "resources"), true);
  const resourcePool = receipt.poolStatuses.find((pool) => pool.id === "resources");
  assert.equal(resourcePool.capTokens, 200);
  assert.equal(resourcePool.spentTokens, receipt.totalCost);

  const failDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-resource-plan-budget-fail-"));
  const result = runCli([
    "resource-plan",
    "--resource",
    "permanenceMode=permanent;vital=mana;delta=6",
    "--budget-tokens",
    "10",
    "--run-id",
    "run_resource_plan_budget_fail",
    "--created-at",
    "2026-06-29T00:00:00.000Z",
    "--out-dir",
    failDir,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Budget receipt denied|budget/i);
  assert.equal(existsSync(join(failDir, "budget-receipt.json")), false);
});

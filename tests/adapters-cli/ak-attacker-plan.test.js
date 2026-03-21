const test = require("node:test");
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

function listAttackerCards(spec) {
  const cardSet = spec?.plan?.hints?.cardSet;
  if (!Array.isArray(cardSet)) return [];
  return cardSet.filter((entry) => entry?.type === "attacker");
}

test("cli attacker-plan authors attacker cards directly from attacker flags", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-basic-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "affinity=fire;motivation=attacking;count=2",
    "--run-id",
    "run_attacker_plan_basic",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "sim-config.json")), true);
  assert.equal(existsSync(join(outDir, "initial-state.json")), true);

  const spec = readJson(join(outDir, "spec.json"));
  assert.equal(spec.meta.runId, "run_attacker_plan_basic");

  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const attacker = cards[0];
  assert.equal(attacker.count, 2);
  assert.equal(attacker.affinity, "fire");
  assert.deepEqual(attacker.motivations, ["attacking"]);
});

test("cli attacker-plan applies default attacker motivation and affinity fallback", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-defaults-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1",
    "--dungeon-affinity",
    "water",
    "--run-id",
    "run_attacker_plan_defaults",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const attacker = cards[0];
  assert.equal(attacker.count, 1);
  assert.equal(attacker.affinity, "water");
  assert.deepEqual(attacker.motivations, ["attacking"]);
});

test("cli attacker-plan supports multiple attacker configurations in one command", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-multi-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "affinity=fire;motivation=attacking;count=2",
    "--attacker",
    "affinity=earth;motivation=patrolling;count=1",
    "--run-id",
    "run_attacker_plan_multi",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 2);

  const byAffinity = new Map(cards.map((card) => [card.affinity, card]));
  assert.equal(byAffinity.get("fire")?.count, 2);
  assert.equal(byAffinity.get("earth")?.count, 1);
  assert.deepEqual(byAffinity.get("earth")?.motivations, ["patrolling"]);
});

test("cli attacker-plan supports advanced affinities, vitals, setup mode, and receipt accounting", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-advanced-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;affinity=fire;motivation=attacking;setup-mode=user;affinities=fire:push:3,wind:emit:2;vitals=health:12:12:1,mana:7:7:2,stamina:6:6:1,durability:5:5:0",
    "--budget",
    "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
    "--price-list",
    "tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
    "--run-id",
    "run_attacker_plan_advanced",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const attacker = cards[0];
  assert.equal(attacker.setupMode, "user");
  assert.deepEqual(attacker.affinities, [
    { kind: "fire", expression: "push", stacks: 3 },
    { kind: "wind", expression: "emit", stacks: 2 },
  ]);
  assert.equal(attacker.vitals.health.max, 12);
  assert.equal(attacker.vitals.mana.regen, 2);

  const initialState = readJson(join(outDir, "initial-state.json"));
  assert.equal(initialState.actors.length, 1);
  const actor = initialState.actors[0];
  assert.equal(actor.vitals.health.max, 12);
  assert.equal(actor.vitals.mana.regen, 2);
  assert.equal(actor.traits.affinities.fire, 3);
  assert.equal(actor.traits.affinities.wind, 2);

  const receipt = readJson(join(outDir, "budget-receipt.json"));
  const byId = new Map(receipt.lineItems.map((item) => [item.id, item]));
  assert.equal(byId.get("affinity_stack")?.quantity, 5);
  assert.equal(byId.get("affinity_expression_externalize")?.quantity, 3);
  assert.equal(byId.get("affinity_expression_localized")?.quantity, 2);
  assert.equal(byId.get("vital_health_point")?.quantity, 12);
  assert.equal(byId.get("vital_mana_regen_tick")?.quantity, 2);
});

test("cli attacker-plan rejects invalid motivation", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "affinity=fire;motivation=berserk;count=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /motivation must be one of/i);
});

test("cli attacker-plan rejects duplicate motivation declarations", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "affinity=fire;attacking;motivation=defending;count=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /motivation may only be specified once/i);
});

test("cli attacker-plan rejects invalid setup mode", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "affinity=fire;setup-mode=manual;count=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /setup-mode must be one of/i);
});

test("cli attacker-plan rejects invalid vital tuple", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "affinity=fire;vitals=health:notanumber:1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /non-negative integer/i);
});

test("cli attacker-plan requires --budget and --price-list together", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "affinity=fire;count=1",
    "--budget",
    "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires both --budget and --price-list/i);
});

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

function readStdoutJson(result) {
  return JSON.parse((result.stdout || "").trim());
}

function listWardenCards(spec) {
  const cardSet = spec?.plan?.hints?.cardSet;
  if (!Array.isArray(cardSet)) return [];
  return cardSet.filter((entry) => entry?.type === "warden");
}

test("cli warden-plan authors warden cards directly from warden flags", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-warden-plan-basic-"));
  const result = runCliOk([
    "warden-plan",
    "--warden",
    "affinity=dark;motivation=defending;count=2",
    "--run-id",
    "run_warden_plan_basic",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  const summary = readStdoutJson(result);

  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "sim-config.json")), true);
  assert.equal(existsSync(join(outDir, "initial-state.json")), true);
  assert.equal(existsSync(join(outDir, "resource-bundle.json")), true);
  assert.equal(summary.preview.ready, true);
  assert.equal(summary.preview.resourceBundlePath, join(outDir, "resource-bundle.json"));
  assert.equal(summary.preview.hasActors, true);
  assert.equal(summary.preview.runReady, false);
  assert.equal(summary.artifactPaths.resource_bundle, join(outDir, "resource-bundle.json"));

  const spec = readJson(join(outDir, "spec.json"));
  const manifest = readJson(join(outDir, "manifest.json"));
  assert.equal(spec.meta.runId, "run_warden_plan_basic");
  assert.ok(manifest.artifacts.some((entry) => entry.path === "resource-bundle.json" && entry.schema === "agent-kernel/ResourceBundleArtifact"));

  const cards = listWardenCards(spec);
  assert.equal(cards.length, 1);
  const warden = cards[0];
  assert.equal(warden.count, 2);
  assert.equal(warden.affinity, "dark");
  assert.deepEqual(warden.motivations, ["defending"]);
});

test("cli warden-plan applies default warden motivation and affinity fallback", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-warden-plan-defaults-"));
  runCliOk([
    "warden-plan",
    "--warden",
    "count=1",
    "--dungeon-affinity",
    "water",
    "--run-id",
    "run_warden_plan_defaults",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listWardenCards(spec);
  assert.equal(cards.length, 1);
  const warden = cards[0];
  assert.equal(warden.count, 1);
  assert.equal(warden.affinity, "water");
  assert.deepEqual(warden.motivations, ["defending"]);
});

test("cli warden-plan keeps defending wardens non-ambulatory by default", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-warden-plan-stationary-defaults-"));
  runCliOk([
    "warden-plan",
    "--warden",
    "count=1;motivation=defending",
    "--run-id",
    "run_warden_plan_stationary_defaults",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const initialState = readJson(join(outDir, "initial-state.json"));
  assert.equal(initialState.actors[0].vitals.stamina.regen, 0);
});

test("cli warden-plan supports multiple warden configurations in one command", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-warden-plan-multi-"));
  runCliOk([
    "warden-plan",
    "--warden",
    "affinity=dark;motivation=defending;count=2",
    "--warden",
    "affinity=earth;motivation=stationary;count=1",
    "--run-id",
    "run_warden_plan_multi",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listWardenCards(spec);
  assert.equal(cards.length, 2);

  const byAffinity = new Map(cards.map((card) => [card.affinity, card]));
  assert.equal(byAffinity.get("dark")?.count, 2);
  assert.equal(byAffinity.get("earth")?.count, 1);
  assert.deepEqual(byAffinity.get("earth")?.motivations, ["stationary"]);
});

test("cli warden-plan supports advanced affinities, vitals, and receipt accounting", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-warden-plan-advanced-"));
  runCliOk([
    "warden-plan",
    "--warden",
    "count=1;affinity=dark;motivation=defending;affinities=dark:emit:4,earth:pull:1;vitals=health:15:15:0,mana:3:3:1,stamina:4:4:1,durability:8:8:0",
    "--budget",
    "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
    "--price-list",
    "tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
    "--run-id",
    "run_warden_plan_advanced",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listWardenCards(spec);
  assert.equal(cards.length, 1);
  const warden = cards[0];
  assert.deepEqual(warden.affinities, [
    { kind: "dark", expression: "emit", stacks: 4 },
    { kind: "earth", expression: "pull", stacks: 1 },
  ]);
  assert.equal(warden.vitals.health.max, 15);
  assert.equal(warden.vitals.stamina.regen, 1);

  const initialState = readJson(join(outDir, "initial-state.json"));
  assert.equal(initialState.actors.length, 1);
  const actor = initialState.actors[0];
  assert.equal(actor.vitals.health.max, 15);
  assert.equal(actor.vitals.stamina.regen, 1);
  assert.equal(actor.traits.affinities.dark, 4);
  assert.equal(actor.traits.affinities.earth, 1);

  const receipt = readJson(join(outDir, "budget-receipt.json"));
  const byId = new Map(receipt.lineItems.map((item) => [item.id, item]));
  assert.equal(byId.get("affinity_stack")?.quantity, 5);
  assert.equal(byId.get("affinity_expression_localized")?.quantity, 4);
  assert.equal(byId.get("affinity_expression_internalize")?.quantity, 1);
  assert.equal(byId.get("vital_health_point")?.quantity, 15);
  assert.equal(byId.get("vital_stamina_regen_tick")?.quantity, 1);
});

test("cli warden-plan rejects invalid motivation", () => {
  const result = runCli([
    "warden-plan",
    "--warden",
    "affinity=dark;motivation=berserk;count=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /motivation must be one of/i);
});

test("cli warden-plan rejects duplicate motivation declarations", () => {
  const result = runCli([
    "warden-plan",
    "--warden",
    "affinity=dark;defending;motivation=attacking;count=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /motivation may only be specified once/i);
});

test("cli warden-plan rejects invalid vital tuple", () => {
  const result = runCli([
    "warden-plan",
    "--warden",
    "affinity=dark;vitals=health:notanumber:1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /non-negative integer/i);
});

test("cli warden-plan requires --budget and --price-list together", () => {
  const result = runCli([
    "warden-plan",
    "--warden",
    "affinity=dark;count=1",
    "--budget",
    "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires both --budget and --price-list/i);
});

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

function listDefenderCards(spec) {
  const cardSet = spec?.plan?.hints?.cardSet;
  if (!Array.isArray(cardSet)) return [];
  return cardSet.filter((entry) => entry?.type === "defender");
}

test("cli defender-plan authors defender cards directly from defender flags", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-basic-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "affinity=dark;motivation=defending;count=2",
    "--run-id",
    "run_defender_plan_basic",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "sim-config.json")), true);
  assert.equal(existsSync(join(outDir, "initial-state.json")), true);

  const spec = readJson(join(outDir, "spec.json"));
  assert.equal(spec.meta.runId, "run_defender_plan_basic");

  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const defender = cards[0];
  assert.equal(defender.count, 2);
  assert.equal(defender.affinity, "dark");
  assert.deepEqual(defender.motivations, ["defending"]);
});

test("cli defender-plan applies default defender motivation and affinity fallback", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-defaults-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1",
    "--dungeon-affinity",
    "water",
    "--run-id",
    "run_defender_plan_defaults",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const defender = cards[0];
  assert.equal(defender.count, 1);
  assert.equal(defender.affinity, "water");
  assert.deepEqual(defender.motivations, ["defending"]);
});

test("cli defender-plan supports multiple defender configurations in one command", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-multi-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "affinity=dark;motivation=defending;count=2",
    "--defender",
    "affinity=earth;motivation=stationary;count=1",
    "--run-id",
    "run_defender_plan_multi",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 2);

  const byAffinity = new Map(cards.map((card) => [card.affinity, card]));
  assert.equal(byAffinity.get("dark")?.count, 2);
  assert.equal(byAffinity.get("earth")?.count, 1);
  assert.deepEqual(byAffinity.get("earth")?.motivations, ["stationary"]);
});

test("cli defender-plan supports advanced affinities, vitals, and receipt accounting", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-advanced-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;affinity=dark;motivation=defending;affinities=dark:emit:4,earth:pull:1;vitals=health:15:15:0,mana:3:3:1,stamina:4:4:1,durability:8:8:0",
    "--budget",
    "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
    "--price-list",
    "tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
    "--run-id",
    "run_defender_plan_advanced",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const defender = cards[0];
  assert.deepEqual(defender.affinities, [
    { kind: "dark", expression: "emit", stacks: 4 },
    { kind: "earth", expression: "pull", stacks: 1 },
  ]);
  assert.equal(defender.vitals.health.max, 15);
  assert.equal(defender.vitals.stamina.regen, 1);

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

test("cli defender-plan rejects invalid motivation", () => {
  const result = runCli([
    "defender-plan",
    "--defender",
    "affinity=dark;motivation=berserk;count=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /motivation must be one of/i);
});

test("cli defender-plan rejects duplicate motivation declarations", () => {
  const result = runCli([
    "defender-plan",
    "--defender",
    "affinity=dark;defending;motivation=attacking;count=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /motivation may only be specified once/i);
});

test("cli defender-plan rejects invalid vital tuple", () => {
  const result = runCli([
    "defender-plan",
    "--defender",
    "affinity=dark;vitals=health:notanumber:1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /non-negative integer/i);
});

test("cli defender-plan requires --budget and --price-list together", () => {
  const result = runCli([
    "defender-plan",
    "--defender",
    "affinity=dark;count=1",
    "--budget",
    "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires both --budget and --price-list/i);
});

test("cli defender-plan accepts multiple motivations with plus separator", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-multi-motivation-plus-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=stationary+defending+reflexive",
    "--run-id",
    "run_defender_plan_multi_motivation_plus",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const defender = cards[0];
  assert.deepEqual(defender.motivations.map((m) => m.kind), ["stationary", "defending", "reflexive"]);
});

test("cli defender-plan accepts multiple motivations with comma separator", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-multi-motivation-comma-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=random,stealthy,goal_oriented",
    "--run-id",
    "run_defender_plan_multi_motivation_comma",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const defender = cards[0];
  assert.deepEqual(defender.motivations.map((m) => m.kind), ["random", "stealthy", "goal_oriented"]);
});

test("cli defender-plan rejects same-family motivation conflicts", () => {
  const result = runCli([
    "defender-plan",
    "--defender",
    "count=1;motivations=stationary+patrolling",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot combine.*stationary.*patrolling.*mobility/i);
});

test("cli defender-plan allows cross-family motivation composition", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-cross-family-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=stationary+defending+strategy_focused",
    "--run-id",
    "run_defender_plan_cross_family",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].motivations.map((m) => m.kind), ["stationary", "defending", "strategy_focused"]);
});

test("cli defender-plan supports legacy single motivation field", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-legacy-motivation-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivation=defending",
    "--run-id",
    "run_defender_plan_legacy",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].motivations.map((m) => m.kind), ["defending"]);
});

// --- Milestone 2: CLI Advanced Features ---

test("cli defender-plan parses motivation with pattern", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-pattern-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending:hold_point",
    "--run-id",
    "run_defender_plan_pattern",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("defending"), "defending kind should be present");
});

test("cli defender-plan parses motivation with intensity", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-intensity-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending:7",
    "--run-id",
    "run_defender_plan_intensity",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("defending"), "defending kind should be present");
});

test("cli defender-plan parses motivation with goal", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-goal-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending:defend_point:5:3",
    "--run-id",
    "run_defender_plan_goal",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("defending"), "defending kind should be present");
});

test("cli defender-plan parses combined goal and cognition", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-goal-cognition-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending:defend_point:5:3+goal_oriented",
    "--run-id",
    "run_defender_plan_goal_cognition",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("defending"), "defending kind should be present");
  assert.ok(kinds.includes("goal_oriented"), "goal_oriented kind should be present");
});

test("cli defender-plan parses combined pattern and intensity", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-pattern-intensity-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=stationary+defending:hold_point:7+strategy_focused",
    "--run-id",
    "run_defender_plan_pattern_intensity",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("stationary"), "stationary kind should be present");
  assert.ok(kinds.includes("defending"), "defending kind should be present");
  assert.ok(kinds.includes("strategy_focused"), "strategy_focused kind should be present");
});

test("cli defender-plan rejects incompatible pattern", () => {
  const result = runCli([
    "defender-plan",
    "--defender",
    "count=1;motivations=stationary:loop",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pattern.*loop.*not compatible.*stationary/i);
});

test("cli defender-plan rejects intensity out of range", () => {
  const result = runCli([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending:11",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /intensity must be between 1 and 10/i);
});

test("cli defender-plan parses motivation flags", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-flags-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending;motivation-flags=canMove=false,prefersStealth=true",
    "--run-id",
    "run_defender_plan_flags",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listDefenderCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("defending"), "defending kind should be present");
});

test("cli defender-plan rejects unknown motivation flag", () => {
  const result = runCli([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending;motivation-flags=badFlag=true",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown.*flag.*badFlag/i);
});

test("cli defender-plan parses defend_zone goal type", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-goal-zone-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending:defend_zone:north_wing",
    "--run-id",
    "run_defender_plan_goal_zone",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  assert.equal(existsSync(join(outDir, "spec.json")), true);
});

test("cli defender-plan parses defend_actor goal type", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-goal-actor-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending:defend_actor:ally_1",
    "--run-id",
    "run_defender_plan_goal_actor",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  assert.equal(existsSync(join(outDir, "spec.json")), true);
});

test("cli defender-plan accepts all valid defender patterns", () => {
  // defending: hold_point
  const outDir1 = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-patterns-hold-"));
  runCliOk([
    "defender-plan",
    "--defender", "count=1;motivations=defending:hold_point",
    "--run-id", "run_defender_plan_patterns_hold",
    "--created-at", "2026-03-07T00:00:00.000Z",
    "--out-dir", outDir1,
  ]);
  assert.equal(existsSync(join(outDir1, "spec.json")), true);

  // defending: bodyguard
  const outDir2 = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-patterns-bodyguard-"));
  runCliOk([
    "defender-plan",
    "--defender", "count=1;motivations=defending:bodyguard",
    "--run-id", "run_defender_plan_patterns_bodyguard",
    "--created-at", "2026-03-07T00:00:00.000Z",
    "--out-dir", outDir2,
  ]);
  assert.equal(existsSync(join(outDir2, "spec.json")), true);
});

test("cli defender-plan accepts motivation flags with motivationflags alias", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-defender-plan-flags-alias-"));
  runCliOk([
    "defender-plan",
    "--defender",
    "count=1;motivations=defending;motivationflags=prefersCover=true,aggroRangeBoost=true",
    "--run-id",
    "run_defender_plan_flags_alias",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  assert.equal(existsSync(join(outDir, "spec.json")), true);
});

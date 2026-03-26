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

test("cli attacker-plan accepts multiple motivations with plus separator", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-multi-motivation-plus-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=random+attacking+reflexive",
    "--run-id",
    "run_attacker_plan_multi_motivation_plus",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const attacker = cards[0];
  assert.deepEqual(attacker.motivations, ["random", "attacking", "reflexive"]);
});

test("cli attacker-plan accepts multiple motivations with comma separator", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-multi-motivation-comma-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=stationary,defending,goal_oriented",
    "--run-id",
    "run_attacker_plan_multi_motivation_comma",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const attacker = cards[0];
  assert.deepEqual(attacker.motivations, ["stationary", "defending", "goal_oriented"]);
});

test("cli attacker-plan supports new posture motivations stealthy and friendly", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-new-postures-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=random+stealthy",
    "--attacker",
    "count=1;motivations=exploring+friendly",
    "--run-id",
    "run_attacker_plan_new_postures",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].motivations, ["random", "stealthy"]);
  assert.deepEqual(cards[1].motivations, ["exploring", "friendly"]);
});

test("cli attacker-plan supports cognition motivations", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-cognition-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=reflexive",
    "--attacker",
    "count=1;motivations=goal_oriented",
    "--attacker",
    "count=1;motivations=strategy_focused",
    "--run-id",
    "run_attacker_plan_cognition",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 3);
  assert.deepEqual(cards[0].motivations, ["reflexive"]);
  assert.deepEqual(cards[1].motivations, ["goal_oriented"]);
  assert.deepEqual(cards[2].motivations, ["strategy_focused"]);
});

test("cli attacker-plan rejects same-family motivation conflicts (mobility)", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=random+exploring",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot combine.*random.*exploring.*mobility/i);
});

test("cli attacker-plan rejects same-family motivation conflicts (posture)", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=attacking+defending",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot combine.*attacking.*defending.*posture/i);
});

test("cli attacker-plan rejects same-family motivation conflicts (cognition)", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=reflexive+goal_oriented",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot combine.*reflexive.*goal_oriented.*cognition/i);
});

test("cli attacker-plan allows cross-family motivation composition", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-cross-family-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=random+attacking+reflexive",
    "--attacker",
    "count=1;motivations=patrolling+defending+goal_oriented",
    "--run-id",
    "run_attacker_plan_cross_family",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].motivations, ["random", "attacking", "reflexive"]);
  assert.deepEqual(cards[1].motivations, ["patrolling", "defending", "goal_oriented"]);
});

test("cli attacker-plan supports legacy single motivation field", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-legacy-motivation-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivation=attacking",
    "--run-id",
    "run_attacker_plan_legacy",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].motivations, ["attacking"]);
});

// --- Milestone 2: CLI Advanced Features ---

test("cli attacker-plan parses motivation with pattern", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-pattern-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=patrolling:loop",
    "--run-id",
    "run_attacker_plan_pattern",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  // Motivation kind is preserved through normalization
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("patrolling"), "patrolling kind should be present");
});

test("cli attacker-plan parses motivation with intensity", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-intensity-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=attacking:5",
    "--run-id",
    "run_attacker_plan_intensity",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("attacking"), "attacking kind should be present");
});

test("cli attacker-plan parses motivation with goal", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-goal-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=defending:defend_point:5:3",
    "--run-id",
    "run_attacker_plan_goal",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("defending"), "defending kind should be present");
});

test("cli attacker-plan parses combined pattern and intensity", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-pattern-intensity-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=patrolling:loop:3+attacking:melee:5",
    "--run-id",
    "run_attacker_plan_pattern_intensity",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("patrolling"), "patrolling kind should be present");
  assert.ok(kinds.includes("attacking"), "attacking kind should be present");
});

test("cli attacker-plan parses goal with advanced cognition", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-goal-cognition-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=defending:defend_point:5:3+goal_oriented",
    "--run-id",
    "run_attacker_plan_goal_cognition",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("defending"), "defending kind should be present");
  assert.ok(kinds.includes("goal_oriented"), "goal_oriented kind should be present");
});

test("cli attacker-plan rejects incompatible pattern", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=random:loop",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pattern.*loop.*not compatible.*random/i);
});

test("cli attacker-plan rejects intensity out of range", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=attacking:15",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /intensity must be between 1 and 10/i);
});

test("cli attacker-plan rejects intensity of zero", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=attacking:0",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /intensity must be between 1 and 10/i);
});

test("cli attacker-plan parses motivation flags", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-flags-"));
  runCliOk([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=attacking;motivation-flags=prefersStealth=true,canMove=false",
    "--run-id",
    "run_attacker_plan_flags",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listAttackerCards(spec);
  assert.equal(cards.length, 1);
  const motivations = cards[0].motivations;
  const kinds = motivations.map((m) => (typeof m === "string" ? m : m.kind));
  assert.ok(kinds.includes("attacking"), "attacking kind should be present");
});

test("cli attacker-plan rejects unknown motivation flag", () => {
  const result = runCli([
    "attacker-plan",
    "--attacker",
    "count=1;motivations=attacking;motivation-flags=unknownFlag=true",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown.*flag.*unknownFlag/i);
});

test("cli attacker-plan accepts all valid patterns per motivation kind", () => {
  // patrolling: loop, ping_pong, random_walk
  const outDir1 = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-patterns-patrolling-"));
  runCliOk([
    "attacker-plan",
    "--attacker", "count=1;motivations=patrolling:ping_pong",
    "--run-id", "run_attacker_plan_patterns_ping_pong",
    "--created-at", "2026-03-07T00:00:00.000Z",
    "--out-dir", outDir1,
  ]);
  assert.equal(existsSync(join(outDir1, "spec.json")), true);

  // attacking: melee, ranged, mixed
  const outDir2 = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-patterns-attacking-"));
  runCliOk([
    "attacker-plan",
    "--attacker", "count=1;motivations=attacking:ranged",
    "--run-id", "run_attacker_plan_patterns_ranged",
    "--created-at", "2026-03-07T00:00:00.000Z",
    "--out-dir", outDir2,
  ]);
  assert.equal(existsSync(join(outDir2, "spec.json")), true);

  // defending: hold_point, bodyguard
  const outDir3 = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-patterns-defending-"));
  runCliOk([
    "attacker-plan",
    "--attacker", "count=1;motivations=defending:bodyguard",
    "--run-id", "run_attacker_plan_patterns_bodyguard",
    "--created-at", "2026-03-07T00:00:00.000Z",
    "--out-dir", outDir3,
  ]);
  assert.equal(existsSync(join(outDir3, "spec.json")), true);
});

test("cli attacker-plan parses goal types correctly", () => {
  // defend_zone goal
  const outDir1 = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-goal-zone-"));
  runCliOk([
    "attacker-plan",
    "--attacker", "count=1;motivations=defending:defend_zone:north_wing",
    "--run-id", "run_attacker_plan_goal_zone",
    "--created-at", "2026-03-07T00:00:00.000Z",
    "--out-dir", outDir1,
  ]);
  assert.equal(existsSync(join(outDir1, "spec.json")), true);

  // attack_target goal
  const outDir2 = mkdtempSync(join(os.tmpdir(), "agent-kernel-attacker-plan-goal-target-"));
  runCliOk([
    "attacker-plan",
    "--attacker", "count=1;motivations=attacking:attack_target:enemy_1",
    "--run-id", "run_attacker_plan_goal_target",
    "--created-at", "2026-03-07T00:00:00.000Z",
    "--out-dir", outDir2,
  ]);
  assert.equal(existsSync(join(outDir2, "spec.json")), true);
});

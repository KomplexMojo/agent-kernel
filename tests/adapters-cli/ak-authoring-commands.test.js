const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const BUDGET = resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json");
const PRICE_LIST = resolve(ROOT, "tests/fixtures/artifacts/price-list-artifact-v1-basic.json");

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

function listCardSet(spec) {
  return Array.isArray(spec?.plan?.hints?.cardSet) ? spec.plan.hints.cardSet : [];
}

function listRoomCards(spec) {
  return listCardSet(spec).filter((entry) => entry?.type === "room");
}

function listDelverCards(spec) {
  return listCardSet(spec).filter((entry) => entry?.type === "delver");
}

test("cli help documents generic create and configure authoring commands", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\bcreate\b/);
  assert.match(result.stdout, /\bconfigure\b/);
  assert.match(result.stdout, /--floor-tile/);
  assert.match(result.stdout, /--trap/);
  assert.match(result.stdout, /goals=max_mana/);
});

test("cli create emits a complete playable artifact bundle for agent requests", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-create-authoring-"));
  const result = runCliOk([
    "create",
    "--text",
    "Create a fire room with a trap, one delver, and one warden. Total budget 1000 tokens.",
    "--room",
    "size=large;count=1;affinities=fire:emit:3",
    "--floor-tile",
    "count=18",
    "--trap",
    "id=trap_fire;x=2;y=2;affinity=fire;expression=push;stacks=2;blocking=false;vitals=mana:3:1,durability:4:0",
    "--delver",
    "id=ember_delver;count=1;affinity=fire;motivation=attacking;setup-mode=user;goals=max_mana:high,mana_regen:high",
    "--warden",
    "id=ember_warden;count=1;affinity=fire;motivation=defending",
    "--budget-tokens",
    "1000",
    "--run-id",
    "run_create_authoring",
    "--created-at",
    "2026-04-08T00:00:00.000Z",
    "--budget",
    BUDGET,
    "--price-list",
    PRICE_LIST,
    "--out-dir",
    outDir,
  ]);
  const summary = readStdoutJson(result);

  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "request.json")), false);
  assert.equal(existsSync(join(outDir, "intent.json")), false);
  assert.equal(existsSync(join(outDir, "plan.json")), false);
  assert.equal(existsSync(join(outDir, "budget.json")), true);
  assert.equal(existsSync(join(outDir, "price-list.json")), true);
  assert.equal(existsSync(join(outDir, "budget-receipt.json")), true);
  assert.equal(existsSync(join(outDir, "spend-proposal.json")), false);
  assert.equal(existsSync(join(outDir, "sim-config.json")), true);
  assert.equal(existsSync(join(outDir, "initial-state.json")), true);
  assert.equal(existsSync(join(outDir, "resource-bundle.json")), true);
  assert.equal(existsSync(join(outDir, "bundle.json")), true);
  assert.equal(existsSync(join(outDir, "manifest.json")), true);
  assert.equal(existsSync(join(outDir, "telemetry.json")), true);
  assert.equal(summary.preview.ready, true);
  assert.equal(summary.preview.bundlePath, join(outDir, "bundle.json"));
  assert.equal(summary.preview.manifestPath, join(outDir, "manifest.json"));
  assert.equal(summary.preview.resourceBundlePath, join(outDir, "resource-bundle.json"));
  assert.equal(summary.preview.hasActors, true);
  assert.equal(summary.preview.runReady, true);
  assert.equal(summary.artifactPaths.resource_bundle, join(outDir, "resource-bundle.json"));

  const spec = readJson(join(outDir, "spec.json"));
  const request = spec.authoring.request;
  const simConfig = readJson(join(outDir, "sim-config.json"));
  const bundle = readJson(join(outDir, "bundle.json"));
  const manifest = readJson(join(outDir, "manifest.json"));
  const telemetry = readJson(join(outDir, "telemetry.json"));

  assert.equal(request.schema, "agent-kernel/AgentCommandRequestArtifact");
  assert.equal(request.command.action, "author");
  assert.equal(request.command.text, "Create a fire room with a trap, one delver, and one warden. Total budget 1000 tokens.");
  assert.deepEqual(
    request.objects.map((entry) => entry.kind),
    ["room", "floor_tile", "trap", "delver", "warden", "shared_config"],
  );

  assert.deepEqual(spec.authoring.objectKinds, ["room", "floor_tile", "trap", "delver", "warden", "shared_config"]);
  assert.equal(request.sharedConfig.constraints.hardBudget.totalTokens, 1000);
  assert.deepEqual(request.sharedConfig.constraints.hardBudget.sources, ["text", "flag", "budget_artifact"]);
  assert.equal(request.sharedConfig.optimizationGoals, undefined);
  assert.equal(spec.authoring.constraints.hardBudget.totalTokens, 1000);
  assert.ok(spec.authoring.optimizationGoals.every((entry) => entry.kind !== "maximize_budget_spend"));
  const delverRequest = request.objects.find((entry) => entry.kind === "delver");
  assert.equal(delverRequest.optimizationGoals.length, 2);
  assert.ok(delverRequest.optimizationGoals.some((entry) => entry.kind === "maximize_vital_max" && entry.vital === "mana"));
  assert.ok(delverRequest.optimizationGoals.some((entry) => entry.kind === "maximize_vital_regen" && entry.vital === "mana"));
  assert.equal(spec.configurator.inputs.levelGen.walkableTilesTarget, 18);
  assert.equal(spec.configurator.inputs.levelGen.traps.length, 1);
  assert.equal(spec.configurator.inputs.levelGen.traps[0].id, "trap_fire");

  assert.ok(Array.isArray(simConfig.layout.data.traps));
  assert.ok(simConfig.layout.data.traps.some((entry) => (
    entry.x === 2
    && entry.y === 2
    && entry.affinity?.kind === "fire"
    && entry.affinity?.expression === "push"
    && entry.affinity?.stacks === 2
  )));
  assert.ok(manifest.artifacts.every((entry) => entry.path !== "request.json"));
  assert.ok(manifest.artifacts.every((entry) => entry.path !== "spend-proposal.json"));
  assert.ok(manifest.artifacts.some((entry) => entry.path === "resource-bundle.json" && entry.schema === "agent-kernel/ResourceBundleArtifact"));
  assert.ok(bundle.artifacts.every((artifact) => artifact.schema !== "agent-kernel/SpendProposal"));
  assert.ok(bundle.artifacts.some((artifact) => artifact.schema === "agent-kernel/ResourceBundleArtifact"));
  assert.deepEqual(
    telemetry.data.artifactRefs,
    manifest.artifacts.map((entry) => ({
      id: entry.id,
      schema: entry.schema,
      schemaVersion: entry.schemaVersion,
    })),
  );
});

test("cli create emits intermediate sidecars only when explicitly requested", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-create-authoring-intermediates-"));
  const result = runCliOk([
    "create",
    "--text",
    "Create one fire delver within a total budget of 1000 tokens.",
    "--delver",
    "count=1;affinity=fire;motivation=attacking;goals=max_mana,mana_regen",
    "--budget-tokens",
    "1000",
    "--emit-intermediates",
    "--run-id",
    "run_create_authoring_intermediates",
    "--created-at",
    "2026-04-08T00:00:00.000Z",
    "--budget",
    BUDGET,
    "--price-list",
    PRICE_LIST,
    "--out-dir",
    outDir,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(outDir, "request.json")), true);
  assert.equal(existsSync(join(outDir, "intent.json")), true);
  assert.equal(existsSync(join(outDir, "plan.json")), true);
  assert.equal(existsSync(join(outDir, "spend-proposal.json")), true);

  const manifest = readJson(join(outDir, "manifest.json"));
  const bundle = readJson(join(outDir, "bundle.json"));
  assert.ok(manifest.artifacts.some((entry) => entry.path === "request.json"));
  assert.ok(manifest.artifacts.some((entry) => entry.path === "spend-proposal.json"));
  assert.ok(bundle.artifacts.some((artifact) => artifact.schema === "agent-kernel/SpendProposal"));
});

test("cli create dry-run validates authored requests without writing artifacts", () => {
  const rootDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-create-dry-run-"));
  const outDir = join(rootDir, "out");
  const result = runCliOk([
    "create",
    "--dry-run",
    "--text",
    "Create one fire delver within a total budget of 200 tokens.",
    "--delver",
    "count=1;affinity=fire;motivation=attacking;goals=max_mana,mana_regen",
    "--budget-tokens",
    "200",
    "--run-id",
    "run_create_dry_run",
    "--created-at",
    "2026-04-10T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.ok, true);
  assert.equal(summary.command, "create");
  assert.equal(summary.valid, true);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.runId, "run_create_dry_run");
  assert.equal(summary.outDir, outDir);
  assert.equal(summary.budgetEstimate.total, 200);
  assert.equal(existsSync(join(outDir, "spec.json")), false);
  assert.equal(existsSync(join(outDir, "bundle.json")), false);
});

test("cli create dry-run returns valid false for infeasible budgets and still exits cleanly", () => {
  const rootDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-create-dry-run-invalid-"));
  const outDir = join(rootDir, "out");
  const result = runCli([
    "create",
    "--dry-run",
    "--room",
    "affinities=dark:emit:2,water:emit:2",
    "--budget-tokens",
    "40",
    "--run-id",
    "run_create_dry_run_invalid",
    "--created-at",
    "2026-04-10T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.ok, true);
  assert.equal(summary.command, "create");
  assert.equal(summary.valid, false);
  assert.equal(summary.dryRun, true);
  assert.match(summary.errors[0], /insufficient_budget/i);
  assert.equal(existsSync(join(outDir, "spec.json")), false);
});

test("cli configure preserves generic parsing but records configure action", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-configure-authoring-"));
  const result = runCliOk([
    "configure",
    "--text",
    "Configure the existing trap layout for a fire room.",
    "--room",
    "size=small;count=1",
    "--trap",
    "id=trap_fire;x=1;y=1;affinity=fire;expression=emit;stacks=1",
    "--run-id",
    "run_configure_authoring",
    "--created-at",
    "2026-04-08T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  const summary = readStdoutJson(result);

  const spec = readJson(join(outDir, "spec.json"));
  const request = spec.authoring.request;
  assert.equal(request.command.action, "configure");
  assert.equal(spec.authoring.request.command.action, "configure");
  assert.ok(spec.authoring.objectKinds.includes("trap"));
  assert.equal(summary.preview.ready, true);
  assert.equal(summary.preview.bundlePath, join(outDir, "bundle.json"));
  assert.equal(summary.preview.resourceBundlePath, join(outDir, "resource-bundle.json"));
  assert.equal(summary.preview.hasActors, false);
  assert.equal(summary.preview.runReady, false);
});

test("cli create rejects invalid trap expressions deterministically", () => {
  const result = runCli([
    "create",
    "--trap",
    "x=1;y=1;affinity=fire;expression=explode",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] expression must be one of/i);
});

test("cli create rejects conflicting hard budget inputs", () => {
  const result = runCli([
    "create",
    "--text",
    "Create one delver with budget 120 tokens.",
    "--delver",
    "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens",
    "100",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hard budget inputs disagree/i);
});

test("cli create keeps budget-only input as a hard constraint without maximize-spend goal", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-create-budget-only-"));
  runCliOk([
    "create",
    "--text",
    "Create one delver with budget 100 tokens.",
    "--delver",
    "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens",
    "100",
    "--run-id",
    "run_create_budget_only",
    "--created-at",
    "2026-04-09T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const request = spec.authoring.request;
  assert.equal(request.sharedConfig.constraints.hardBudget.totalTokens, 100);
  assert.deepEqual(request.sharedConfig.constraints.hardBudget.sources, ["text", "flag"]);
  assert.equal(request.sharedConfig.optimizationGoals, undefined);
  assert.equal(spec.authoring.constraints.hardBudget.totalTokens, 100);
  assert.equal(spec.authoring.optimizationGoals, undefined);
});

test("cli create maximizes delver spend deterministically when explicitly asked to maximize spend", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-create-delver-max-spend-"));
  runCliOk([
    "create",
    "--text",
    "Create one fire delver and maximize valid spend within a total budget of 200 tokens.",
    "--delver",
    "count=1;affinity=fire;motivation=attacking;affinities=fire:push:2;goals=max_mana,mana_regen",
    "--budget-tokens",
    "200",
    "--run-id",
    "run_create_delver_max_spend",
    "--created-at",
    "2026-04-09T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const delver = listDelverCards(spec)[0];
  assert.ok(delver);
  assert.ok(spec.authoring.optimizationGoals.some((entry) => entry.kind === "maximize_budget_spend"));
  assert.equal(delver.vitals.mana.max, 29);
  assert.ok(delver.vitals.mana.regen >= 1);
  assert.ok(delver.vitals.stamina.regen >= 1);
});

test("cli create preserves mixed room affinities while maximizing valid spend", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-create-room-max-spend-"));
  runCliOk([
    "create",
    "--text",
    "Create one room and maximize valid spend within a total budget of 400 tokens.",
    "--room",
    "affinities=dark:emit:2,water:emit:2",
    "--budget-tokens",
    "400",
    "--run-id",
    "run_create_room_max_spend",
    "--created-at",
    "2026-04-09T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const room = listRoomCards(spec)[0];
  assert.ok(room);
  assert.equal(room.roomSize, "large");
  assert.deepEqual(room.affinities, [
    { kind: "dark", expression: "emit", stacks: 2 },
    { kind: "water", expression: "emit", stacks: 2 },
  ]);
});

test("cli room-plan rejects insufficient hard budgets instead of silently degrading the request", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-room-plan-insufficient-"));
  const result = runCli([
    "room-plan",
    "--room",
    "affinities=dark:emit:2,water:emit:2",
    "--budget-tokens",
    "40",
    "--run-id",
    "run_room_plan_insufficient",
    "--created-at",
    "2026-04-09T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /insufficient_budget/);
  assert.match(result.stderr, /hard budget is 40 tokens but minimum required spend is 42 tokens/i);
  assert.match(result.stderr, /room\[1\] requires at least 42 tokens/i);
  assert.equal(existsSync(join(outDir, "bundle.json")), false);
});

test("cli delver-plan rejects conflicting hard requirements with deterministic explanations", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-delver-plan-conflict-"));
  const result = runCli([
    "delver-plan",
    "--goal",
    "Author one fire delver within a total budget of 200 tokens.",
    "--delver",
    "count=1;affinity=fire;motivation=attacking;affinities=fire:push:2;vitals=health:1:0,mana:0:0,stamina:0:0,durability:1:0",
    "--budget-tokens",
    "200",
    "--run-id",
    "run_delver_plan_conflict",
    "--created-at",
    "2026-04-09T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflicting_requirements/);
  assert.match(result.stderr, /delver\[1\] affinities require mana\.max >= 1/i);
  assert.match(result.stderr, /delver\[1\] affinities require mana\.regen >= 1/i);
  assert.match(result.stderr, /delver\[1\] movement requires stamina\.regen >= 1/i);
  assert.equal(existsSync(join(outDir, "bundle.json")), false);
});

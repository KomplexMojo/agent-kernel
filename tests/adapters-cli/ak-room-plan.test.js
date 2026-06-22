const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync, writeFileSync } = require("node:fs");
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

function listRoomCards(spec) {
  const cardSet = spec?.plan?.hints?.cardSet;
  if (!Array.isArray(cardSet)) return [];
  return cardSet.filter((entry) => entry?.type === "room");
}

function listAffinityTuples(card) {
  return (Array.isArray(card?.affinities) ? card.affinities : []).map((entry) => ({
    kind: entry.kind,
    expression: entry.expression,
    stacks: entry.stacks,
  }));
}

test("cli room-plan authors room cards directly from room flags", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-room-plan-basic-"));
  const result = runCliOk([
    "room-plan",
    "--room",
    "size=large;count=2",
    "--run-id",
    "run_room_plan_basic",
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
  assert.equal(summary.preview.hasActors, false);
  assert.equal(summary.preview.runReady, false);
  assert.equal(summary.artifactPaths.resource_bundle, join(outDir, "resource-bundle.json"));

  const spec = readJson(join(outDir, "spec.json"));
  const manifest = readJson(join(outDir, "manifest.json"));
  assert.equal(spec.meta.runId, "run_room_plan_basic");
  assert.ok(manifest.artifacts.some((entry) => entry.path === "resource-bundle.json" && entry.schema === "agent-kernel/ResourceBundleArtifact"));

  const cards = listRoomCards(spec);
  assert.equal(cards.length, 1);
  const room = cards[0];
  assert.equal(room.roomSize, "large");
  assert.equal(room.count, 2);
  assert.deepEqual(listAffinityTuples(room), [], "rooms carry no affinities — affinity comes from traps/hazards");
});

test("cli room-plan produces a generic room card with no affinity tuples", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-room-plan-defaults-"));
  runCliOk([
    "room-plan",
    "--room",
    "size=small",
    "--run-id",
    "run_room_plan_defaults",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listRoomCards(spec);
  assert.equal(cards.length, 1);
  const room = cards[0];
  assert.equal(room.roomSize, "small");
  assert.equal(room.count, 1);
  assert.deepEqual(listAffinityTuples(room), [], "rooms are generic containers and carry no affinities");
});

test("cli room-plan supports multiple room configurations in one command", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-room-plan-multi-"));
  runCliOk([
    "room-plan",
    "--room",
    "size=small;count=1",
    "--room",
    "size=large;count=3",
    "--run-id",
    "run_room_plan_multi",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const cards = listRoomCards(spec);
  assert.equal(cards.length, 2);

  const bySize = new Map(cards.map((card) => [card.roomSize, card]));
  assert.equal(bySize.get("small")?.count, 1);
  assert.equal(bySize.get("large")?.count, 3);
  assert.deepEqual(listAffinityTuples(bySize.get("large")), [], "rooms carry no affinities");
});

test("cli room-plan writes budget receipt with room layout spend only — no affinity line items", async () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-room-plan-budget-"));
  const outDir = join(workDir, "out");
  const budgetPath = join(workDir, "budget.json");
  const priceListPath = join(workDir, "price-list.json");

  const budgetTokens = 50000;
  writeFileSync(budgetPath, JSON.stringify({
    schema: "agent-kernel/BudgetArtifact",
    schemaVersion: 1,
    meta: {
      id: "budget_room_plan",
      runId: "run_room_plan_budget",
      createdAt: "2026-03-07T00:00:00.000Z",
      producedBy: "test",
    },
    budget: {
      tokens: budgetTokens,
      ownerRef: {
        id: "intent_room_plan_budget",
        schema: "agent-kernel/IntentEnvelope",
        schemaVersion: 1,
      },
    },
  }, null, 2));
  writeFileSync(priceListPath, JSON.stringify({
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: {
      id: "price_list_room_plan",
      runId: "run_room_plan_budget",
      createdAt: "2026-03-07T00:00:00.000Z",
      producedBy: "test",
    },
    items: [
      { id: "layout_grid_10x10", kind: "layout", costTokens: 11 },
      { id: "trap_basic", kind: "trap", costTokens: 2 },
    ],
  }, null, 2));

  runCliOk([
    "room-plan",
    "--room",
    "size=small;count=1",
    "--budget",
    budgetPath,
    "--price-list",
    priceListPath,
    "--run-id",
    "run_room_plan_budget",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const receipt = readJson(join(outDir, "budget-receipt.json"));
  const simConfig = readJson(join(outDir, "sim-config.json"));
  assert.equal(receipt.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.equal(receipt.status, "approved");

  const layoutLine = receipt.lineItems.find((item) => item.id === "layout_grid_10x10" && item.kind === "layout");
  assert.ok(layoutLine);
  assert.equal(layoutLine.status, "approved");
  assert.equal(layoutLine.totalCost, 11);

  const affinityLines = receipt.lineItems.filter((item) => item.kind === "affinity");
  assert.equal(affinityLines.length, 0, "room receipt must contain no affinity line items");

  assert.equal(receipt.remaining, budgetTokens - receipt.totalCost);
  assert.equal(simConfig.budgetReceiptRef.id, receipt.meta.id);
});

test("cli room-plan rejects invalid room size", async () => {
  const result = runCli([
    "room-plan",
    "--room",
    "size=colossal;count=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /room\[1\] size must be one of/i);
});

test("cli room-plan rejects affinity field — rooms are generic containers", async () => {
  const result = runCli([
    "room-plan",
    "--room",
    "size=small;affinities=fire:emit:2",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not supported.*trap.*hazard/i);
});

test("cli room-plan requires --budget and --price-list together", async () => {
  const result = runCli([
    "room-plan",
    "--room",
    "size=small;count=1",
    "--budget",
    "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires both --budget and --price-list/i);
});

test("cli room-plan maximizes a flexible room within a 400-token budget", async () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-room-plan-budgeted-"));
  const outDir = join(workDir, "out");
  const budgetPath = join(workDir, "budget.json");
  const priceListPath = join(workDir, "price-list.json");

  writeFileSync(budgetPath, JSON.stringify({
    schema: "agent-kernel/BudgetArtifact",
    schemaVersion: 1,
    meta: {
      id: "budget_room_400",
      runId: "run_room_plan_budgeted",
      createdAt: "2026-04-09T00:00:00.000Z",
      producedBy: "test",
    },
    budget: {
      tokens: 400,
    },
  }, null, 2));
  writeFileSync(priceListPath, JSON.stringify({
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: {
      id: "price_list_room_400",
      runId: "run_room_plan_budgeted",
      createdAt: "2026-04-09T00:00:00.000Z",
      producedBy: "test",
    },
    items: [],
  }, null, 2));

  runCliOk([
    "room-plan",
    "--room",
    "size=large",
    "--budget",
    budgetPath,
    "--price-list",
    priceListPath,
    "--run-id",
    "run_room_plan_budgeted",
    "--created-at",
    "2026-04-09T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const spec = readJson(join(outDir, "spec.json"));
  const room = listRoomCards(spec)[0];
  assert.ok(room);
  assert.equal(room.roomSize, "large");
  assert.deepEqual(listAffinityTuples(room), [], "rooms carry no affinities");

  const { calculateRoomCardUnitCost } = await import("../../packages/runtime/src/personas/configurator/spend-proposal.js");

const mediumCost = calculateRoomCardUnitCost({
  card: { ...room, roomSize: "medium" },
  priceList: { items: [] },
}).cost;
const largeCost = calculateRoomCardUnitCost({
  card: room,
  priceList: { items: [] },
}).cost;

assert.ok(largeCost <= 400);
assert.ok(largeCost >= mediumCost);
});

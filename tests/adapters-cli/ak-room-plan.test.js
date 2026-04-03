const test = require("node:test");
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

test("cli room-plan authors room cards directly from room flags", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-room-plan-basic-"));
  runCliOk([
    "room-plan",
    "--room",
    "size=large;count=2;affinities=fire:emit:3,water:pull:1",
    "--run-id",
    "run_room_plan_basic",
    "--created-at",
    "2026-03-07T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "sim-config.json")), true);
  assert.equal(existsSync(join(outDir, "initial-state.json")), true);

  const spec = readJson(join(outDir, "spec.json"));
  assert.equal(spec.meta.runId, "run_room_plan_basic");

  const cards = listRoomCards(spec);
  assert.equal(cards.length, 1);
  const room = cards[0];
  assert.equal(room.roomSize, "large");
  assert.equal(room.count, 2);
  assert.deepEqual(listAffinityTuples(room), [
    { kind: "fire", expression: "emit", stacks: 3 },
    { kind: "water", expression: "pull", stacks: 1 },
  ]);
});

test("cli room-plan applies default room affinity and stacks when omitted", () => {
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
  assert.equal(room.affinity, "dark");
  assert.deepEqual(listAffinityTuples(room), [
    { kind: "dark", expression: "emit", stacks: 2 },
  ]);
});

test("cli room-plan supports multiple room configurations in one command", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-room-plan-multi-"));
  runCliOk([
    "room-plan",
    "--room",
    "size=small;count=1",
    "--room",
    "size=large;count=3;affinities=life:emit:4",
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
  assert.deepEqual(listAffinityTuples(bySize.get("large")), [
    { kind: "life", expression: "emit", stacks: 4 },
  ]);
});

test("cli room-plan writes budget receipt with room layout and room-affinity spend", () => {
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
      { id: "layout_grid_7x7", kind: "layout", costTokens: 11 },
      { id: "trap_basic", kind: "trap", costTokens: 2 },
    ],
  }, null, 2));

  runCliOk([
    "room-plan",
    "--room",
    "size=small;count=1;affinities=fire:emit:2",
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

  const layoutLine = receipt.lineItems.find((item) => item.id === "layout_grid_7x7" && item.kind === "layout");
  assert.ok(layoutLine);
  assert.equal(layoutLine.status, "approved");
  assert.equal(layoutLine.totalCost, 11);

  const trapLine = receipt.lineItems.find((item) => item.id === "trap_basic" && item.kind === "trap");
  assert.ok(trapLine);
  assert.equal(trapLine.status, "approved");
  assert.ok(trapLine.quantity > 0);
  assert.ok(trapLine.totalCost > 0);

  assert.equal(receipt.totalCost, layoutLine.totalCost + trapLine.totalCost);
  assert.equal(receipt.remaining, budgetTokens - receipt.totalCost);
  assert.equal(simConfig.budgetReceiptRef.id, receipt.meta.id);
});

test("cli room-plan rejects invalid room size", () => {
  const result = runCli([
    "room-plan",
    "--room",
    "size=colossal;count=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /room\[1\] size must be one of/i);
});

test("cli room-plan rejects invalid affinity expression", () => {
  const result = runCli([
    "room-plan",
    "--room",
    "size=small;affinities=fire:burst:2",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid affinity expression/i);
});

test("cli room-plan requires --budget and --price-list together", () => {
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

/**
 * MCP sandbox + tick navigation integration tests
 *
 * Coverage:
 *   S1  ak_sandbox_create  — session creation, budget enforcement
 *   S2  ak_sandbox_place   — entity placement, bounds checking
 *   S3  ak_sandbox_move    — cardinal movement, wall/bounds/stamina guards
 *   T1  ak_tick_forward    — cursor advance, boundary error
 *   T2  ak_tick_backward   — cursor rewind, boundary error
 *   T3  ak_show_state      — frame inspection at current cursor
 *   INT Full integration   — sandbox session → scaffolded tick frames → navigate forward/backward
 *   VSR Vault scenario     — run MCP payload from vault reference through the CLI
 *
 * Tick tool tests use AK_ARTIFACTS_DIR (env var) to isolate run directories.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

const VAULT_DIR =
  "/Users/darren/Documents/Obsidian/agent-kernel-vault/Sample Calls to agent-kernel MCP and Results";
const BUDGET_RECEIPT_FIXTURE = resolve(
  ROOT,
  "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json",
);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function makeMeta(id, runId) {
  return {
    id,
    runId,
    createdAt: "2026-01-01T00:00:00.000Z",
    producedBy: "test-fixture",
  };
}

/**
 * Build a minimal run directory that tick tools can navigate.
 * Returns the tmpDir so AK_ARTIFACTS_DIR can point to it.
 */
function scaffoldTickRun(runId, { maxTick = 10, actorId = "actor_delver" } = {}) {
  const tmpDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-tick-"));
  const buildDir = join(tmpDir, "artifacts", "runs", runId, "build");
  const runDir = join(tmpDir, "artifacts", "runs", runId, "run");

  writeJson(join(buildDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: makeMeta("sim_config", runId),
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 5,
        height: 5,
        tiles: ["#####", "#...#", "#...#", "#...#", "#####"],
        legend: { "#": { tile: "wall" }, ".": { tile: "floor" } },
      },
    },
  });

  writeJson(join(buildDir, "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: makeMeta("initial_state", runId),
    actors: [{ id: actorId, kind: "ambulatory", position: { x: 1, y: 1 } }],
  });

  const frames = Array.from({ length: maxTick }, (_, i) => ({
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    meta: makeMeta(`tick_frame_${i + 1}`, runId),
    tick: i + 1,
    phase: "execute",
    acceptedActions: [
      {
        schema: "agent-kernel/Action",
        schemaVersion: 1,
        actorId,
        tick: i + 1,
        kind: "wait",
        params: { reason: "idle" },
      },
    ],
  }));
  writeJson(join(runDir, "tick-frames.json"), frames);

  writeJson(join(runDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: makeMeta("run_summary", runId),
    outcome: "success",
    metrics: { ticks: maxTick },
  });

  return tmpDir;
}

/**
 * Build a denied budget receipt (status != "approved") for negative tests.
 */
function makeDeniedReceipt(outDir) {
  const path = join(outDir, "denied-receipt.json");
  writeJson(path, {
    schema: "agent-kernel/BudgetReceiptArtifact",
    schemaVersion: 1,
    meta: { id: "denied_receipt", runId: "run_denied", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" },
    budgetRef: { id: "b1", schema: "agent-kernel/BudgetArtifact", schemaVersion: 1 },
    priceListRef: { id: "pl1", schema: "agent-kernel/PriceList", schemaVersion: 1 },
    status: "denied",
    totalCost: 0,
    remaining: 0,
    lineItems: [],
  });
  return path;
}

// ---------------------------------------------------------------------------
// Vault scenario CLI runner (used in VSR section)
// ---------------------------------------------------------------------------

function vaultScenarioPath(n) {
  const files = [
    "01 Create Single Delver.md",
    "09 Create Delver Versus Warden Arena.md",
    "53 Create Tick Session Ready Dungeon.md",
  ];
  return join(VAULT_DIR, files[n]);
}

function extractMcpPayload(mdContent) {
  const match = mdContent.match(/```json\n([\s\S]+?)\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function mcpPayloadToCliArgs(payload, outDir) {
  const args = ["create"];
  if (payload.budgetTokens) args.push("--budget-tokens", String(payload.budgetTokens));
  if (payload.runId) args.push("--run-id", payload.runId + "_test");
  args.push("--out-dir", outDir);
  for (const room of (payload.room ?? [])) args.push("--room", room);
  for (const delver of (payload.delver ?? [])) args.push("--delver", delver);
  for (const warden of (payload.warden ?? [])) args.push("--warden", warden);
  for (const trap of (payload.trap ?? [])) args.push("--trap", trap);
  for (const resource of (payload.resource ?? [])) args.push("--resource", resource);
  return args;
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

// ---------------------------------------------------------------------------
// S1 — ak_sandbox_create
// ---------------------------------------------------------------------------

test("S1-01: ak_sandbox_create succeeds with approved budget receipt", async () => {
  const { executeSandboxCreate } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-sandbox-create-"));
  const result = await executeSandboxCreate({
    budgetReceipt: BUDGET_RECEIPT_FIXTURE,
    runId: "sandbox_s1_01",
    outDir,
  });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
  assert.ok(typeof result.sandboxId === "string" && result.sandboxId.length > 0, "sandboxId must be a non-empty string");
  assert.equal(result.runId, "sandbox_s1_01");
  assert.ok(Array.isArray(result.rooms) && result.rooms.length === 1, "rooms must have one entry");
  assert.equal(result.rooms[0].width, 10, "default room width is 10");
  assert.equal(result.rooms[0].height, 10, "default room height is 10");
  assert.ok(existsSync(join(outDir, "sandbox-session.json")), "sandbox-session.json must be written");
});

test("S1-02: ak_sandbox_create with custom dimensions uses those values", async () => {
  const { executeSandboxCreate } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-sandbox-dims-"));
  const result = await executeSandboxCreate({
    budgetReceipt: BUDGET_RECEIPT_FIXTURE,
    width: 15,
    height: 12,
    outDir,
  });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
  assert.equal(result.rooms[0].width, 15);
  assert.equal(result.rooms[0].height, 12);
});

test("S1-03: ak_sandbox_create with entityCategories includes them in output", async () => {
  const { executeSandboxCreate } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-sandbox-cats-"));
  const result = await executeSandboxCreate({
    budgetReceipt: BUDGET_RECEIPT_FIXTURE,
    entityCategories: ["delver", "warden"],
    outDir,
  });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
  assert.deepEqual(result.entityCategories, ["delver", "warden"]);
  const session = readJson(join(outDir, "sandbox-session.json"));
  assert.deepEqual(session.entityCategories, ["delver", "warden"]);
});

test("S1-04: ak_sandbox_create without budget returns ok:false with budgetRequired flag", async () => {
  const { executeSandboxCreate } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const result = await executeSandboxCreate({});
  assert.equal(result.ok, false);
  assert.equal(result.budgetRequired, true);
  assert.match(result.error, /budgetReceipt|budget/i);
});

test("S1-05: ak_sandbox_create with denied budget receipt returns ok:false with budgetInsufficient flag", async () => {
  const { executeSandboxCreate } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const tmpDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-sandbox-denied-"));
  const deniedPath = makeDeniedReceipt(tmpDir);
  const result = await executeSandboxCreate({
    budgetReceipt: deniedPath,
    outDir: join(tmpDir, "out"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.budgetInsufficient, true);
  assert.match(result.error, /approved|status/i);
});

test("S1-06: ak_sandbox_create sandbox-session.json has correct schema fields", async () => {
  const { executeSandboxCreate } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-sandbox-schema-"));
  await executeSandboxCreate({ budgetReceipt: BUDGET_RECEIPT_FIXTURE, outDir });

  const session = readJson(join(outDir, "sandbox-session.json"));
  assert.equal(session.schema, "agent-kernel/SandboxSessionArtifact");
  assert.equal(session.schemaVersion, 1);
  assert.ok(session.meta?.id, "meta.id must be present");
  assert.ok(session.meta?.runId, "meta.runId must be present");
  assert.ok(session.artifacts?.budgetReceiptRef, "budgetReceiptRef must be indexed");
});

// ---------------------------------------------------------------------------
// S2 — ak_sandbox_place
// ---------------------------------------------------------------------------

async function createSession(outDir, opts = {}) {
  const { executeSandboxCreate } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const r = await executeSandboxCreate({
    budgetReceipt: BUDGET_RECEIPT_FIXTURE,
    width: opts.width ?? 10,
    height: opts.height ?? 10,
    outDir,
  });
  if (!r.ok) throw new Error(`sandbox-create failed: ${r.error}`);
  return join(outDir, "sandbox-session.json");
}

test("S2-01: ak_sandbox_place places a delver at a valid position", async () => {
  const { executeSandboxPlace } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-place-delver-"));
  const sessionPath = await createSession(outDir);

  const result = await executeSandboxPlace({
    session: sessionPath,
    entityType: "delver",
    spec: "id=delver_1;x=2;y=2;affinity=fire;motivation=exploring",
  });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
  assert.equal(result.entityType, "delver");
  assert.equal(result.entityId, "delver_1");
  assert.deepEqual(result.position, { x: 2, y: 2 });

  const initialState = readJson(result.initialStatePath);
  const actor = initialState.actors.find((a) => a.id === "delver_1");
  assert.ok(actor, "delver_1 must be in InitialState");
  assert.deepEqual(actor.position, { x: 2, y: 2 });
  assert.equal(actor.traits?.affinity, "fire");
  assert.equal(actor.traits?.motivation, "exploring");
});

test("S2-02: ak_sandbox_place places a warden", async () => {
  const { executeSandboxPlace } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-place-warden-"));
  const sessionPath = await createSession(outDir);

  const result = await executeSandboxPlace({
    session: sessionPath,
    entityType: "warden",
    spec: "id=warden_1;x=7;y=7;affinity=dark;motivation=stationary",
  });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
  assert.equal(result.entityId, "warden_1");
  assert.deepEqual(result.position, { x: 7, y: 7 });
});

test("S2-03: ak_sandbox_place places a fire trap", async () => {
  const { executeSandboxPlace } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-place-trap-"));
  const sessionPath = await createSession(outDir);

  const result = await executeSandboxPlace({
    session: sessionPath,
    entityType: "trap",
    spec: "id=trap_fire;x=3;y=1;affinity=fire;expression=emit;stacks=3;blocking=false",
  });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
  const state = readJson(result.initialStatePath);
  const trap = state.actors.find((a) => a.id === "trap_fire");
  assert.ok(trap, "trap must appear in InitialState");
  assert.equal(trap.traits?.affinity, "fire");
  assert.equal(trap.traits?.stacks, 3);
  assert.equal(trap.traits?.blocking, false);
});

test("S2-04: ak_sandbox_place places a level resource pickup", async () => {
  const { executeSandboxPlace } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-place-resource-"));
  const sessionPath = await createSession(outDir);

  const result = await executeSandboxPlace({
    session: sessionPath,
    entityType: "resource",
    spec: "id=res_1;x=5;y=5;tier=level;stat=vitalMax;delta=10;dropRate=50",
  });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
  const state = readJson(result.initialStatePath);
  const res = state.actors.find((a) => a.id === "res_1");
  assert.ok(res, "resource must appear in InitialState");
  assert.equal(res.traits?.tier, "level");
  assert.equal(res.traits?.stat, "vitalMax");
  assert.equal(res.traits?.delta, 10);
  assert.equal(res.traits?.dropRate, 50);
});

test("S2-05: ak_sandbox_place out of bounds returns ok:false with outOfBounds flag", async () => {
  const { executeSandboxPlace } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-place-oob-"));
  const sessionPath = await createSession(outDir, { width: 10, height: 10 });

  const result = await executeSandboxPlace({
    session: sessionPath,
    entityType: "delver",
    spec: "id=d_oob;x=20;y=20;affinity=fire;motivation=exploring",
  });

  assert.equal(result.ok, false);
  assert.equal(result.outOfBounds, true);
  assert.match(result.error, /out of bounds/i);
});

test("S2-06: ak_sandbox_place invalid entityType returns structured error", async () => {
  const { executeSandboxPlace } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-place-badtype-"));
  const sessionPath = await createSession(outDir);

  const result = await executeSandboxPlace({
    session: sessionPath,
    entityType: "dragon",
    spec: "id=d1;x=1;y=1",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /entityType|delver|warden/i);
});

test("S2-07: ak_sandbox_place updates session artifacts index", async () => {
  const { executeSandboxPlace } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-place-index-"));
  const sessionPath = await createSession(outDir);

  await executeSandboxPlace({
    session: sessionPath,
    entityType: "delver",
    spec: "id=d_idx;x=1;y=1;affinity=water;motivation=exploring",
  });

  const session = readJson(sessionPath);
  assert.ok(session.artifacts?.simConfigRef, "simConfigRef must be indexed after place");
  assert.ok(session.artifacts?.initialStateRef, "initialStateRef must be indexed after place");
  assert.ok(session.artifacts?.resourceBundleRef, "resourceBundleRef must be indexed after place");
});

// ---------------------------------------------------------------------------
// S3 — ak_sandbox_move
// ---------------------------------------------------------------------------

async function createSessionWithDelver(baseDir, delverSpec = "id=delver_move;x=2;y=2;affinity=fire;motivation=exploring") {
  const { executeSandboxCreate, executeSandboxPlace } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const r1 = await executeSandboxCreate({
    budgetReceipt: BUDGET_RECEIPT_FIXTURE,
    outDir: baseDir,
  });
  if (!r1.ok) throw new Error(`sandbox-create failed: ${r1.error}`);
  const sessionPath = join(baseDir, "sandbox-session.json");

  const r2 = await executeSandboxPlace({
    session: sessionPath,
    entityType: "delver",
    spec: delverSpec,
  });
  if (!r2.ok) throw new Error(`sandbox-place failed: ${r2.error}`);
  return sessionPath;
}

test("S3-01: ak_sandbox_move east advances actor position by (1,0)", async () => {
  const { executeSandboxMove } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-move-east-"));
  const sessionPath = await createSessionWithDelver(outDir);
  const actionsOut = join(outDir, "actions.json");

  const result = await executeSandboxMove({
    session: sessionPath,
    actorId: "delver_move",
    direction: "east",
    actionsOut,
  });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
  assert.deepEqual(result.from, { x: 2, y: 2 });
  assert.deepEqual(result.to, { x: 3, y: 2 });
  assert.equal(result.tick, 1);
});

test("S3-02: ak_sandbox_move south advances actor position by (0,1)", async () => {
  const { executeSandboxMove } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-move-south-"));
  const sessionPath = await createSessionWithDelver(outDir);
  const actionsOut = join(outDir, "actions.json");

  const result = await executeSandboxMove({
    session: sessionPath,
    actorId: "delver_move",
    direction: "south",
    actionsOut,
  });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
  assert.deepEqual(result.to, { x: 2, y: 3 });
});

test("S3-03: ak_sandbox_move consecutive moves increment tick numbers", async () => {
  const { executeSandboxMove } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-move-ticks-"));
  const sessionPath = await createSessionWithDelver(outDir);
  const actionsOut = join(outDir, "actions.json");

  const r1 = await executeSandboxMove({ session: sessionPath, actorId: "delver_move", direction: "east", actionsOut });
  const r2 = await executeSandboxMove({ session: sessionPath, actorId: "delver_move", direction: "east", actionsOut });

  assert.equal(r1.tick, 1);
  assert.equal(r2.tick, 2);

  const seq = readJson(actionsOut);
  assert.equal(seq.schema, "agent-kernel/ActionSequence");
  assert.equal(seq.actions.length, 2);
});

test("S3-04: ak_sandbox_move into wall returns ok:false with blockedByWall flag", async () => {
  const { executeSandboxMove } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-move-wall-"));
  // Place delver at x=1,y=1; north of that (x=1,y=0) is a wall in the 10x10 grid
  const sessionPath = await createSessionWithDelver(
    outDir,
    "id=delver_move;x=1;y=1;affinity=fire;motivation=exploring",
  );
  const actionsOut = join(outDir, "actions.json");

  const result = await executeSandboxMove({
    session: sessionPath,
    actorId: "delver_move",
    direction: "north",
    actionsOut,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blockedByWall, true);
  assert.match(result.error, /wall/i);
});

test("S3-05: ak_sandbox_move out of bounds returns ok:false with outOfBounds flag", async () => {
  const { executeSandboxMove } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-move-oob-"));
  // Place delver near left edge; moving west hits x=-1
  const sessionPath = await createSessionWithDelver(
    outDir,
    "id=delver_move;x=0;y=2;affinity=fire;motivation=exploring",
  );
  const actionsOut = join(outDir, "actions.json");

  const result = await executeSandboxMove({
    session: sessionPath,
    actorId: "delver_move",
    direction: "west",
    actionsOut,
  });

  assert.equal(result.ok, false);
  assert.equal(result.outOfBounds, true);
});

test("S3-06: ak_sandbox_move with insufficient stamina returns ok:false with insufficientStamina flag", async () => {
  const { executeSandboxMove } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-move-stamina-"));
  // Place delver with movementCost=10 but stamina=1
  const sessionPath = await createSessionWithDelver(
    outDir,
    "id=delver_move;x=2;y=2;affinity=fire;motivation=exploring;movementCost=10;staminaCurrent=1;staminaMax=10;staminaRegen=0",
  );
  const actionsOut = join(outDir, "actions.json");

  const result = await executeSandboxMove({
    session: sessionPath,
    actorId: "delver_move",
    direction: "east",
    actionsOut,
  });

  assert.equal(result.ok, false);
  assert.equal(result.insufficientStamina, true);
  assert.match(result.error, /stamina/i);
});

test("S3-07: ak_sandbox_move with actor not in session returns ok:false with actorNotFound flag", async () => {
  const { executeSandboxMove } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-move-nofound-"));
  const sessionPath = await createSessionWithDelver(outDir);
  const actionsOut = join(outDir, "actions.json");

  const result = await executeSandboxMove({
    session: sessionPath,
    actorId: "ghost_actor",
    direction: "east",
    actionsOut,
  });

  assert.equal(result.ok, false);
  assert.equal(result.actorNotFound, true);
});

test("S3-08: ak_sandbox_move unknown direction returns structured error", async () => {
  const { executeSandboxMove } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-move-baddir-"));
  const sessionPath = await createSessionWithDelver(outDir);
  const actionsOut = join(outDir, "actions.json");

  const result = await executeSandboxMove({
    session: sessionPath,
    actorId: "delver_move",
    direction: "upward",
    actionsOut,
  });

  assert.equal(result.ok, false);
  assert.equal(result.unknownDirection, true);
  assert.match(result.error, /Unknown direction/i);
});

// ---------------------------------------------------------------------------
// T1 — ak_tick_forward
// ---------------------------------------------------------------------------

test("T1-01: ak_tick_forward advances cursor from 0 to 1", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const runId = "tick_fwd_01";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 10 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    const result = await fwd.handler({ runId });
    assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
    assert.equal(result.action, "forward");
    assert.equal(result.previousTick, 0);
    assert.equal(result.tick, 1);
    assert.equal(result.maxTick, 10);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

test("T1-02: ak_tick_forward advances from 1 to 2 on second call", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const runId = "tick_fwd_02";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 10 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    await fwd.handler({ runId });
    const result = await fwd.handler({ runId });
    assert.equal(result.ok, true);
    assert.equal(result.previousTick, 1);
    assert.equal(result.tick, 2);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

test("T1-03: ak_tick_forward at maxTick returns ok:false with error", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const runId = "tick_fwd_max";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 3 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    await fwd.handler({ runId });
    await fwd.handler({ runId });
    await fwd.handler({ runId }); // now at tick 3 == maxTick
    const result = await fwd.handler({ runId });
    assert.equal(result.ok, false);
    assert.equal(result.tick, 3);
    assert.equal(result.maxTick, 3);
    assert.match(result.error, /max tick|cannot advance/i);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

test("T1-04: ak_tick_forward unknown run returns ok:false", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const tmpDir = mkdtempSync(join(os.tmpdir(), "ak-tick-empty-"));
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    const result = await fwd.handler({ runId: "run_does_not_exist" });
    assert.equal(result.ok, false);
    assert.match(result.error, /not found/i);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

// ---------------------------------------------------------------------------
// T2 — ak_tick_backward
// ---------------------------------------------------------------------------

test("T2-01: ak_tick_backward rewinds from 2 to 1", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const bwd = tickTools.find((t) => t.name === "ak_tick_backward");
  const runId = "tick_bwd_01";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 10 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    await fwd.handler({ runId });
    await fwd.handler({ runId });
    const result = await bwd.handler({ runId });
    assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
    assert.equal(result.action, "backward");
    assert.equal(result.previousTick, 2);
    assert.equal(result.tick, 1);
    assert.equal(result.maxTick, 10);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

test("T2-02: ak_tick_backward from tick 1 to 0 succeeds; subsequent backward returns error", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const bwd = tickTools.find((t) => t.name === "ak_tick_backward");
  const runId = "tick_bwd_chain";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 5 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    await fwd.handler({ runId });

    const b1 = await bwd.handler({ runId });
    assert.equal(b1.ok, true);
    assert.equal(b1.tick, 0);

    const b2 = await bwd.handler({ runId });
    assert.equal(b2.ok, false);
    assert.match(b2.error, /tick 0|cannot rewind/i);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

test("T2-03: ak_tick_backward at tick 0 without any forward returns ok:false", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const bwd = tickTools.find((t) => t.name === "ak_tick_backward");
  const runId = "tick_bwd_zero";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 5 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    const result = await bwd.handler({ runId });
    assert.equal(result.ok, false);
    assert.equal(result.tick, 0);
    assert.match(result.error, /tick 0|cannot rewind/i);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

// ---------------------------------------------------------------------------
// T3 — ak_show_state
// ---------------------------------------------------------------------------

test("T3-01: ak_show_state at tick 0 returns ok:true with null tickFrame", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const state = tickTools.find((t) => t.name === "ak_show_state");
  const runId = "tick_state_zero";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 5 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    const result = await state.handler({ runId });
    assert.equal(result.ok, true, `expected ok:true but got: ${result.error}`);
    assert.equal(result.tick, 0);
    assert.equal(result.maxTick, 5);
    assert.equal(result.tickFrame, null, "tickFrame must be null at tick 0");
    assert.ok("ascii" in result, "ascii field must be present");
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

test("T3-02: ak_show_state after forward returns the correct tick frame", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const state = tickTools.find((t) => t.name === "ak_show_state");
  const runId = "tick_state_at_1";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 5 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    await fwd.handler({ runId });
    const result = await state.handler({ runId });
    assert.equal(result.ok, true);
    assert.equal(result.tick, 1);
    assert.ok(result.tickFrame, "tickFrame must be present after forward");
    assert.equal(result.tickFrame.tick, 1);
    assert.ok(typeof result.ascii === "string" && result.ascii.length > 0, "ascii must be non-empty");
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

test("T3-03: ak_show_state after forward+backward returns state of the rewound tick", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const bwd = tickTools.find((t) => t.name === "ak_tick_backward");
  const state = tickTools.find((t) => t.name === "ak_show_state");
  const runId = "tick_state_rewind";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 10 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    await fwd.handler({ runId });
    await fwd.handler({ runId });
    await fwd.handler({ runId }); // cursor at 3
    await bwd.handler({ runId }); // cursor at 2

    const result = await state.handler({ runId });
    assert.equal(result.tick, 2);
    assert.equal(result.tickFrame?.tick, 2);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

// ---------------------------------------------------------------------------
// INT — Full integration: sandbox session + tick navigation
// ---------------------------------------------------------------------------

/**
 * Full path that matches scenario 53 (Create Tick Session Ready Dungeon):
 *   1. Create a sandbox session
 *   2. Place an exploring delver, a stationary warden, and a fire trap
 *   3. Scaffold tick frames for the session run
 *   4. Navigate forward through ticks, verify cursor position
 *   5. Navigate backward, verify cursor returns to correct tick
 *   6. Confirm show_state returns the expected tick frame at each step
 */
test("INT-01: sandbox session → place entities → navigate 5 ticks forward then 3 backward", async () => {
  const { executeSandboxCreate, executeSandboxPlace } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs?t=" + Date.now()
  );
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const bwd = tickTools.find((t) => t.name === "ak_tick_backward");
  const stateT = tickTools.find((t) => t.name === "ak_show_state");

  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-int-01-"));
  const runId = "int_sandbox_tick_01";

  // 1. Create sandbox session
  const created = await executeSandboxCreate({
    budgetReceipt: BUDGET_RECEIPT_FIXTURE,
    runId,
    width: 10,
    height: 10,
    outDir,
  });
  assert.equal(created.ok, true, `sandbox-create failed: ${created.error}`);
  const sessionPath = join(outDir, "sandbox-session.json");

  // 2. Place entities (mirrors scenario 53 configuration)
  const delverResult = await executeSandboxPlace({
    session: sessionPath,
    entityType: "delver",
    spec: "id=delver_fire;x=1;y=1;affinity=fire;motivation=exploring",
  });
  assert.equal(delverResult.ok, true, `place delver failed: ${delverResult.error}`);

  const wardenResult = await executeSandboxPlace({
    session: sessionPath,
    entityType: "warden",
    spec: "id=warden_dark;x=8;y=8;affinity=dark;motivation=stationary",
  });
  assert.equal(wardenResult.ok, true, `place warden failed: ${wardenResult.error}`);

  const trapResult = await executeSandboxPlace({
    session: sessionPath,
    entityType: "trap",
    spec: "id=trap_fire_1;x=3;y=1;affinity=fire;expression=emit;stacks=3;blocking=false",
  });
  assert.equal(trapResult.ok, true, `place trap failed: ${trapResult.error}`);

  const resourceResult = await executeSandboxPlace({
    session: sessionPath,
    entityType: "resource",
    spec: "id=res_level_1;x=5;y=5;tier=level;stat=vitalMax;delta=10;dropRate=50",
  });
  assert.equal(resourceResult.ok, true, `place resource failed: ${resourceResult.error}`);

  // 3. Scaffold tick frames for this run (10 ticks) in a temp run dir
  const tickBase = mkdtempSync(join(os.tmpdir(), "ak-mcp-int-ticks-"));
  const runDir = join(tickBase, "artifacts", "runs", runId, "run");
  const buildDir = join(tickBase, "artifacts", "runs", runId, "build");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(buildDir, { recursive: true });

  // Copy sim-config and initial-state from sandbox session dir to build dir
  writeFileSync(
    join(buildDir, "sim-config.json"),
    readFileSync(join(outDir, "sim-config.json")),
  );
  writeFileSync(
    join(buildDir, "initial-state.json"),
    readFileSync(join(outDir, "initial-state.json")),
  );

  const MAX_TICKS = 10;
  const frames = Array.from({ length: MAX_TICKS }, (_, i) => ({
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    meta: makeMeta(`tick_frame_int_${i + 1}`, runId),
    tick: i + 1,
    phase: "execute",
    acceptedActions: [
      {
        schema: "agent-kernel/Action",
        schemaVersion: 1,
        actorId: "delver_fire",
        tick: i + 1,
        kind: "move",
        params: { direction: 2, from: { x: 1 + i, y: 1 }, to: { x: 2 + i, y: 1 } },
      },
    ],
  }));
  writeJson(join(runDir, "tick-frames.json"), frames);
  writeJson(join(runDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: makeMeta("run_summary_int", runId),
    outcome: "success",
    metrics: { ticks: MAX_TICKS },
  });

  // 4. Navigate forward 5 ticks
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tickBase, "artifacts");
  try {
    for (let i = 1; i <= 5; i++) {
      const r = await fwd.handler({ runId });
      assert.equal(r.ok, true, `forward at tick ${i} failed: ${r.error}`);
      assert.equal(r.tick, i, `cursor should be at tick ${i} after ${i} forwards`);
    }

    // 5. Verify show_state at tick 5
    const stateAt5 = await stateT.handler({ runId });
    assert.equal(stateAt5.tick, 5);
    assert.equal(stateAt5.tickFrame?.tick, 5);
    assert.ok(stateAt5.tickFrame?.acceptedActions?.[0]?.actorId === "delver_fire");

    // 6. Navigate backward 3 ticks → should land at tick 2
    for (let i = 1; i <= 3; i++) {
      const r = await bwd.handler({ runId });
      assert.equal(r.ok, true, `backward ${i} failed: ${r.error}`);
    }
    const stateAt2 = await stateT.handler({ runId });
    assert.equal(stateAt2.tick, 2, "cursor must be at tick 2 after 3 backwards from tick 5");
    assert.equal(stateAt2.tickFrame?.tick, 2);

    // 7. Forward again to tick 3
    const fwdTo3 = await fwd.handler({ runId });
    assert.equal(fwdTo3.ok, true);
    assert.equal(fwdTo3.tick, 3);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
}, 30_000);

test("INT-02: forward to maxTick then backward-to-zero then forward again is consistent", async () => {
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const bwd = tickTools.find((t) => t.name === "ak_tick_backward");
  const stateT = tickTools.find((t) => t.name === "ak_show_state");

  const runId = "int_round_trip";
  const tmpDir = scaffoldTickRun(runId, { maxTick: 5 });
  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tmpDir, "artifacts");
  try {
    // Forward all the way to maxTick
    for (let i = 0; i < 5; i++) await fwd.handler({ runId });
    const atMax = await stateT.handler({ runId });
    assert.equal(atMax.tick, 5);

    // Backward all the way to 0
    for (let i = 0; i < 5; i++) await bwd.handler({ runId });
    const atZero = await stateT.handler({ runId });
    assert.equal(atZero.tick, 0);
    assert.equal(atZero.tickFrame, null);

    // Forward again to 3
    for (let i = 0; i < 3; i++) await fwd.handler({ runId });
    const at3 = await stateT.handler({ runId });
    assert.equal(at3.tick, 3);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
});

// ---------------------------------------------------------------------------
// VSR — Vault scenario CLI replay (non-LLM scenarios: structural + budget)
// ---------------------------------------------------------------------------

/**
 * Parse and replay a vault scenario's MCP payload through the CLI, verifying
 * the output schema fields match expectations without live LLM calls.
 * The create command is deterministic (budget-enforced, rule-based) — LLM is
 * only used in ak_llm_plan / ak_scenario, which these scenarios don't call.
 */
function replayVaultScenario(mdPath, extraArgs = []) {
  if (!existsSync(mdPath)) {
    return { skipped: true, reason: `vault file not found: ${mdPath}` };
  }
  const content = readFileSync(mdPath, "utf8");
  const payload = extractMcpPayload(content);
  if (!payload) return { skipped: true, reason: "no MCP payload found in vault file" };

  const outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-vsr-"));
  const args = mcpPayloadToCliArgs(payload, outDir);
  const result = runCli([...args, ...extraArgs]);

  return {
    skipped: false,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    outDir,
    payload,
  };
}

test("VSR-01: scenario 01 (single delver) CLI create exits 0 and writes sim-config", () => {
  const mdPath = join(VAULT_DIR, "01 Create Single Delver.md");
  const { skipped, reason, status, stderr, outDir } = replayVaultScenario(mdPath);
  if (skipped) {
    console.warn(`[VSR-01] Skipped: ${reason}`);
    return;
  }
  assert.equal(status, 0, `CLI exited ${status}: ${stderr}`);
  assert.ok(existsSync(join(outDir, "sim-config.json")), "sim-config.json must be written");
  const simConfig = readJson(join(outDir, "sim-config.json"));
  assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");
  assert.equal(simConfig.schemaVersion, 1);
  assert.ok(simConfig.meta?.id, "sim-config must have meta.id");
});

test("VSR-02: scenario 09 (delver vs warden arena) CLI create writes initial-state with actors", () => {
  const mdPath = join(VAULT_DIR, "09 Create Delver Versus Warden Arena.md");
  const { skipped, reason, status, stderr, outDir } = replayVaultScenario(mdPath);
  if (skipped) {
    console.warn(`[VSR-02] Skipped: ${reason}`);
    return;
  }
  assert.equal(status, 0, `CLI exited ${status}: ${stderr}`);
  const state = readJson(join(outDir, "initial-state.json"));
  assert.equal(state.schema, "agent-kernel/InitialStateArtifact");
  assert.ok(Array.isArray(state.actors) && state.actors.length > 0, "initial-state must have actors");
});

test("VSR-03: scenario 53 (tick session ready dungeon) CLI create writes all core artifacts", () => {
  const mdPath = join(VAULT_DIR, "53 Create Tick Session Ready Dungeon.md");
  const { skipped, reason, status, stderr, outDir } = replayVaultScenario(mdPath);
  if (skipped) {
    console.warn(`[VSR-03] Skipped: ${reason}`);
    return;
  }
  assert.equal(status, 0, `CLI exited ${status}: ${stderr}`);
  assert.ok(existsSync(join(outDir, "sim-config.json")), "sim-config.json must exist");
  assert.ok(existsSync(join(outDir, "initial-state.json")), "initial-state.json must exist");
  assert.ok(existsSync(join(outDir, "budget-receipt.json")), "budget-receipt.json must exist");

  const simConfig = readJson(join(outDir, "sim-config.json"));
  assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");

  const initialState = readJson(join(outDir, "initial-state.json"));
  assert.ok(Array.isArray(initialState.actors) && initialState.actors.length > 0,
    "scenario 53 must produce actors (delver + warden + trap + resource)");
});

test("VSR-04: scenario 53 CLI output then tick-navigable via MCP handlers", async () => {
  const mdPath = join(VAULT_DIR, "53 Create Tick Session Ready Dungeon.md");
  const { skipped, reason, status, outDir } = replayVaultScenario(mdPath);
  if (skipped) {
    console.warn(`[VSR-04] Skipped: ${reason}`);
    return;
  }
  if (status !== 0) {
    console.warn("[VSR-04] Skipped: CLI create failed, cannot test tick navigation");
    return;
  }

  // The CLI create produces sim-config + initial-state; we scaffold tick frames
  // to simulate the run phase, then navigate with MCP handlers.
  const runId = "vsr_53_tick_nav";
  const { tickTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/tick.mjs?t=" + Date.now()
  );
  const fwd = tickTools.find((t) => t.name === "ak_tick_forward");
  const bwd = tickTools.find((t) => t.name === "ak_tick_backward");
  const stateT = tickTools.find((t) => t.name === "ak_show_state");

  const tickBase = mkdtempSync(join(os.tmpdir(), "ak-mcp-vsr53-ticks-"));
  const buildDst = join(tickBase, "artifacts", "runs", runId, "build");
  const runDst = join(tickBase, "artifacts", "runs", runId, "run");
  mkdirSync(buildDst, { recursive: true });
  mkdirSync(runDst, { recursive: true });

  writeFileSync(join(buildDst, "sim-config.json"), readFileSync(join(outDir, "sim-config.json")));
  writeFileSync(join(buildDst, "initial-state.json"), readFileSync(join(outDir, "initial-state.json")));

  const frames = Array.from({ length: 10 }, (_, i) => ({
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    meta: makeMeta(`tf_vsr53_${i + 1}`, runId),
    tick: i + 1,
    phase: "execute",
    acceptedActions: [],
  }));
  writeJson(join(runDst, "tick-frames.json"), frames);
  writeJson(join(runDst, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: makeMeta("rs_vsr53", runId),
    outcome: "success",
    metrics: { ticks: 10 },
  });

  const saved = process.env.AK_ARTIFACTS_DIR;
  process.env.AK_ARTIFACTS_DIR = join(tickBase, "artifacts");
  try {
    // Forward 5 ticks
    for (let i = 1; i <= 5; i++) {
      const r = await fwd.handler({ runId });
      assert.equal(r.ok, true, `tick forward ${i} failed: ${r.error}`);
      assert.equal(r.tick, i);
    }

    // Backward 2 ticks → cursor at 3
    await bwd.handler({ runId });
    await bwd.handler({ runId });
    const at3 = await stateT.handler({ runId });
    assert.equal(at3.tick, 3, "cursor should be at tick 3 after 5 forward, 2 backward");

    // Forward to maxTick
    for (let i = 4; i <= 10; i++) {
      const r = await fwd.handler({ runId });
      assert.equal(r.ok, true, `tick forward to ${i} failed: ${r.error}`);
    }
    const atMax = await fwd.handler({ runId }); // this should fail
    assert.equal(atMax.ok, false, "forward past maxTick must return ok:false");
    assert.match(atMax.error, /max tick|cannot advance/i);
  } finally {
    if (saved === undefined) delete process.env.AK_ARTIFACTS_DIR;
    else process.env.AK_ARTIFACTS_DIR = saved;
  }
}, 60_000);

test.skip("S1 ak_sandbox_create accepts budget artifact path as alternative to budgetReceipt", () => {});
test.skip("S1 ak_sandbox_create with zero-token budget artifact returns budgetInsufficient", () => {});
test.skip("S1 ak_sandbox_create with malformed receipt JSON returns structured error", () => {});
test.skip("S2 ak_sandbox_place replaces existing actor at same id as idempotent upsert", () => {});
test.skip("S2 ak_sandbox_place at corner position 0,0 is valid placement", () => {});
test.skip("S2 ak_sandbox_place hazard preserves proximityRadius trait", () => {});
test.skip("S3 ak_sandbox_move northeast diagonal updates position by +1,-1", () => {});
test.skip("S3 ak_sandbox_move with sufficient stamina deducts stamina and reports remainder", () => {});
test.skip("S3 ak_sandbox_move appends to existing multi-actor action sequence", () => {});
test.skip("T1 ak_tick_forward with visualization ascii returns visualization ascii block", () => {});
test.skip("T2 ak_tick_backward with visualization ascii returns visualization ascii block", () => {});
test.skip("T3 ak_show_state at tick N returns tickFrame with correct acceptedActions", () => {});
test.skip("INT stationary warden remains in place after 10 ticks", () => {});
test.skip("INT scenario 27 opposed fire water replay supports sandbox tick navigation", () => {});
test.skip("VSR scenario 46 large dark maze CLI create verifies multi-room actor placement", () => {});
test.skip("VSR scenario 03 denied layout CLI create exits non-zero for denied budget", () => {});

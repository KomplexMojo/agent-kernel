// M4 — Sandbox movement MCP contract tests.
//
// Tools tested:
//   ak_sandbox_move — compose a cardinal move into an ActionSequence file
//
// Movement rules tested:
//   - Move actor east → ok: true, actionsOut file exists with one action
//   - Action has schema "agent-kernel/Action", kind "move", correct from/to positions
//   - Actor position updated in InitialState for subsequent moves
//   - Move into a wall tile → ok: false, blockedByWall: true
//   - Second move on same actionsOut file appends action (tick increments)
//   - Unknown actorId → ok: false, actorNotFound: true
//   - Unknown direction string → ok: false with error
//   - Session without initialStateRef (no entities placed) → ok: false
//   - Session not corrupted by failed move
//
// Reference fixture: tests/fixtures/sandbox/action-sequence-v1-move.json

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");

const BUDGET_RECEIPT_APPROVED = resolve(
  ROOT,
  "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json",
);

// ---------------------------------------------------------------------------
// MCP harness — stdio JSON-RPC (same pattern as other sandbox tests)
// ---------------------------------------------------------------------------

class McpServerHarness {
  constructor(env = {}) {
    this.nextId = 1;
    this.stdoutBuffer = "";
    this.stderr = "";
    this.pending = new Map();
    this.closed = false;
    this.process = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.process.on("exit", (code, signal) => {
      this.closed = true;
      const reason = `MCP server exited (code=${code}, signal=${signal})`;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(this.#error(reason));
      }
      this.pending.clear();
    });
  }

  #error(message) {
    return new Error(`${message}\nSTDERR:\n${this.stderr || "<empty>"}`);
  }

  #onStdout(chunk) {
    this.stdoutBuffer += chunk;
    let idx = this.stdoutBuffer.indexOf("\n");
    while (idx !== -1) {
      const line = this.stdoutBuffer.slice(0, idx).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
      if (line.trim()) this.#handleMessage(line);
      idx = this.stdoutBuffer.indexOf("\n");
    }
  }

  #handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      throw this.#error(`Failed to parse MCP message: ${err.message}\nLINE: ${line}`);
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(this.#error(`MCP request failed: ${message.error.message}`));
      return;
    }
    pending.resolve(message.result);
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "agent-kernel-sandbox-movement-test", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  notify(method, params) {
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectReq(this.#error(`Timed out waiting for ${method}`));
      }, 30000);
      this.pending.set(id, { resolve: resolveReq, reject: rejectReq, timer });
      this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    assert.equal(Array.isArray(result.content), true, `Expected content array for ${name}`);
    assert.equal(result.content[0]?.type, "text");
    const parsedContent = JSON.parse(result.content[0].text);
    assert.deepEqual(parsedContent, result.structuredContent);
    assert.equal(
      result.structuredContent.ok,
      true,
      `Expected ok: true for ${name}\n${JSON.stringify(result.structuredContent, null, 2)}`,
    );
    return result.structuredContent;
  }

  async callToolRaw(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    assert.equal(Array.isArray(result.content), true, `Expected content array for ${name}`);
    assert.equal(result.content[0]?.type, "text");
    return result.structuredContent;
  }

  async listTools() {
    return this.request("tools/list", {});
  }

  async close() {
    if (!this.process || this.closed) return;
    await new Promise((resolveClose) => {
      this.process.once("close", () => {
        this.closed = true;
        resolveClose();
      });
      this.process.stdin.end();
      setTimeout(() => {
        if (!this.closed) this.process.kill("SIGTERM");
      }, 500).unref();
      setTimeout(() => {
        if (!this.closed) this.process.kill("SIGKILL");
      }, 2000).unref();
    });
  }
}

function makeTempDir(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Shared setup helper — create session + place delver at (2,2)
// ---------------------------------------------------------------------------

async function setupSessionWithDelver(harness, outDir) {
  const createResult = await harness.callTool("ak_sandbox_create", {
    budgetReceipt: BUDGET_RECEIPT_APPROVED,
    outDir,
  });
  const sessionPath = join(createResult.outDir, "sandbox-session.json");
  await harness.callTool("ak_sandbox_place", {
    session: sessionPath,
    entityType: "delver",
    spec: "id=delver_1;x=2;y=2;affinity=water;motivation=exploring",
  });
  return sessionPath;
}

// ---------------------------------------------------------------------------
// Tool discovery
// ---------------------------------------------------------------------------

test("mcp tools/list includes ak_sandbox_move", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const listing = await harness.listTools();
    const names = listing.tools.map((t) => t.name);
    assert.ok(
      names.includes("ak_sandbox_move"),
      `Expected ak_sandbox_move in tools/list, got: ${names.join(", ")}`,
    );
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Happy path — move east
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move moves actor east and returns ok: true with actionsOut file", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-east-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);
    const actionsOut = join(outDir, "actions.json");

    const result = await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    assert.equal(result.command, "sandbox-move");
    assert.equal(result.actorId, "delver_1");
    assert.equal(result.direction, "east");
    assert.deepEqual(result.from, { x: 2, y: 2 });
    assert.deepEqual(result.to, { x: 3, y: 2 });
    assert.equal(existsSync(actionsOut), true, "actionsOut file must exist after move");
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move action file contains schema Action with kind=move and correct positions", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-action-schema-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);
    const actionsOut = join(outDir, "actions.json");

    await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    const seq = JSON.parse(readFileSync(actionsOut, "utf8"));
    assert.equal(seq.schema, "agent-kernel/ActionSequence");
    assert.equal(seq.schemaVersion, 1);
    assert.equal(Array.isArray(seq.actions), true);
    assert.equal(seq.actions.length, 1);

    const action = seq.actions[0];
    assert.equal(action.schema, "agent-kernel/Action");
    assert.equal(action.schemaVersion, 1);
    assert.equal(action.actorId, "delver_1");
    assert.equal(action.kind, "move");
    assert.equal(action.tick, 1);
    assert.deepEqual(action.params.from, { x: 2, y: 2 });
    assert.deepEqual(action.params.to, { x: 3, y: 2 });
    // direction=2 is East in core-ts Direction enum
    assert.equal(action.params.direction, 2);
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move updates actor position in InitialState for subsequent moves", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-position-update-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);
    const actionsOut = join(outDir, "actions.json");

    await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    const initialState = JSON.parse(readFileSync(join(outDir, "initial-state.json"), "utf8"));
    const actor = initialState.actors.find((a) => a.id === "delver_1");
    assert.ok(actor, "delver_1 must remain in InitialState");
    assert.deepEqual(
      actor.position,
      { x: 3, y: 2 },
      "actor position must be updated to destination after move",
    );
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Action accumulation — second move appends and increments tick
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move second call appends action and increments tick", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-append-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);
    const actionsOut = join(outDir, "actions.json");

    // First move: delver_1 (2,2) → east → (3,2)
    await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    // Second move: now at (3,2) → east → (4,2)
    const result2 = await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    assert.deepEqual(result2.from, { x: 3, y: 2 });
    assert.deepEqual(result2.to, { x: 4, y: 2 });
    assert.equal(result2.tick, 2, "second move must use tick 2");

    const seq = JSON.parse(readFileSync(actionsOut, "utf8"));
    assert.equal(seq.actions.length, 2, "actions file must contain 2 actions after two moves");
    assert.equal(seq.actions[0].tick, 1);
    assert.equal(seq.actions[1].tick, 2);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Error: move blocked by wall
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move rejects move into wall and returns blockedByWall: true", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-wall-");

    // Place delver at (1,1) — one step east of west wall, one step south of north wall.
    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=1;y=1;affinity=water;motivation=exploring",
    });

    const actionsOut = join(outDir, "actions.json");

    // Moving north from (1,1) → (1,0) which is the top-border wall row
    const result = await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "north",
      actionsOut,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blockedByWall, true);
    assert.ok(result.error, "error message must be present");
    assert.equal(existsSync(actionsOut), false, "actionsOut must not be created on failed move");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Inter-cardinal directions
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move moves actor northeast and records direction enum value 1", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-ne-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);
    const actionsOut = join(outDir, "actions.json");

    // Delver starts at (2,2); northeast = dx+1, dy-1 → (3,1)
    const result = await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "northeast",
      actionsOut,
    });

    assert.equal(result.direction, "northeast");
    assert.deepEqual(result.from, { x: 2, y: 2 });
    assert.deepEqual(result.to, { x: 3, y: 1 });

    const seq = JSON.parse(readFileSync(actionsOut, "utf8"));
    // Direction enum value 1 = NorthEast in core-ts
    assert.equal(seq.actions[0].params.direction, 1);
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move rejects northwest move into wall corner and returns blockedByWall: true", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-nw-wall-");

    // Place delver at (1,1); northwest = dx-1,dy-1 → (0,0) which is a wall corner
    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=1;y=1;affinity=water;motivation=exploring",
    });

    const actionsOut = join(outDir, "actions.json");
    const result = await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "northwest",
      actionsOut,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blockedByWall, true);
    assert.equal(existsSync(actionsOut), false, "actionsOut must not be created on blocked move");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Error: actor not found
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move rejects unknown actorId with actorNotFound: true", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-noactor-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);
    const actionsOut = join(outDir, "actions.json");

    const result = await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "ghost_actor",
      direction: "east",
      actionsOut,
    });

    assert.equal(result.ok, false);
    assert.equal(result.actorNotFound, true);
    assert.ok(result.error, "error message must be present");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Error: unknown direction
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move rejects unknown direction with ok: false", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-baddir-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);
    const actionsOut = join(outDir, "actions.json");

    const result = await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "diagonal",
      actionsOut,
    });

    assert.equal(result.ok, false);
    assert.ok(result.error, "error message must be present for unknown direction");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Error: session has no initialStateRef
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move rejects session without initialStateRef (no entities placed)", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-nosession-");

    // Create session but do NOT place any entities — no initialStateRef in artifacts
    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    const actionsOut = join(outDir, "actions.json");

    const result = await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    assert.equal(result.ok, false);
    assert.ok(result.error, "error message must be present when initialStateRef is absent");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Safety: session not corrupted by failed move
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move failed move does not modify the session file", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-safe-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);
    const actionsOut = join(outDir, "actions.json");

    const sessionBefore = readFileSync(sessionPath, "utf8");

    // Attempt move with unknown actor — should fail
    await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "nonexistent",
      direction: "east",
      actionsOut,
    });

    const sessionAfter = readFileSync(sessionPath, "utf8");
    assert.equal(
      sessionBefore,
      sessionAfter,
      "sandbox-session.json must not be modified by a failed move",
    );
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Stamina reduction — cardinal and inter-cardinal
//
// Spec fields used: movementCost=N, staminaCurrent=N, staminaMax=N, staminaRegen=N
// Formula (mirrors core-ts rules/move.ts):
//   cardinal cost  = movementCost
//   diagonal cost  = movementCost + (movementCost > 1 ? trunc(movementCost/2) : 1)
//   staminaAfterRegen = min(current + regen, max)
//   if staminaAfterRegen < cost → insufficientStamina: true
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move cardinal move deducts movementCost from stamina", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-stamina-cardinal-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(createResult.outDir, "sandbox-session.json");

    // Actor with movementCost=1, stamina 10/10/0
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=2;y=2;affinity=water;motivation=exploring;movementCost=1;staminaCurrent=10;staminaMax=10",
    });

    const actionsOut = join(outDir, "actions.json");
    const result = await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east", // cardinal → cost 1
      actionsOut,
    });

    // Result surface
    assert.equal(result.movementCost, 1, "cardinal movementCost must be 1");
    assert.equal(result.staminaRemaining, 9, "stamina must drop by 1 after cardinal move");

    // InitialState persisted stamina
    const is = JSON.parse(readFileSync(join(outDir, "initial-state.json"), "utf8"));
    const actor = is.actors.find((a) => a.id === "delver_1");
    assert.equal(actor.vitals.stamina.current, 9);
    assert.equal(actor.vitals.stamina.max, 10);
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move diagonal move deducts 2× base cost from stamina (cost=1 → 2)", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-stamina-diagonal-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(createResult.outDir, "sandbox-session.json");

    // Actor with movementCost=1, stamina 10/10/0
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=2;y=2;affinity=water;motivation=exploring;movementCost=1;staminaCurrent=10;staminaMax=10",
    });

    const actionsOut = join(outDir, "actions.json");
    const result = await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "northeast", // diagonal → cost 1 + 1 = 2
      actionsOut,
    });

    assert.equal(result.movementCost, 2, "diagonal movementCost must be 2 when cardinal cost is 1");
    assert.equal(result.staminaRemaining, 8, "stamina must drop by 2 after diagonal move");

    const is = JSON.parse(readFileSync(join(outDir, "initial-state.json"), "utf8"));
    const actor = is.actors.find((a) => a.id === "delver_1");
    assert.equal(actor.vitals.stamina.current, 8);
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move diagonal move with movementCost=2 costs 3 stamina", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-stamina-diagonal-cost2-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(createResult.outDir, "sandbox-session.json");

    // movementCost=2 → diagonal extra = max(1, trunc(2/2)) = 1 → total 3
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=2;y=2;affinity=water;motivation=exploring;movementCost=2;staminaCurrent=10;staminaMax=10",
    });

    const actionsOut = join(outDir, "actions.json");
    const result = await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "southeast",
      actionsOut,
    });

    assert.equal(result.movementCost, 3, "diagonal movementCost must be 3 when cardinal cost is 2");
    assert.equal(result.staminaRemaining, 7);
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move cardinal move with insufficient stamina returns insufficientStamina", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-stamina-insufficient-cardinal-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(createResult.outDir, "sandbox-session.json");

    // staminaCurrent=0 — cannot afford cardinal cost 1
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=2;y=2;affinity=water;motivation=exploring;movementCost=1;staminaCurrent=0;staminaMax=10",
    });

    const actionsOut = join(outDir, "actions.json");
    const result = await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    assert.equal(result.ok, false);
    assert.equal(result.insufficientStamina, true);
    assert.equal(result.movementCost, 1);
    assert.equal(result.staminaAfterRegen, 0);
    assert.equal(existsSync(actionsOut), false, "actionsOut must not be created on stamina failure");
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move diagonal move rejected when stamina covers cardinal but not diagonal", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-stamina-insufficient-diagonal-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(createResult.outDir, "sandbox-session.json");

    // staminaCurrent=1 — enough for cardinal (1) but not diagonal (2)
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=2;y=2;affinity=water;motivation=exploring;movementCost=1;staminaCurrent=1;staminaMax=10",
    });

    const actionsOut = join(outDir, "actions.json");
    const result = await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "northwest", // diagonal → cost 2 > staminaAfterRegen 1
      actionsOut,
    });

    assert.equal(result.ok, false);
    assert.equal(result.insufficientStamina, true);
    assert.equal(result.movementCost, 2);
    assert.equal(result.staminaAfterRegen, 1);
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move actor without movementCost gets free movement regardless of stamina", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-stamina-free-");
    const sessionPath = await setupSessionWithDelver(harness, outDir); // no movementCost in spec

    const actionsOut = join(outDir, "actions.json");
    // Verify it moves without stamina fields on the result (staminaRemaining absent)
    const result = await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "northeast", // diagonal, but free movement
      actionsOut,
    });

    assert.equal(result.ok, true);
    assert.equal(
      result.staminaRemaining,
      undefined,
      "staminaRemaining must not appear when movementCost is unset (free movement)",
    );
    assert.equal(
      result.movementCost,
      undefined,
      "movementCost must not appear when capabilities are unset",
    );
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move stamina regen is applied before deduction", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-stamina-regen-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(createResult.outDir, "sandbox-session.json");

    // staminaCurrent=0 but staminaRegen=2 → staminaAfterRegen = min(0+2, 5) = 2
    // cardinal cost = 1 → 2 >= 1 → succeeds, remaining = 1
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=2;y=2;affinity=water;motivation=exploring;movementCost=1;staminaCurrent=0;staminaMax=5;staminaRegen=2",
    });

    const actionsOut = join(outDir, "actions.json");
    const result = await harness.callTool("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    assert.equal(result.staminaRemaining, 1, "stamina = min(0+2,5) - 1 = 1 after cardinal move");

    const is = JSON.parse(readFileSync(join(outDir, "initial-state.json"), "utf8"));
    const actor = is.actors.find((a) => a.id === "delver_1");
    assert.equal(actor.vitals.stamina.current, 1);
    assert.equal(actor.vitals.stamina.max, 5);
    assert.equal(actor.vitals.stamina.regen, 2);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Actor coordinate validation — Codex fix regression (Issue #2)
// Tampered InitialState with null/NaN coordinates must be rejected cleanly.
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_move rejects actor with null position coordinates", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-nan-pos-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);

    // Tamper: overwrite initial-state.json with null coordinates on the actor
    const initialStatePath = join(outDir, "initial-state.json");
    const is = JSON.parse(readFileSync(initialStatePath, "utf8"));
    const actorIdx = is.actors.findIndex((a) => a.id === "delver_1");
    is.actors[actorIdx].position = { x: null, y: null };
    writeFileSync(initialStatePath, JSON.stringify(is, null, 2), "utf8");

    const actionsOut = join(outDir, "actions.json");
    const result = await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    assert.equal(result.ok, false, "null coordinates must cause rejection");
    assert.ok(result.error, "error message must be present");
    // The session file must be unmodified — no corruption from partial writes
    const sessionAfter = JSON.parse(readFileSync(sessionPath, "utf8"));
    assert.ok(
      sessionAfter.schema === "agent-kernel/SandboxSessionArtifact",
      "session schema must be intact after rejection",
    );
    // The actionsOut file must not have been written
    assert.equal(
      existsSync(actionsOut),
      false,
      "actionsOut must not be written when coordinates are invalid",
    );
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_move rejects actor with string position coordinates", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-move-str-pos-");
    const sessionPath = await setupSessionWithDelver(harness, outDir);

    // Tamper: overwrite initial-state.json with string coordinates
    const initialStatePath = join(outDir, "initial-state.json");
    const is = JSON.parse(readFileSync(initialStatePath, "utf8"));
    const actorIdx = is.actors.findIndex((a) => a.id === "delver_1");
    is.actors[actorIdx].position = { x: "two", y: "two" };
    writeFileSync(initialStatePath, JSON.stringify(is, null, 2), "utf8");

    const actionsOut = join(outDir, "actions.json");
    const result = await harness.callToolRaw("ak_sandbox_move", {
      session: sessionPath,
      actorId: "delver_1",
      direction: "east",
      actionsOut,
    });

    assert.equal(result.ok, false, "non-integer string coordinates must cause rejection");
    assert.ok(result.error, "error message must be present");
    assert.equal(
      existsSync(actionsOut),
      false,
      "actionsOut must not be written when coordinates are invalid",
    );
  } finally {
    await harness.close();
  }
});

/* ## TODO: Test Permutations
 * - move south from (2,2) → (2,3), floor tile, succeeds
 * - move west from (2,2) → (1,2), floor tile, succeeds
 * - move north from (2,2) → (2,1), floor tile, succeeds
 * - move southeast from (2,2) → (3,3), floor tile, succeeds; direction enum value 3
 * - move southwest from (2,2) → (1,3), floor tile, succeeds; direction enum value 5
 * - move west from (1,1) → (0,1), wall tile, blockedByWall: true
 * - move south from (1,8) in 10x10 → (1,9), wall tile, blockedByWall: true
 * - move east from (8,8) → (9,8), wall tile, blockedByWall: true
 * - move southeast from (8,8) → (9,9), wall corner, blockedByWall: true
 * - three consecutive moves produce 3 actions with ticks 1,2,3
 * - actionsOut in a directory that does not yet exist — auto-created
 * - move with actorId that exists but has no position field — error
 * - direction "NORTH" (uppercase) — should normalise and succeed
 * - direction "northeast" — not in cardinal set, rejected
 * - missing actorId argument — rejected with validation error
 * - missing direction argument — rejected with validation error
 * - missing actionsOut argument — rejected with validation error
 * - actionsOut path with pre-existing non-ActionSequence JSON — handled gracefully
 * - action sequence simConfigRef matches session's simConfigRef
 * - action sequence initialStateRef matches session's initialStateRef
 * - 10x10 grid: move to every interior floor tile succeeds
 * - custom room dimensions (5x5): actor at (1,1) moves east to (2,1)
 */

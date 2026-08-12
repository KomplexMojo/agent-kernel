// M3 — Sandbox entity placement MCP contract tests.
//
// Tools tested:
//   ak_sandbox_place — place and configure entities in an existing sandbox session
//
// Placement rules tested:
//   - Valid hazard placement → ok: true, sim-config.json + initial-state.json written
//   - Valid delver, warden, hazard, resource placement → ok: true
//   - Session artifacts index updated with simConfigRef, initialStateRef, resourceBundleRef
//   - Out-of-bounds position (x=999,y=999 in 10x10 room) → ok: false, outOfBounds: true
//   - Multiple placements accumulate actors in InitialState
//
// Regression:
//   - ak_sandbox_create must still work (sanity)

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
      clientInfo: { name: "agent-kernel-sandbox-entities-test", version: "1.0.0" },
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
// Tool discovery
// ---------------------------------------------------------------------------

test("mcp tools/list includes ak_sandbox_place", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const listing = await harness.listTools();
    const names = listing.tools.map((t) => t.name);
    assert.ok(
      names.includes("ak_sandbox_place"),
      `Expected ak_sandbox_place in tools/list, got: ${names.join(", ")}`,
    );
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Happy path — single entity placement
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_place places a hazard entity and returns ok: true", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-hazard-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });

    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    const placeResult = await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "hazard",
      spec: "id=hazard_fire;x=4;y=4;affinity=fire;expression=emit;stacks=2",
    });

    assert.equal(placeResult.command, "sandbox-place");
    assert.equal(placeResult.entityType, "hazard");
    assert.equal(placeResult.entityId, "hazard_fire");
    assert.deepEqual(placeResult.position, { x: 4, y: 4 });
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_place places a delver entity", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-delver-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });

    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    const result = await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=1;y=1;affinity=water;motivation=exploring",
    });

    assert.equal(result.entityType, "delver");
    assert.equal(result.entityId, "delver_1");
    assert.deepEqual(result.position, { x: 1, y: 1 });
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_place places a warden entity", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-warden-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });

    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    const result = await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "warden",
      spec: "id=warden_1;x=2;y=1;affinity=fire;motivation=defending",
    });

    assert.equal(result.entityType, "warden");
    assert.equal(result.entityId, "warden_1");
    assert.deepEqual(result.position, { x: 2, y: 1 });
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_place places a hazard entity", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-hazard-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });

    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    const result = await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "hazard",
      spec: "id=hazard_1;x=3;y=2;affinity=dark;expression=emit;stacks=1;blocking=false",
    });

    assert.equal(result.entityType, "hazard");
    assert.equal(result.entityId, "hazard_1");
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_place places a resource entity", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-resource-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });

    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    const result = await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "resource",
      spec: "id=res_1;x=3;y=3;tier=level;stat=affinityStack;delta=1;dropRate=1",
    });

    assert.equal(result.entityType, "resource");
    assert.equal(result.entityId, "res_1");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Artifact persistence
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_place writes sim-config.json and initial-state.json", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-files-");

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

    assert.equal(existsSync(join(outDir, "sim-config.json")), true, "sim-config.json must exist");
    assert.equal(
      existsSync(join(outDir, "initial-state.json")),
      true,
      "initial-state.json must exist",
    );
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_place updates session artifacts index with all refs", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-refs-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });

    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "hazard",
      spec: "id=hazard_fire;x=4;y=4;affinity=fire;expression=emit;stacks=2",
    });

    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    const refs = JSON.stringify(session.artifacts || session);

    assert.ok(refs.includes("sim-config"), "session.artifacts must contain sim-config reference");
    assert.ok(
      refs.includes("initial-state"),
      "session.artifacts must contain initial-state reference",
    );
    assert.ok(
      refs.includes("resource-bundle"),
      "session.artifacts must contain resource-bundle reference",
    );
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_place second placement appends actor in InitialState", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-multi-");

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
    await harness.callTool("ak_sandbox_place", {
      session: sessionPath,
      entityType: "warden",
      spec: "id=warden_1;x=2;y=1;affinity=fire;motivation=defending",
    });

    const initialState = JSON.parse(
      readFileSync(join(outDir, "initial-state.json"), "utf8"),
    );
    const actorIds = initialState.actors.map((a) => a.id);
    assert.ok(actorIds.includes("delver_1"), "delver_1 must be in InitialState");
    assert.ok(actorIds.includes("warden_1"), "warden_1 must be in InitialState");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Error: out-of-bounds placement
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_place rejects out-of-bounds position (999,999 in 10x10 room)", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-oob-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });

    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    const result = await harness.callToolRaw("ak_sandbox_place", {
      session: sessionPath,
      entityType: "hazard",
      spec: "id=bad_hazard;x=999;y=999;affinity=fire;expression=emit;stacks=1",
    });

    assert.equal(result.ok, false);
    assert.equal(result.outOfBounds, true);
    assert.ok(result.error, "error message must be present");
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_place prior session is not corrupted by rejected out-of-bounds placement", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-oob-safe-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });

    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    const sessionBefore = readFileSync(sessionPath, "utf8");

    // Attempt out-of-bounds placement
    await harness.callToolRaw("ak_sandbox_place", {
      session: sessionPath,
      entityType: "hazard",
      spec: "id=bad_hazard;x=999;y=999;affinity=fire;expression=emit;stacks=1",
    });

    // Session should be unchanged
    const sessionAfter = readFileSync(sessionPath, "utf8");
    assert.equal(sessionBefore, sessionAfter, "session must not be modified by rejected placement");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Validate-before-write ordering — Codex fix regression (Issue #3)
// If session validation fails, no artifact files should be written to disk.
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_place does not write artifact files when session validation fails", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-place-validate-order-");

    const createResult = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });

    // Tamper: inject an invalid entityCategories value into the session so
    // validateSandboxSession(updatedSession) will fail during placement.
    const sessionPath = join(createResult.outDir, "sandbox-session.json");
    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    session.entityCategories = ["invalid_category_xyz"];
    writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf8");

    // Attempt placement — validation must fail because of invalid entityCategories
    const result = await harness.callToolRaw("ak_sandbox_place", {
      session: sessionPath,
      entityType: "delver",
      spec: "id=delver_1;x=2;y=2;affinity=water;motivation=exploring",
    });

    assert.equal(result.ok, false, "placement must fail when session is invalid");
    assert.ok(result.error, "error message must be present");

    // Critical: the artifact files must NOT have been written before the validation check.
    // Pre-fix: sim-config.json, initial-state.json, resource-bundle.json were written first.
    // Post-fix: validation happens before any writeJson calls.
    const simConfigPath = join(outDir, "sim-config.json");
    const initialStatePath = join(outDir, "initial-state.json");
    const resourceBundlePath = join(outDir, "resource-bundle.json");

    assert.equal(
      existsSync(simConfigPath),
      false,
      "sim-config.json must not be written when session validation fails",
    );
    assert.equal(
      existsSync(initialStatePath),
      false,
      "initial-state.json must not be written when session validation fails",
    );
    assert.equal(
      existsSync(resourceBundlePath),
      false,
      "resource-bundle.json must not be written when session validation fails",
    );
  } finally {
    await harness.close();
  }
});

test.skip("mcp ak_sandbox_place allows boundary corner position 0,0", () => {});
test.skip("mcp ak_sandbox_place allows max valid position 9,9 in 10x10", () => {});
test.skip("mcp ak_sandbox_place rejects x=10 in 10x10 as out of bounds", () => {});
test.skip("mcp ak_sandbox_place replaces existing actor by id with new position", () => {});
test.skip("mcp ak_sandbox_place rejects spec missing x or y", () => {});
test.skip("mcp ak_sandbox_place rejects non-integer x or y", () => {});
test.skip("mcp ak_sandbox_place handles missing id deterministically", () => {});
test.skip("mcp ak_sandbox_place rejects unsupported entityType with structured error", () => {});
test.skip("mcp ak_sandbox_place rejects missing session path with structured error", () => {});
test.skip("mcp ak_sandbox_place rejects non-existent session file with structured error", () => {});
test.skip("mcp ak_sandbox_place supports non-default room dimensions 20x15", () => {});
test.skip("mcp ak_sandbox_place writes InitialState actor archetype matching entityType", () => {});
test.skip("mcp ak_sandbox_place writes SimConfig dimensions from session room", () => {});
test.skip("mcp ak_sandbox_place writes valid grid with walls on border", () => {});
test.skip("mcp ak_sandbox_place writes ResourceBundle schemaVersion 2", () => {});
test.skip("mcp ak_sandbox_place handles malformed spec string deterministically", () => {});

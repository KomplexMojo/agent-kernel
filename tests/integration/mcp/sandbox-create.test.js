// M2 — Sandbox creation MCP contract tests.
//
// Tools tested:
//   ak_sandbox_create — create a SandboxSessionArtifact with budget enforcement
//
// Budget enforcement rules tested:
//   - Denied BudgetReceiptArtifact → ok: false, budgetInsufficient: true
//   - Zero-token BudgetArtifact    → ok: false, budgetInsufficient: true
//   - No budget inputs             → ok: false, budgetRequired: true
//   - Approved receipt             → ok: true, sandbox-session.json written
//
// Regression:
//   - ak_create must still appear in tools/list

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");

// Fixtures
const BUDGET_RECEIPT_APPROVED = resolve(
  ROOT,
  "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json",
);
const BUDGET_RECEIPT_DENIED = resolve(
  ROOT,
  "tests/fixtures/sandbox/budget-receipt-v1-denied.json",
);
const BUDGET_BASIC = resolve(
  ROOT,
  "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
);
const BUDGET_ZERO_TOKENS = resolve(
  ROOT,
  "tests/fixtures/sandbox/budget-v1-zero-tokens.json",
);

// ---------------------------------------------------------------------------
// MCP harness — stdio JSON-RPC (same pattern as mcp-tick-control.test.js)
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
      clientInfo: { name: "agent-kernel-sandbox-create-test", version: "1.0.0" },
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

  // Like callTool but does not assert ok===true — used for budget enforcement failures
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

test("mcp tools/list includes ak_sandbox_create", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const listing = await harness.listTools();
    const names = listing.tools.map((t) => t.name);
    assert.ok(
      names.includes("ak_sandbox_create"),
      `Expected ak_sandbox_create in tools/list, got: ${names.join(", ")}`,
    );
  } finally {
    await harness.close();
  }
});

test("mcp tools/list still includes ak_create (no regression)", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const listing = await harness.listTools();
    const names = listing.tools.map((t) => t.name);
    assert.ok(names.includes("ak_create"), "ak_create must still be present");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Happy path — approved budget receipt
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_create with approved budget receipt returns ok: true", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-create-");
    const result = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    assert.equal(result.command, "sandbox-create");
    assert.ok(result.sandboxId, "sandboxId must be present");
    assert.ok(result.runId, "runId must be present");
    assert.equal(result.outDir, outDir);
    assert.ok(Array.isArray(result.rooms), "rooms must be an array");
    assert.equal(result.rooms.length, 1, "default is a single room");
    assert.ok(result.artifacts?.budgetReceiptRef, "artifacts.budgetReceiptRef must be present");
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_create writes sandbox-session.json to outDir", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-session-file-");
    await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    const sessionPath = join(outDir, "sandbox-session.json");
    assert.equal(existsSync(sessionPath), true, "sandbox-session.json must exist");
    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    assert.equal(session.schema, "agent-kernel/SandboxSessionArtifact");
    assert.equal(session.schemaVersion, 1);
    assert.ok(session.meta?.id, "session meta.id must be present");
    assert.ok(session.artifacts?.budgetReceiptRef, "session artifacts.budgetReceiptRef must be present");
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_create default room is 10x10", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-default-room-");
    const result = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      outDir,
    });
    assert.equal(result.rooms[0].width, 10);
    assert.equal(result.rooms[0].height, 10);
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_create accepts custom room dimensions", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-custom-dim-");
    const result = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      width: 20,
      height: 15,
      outDir,
    });
    assert.equal(result.rooms[0].width, 20);
    assert.equal(result.rooms[0].height, 15);
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_create accepts valid entity categories", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-entity-cats-");
    const result = await harness.callTool("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_APPROVED,
      entityCategories: ["delver", "warden"],
      outDir,
    });
    assert.deepEqual(result.entityCategories, ["delver", "warden"]);
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_create with budget artifact (approved) returns ok: true", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-budget-art-");
    const result = await harness.callTool("ak_sandbox_create", {
      budget: BUDGET_BASIC,
      outDir,
    });
    assert.equal(result.command, "sandbox-create");
    assert.ok(result.sandboxId);
    assert.ok(result.artifacts?.budgetReceiptRef);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Budget enforcement — denied receipt
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_create with denied budget receipt returns ok: false, budgetInsufficient: true", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-denied-");
    const result = await harness.callToolRaw("ak_sandbox_create", {
      budgetReceipt: BUDGET_RECEIPT_DENIED,
      outDir,
    });
    assert.equal(result.ok, false);
    assert.equal(result.budgetInsufficient, true);
    assert.ok(result.error, "error message must be present");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Budget enforcement — zero-token budget artifact
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_create with zero-token budget artifact returns ok: false, budgetInsufficient: true", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-zero-tok-");
    const result = await harness.callToolRaw("ak_sandbox_create", {
      budget: BUDGET_ZERO_TOKENS,
      outDir,
    });
    assert.equal(result.ok, false);
    assert.equal(result.budgetInsufficient, true);
    assert.ok(result.error, "error message must be present");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Budget enforcement — missing budget inputs
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_create without budget inputs returns ok: false, budgetRequired: true", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-no-budget-");
    const result = await harness.callToolRaw("ak_sandbox_create", {
      outDir,
    });
    assert.equal(result.ok, false);
    assert.equal(result.budgetRequired, true);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Budget receipt validation — Codex fix regression (Issue #1)
// Malformed receipts that share the right schema must still be rejected.
// ---------------------------------------------------------------------------

test("mcp ak_sandbox_create rejects budget receipt with missing meta.id", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-receipt-no-meta-id-");
    const result = await harness.callToolRaw("ak_sandbox_create", {
      budgetReceipt: resolve(ROOT, "tests/fixtures/sandbox/budget-receipt-v1-missing-meta-id.json"),
      outDir,
    });
    assert.equal(result.ok, false, "missing meta.id must cause rejection");
    assert.ok(result.error, "error message must be present");
    assert.ok(result.error.includes("meta.id"), "error must mention meta.id");
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_create rejects budget receipt with unknown status (not approved)", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-receipt-unknown-status-");
    const result = await harness.callToolRaw("ak_sandbox_create", {
      budgetReceipt: resolve(ROOT, "tests/fixtures/sandbox/budget-receipt-v1-unknown-status.json"),
      outDir,
    });
    assert.equal(result.ok, false, "unknown status must cause rejection");
    assert.equal(result.budgetInsufficient, true, "must signal budgetInsufficient");
    assert.ok(result.error, "error message must be present");
  } finally {
    await harness.close();
  }
});

test("mcp ak_sandbox_create rejects budget receipt with missing lineItems array", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-sandbox-receipt-no-lineitems-");
    const result = await harness.callToolRaw("ak_sandbox_create", {
      budgetReceipt: resolve(ROOT, "tests/fixtures/sandbox/budget-receipt-v1-missing-line-items.json"),
      outDir,
    });
    assert.equal(result.ok, false, "missing lineItems must cause rejection");
    assert.ok(result.error, "error message must be present");
  } finally {
    await harness.close();
  }
});

/* ## TODO: Test Permutations
 * - budget receipt with partial status (ok: true)
 * - budget receipt with remaining === 0 (ok: true — zero remaining but not denied)
 * - custom runId is reflected in sandboxId and session meta
 * - custom createdAt is reflected in session meta
 * - outDir defaults to artifacts/sandbox/<runId> when not provided
 * - entity categories as empty array (no entityCategories key in result)
 * - entity categories with invalid value (should be ignored by handler or cause validation error)
 * - budget artifact with negative tokens (ok: false, budgetInsufficient: true)
 * - budget artifact with missing budget.tokens field (ok: false, budgetInsufficient: true)
 * - sandbox-session.json schema validates against SANDBOX_SESSION_SCHEMA
 * - budgetReceiptRef in written session matches loaded receipt meta.id when using budget receipt
 * - budgetReceiptRef in written session has a synthetic id when using budget artifact
 */

// M5 — Sandbox tick navigation MCP contract tests.
//
// Tools tested:
//   ak_tick_forward  — advance the session cursor one tick on a sandbox-produced run
//   ak_tick_backward — rewind the session cursor one tick on a sandbox-produced run
//   ak_show_state    — return current state at the cursor tick for a sandbox-produced run
//
// Setup:
//   The sandbox CLI pipeline (sandbox-create → sandbox-place → run) produces a real
//   tick-frames.json under {artifactsDir}/runs/{runId}/run/.  The MCP server is spawned
//   with AK_ARTIFACTS_DIR pointing at that same tree so resolveRunDir resolves correctly.
//
// Also verified:
//   - The cli `run` command succeeds on sandbox-produced sim-config + initial-state
//   - Deferred controls (autoplay, pause, jump-to-tick, create-with-tick-count) are
//     NOT exposed through the MCP tools/list

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, mkdirSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT   = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");
const CLI    = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

const BUDGET_RECEIPT_APPROVED = resolve(
  ROOT,
  "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json",
);

// Deferred controls the plan explicitly excludes from this milestone.
const FORBIDDEN_TICK_TOOLS = [
  "ak_autoplay",
  "ak_pause",
  "ak_tick_jump",
  "ak_jump_to_tick",
  "ak_create_with_tick_count",
  "ak_tick_autoplay",
];

// ---------------------------------------------------------------------------
// CLI helpers (synchronous — setup only, not assertions)
// ---------------------------------------------------------------------------

function runCliSync(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30000,
  });
}

function makeTempDir(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Sandbox run scaffold
//
// Creates a minimal sandbox session (sandbox-create + sandbox-place), then
// runs the simulation (run) so tick-frames land at the path tick-session.mjs
// expects: {artifactsDir}/runs/{runId}/run/tick-frames.json
//
// Returns { sandboxDir, artifactsDir, runId, runOutDir }
// ---------------------------------------------------------------------------

function setupSandboxRun(runId, { ticks = 3 } = {}) {
  const sandboxDir   = makeTempDir("ak-sb-nav-sandbox-");
  const artifactsDir = makeTempDir("ak-sb-nav-artifacts-");
  const runOutDir    = join(artifactsDir, "runs", runId, "run");

  mkdirSync(runOutDir, { recursive: true });

  // 1. Create sandbox session
  const createResult = runCliSync([
    "sandbox-create",
    "--budget-receipt", BUDGET_RECEIPT_APPROVED,
    "--out-dir",        sandboxDir,
  ]);
  assert.equal(
    createResult.status, 0,
    `sandbox-create failed:\n${createResult.stderr}`,
  );

  const sessionPath = join(sandboxDir, "sandbox-session.json");

  // 2. Place a delver so InitialState has an actor (runtime requires at least one)
  const placeResult = runCliSync([
    "sandbox-place",
    "--session",     sessionPath,
    "--entity-type", "delver",
    "--spec",        "id=delver_1;x=2;y=2;affinity=water;motivation=exploring",
  ]);
  assert.equal(
    placeResult.status, 0,
    `sandbox-place failed:\n${placeResult.stderr}`,
  );

  // 3. Run the simulation — output goes directly into the run subdir so
  //    tick-session.mjs can find it via resolveRunDir + "run/tick-frames.json".
  const runResult = runCliSync([
    "run",
    "--sim-config",    join(sandboxDir, "sim-config.json"),
    "--initial-state", join(sandboxDir, "initial-state.json"),
    "--ticks",         String(ticks),
    "--out-dir",       runOutDir,
    "--run-id",        runId,
  ]);
  assert.equal(
    runResult.status, 0,
    `ak run failed:\n${runResult.stderr}\n${runResult.stdout}`,
  );

  return { sandboxDir, artifactsDir, runId, runOutDir };
}

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
    this.process.stderr.on("data", (chunk) => { this.stderr += chunk; });
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
      clientInfo: { name: "agent-kernel-sandbox-tick-navigation-test", version: "1.0.0" },
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
    assert.equal(Array.isArray(result.content), true);
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

// ---------------------------------------------------------------------------
// CLI verification — run command on sandbox artifacts
// ---------------------------------------------------------------------------

test("cli run with sandbox artifacts produces tick-frames.json and run-summary.json", () => {
  const { runOutDir } = setupSandboxRun("sb_cli_smoke", { ticks: 3 });

  assert.equal(
    existsSync(join(runOutDir, "tick-frames.json")),
    true,
    "tick-frames.json must exist after ak run on sandbox artifacts",
  );
  assert.equal(
    existsSync(join(runOutDir, "run-summary.json")),
    true,
    "run-summary.json must exist after ak run on sandbox artifacts",
  );

  const summary = JSON.parse(readFileSync(join(runOutDir, "run-summary.json"), "utf8"));
  assert.equal(summary.metrics?.ticks, 3, "run-summary.metrics.ticks must equal --ticks argument");
});

// ---------------------------------------------------------------------------
// ak_tick_forward — advance cursor on sandbox run
// ---------------------------------------------------------------------------

test("mcp ak_tick_forward advances cursor from tick 0 to tick 1 on sandbox run", async () => {
  const { artifactsDir, runId } = setupSandboxRun("sb_fwd_basic", { ticks: 3 });
  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_tick_forward", { runId });

    assert.equal(result.command, "tick");
    assert.equal(result.action, "forward");
    assert.equal(result.runId, runId);
    assert.equal(result.previousTick, 0);
    assert.equal(result.tick, 1);
    assert.equal(result.maxTick, 3);
  } finally {
    await harness.close();
  }
});

test("mcp ak_tick_forward advances cursor across multiple steps on sandbox run", async () => {
  const { artifactsDir, runId } = setupSandboxRun("sb_fwd_multi", { ticks: 3 });
  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();

    await harness.callTool("ak_tick_forward", { runId }); // 0→1
    const result = await harness.callTool("ak_tick_forward", { runId }); // 1→2

    assert.equal(result.previousTick, 1);
    assert.equal(result.tick, 2);
    assert.equal(result.maxTick, 3);
  } finally {
    await harness.close();
  }
});

test("mcp ak_tick_forward at max tick returns structured error", async () => {
  const { artifactsDir, runId } = setupSandboxRun("sb_fwd_max", { ticks: 2 });
  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    // Advance to maxTick
    await harness.callTool("ak_tick_forward", { runId }); // 0→1
    await harness.callTool("ak_tick_forward", { runId }); // 1→2 (=maxTick)

    const result = await harness.callToolRaw("ak_tick_forward", { runId });
    assert.equal(result.ok, false);
    assert.ok(result.error, "error message must be present when at max tick");
    assert.equal(result.tick, 2);
    assert.equal(result.maxTick, 2);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// ak_tick_backward — rewind cursor on sandbox run
// ---------------------------------------------------------------------------

test("mcp ak_tick_backward rewinds cursor from tick 1 to tick 0 on sandbox run", async () => {
  const { artifactsDir, runId } = setupSandboxRun("sb_bwd_basic", { ticks: 3 });
  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    await harness.callTool("ak_tick_forward", { runId }); // 0→1

    const result = await harness.callTool("ak_tick_backward", { runId });
    assert.equal(result.command, "tick");
    assert.equal(result.action, "backward");
    assert.equal(result.runId, runId);
    assert.equal(result.previousTick, 1);
    assert.equal(result.tick, 0);
    assert.equal(result.maxTick, 3);
  } finally {
    await harness.close();
  }
});

test("mcp ak_tick_backward at tick 0 returns structured error", async () => {
  const { artifactsDir, runId } = setupSandboxRun("sb_bwd_zero", { ticks: 3 });
  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    const result = await harness.callToolRaw("ak_tick_backward", { runId });

    assert.equal(result.ok, false);
    assert.ok(result.error, "error message must be present when rewinding past tick 0");
    assert.equal(result.tick, 0);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// ak_show_state — return state at cursor tick
// ---------------------------------------------------------------------------

test("mcp ak_show_state returns tick 0 and maxTick for a fresh sandbox run", async () => {
  const { artifactsDir, runId } = setupSandboxRun("sb_show_init", { ticks: 3 });
  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_show_state", { runId });

    assert.equal(result.command, "tick");
    assert.equal(result.action, "state");
    assert.equal(result.runId, runId);
    assert.equal(result.tick, 0);
    assert.equal(result.maxTick, 3);
  } finally {
    await harness.close();
  }
});

test("mcp ak_show_state at tick 1 includes tickFrame from sandbox run", async () => {
  const { artifactsDir, runId } = setupSandboxRun("sb_show_frame", { ticks: 3 });
  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    await harness.callTool("ak_tick_forward", { runId }); // cursor → tick 1

    const result = await harness.callTool("ak_show_state", { runId });
    assert.equal(result.tick, 1);
    assert.ok(result.tickFrame !== null && result.tickFrame !== undefined,
      "tickFrame must be present at tick 1");
    assert.equal(result.tickFrame.tick, 1,
      "tickFrame.tick must match the cursor tick");
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Deferred controls — must not appear in tools/list
// ---------------------------------------------------------------------------

test("deferred tick controls not exposed in tools/list", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const listing = await harness.listTools();
    const names = listing.tools.map((t) => t.name);

    for (const forbidden of FORBIDDEN_TICK_TOOLS) {
      assert.ok(
        !names.includes(forbidden),
        `Deferred tool ${forbidden} must not appear in tools/list`,
      );
    }
  } finally {
    await harness.close();
  }
});

test.skip("mcp sandbox tick forward backward forward keeps cursor idempotent", () => {});
test.skip("mcp sandbox tick advances to maxTick with every forward step ok:true", () => {});
test.skip("mcp sandbox tick rewinds from maxTick to 0 with every backward step ok:true", () => {});
test.skip("mcp ak_show_state at each tick has tickFrame for tick greater than zero", () => {});
test.skip("mcp ak_tick_forward with invalid runId returns ok:false with error", () => {});
test.skip("mcp ak_tick_backward with invalid runId returns ok:false with error", () => {});
test.skip("mcp ak_show_state with invalid runId returns ok:false with error", () => {});
test.skip("mcp sandbox run with delver warden and hazard succeeds", () => {});
test.skip("mcp sandbox run with no placed actors completes with zero accepted actions per tick", () => {});
test.skip("mcp ak_show_state ascii visualization on sandbox run returns ascii grid", () => {});
test.skip("mcp sandbox run-summary metrics ticks matches tick-frames length", () => {});
test.skip("mcp AK_ARTIFACTS_DIR isolation keeps concurrent sandbox runs separate", () => {});
test.skip("mcp sandbox run with actions file respects ak_sandbox_move sequence", () => {});

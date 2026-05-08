'use strict';

// M1 — Interactive tick control MCP contract tests.
//
// Tools tested:
//   ak_tick_forward  — advance the session cursor one tick; returns ok, runId, tick, maxTick, previousTick
//   ak_tick_backward — rewind the session cursor one tick; structured error when already at tick 0
//   ak_show_state    — return current dungeon state for the session cursor; ascii grid (WASM-conditional)

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve, join, dirname } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const testIfWasm = existsSync(WASM_PATH) ? test : test.skip;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeMeta(id, runId) {
  return { id, runId, createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" };
}

function makeTickFrame(tick, runId) {
  return {
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    meta: makeMeta(`tick_frame_${tick}`, runId),
    tick,
    phase: "execute",
    acceptedActions: [
      {
        schema: "agent-kernel/Action",
        schemaVersion: 1,
        actorId: "actor_delver",
        tick,
        kind: "wait",
        params: { reason: "idle" },
      },
    ],
  };
}

function scaffoldRun(workDir, runId, { maxTick = 10 } = {}) {
  const buildDir = join(workDir, "artifacts", "runs", runId, "build");
  const runDir = join(workDir, "artifacts", "runs", runId, "run");

  writeJson(join(buildDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: makeMeta("sim_config", runId),
    layout: {
      kind: "grid",
      width: 5,
      height: 5,
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
    actors: [
      { id: "actor_delver", kind: "motivated", position: { x: 1, y: 1 } },
    ],
  });

  const frames = Array.from({ length: maxTick }, (_, i) => makeTickFrame(i + 1, runId));
  writeJson(join(runDir, "tick-frames.json"), frames);

  writeJson(join(runDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: makeMeta("run_summary", runId),
    outcome: "success",
    metrics: { ticks: maxTick },
  });
}

// ---------------------------------------------------------------------------
// MCP harness — stdio JSON-RPC
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
    try { message = JSON.parse(line); } catch (err) {
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
      clientInfo: { name: "agent-kernel-mcp-tick-control-test", version: "1.0.0" },
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

  async close() {
    if (!this.process || this.closed) return;
    await new Promise((resolveClose) => {
      this.process.once("close", () => { this.closed = true; resolveClose(); });
      this.process.stdin.end();
      setTimeout(() => { if (!this.closed) this.process.kill("SIGTERM"); }, 500).unref();
      setTimeout(() => { if (!this.closed) this.process.kill("SIGKILL"); }, 2000).unref();
    });
  }
}

function makeTempDir(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// ak_tick_forward
// ---------------------------------------------------------------------------

test("mcp ak_tick_forward initializes cursor and advances from tick 0 to tick 1", async () => {
  const workDir = makeTempDir("mcp-tick-fwd-");
  const runId = "run_mcp_tick_fwd";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir, "artifacts") });
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_tick_forward", { runId });

    assert.equal(result.command, "tick");
    assert.equal(result.action, "forward");
    assert.equal(result.runId, runId);
    assert.equal(result.previousTick, 0);
    assert.equal(result.tick, 1);
    assert.equal(result.maxTick, 10);
  } finally {
    await harness.close();
  }
});

test("mcp ak_tick_forward sequential calls advance tick by one each time", async () => {
  const workDir = makeTempDir("mcp-tick-fwd-seq-");
  const runId = "run_mcp_tick_fwd_seq";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir, "artifacts") });
  try {
    await harness.initialize();
    await harness.callTool("ak_tick_forward", { runId });
    const result = await harness.callTool("ak_tick_forward", { runId });

    assert.equal(result.tick, 2);
    assert.equal(result.previousTick, 1);
  } finally {
    await harness.close();
  }
});

test("mcp ak_tick_forward at maxTick returns ok false", async () => {
  const workDir = makeTempDir("mcp-tick-fwd-max-");
  const runId = "run_mcp_tick_fwd_max";
  scaffoldRun(workDir, runId, { maxTick: 2 });

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir, "artifacts") });
  try {
    await harness.initialize();
    await harness.callTool("ak_tick_forward", { runId }); // tick 1
    await harness.callTool("ak_tick_forward", { runId }); // tick 2 (max)

    const result = await harness.callToolRaw("ak_tick_forward", { runId });
    assert.equal(result.ok, false);
    assert.equal(result.tick, 2);
    assert.equal(result.maxTick, 2);
    assert.match(result.error, /max tick|cannot advance/i);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// ak_tick_backward
// ---------------------------------------------------------------------------

test("mcp ak_tick_backward rewinds cursor from tick 2 to tick 1", async () => {
  const workDir = makeTempDir("mcp-tick-bwd-");
  const runId = "run_mcp_tick_bwd";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir, "artifacts") });
  try {
    await harness.initialize();
    await harness.callTool("ak_tick_forward", { runId });
    await harness.callTool("ak_tick_forward", { runId });

    const result = await harness.callTool("ak_tick_backward", { runId });
    assert.equal(result.command, "tick");
    assert.equal(result.action, "backward");
    assert.equal(result.previousTick, 2);
    assert.equal(result.tick, 1);
    assert.equal(result.maxTick, 10);
  } finally {
    await harness.close();
  }
});

test("mcp ak_tick_backward at tick 0 returns ok false", async () => {
  const workDir = makeTempDir("mcp-tick-bwd-zero-");
  const runId = "run_mcp_tick_bwd_zero";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir, "artifacts") });
  try {
    await harness.initialize();

    const result = await harness.callToolRaw("ak_tick_backward", { runId });
    assert.equal(result.ok, false);
    assert.equal(result.tick, 0);
    assert.match(result.error, /tick 0|cannot rewind/i);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// ak_show_state
// ---------------------------------------------------------------------------

test("mcp ak_show_state returns runId, tick, maxTick, and ascii field", async () => {
  const workDir = makeTempDir("mcp-tick-state-");
  const runId = "run_mcp_tick_state";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir, "artifacts") });
  try {
    await harness.initialize();
    await harness.callTool("ak_tick_forward", { runId });

    const result = await harness.callTool("ak_show_state", { runId });
    assert.equal(result.command, "tick");
    assert.equal(result.action, "state");
    assert.equal(result.runId, runId);
    assert.equal(result.tick, 1);
    assert.equal(result.maxTick, 10);
    assert.ok("ascii" in result, "response must include ascii field");
  } finally {
    await harness.close();
  }
});

testIfWasm("mcp ak_show_state ascii is a non-empty grid string when WASM is present", async () => {
  const workDir = makeTempDir("mcp-tick-state-wasm-");
  const runId = "run_mcp_tick_state_wasm";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir, "artifacts") });
  try {
    await harness.initialize();
    await harness.callTool("ak_tick_forward", { runId });

    const result = await harness.callTool("ak_show_state", { runId });
    assert.equal(typeof result.ascii, "string");
    assert.ok(result.ascii.length > 0, "ascii must not be empty");
    assert.ok(result.ascii.includes("\n"), "ascii must contain newline-separated rows");
  } finally {
    await harness.close();
  }
});

test("mcp ak_show_state at tick 0 returns the initial dungeon layout", async () => {
  const workDir = makeTempDir("mcp-tick-state-t0-");
  const runId = "run_mcp_tick_state_t0";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir, "artifacts") });
  try {
    await harness.initialize();

    // No forward — cursor should default to tick 0
    const result = await harness.callTool("ak_show_state", { runId });
    assert.equal(result.tick, 0);
    assert.equal(result.maxTick, 10);
    assert.ok("ascii" in result);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// Rewind parity over MCP — tick N after rewind == direct forward to tick N
// ---------------------------------------------------------------------------

test("mcp ak_show_state ascii at tick 2 after rewind matches direct forward replay", async () => {
  const workDir = makeTempDir("mcp-tick-parity-");
  const runId = "run_mcp_parity";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  const workDir2 = makeTempDir("mcp-tick-parity2-");
  const runId2 = "run_mcp_parity2";
  scaffoldRun(workDir2, runId2, { maxTick: 10 });

  const harnessA = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir, "artifacts") });
  const harnessB = new McpServerHarness({ AK_ARTIFACTS_DIR: join(workDir2, "artifacts") });

  try {
    await harnessA.initialize();
    // Path A: forward x3, backward x1 → tick 2
    await harnessA.callTool("ak_tick_forward", { runId });
    await harnessA.callTool("ak_tick_forward", { runId });
    await harnessA.callTool("ak_tick_forward", { runId });
    await harnessA.callTool("ak_tick_backward", { runId });
    const stateA = await harnessA.callTool("ak_show_state", { runId });

    await harnessB.initialize();
    // Path B: forward x2 → tick 2
    await harnessB.callTool("ak_tick_forward", { runId: runId2 });
    await harnessB.callTool("ak_tick_forward", { runId: runId2 });
    const stateB = await harnessB.callTool("ak_show_state", { runId: runId2 });

    assert.equal(stateA.tick, 2);
    assert.equal(stateB.tick, 2);
    assert.equal(stateA.ascii, stateB.ascii);
  } finally {
    await harnessA.close();
    await harnessB.close();
  }
});

// ## TODO: Test Permutations
// - Permutation: ak_tick_forward with missing runId argument — MCP returns a structured error, not a server crash.
// - Permutation: ak_tick_forward on an unknown runId — ok:false with error matching /not found/i.
// - Permutation: ak_tick_backward on an unknown runId — ok:false with error matching /not found/i.
// - Permutation: ak_show_state with missing cursor but valid run — should default to tick 0 without error.
// - Permutation: ak_tick_forward on a run with maxTick 1 — first call succeeds (tick 1), second returns ok:false.
// - Permutation: ak_show_state called before any forward on a brand-new run — tick 0, ok:true.
// - Permutation: interleaved forward/backward sequence of 10 steps — final tick matches expected value, no cursor corruption.
// - Permutation: ak_show_state after backward to tick 0 — ascii matches initial layout, same as state before any forward.

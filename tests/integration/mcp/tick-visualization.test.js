'use strict';

// M1 — MCP integration tests for visualization support on tick tools.
//
// Tests for ak_show_state and ak_tick_forward with a `visualization` argument
// FAIL until M3 (ascii) and M4 (image) implement the option.
// The harness uses AK_ARTIFACTS_DIR to isolate runs inside a temp directory.

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve, join, dirname } = require("node:path");
const os = require("node:os");

const ROOT   = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");
const CLI    = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

// ---------------------------------------------------------------------------
// McpServerHarness (same pattern as mcp-tools.test.js)
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
        reject(new Error(`${reason}\nSTDERR:\n${this.stderr}`));
      }
      this.pending.clear();
    });
  }

  #onStdout(chunk) {
    this.stdoutBuffer += chunk;
    let nl = this.stdoutBuffer.indexOf("\n");
    while (nl !== -1) {
      const line = this.stdoutBuffer.slice(0, nl).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (line.trim()) this.#handleMessage(line);
      nl = this.stdoutBuffer.indexOf("\n");
    }
  }

  #handleMessage(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`MCP request failed: ${message.error.message}\nSTDERR:\n${this.stderr}`));
      return;
    }
    pending.resolve(message.result);
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "tick-visualization-test", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  notify(method, params) {
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}\nSTDERR:\n${this.stderr}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async callToolRaw(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    assert.ok(Array.isArray(result.content), `Expected content array for ${name}`);
    return result.structuredContent;
  }

  async close() {
    if (!this.process || this.closed) return;
    this.process.stdin.end();
    await new Promise((resolve) => this.process.once("exit", resolve));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function scaffoldRun(artifactsDir, runId, { maxTick = 5 } = {}) {
  const buildDir = join(artifactsDir, "runs", runId, "build");
  const runDir   = join(artifactsDir, "runs", runId, "run");

  writeJson(join(buildDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1,
    meta: { id: "sc1", runId, createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" },
    layout: {
      kind: "grid", width: 7, height: 3,
      data: { width: 7, height: 3, tiles: ["#######", "#.....#", "#######"],
        legend: { "#": { tile: "wall" }, ".": { tile: "floor" } } },
    },
    traps: [{ id: "trap_1", x: 2, y: 1, affinity: "fire", expression: "emit", stacks: 3, blocking: false }],
    resources: [{ id: "res_1", x: 4, y: 1, tier: "level", stat: "vitalMax", delta: 10, dropRate: 50 }],
  });

  writeJson(join(buildDir, "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1,
    meta: { id: "is1", runId, createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" },
    actors: [
      { id: "actor_delver_1", kind: "motivated", role: "delver", position: { x: 1, y: 1 },
        affinity: "fire", motivation: "exploring",
        affinities: [{ name: "fire", stacks: 2, expression: "emit" }],
        vitals: { health: { current: 10, max: 10, regen: 1 } } },
      { id: "actor_warden_1", kind: "motivated", role: "warden", position: { x: 5, y: 1 },
        affinity: "dark", motivation: "stationary",
        affinities: [{ name: "dark", stacks: 1, expression: "emit" }],
        vitals: { health: { current: 15, max: 15, regen: 0 } } },
    ],
  });

  const frames = Array.from({ length: maxTick }, (_, i) => ({
    schema: "agent-kernel/TickFrame", schemaVersion: 1,
    meta: { id: `tf_${i+1}`, runId, createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" },
    tick: i + 1, phase: "summarize",
    acceptedActions: [
      { schema: "agent-kernel/Action", schemaVersion: 1,
        actorId: "actor_delver_1", tick: i + 1, kind: "wait", params: { reason: "idle" } },
    ],
  }));
  writeJson(join(runDir, "tick-frames.json"), frames);
  writeJson(join(runDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary", schemaVersion: 1,
    meta: { id: "rs1", runId, createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" },
    outcome: "success", metrics: { ticks: maxTick },
  });
}

// ---------------------------------------------------------------------------
// FAILING: visualization option on MCP tick tools (M3/M4)
// ---------------------------------------------------------------------------

test("ak_show_state with visualization:ascii returns visualization object", async () => {
  const workDir     = mkdtempSync(join(os.tmpdir(), "ak-mcp-viz-ascii-"));
  const artifactsDir = join(workDir, "artifacts");
  const runId       = "run_mcp_viz_ascii";
  scaffoldRun(artifactsDir, runId, { maxTick: 5 });

  // Advance cursor via CLI so state is at tick 1
  runCli(["tick", "forward", "--run-id", runId], workDir);

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    // FAILS: ak_show_state does not yet accept a visualization argument
    const result = await harness.callToolRaw("ak_show_state", { runId, visualization: "ascii" });
    assert.equal(result.ok, true);
    assert.equal(result.tick, 1);
    // FAILS: visualization field not returned until M3
    assert.ok(result.visualization !== undefined, "ak_show_state must return visualization field");
    assert.equal(result.visualization.mode, "ascii");
    assert.ok(result.visualization.layers, "ascii visualization must include layers");
    assert.equal(typeof result.visualization.layers.layout, "string");
    assert.equal(typeof result.visualization.layers.hazards, "string");
    assert.ok(Array.isArray(result.visualization.actorDetails));
  } finally {
    await harness.close();
  }
});

test("ak_show_state with visualization:image returns visualizationDataUri PNG data URI", async () => {
  const workDir      = mkdtempSync(join(os.tmpdir(), "ak-mcp-viz-img-"));
  const artifactsDir = join(workDir, "artifacts");
  const runId        = "run_mcp_viz_img";
  scaffoldRun(artifactsDir, runId, { maxTick: 5 });

  runCli(["tick", "forward", "--run-id", runId], workDir);

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    // FAILS until M4
    const result = await harness.callToolRaw("ak_show_state", { runId, visualization: "image" });
    assert.equal(result.ok, true);
    assert.ok(result.visualization !== undefined, "visualization must be present");
    assert.equal(result.visualization.mode, "image");
    assert.ok(
      typeof result.visualization.visualizationDataUri === "string" &&
      result.visualization.visualizationDataUri.startsWith("data:image/png;base64,"),
      "visualizationDataUri must be a PNG data URI",
    );
  } finally {
    await harness.close();
  }
});

test("ak_tick_forward with visualization:ascii returns visualization at the new tick", async () => {
  const workDir      = mkdtempSync(join(os.tmpdir(), "ak-mcp-fwd-viz-"));
  const artifactsDir = join(workDir, "artifacts");
  const runId        = "run_mcp_fwd_viz";
  scaffoldRun(artifactsDir, runId, { maxTick: 5 });

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    // FAILS until M3
    const result = await harness.callToolRaw("ak_tick_forward", { runId, visualization: "ascii" });
    assert.equal(result.ok, true);
    assert.equal(result.tick, 1);
    assert.ok(result.visualization !== undefined, "tick forward must include visualization when option set");
    assert.equal(result.visualization.mode, "ascii");
    assert.equal(result.visualization.tick, 1);
  } finally {
    await harness.close();
  }
});

test("ak_tick_backward with visualization:ascii returns visualization at the rewound tick", async () => {
  const workDir      = mkdtempSync(join(os.tmpdir(), "ak-mcp-bwd-viz-"));
  const artifactsDir = join(workDir, "artifacts");
  const runId        = "run_mcp_bwd_viz";
  scaffoldRun(artifactsDir, runId, { maxTick: 5 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "forward", "--run-id", runId], workDir);

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    // FAILS until M3
    const result = await harness.callToolRaw("ak_tick_backward", { runId, visualization: "ascii" });
    assert.equal(result.ok, true);
    assert.equal(result.tick, 1);
    assert.ok(result.visualization !== undefined, "tick backward must include visualization when option set");
    assert.equal(result.visualization.tick, 1);
  } finally {
    await harness.close();
  }
});

test("ak_show_state with unknown visualization value returns ok:false with structured error", async () => {
  const workDir      = mkdtempSync(join(os.tmpdir(), "ak-mcp-viz-bad-"));
  const artifactsDir = join(workDir, "artifacts");
  const runId        = "run_mcp_viz_bad";
  scaffoldRun(artifactsDir, runId, { maxTick: 3 });

  runCli(["tick", "forward", "--run-id", runId], workDir);

  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();
    // FAILS until M3 validates the option
    const result = await harness.callToolRaw("ak_show_state", { runId, visualization: "video" });
    assert.equal(result.ok, false);
    assert.match(result.error, /ascii|image|visualization/i);
  } finally {
    await harness.close();
  }
});

/*
## TODO: Test Permutations
- ak_show_state without visualization arg returns no visualization field (backward compat)
- ak_show_state at tick 0 with visualization:ascii returns ok:true with ascii snapshot for initial state
- ak_show_state at tick 0 with visualization:image returns visualizationDataUri or null gracefully
- ak_tick_forward at maxTick boundary with visualization:ascii still returns ok:false boundary error
- ak_tick_backward at tick 0 with visualization:ascii still returns ok:false boundary error
- ak_show_state with visualization:ascii and missing core-ts returns ok:true with best-effort ascii
- ak_tick_forward with visualization:ascii for multiple successive calls produces different actorDetail positions
*/

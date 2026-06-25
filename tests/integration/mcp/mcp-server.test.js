const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");

const E2E_SCENARIO = resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json");
const LLM_FIXTURE = resolve(ROOT, "tests/fixtures/adapters/llm-generate-summary.json");
const SIM_CONFIG = resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json");
const INITIAL_STATE = resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json");
const BUILD_SPEC = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json");

// The renamed bridge push tool (Plan O3) and the sandbox bridge WebSocket path.
const PUSH_TOOL_NAME = "ak_push_to_ui";
const LEGACY_PUSH_TOOL_NAME = "ak_sandbox_push_ui";
const BRIDGE_WS_PATH = "/ak-sandbox";

// Reserve an ephemeral loopback port, then release it so the MCP server can bind it.
function reserveFreePort() {
  const net = require("node:net");
  return new Promise((resolvePort, rejectPort) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", rejectPort);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

// Try to open a WebSocket to the sandbox bridge, retrying until it connects or the deadline passes.
// Resolves on the first successful open; rejects if the bridge never accepts a connection.
function connectBridgeWithRetry(port, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveConn, rejectConn) => {
    const attempt = () => {
      let ws;
      try {
        ws = new globalThis.WebSocket(`ws://127.0.0.1:${port}${BRIDGE_WS_PATH}`);
      } catch (err) {
        if (Date.now() >= deadline) return rejectConn(err);
        return setTimeout(attempt, 150);
      }
      const onErrorOrClose = () => {
        if (Date.now() >= deadline) {
          rejectConn(new Error(`bridge did not accept a connection on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 150);
        }
      };
      ws.addEventListener("open", () => resolveConn(ws), { once: true });
      ws.addEventListener("error", onErrorOrClose, { once: true });
      ws.addEventListener("close", onErrorOrClose, { once: true });
    };
    attempt();
  });
}

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
      const reason = `MCP server exited before response (code=${code}, signal=${signal})`;
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
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim()) {
        this.#handleMessage(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  #handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      throw this.#error(`Failed to parse MCP message: ${error.message}\nLINE: ${line}`);
    }

    if (message.id === undefined) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

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
      clientInfo: {
        name: "agent-kernel-mcp-test",
        version: "1.0.0",
      },
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  notify(method, params) {
    assert.ok(this.process.stdin, "MCP server stdin is unavailable");
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request(method, params) {
    assert.ok(this.process.stdin, "MCP server stdin is unavailable");
    const id = this.nextId;
    this.nextId += 1;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(this.#error(`Timed out waiting for ${method}`));
      }, 15000);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    assert.equal(Array.isArray(result.content), true, `Expected content array for ${name}`);
    assert.equal(result.content[0]?.type, "text");
    const parsedContent = JSON.parse(result.content[0].text);
    assert.deepEqual(parsedContent, result.structuredContent);
    assert.equal(result.structuredContent.ok, true, `Expected ok: true for ${name}`);
    return result.structuredContent;
  }

  async close() {
    if (!this.process || this.closed) {
      return;
    }
    await new Promise((resolveClose) => {
      this.process.once("close", () => {
        this.closed = true;
        resolveClose();
      });
      this.process.stdin.end();
      setTimeout(() => {
        if (!this.closed) {
          this.process.kill("SIGTERM");
        }
      }, 500).unref();
      setTimeout(() => {
        if (!this.closed) {
          this.process.kill("SIGKILL");
        }
      }, 2000).unref();
    });
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test("mcp server lists required tools and schemas round-trips over stdio", async () => {
  const harness = new McpServerHarness({
    AK_SCHEMA_CATALOG_TIME: "2000-01-01T00:00:00.000Z",
  });
  try {
    const initializeResult = await harness.initialize();
    assert.equal(initializeResult.serverInfo.name, "agent-kernel-cli");

    const listed = await harness.request("tools/list", {});
    const toolNames = listed.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("ak_create"));
    assert.ok(toolNames.includes("ak_run"));
    assert.ok(toolNames.includes("ak_llm_plan"));
    assert.ok(toolNames.includes("ak_inspect"));
    assert.ok(toolNames.includes("ak_schemas"));

    const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-schemas-"));
    const schemas = await harness.callTool("ak_schemas", { outDir });
    assert.equal(schemas.command, "schemas");
    assert.equal(schemas.stdout, `schemas: wrote ${outDir}`);

    const catalog = readJson(join(outDir, "schemas.json"));
    assert.equal(catalog.generatedAt, "2000-01-01T00:00:00.000Z");
    const names = catalog.schemas.map((entry) => entry.schema);
    assert.ok(names.includes("agent-kernel/BuildSpec"));
    assert.ok(names.includes("agent-kernel/SimConfigArtifact"));
    assert.ok(names.includes("agent-kernel/TelemetryRecord"));
  } finally {
    await harness.close();
  }
});

test("mcp authoring tools expose the current full scenario schema", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();

    const listed = await harness.request("tools/list", {});
    const createTool = listed.tools.find((tool) => tool.name === "ak_create");
    const configureTool = listed.tools.find((tool) => tool.name === "ak_configure");
    for (const tool of [createTool, configureTool]) {
      assert.ok(tool, "expected authoring tool to be listed");
      const properties = tool.inputSchema?.properties || {};
      assert.ok(properties.room);
      assert.ok(properties.floorTile);
      assert.ok(properties.trap);
      assert.ok(properties.hazard);
      assert.ok(properties.resource);
      assert.ok(properties.delver);
      assert.ok(properties.warden);
      assert.ok(properties.budgetTokens);
      assert.ok(properties.dungeonBudgetTokens);
      assert.ok(properties.delverBudgetTokens);
      assert.match(properties.outDir?.description || "", /temp/i);
    }
  } finally {
    await harness.close();
  }
});

test("mcp server create and llm-plan tool calls round-trip with fixture inputs", async () => {
  const harness = new McpServerHarness({
    AK_LLM_LIVE: "1",
  });
  try {
    await harness.initialize();

    const createOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-create-"));
    const createResult = await harness.callTool("ak_create", {
      dryRun: true,
      text: "Create one fire delver within a total budget of 200 tokens.",
      delver: ["count=1;affinity=fire;motivation=attacking;goals=max_mana,mana_regen"],
      budgetTokens: 200,
      runId: "run_mcp_create_dry_run",
      createdAt: "2026-04-10T00:00:00.000Z",
      outDir: createOutDir,
    });
    assert.equal(createResult.command, "create");
    assert.equal(createResult.dryRun, true);
    assert.equal(createResult.valid, true);
    assert.equal(createResult.runId, "run_mcp_create_dry_run");
    assert.equal(existsSync(join(createOutDir, "spec.json")), false);

    const llmPlanOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-llm-plan-"));
    const llmPlanResult = await harness.callTool("ak_llm_plan", {
      scenario: E2E_SCENARIO,
      model: "fixture",
      fixture: LLM_FIXTURE,
      runId: "run_mcp_llm_plan_fixture",
      createdAt: "2025-01-01T00:00:00Z",
      outDir: llmPlanOutDir,
    });
    assert.equal(llmPlanResult.command, "llm-plan");
    assert.equal(llmPlanResult.runId, "run_mcp_llm_plan_fixture");
    assert.equal(existsSync(join(llmPlanOutDir, "spec.json")), true);
    assert.equal(existsSync(join(llmPlanOutDir, "manifest.json")), true);
    assert.equal(existsSync(join(llmPlanOutDir, "intent.json")), false);
    assert.equal(existsSync(join(llmPlanOutDir, "plan.json")), false);

    const spec = readJson(join(llmPlanOutDir, "spec.json"));
    const manifest = readJson(join(llmPlanOutDir, "manifest.json"));
    assert.equal(spec.schema, "agent-kernel/BuildSpec");
    assert.equal(spec.meta.runId, "run_mcp_llm_plan_fixture");
    assert.ok(manifest.artifacts.every((entry) => entry.schema !== "agent-kernel/CapturedInputArtifact"));
  } finally {
    await harness.close();
  }
});

test("mcp authoring tools expose preview handoff metadata for persisted outputs", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();

    const roomOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-room-plan-"));
    const roomPlanResult = await harness.callTool("ak_room_plan", {
      room: ["size=small;count=1"],
      runId: "run_mcp_room_plan_preview",
      createdAt: "2026-04-10T00:00:00.000Z",
      outDir: roomOutDir,
    });
    assert.equal(roomPlanResult.preview.ready, true);
    assert.equal(roomPlanResult.preview.bundlePath, join(roomOutDir, "bundle.json"));
    assert.equal(roomPlanResult.preview.manifestPath, join(roomOutDir, "manifest.json"));
    assert.equal(roomPlanResult.preview.resourceBundlePath, join(roomOutDir, "resource-bundle.json"));
    assert.equal(roomPlanResult.preview.hasActors, false);
    assert.equal(roomPlanResult.preview.runReady, false);

    const delverOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-delver-plan-"));
    const delverPlanResult = await harness.callTool("ak_delver_plan", {
      delver: ["count=1;affinity=fire;motivation=attacking"],
      runId: "run_mcp_delver_plan_preview",
      createdAt: "2026-04-10T00:00:00.000Z",
      outDir: delverOutDir,
    });
    assert.equal(delverPlanResult.preview.ready, true);
    assert.equal(delverPlanResult.preview.hasActors, true);
    assert.equal(delverPlanResult.preview.runReady, false);

    const wardenOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-warden-plan-"));
    const wardenPlanResult = await harness.callTool("ak_warden_plan", {
      warden: ["count=1;affinity=dark;motivation=defending"],
      runId: "run_mcp_warden_plan_preview",
      createdAt: "2026-04-10T00:00:00.000Z",
      outDir: wardenOutDir,
    });
    assert.equal(wardenPlanResult.preview.ready, true);
    assert.equal(wardenPlanResult.preview.hasActors, true);
    assert.equal(wardenPlanResult.preview.runReady, false);
  } finally {
    await harness.close();
  }
});

test("mcp create defaults full scenario outputs into a writable temp folder and remembers them for follow-up tools", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();

    const runId = "run_mcp_full_scenario";
    const createResult = await harness.callTool("ak_create", {
      runId,
      createdAt: "2026-04-19T00:00:00.000Z",
      text: "Create a full playable dungeon scenario with room layout, traps, hazards, resources, delvers, and a warden under a total budget of 2000 tokens.",
      room: ["size=medium;count=1"],
      floorTile: ["count=12"],
      trap: ["x=2;y=2;affinity=dark;expression=emit;stacks=2;blocking=false"],
      hazard: ["affinity=dark;expression=emit;proximityRadius=1;mana=one-time:1"],
      resource: ["permanenceMode=consumable;vital=health;delta=2"],
      delver: ["count=1;affinity=fire;motivation=attacking"],
      warden: ["count=1;affinity=dark;motivation=defending"],
      budgetTokens: 2000,
    });
    assert.equal(createResult.command, "create");
    assert.equal(createResult.runId, runId);
    assert.equal(existsSync(join(createResult.outDir, "spec.json")), true);
    assert.equal(existsSync(join(createResult.outDir, "manifest.json")), true);
    assert.equal(createResult.outDir.startsWith(os.tmpdir()), true);
    assert.equal(createResult.preview.ready, true);
    assert.equal(createResult.preview.runReady, true);
    assert.equal(createResult.artifactLocation?.outDir, createResult.outDir);
    assert.equal(createResult.artifactLocation?.defaultedToTemp, true);
    assert.equal(createResult.artifactLocation?.remembered, true);

    const showResult = await harness.callTool("ak_show", { runId });
    assert.equal(showResult.command, "show");
    assert.equal(showResult.runId, runId);
    assert.equal(showResult.commands.some((entry) => entry.command === "create" && entry.outDir === createResult.outDir), true);

    const runsListResult = await harness.callTool("ak_runs_list");
    assert.equal(runsListResult.command, "runs");
    assert.equal(runsListResult.action, "list");
    assert.equal(runsListResult.runs.some((entry) => entry.runId === runId), true);

    const runResult = await harness.callTool("ak_run", {
      fromRun: runId,
      ticks: 1,
    });
    assert.equal(runResult.command, "run");
    assert.equal(existsSync(join(runResult.outDir, "tick-frames.json")), true);
    assert.equal(runResult.outDir.startsWith(os.tmpdir()), true);

    const showWithRun = await harness.callTool("ak_show", { runId });
    assert.equal(showWithRun.commands.some((entry) => entry.command === "run" && entry.outDir === runResult.outDir), true);
  } finally {
    await harness.close();
  }
});


test("mcp server run and inspect tool calls round-trip over stdio", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();

    const runOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-run-"));
    const runResult = await harness.callTool("ak_run", {
      simConfig: SIM_CONFIG,
      initialState: INITIAL_STATE,
      ticks: 1,
      outDir: runOutDir,
    });
    assert.equal(runResult.command, "run");
    assert.equal(runResult.outDir, runOutDir);
    assert.equal(existsSync(join(runOutDir, "tick-frames.json")), true);
    assert.equal(existsSync(join(runOutDir, "effects-log.json")), true);

    const inspectOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-inspect-"));
    const inspectResult = await harness.callTool("ak_inspect", {
      tickFrames: join(runOutDir, "tick-frames.json"),
      effectsLog: join(runOutDir, "effects-log.json"),
      outDir: inspectOutDir,
    });
    assert.equal(inspectResult.command, "inspect");
    assert.equal(inspectResult.outDir, inspectOutDir);
    assert.equal(existsSync(join(inspectOutDir, "inspect-summary.json")), true);

    const inspectSummary = readJson(join(inspectOutDir, "inspect-summary.json"));
    assert.equal(inspectSummary.schema, "agent-kernel/TelemetryRecord");
    assert.equal(inspectSummary.schemaVersion, 1);
  } finally {
    await harness.close();
  }
});

// ---------------------------------------------------------------------------
// M1 — Bridge exposure and autostart (sandbox consolidation)
//
// These tests define the M2 contract: the renamed `ak_push_to_ui` tool is
// registered in TOOL_DEFINITIONS and the loopback bridge auto-starts on
// AK_SANDBOX_BRIDGE_PORT during MCP server startup.
// ---------------------------------------------------------------------------

test("mcp server exposes ak_push_to_ui and not the legacy ak_sandbox_push_ui (O3)", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const listed = await harness.request("tools/list", {});
    const toolNames = listed.tools.map((tool) => tool.name);
    assert.ok(
      toolNames.includes(PUSH_TOOL_NAME),
      `expected ${PUSH_TOOL_NAME} in tools/list, got: ${toolNames.join(", ")}`,
    );
    assert.ok(
      !toolNames.includes(LEGACY_PUSH_TOOL_NAME),
      `legacy ${LEGACY_PUSH_TOOL_NAME} must be removed, got: ${toolNames.join(", ")}`,
    );
  } finally {
    await harness.close();
  }
});

test("mcp server auto-starts the loopback sandbox bridge on AK_SANDBOX_BRIDGE_PORT", async () => {
  const port = await reserveFreePort();
  const harness = new McpServerHarness({ AK_SANDBOX_BRIDGE_PORT: String(port) });
  let ws;
  try {
    await harness.initialize();
    // The bridge must be listening once the server is up: a raw loopback client connects.
    ws = await connectBridgeWithRetry(port, 4000);
    assert.equal(ws.readyState, globalThis.WebSocket.OPEN, "bridge WebSocket must accept the connection");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("mcp ak_push_to_ui compiles and pre-stages a bundle when requireClient:false", async () => {
  const port = await reserveFreePort();
  const harness = new McpServerHarness({ AK_SANDBOX_BRIDGE_PORT: String(port) });
  try {
    await harness.initialize();
    const buildSpec = readJson(BUILD_SPEC);
    const result = await harness.callTool(PUSH_TOOL_NAME, {
      buildSpec,
      requireClient: false,
    });
    assert.equal(result.ok, true);
    assert.ok(result.bundle, "must include bundle summary");
    assert.ok(
      typeof result.bundle.artifactCount === "number" && result.bundle.artifactCount > 0,
      "must report artifact count > 0",
    );
    assert.ok(result.bundle.simConfigArtifactId, "must include simConfigArtifactId");
    assert.ok(result.bundle.resourceBundleArtifactId, "must include resourceBundleArtifactId");
  } finally {
    await harness.close();
  }
});

/*
## TODO: Test Permutations
- ak_push_to_ui with omitted buildSpec → MISSING_BUILD_SPEC over the stdio surface
- ak_push_to_ui with requireClient:true and no connected client → SANDBOX_UI_NOT_CONNECTED
- bridge autostart honors the default port (38487) when AK_SANDBOX_BRIDGE_PORT is unset
- two MCP server instances on different AK_SANDBOX_BRIDGE_PORT values do not collide
- ak_push_to_ui with openBrowser:true (O1) returns the served index_c.html URL in the result
- correlationId round-trips through the stdio tool envelope
*/

// ---------------------------------------------------------------------------
// M4 — Canonical replacement for the file-based sandbox tools (lean scope)
//
// The file-based ak_sandbox_create/place/move tools are removed in M5. The
// code-is-law rules they touched (walls, stamina, bounds, budget) stay covered
// by core-ts/runtime tests (validateActorPlacement, wind+push stamina, room
// bounds, design-spend-ledger). Here we (1) assert the removed tool surface is
// gone — a FAILING test until M5 — and (2) prove the budget gate through the
// canonical ak_create path that replaces ak_sandbox_create's receipt gate.
// ---------------------------------------------------------------------------

test("mcp tools/list no longer exposes the file-based sandbox tools (M5)", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const listed = await harness.request("tools/list", {});
    const names = listed.tools.map((tool) => tool.name);
    for (const removed of ["ak_sandbox_create", "ak_sandbox_place", "ak_sandbox_move"]) {
      assert.ok(
        !names.includes(removed),
        `${removed} must be removed from tools/list (replaced by the BuildSpec/run path), got: ${names.join(", ")}`,
      );
    }
  } finally {
    await harness.close();
  }
});

test("mcp ak_create computes and reports deterministic budget cost (canonical budget gate)", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();

    // Within budget → valid with non-negative remaining.
    const within = await harness.callTool("ak_create", {
      dryRun: true,
      text: "single fire delver",
      delver: ["count=1;affinity=fire;motivation=attacking"],
      budgetTokens: 1000,
      runId: "run_m4_budget_within",
      createdAt: "2026-04-10T00:00:00.000Z",
    });
    assert.equal(within.valid, true);
    assert.ok(within.budgetEstimate, "create must report a budgetEstimate");
    assert.ok(
      within.budgetEstimate.remaining >= 0,
      `within-budget spec must have non-negative remaining, got ${within.budgetEstimate.remaining}`,
    );

    // Over budget → the overage is reported deterministically as negative remaining.
    const over = await harness.callTool("ak_create", {
      dryRun: true,
      text: "fire warden dungeon",
      room: ["size=medium;count=1"],
      warden: ["count=3;affinity=fire;motivation=defending"],
      delver: ["count=2;affinity=water;motivation=exploring"],
      budgetTokens: 5,
      runId: "run_m4_budget_over",
      createdAt: "2026-04-10T00:00:00.000Z",
    });
    assert.ok(over.budgetEstimate, "create must report a budgetEstimate");
    assert.equal(over.budgetEstimate.total, 5);
    assert.ok(
      over.budgetEstimate.used > over.budgetEstimate.total,
      "used must exceed the budget for an over-budget spec",
    );
    assert.ok(
      over.budgetEstimate.remaining < 0,
      `over-budget spec must report negative remaining, got ${over.budgetEstimate.remaining}`,
    );
  } finally {
    await harness.close();
  }
});

/*
## TODO: Test Permutations (M4 — canonical sandbox replacement)
- ak_create within budget then ak_run produces tick-frames (end-to-end runnable scenario)
- ak_create over budget by exactly 1 token → remaining === -1
- ak_create with dungeonBudgetTokens/delverBudgetTokens split → per-pool budgetEstimate
- BuildSpec→ak_run replays N ticks and the final tick index === N-1 (tick navigation parity)
- walls/stamina/bounds remain covered by core-ts/runtime move-rule tests (no MCP duplication)
*/

// ## Gap Registry — Uncovered MCP Tools (M7 scope boundary)
//
// This file is the authoritative MCP verification surface for the session.
// Tools verified working (M5): ak_schemas, ak_create (dry-run + full), ak_configure,
// ak_llm_plan, ak_room_plan, ak_delver_plan, ak_warden_plan, ak_show, ak_runs_list, ak_run, ak_inspect.
//
// The tool families below are uncovered at the MCP layer. Each requires fixture files or
// core-backed runs that do not yet exist, placing them outside the local-model permutation
// scope (complex async integration, multi-system coordination). They remain here as an
// explicit gap registry so the uncovered surface stays observable rather than implied.
//
// Simulation tools:
// - Permutation: ak_build with a fixture spec — confirm the MCP envelope returns a bundle ref and
//   the same artifact set as `ak build` on the CLI.
// - Permutation: ak_solve with --solver-fixture — confirm the MCP server returns the SolverResult
//   envelope deterministically (no network).
// - Permutation: ak_configurator with a level-gen + actors fixture — confirm the configurator
//   FSM result schema matches the CLI's `configurator` command.
// - Permutation: ak_budget against a fixed budget + price list — confirm the MCP receipt envelope
//   matches the CLI receipt envelope byte-for-byte except for ids/timestamps.
// - Permutation: ak_replay against a recorded tick-frames artifact — confirm parity with CLI
//   `replay` (replay-summary + replay-tick-frames present).
// - Permutation: ak_scenario with --from-run and a deterministic fixture — confirm scenario
//   chaining works from MCP without leaking temp paths.
//
// LLM tools:
// - Permutation: ak_llm with --fixture set — confirm fixture-backed text path returns the expected
//   payload schema and never opens a network socket.
// - Permutation: ak_ollama against a fixture path — confirm same envelope surface as ak_llm.
//
// Inspection tools:
// - Permutation: ak_diff between two recorded runs — confirm diff envelope contains a stable
//   shape (added/removed/changed) when both runs have run-step artifacts (covers GAP-3 boundary).
// - Permutation: ak_narrate against tick-frames + initial-state — confirm the narrative artifact
//   schema matches the CLI's `narrate` command.
//
// External adapters (must remain fixture-backed under test):
// - Permutation: ak_ipfs with --fixture — confirm payload envelope and no network.
// - Permutation: ak_ipfs_publish with --fixture-cid — confirm artifact map handling.
// - Permutation: ak_ipfs_load with --fixture-map — confirm the per-file fetch loop.
// - Permutation: ak_blockchain with --fixture-chain-id and --fixture-balance — confirm wallet
//   shape envelope.
// - Permutation: ak_blockchain_mint with --fixture-mint — confirm token id is echoed back.
// - Permutation: ak_blockchain_load with --fixture-load — confirm card payload round-trips.
//
// Test-tooling MCP surface (lowest priority — verifying the verifier):
// - Permutation: ak_test_list_suites — confirm the suite list matches the file system.
// - Permutation: ak_test_discover_patterns — confirm pattern discovery produces a deterministic
//   list for a fixed snapshot.
// - Permutation: ak_test_plan_from_change — confirm the plan envelope shape against a known diff.
// - Permutation: ak_test_run — confirm a single test invocation returns a stable status envelope.
// - Permutation: ak_test_scaffold_case — confirm the scaffolded test file matches an in-tree
//   golden.
// - Permutation: ak_test_insert_case — confirm idempotent insertion (re-running does not duplicate).
// - Permutation: ak_test_explain_failure — confirm the explanation envelope shape for a stub
//   failing test.
// - Permutation: ak_test_lint_structure — confirm the lint envelope shape against a known-good and
//   a known-bad fixture.

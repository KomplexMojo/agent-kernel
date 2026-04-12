const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const E2E_SCENARIO = resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json");
const LLM_FIXTURE = resolve(ROOT, "tests/fixtures/adapters/llm-generate-summary.json");
const SIM_CONFIG = resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json");
const INITIAL_STATE = resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json");

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

test("mcp server lists required tools and schemas round-trips over stdio", async (t) => {
  const harness = new McpServerHarness({
    AK_SCHEMA_CATALOG_TIME: "2000-01-01T00:00:00.000Z",
  });
  t.after(async () => {
    await harness.close();
  });

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
});

test("mcp server create and llm-plan tool calls round-trip with fixture inputs", async (t) => {
  const harness = new McpServerHarness({
    AK_LLM_LIVE: "1",
  });
  t.after(async () => {
    await harness.close();
  });

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
});

test("mcp authoring tools expose preview handoff metadata for persisted outputs", async (t) => {
  const harness = new McpServerHarness();
  t.after(async () => {
    await harness.close();
  });

  await harness.initialize();

  const roomOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-room-plan-"));
  const roomPlanResult = await harness.callTool("ak_room_plan", {
    room: ["size=small;count=1;affinities=fire:emit:2"],
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
});

test("mcp server run and inspect tool calls round-trip over stdio", async (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }

  const harness = new McpServerHarness();
  t.after(async () => {
    await harness.close();
  });

  await harness.initialize();

  const runOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-run-"));
  const runResult = await harness.callTool("ak_run", {
    simConfig: SIM_CONFIG,
    initialState: INITIAL_STATE,
    ticks: 1,
    wasm: WASM_PATH,
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
});

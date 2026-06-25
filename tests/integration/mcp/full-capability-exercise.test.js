const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const net = require("node:net");
const { join, resolve } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");

function reserveFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.unref();
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
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
      env: {
        ...process.env,
        AK_DISABLE_UI_LAUNCH: "1",
        AK_LLM_LIVE: "1",
        ...env,
      },
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
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim()) this.#handleMessage(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  #handleMessage(line) {
    const message = JSON.parse(line);
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
      clientInfo: { name: "agent-kernel-full-capability-test", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  notify(method, params) {
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(this.#error(`Timed out waiting for ${method}`));
      }, 120000);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    assert.equal(Array.isArray(result.content), true, `Expected content array for ${name}`);
    assert.equal(result.content[0]?.type, "text");
    const parsedContent = JSON.parse(result.content[0].text);
    assert.deepEqual(parsedContent, result.structuredContent);
    return result.structuredContent;
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

test("mcp ak_test_exercise_capabilities covers every live fixture-backed tool family", async () => {
  const harness = new McpServerHarness({
    AK_SANDBOX_BRIDGE_PORT: String(await reserveFreePort()),
  });
  try {
    await harness.initialize();
    const listed = await harness.request("tools/list", {});
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.equal(names.length, 40);
    assert.ok(names.includes("ak_test_exercise_capabilities"));
    assert.ok(names.includes("ak_push_to_ui"));
    assert.ok(names.includes("ak_diff"));
    assert.ok(names.includes("ak_scenario"));

    const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-full-mcp-capability-"));
    const result = await harness.callTool("ak_test_exercise_capabilities", {
      scope: "all",
      outDir,
    });
    assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
    assert.equal(result.command, "test-exercise-capabilities");
    assert.equal(result.toolCount, 40);
    assert.equal(result.coveredToolCount, 40);
    assert.deepEqual(result.failures, []);

    for (const familyName of ["authoring", "simulation", "inspection", "llm", "external", "testing", "tick", "ui"]) {
      assert.ok(result.families[familyName], `missing family ${familyName}`);
      assert.equal(result.families[familyName].failed, 0, `${familyName} should have no failed tools`);
      assert.equal(
        result.families[familyName].covered,
        result.families[familyName].tools.length,
        `${familyName} should cover every listed tool`,
      );
    }
  } finally {
    await harness.close();
  }
});

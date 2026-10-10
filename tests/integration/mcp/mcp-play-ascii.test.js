// ak_play_ascii — the harness path from a request to the ASCII UI.
//
// "Create an ascii UI filled with water affinity traps" is two MCP calls: ak_create
// with water hazards, then ak_play_ascii with that call's runId. These tests run
// the real MCP server over stdio and drive exactly that sequence.

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");

function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    // Port 0: an OS-chosen sandbox bridge port, so parallel servers never collide.
    env: { ...process.env, AK_SANDBOX_BRIDGE_PORT: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.message}\n${stderr}`));
      else entry.resolve(message.result);
    }
  });
  const request = (method, params) => new Promise((resolveReq, rejectReq) => {
    const id = nextId++;
    pending.set(id, { resolve: resolveReq, reject: rejectReq });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  return {
    async initialize() {
      await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "play-ascii-test", version: "1.0.0" } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    },
    request,
    async callTool(name, args) {
      const result = await request("tools/call", { name, arguments: args });
      return result.structuredContent;
    },
    close() {
      return new Promise((resolveClose) => {
        child.once("close", resolveClose);
        child.stdin.end();
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      });
    },
  };
}

const WATER_TRAP = { affinity: "water", expression: "emit", proximityRadius: 1, mana: "one-time:30" };

test("ak_create with water traps, then ak_play_ascii by runId, shows the board with its traps", async () => {
  const server = startServer();
  try {
    await server.initialize();
    const { tools } = await server.request("tools/list", {});
    const tool = tools.find((entry) => entry.name === "ak_play_ascii");
    assert.ok(tool, "ak_play_ascii is listed");
    assert.match(tool.description, /ak_create/);

    const created = await server.callTool("ak_create", {
      text: "Create an ascii UI filled with water affinity traps",
      room: ["size=small;count=3"],
      delver: ["count=1;affinity=wind;motivation=exploring"],
      hazard: [WATER_TRAP, WATER_TRAP, WATER_TRAP],
      runId: "water-traps-mcp",
      createdAt: "2026-10-10T00:00:00.000Z",
    });
    assert.equal(created.ok, true, JSON.stringify(created));

    const shown = await server.callTool("ak_play_ascii", { runId: "water-traps-mcp" });
    assert.equal(shown.ok, true, JSON.stringify(shown));
    assert.equal(shown.command, "play");
    assert.equal(shown.turns, 0);
    const board = shown.screen.split("\n").filter((line) => /^ {2}#/.test(line)).join("\n");
    assert.equal((board.match(/H/g) || []).length, 3, `three traps on the board:\n${board}`);
    assert.match(shown.screen, /@/);
    assert.match(shown.screen, /Mind the traps \(H\)/);
    assert.doesNotMatch(shown.screen, /\u001b\[/, "plain text unless colour is asked for");
    assert.match(shown.launch, /ak\.mjs play --sim-config .*sim-config\.json --initial-state .*initial-state\.json$/);

    const moved = await server.callTool("ak_play_ascii", { runId: "water-traps-mcp", keys: "w." });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    assert.equal(moved.turns, 2);
    assert.equal(moved.status.tick, 2);

    const colored = await server.callTool("ak_play_ascii", { runId: "water-traps-mcp", color: true });
    assert.match(colored.screen, /\u001b\[48;2;/);
  } finally {
    await server.close();
  }
});

test("ak_play_ascii shows a bundled level, and refuses a directory with no level", async () => {
  const server = startServer();
  try {
    await server.initialize();
    const bundled = await server.callTool("ak_play_ascii", { level: "water-traps" });
    assert.equal(bundled.ok, true, JSON.stringify(bundled));
    assert.equal(bundled.level, "water-traps");
    await assert.rejects(
      server.callTool("ak_play_ascii", { dir: resolve(ROOT, "no-such-run-dir") }),
      /No sim-config\.json/,
    );
  } finally {
    await server.close();
  }
});

// ## TODO: Test Permutations
// - ak_play_ascii with dir set to an ak_create outDir
// - ak_play_ascii with simConfig/initialState paths, and with only one of them
// - ak_play_ascii runId of an ak_run call (run directory layout)
// - keys that reach the exit and step through (status.exited)

// ak_play_start / ak_play_act / ak_play_view / ak_play_switch / ak_play_end (Phase 2):
// a live game Claude plays a few turns at a time. These tests run the real MCP server
// over stdio: make a level with ak_create, start a game on it by runId, switch between
// the two playable delvers, play structured commands by label, and end it.

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");
// The saves go to a temp dir, not the repo's artifacts/play-sessions.
const SESSIONS = mkdtempSync(join(os.tmpdir(), "mcp-play-sessions-"));
const FLOOR = "vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1";

function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    // Port 0: an OS-chosen sandbox bridge port, so parallel servers never collide.
    env: { ...process.env, AK_SANDBOX_BRIDGE_PORT: "0", AK_PLAY_SESSIONS_DIR: SESSIONS },
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
      await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "play-session-test", version: "1.0.0" } });
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

test("a live game: start by runId, switch seats, act by label, end", async () => {
  const server = startServer();
  try {
    await server.initialize();
    const { tools } = await server.request("tools/list", {});
    for (const name of ["ak_play_start", "ak_play_act", "ak_play_view", "ak_play_switch", "ak_play_order", "ak_play_advance", "ak_play_end"]) {
      assert.ok(tools.some((tool) => tool.name === name), `${name} is listed`);
    }

    const created = await server.callTool("ak_create", {
      room: ["size=medium;count=2"],
      delver: [
        { count: 2, id: "hero", affinity: "earth", motivation: ["user_controlled", "exploring"], vitals: "health:10:1,mana:10:1,stamina:10:1,durability:10:1" },
        `count=1;id=pal;affinity=dark;motivation=exploring+friendly;${FLOOR}`,
      ],
      budgetTokens: 6000,
      runId: "party-mcp",
      createdAt: "2026-10-14T00:00:00.000Z",
    });
    assert.equal(created.ok, true, JSON.stringify(created));

    const started = await server.callTool("ak_play_start", { session: "mcp-party", runId: "party-mcp" });
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(started.active, "hero-1");
    assert.deepEqual(started.party.map((member) => member.label), ["D1", "D2"]);
    assert.ok(existsSync(join(SESSIONS, "mcp-party.json")));

    const switched = await server.callTool("ak_play_switch", { session: "mcp-party", actor: "D2" });
    assert.equal(switched.active, "hero-2");
    assert.equal(switched.turns, 0);

    const acted = await server.callTool("ak_play_act", {
      session: "mcp-party",
      commands: [{ kind: "wait" }, { kind: "wait", actorId: "D1" }],
      keys: ".",
    });
    assert.equal(acted.ok, true, JSON.stringify(acted));
    assert.equal(acted.turns, 3);
    assert.deepEqual(acted.results.map((result) => result.accepted[0]?.actorId), ["hero-2", "hero-1"]);

    const viewed = await server.callTool("ak_play_view", { session: "mcp-party" });
    assert.equal(viewed.turns, 3);
    assert.match(viewed.screen, /Party: D1 hero-1 \(exploring\) {2}\[D2 hero-2 \(exploring\)\]/);

    const ended = await server.callTool("ak_play_end", { session: "mcp-party" });
    assert.equal(ended.ended, true);
    assert.equal(existsSync(join(SESSIONS, "mcp-party.json")), false);
  } finally {
    await server.close();
  }
});

test("orders: ak_create authors a strategy, ak_play_order replaces it, ak_play_advance plays it out", async () => {
  const server = startServer();
  try {
    await server.initialize();
    const created = await server.callTool("ak_create", {
      room: ["size=medium;count=2"],
      delver: [
        { count: 1, id: "hero", affinity: "earth", motivation: ["user_controlled"], vitals: "health:10:1,mana:10:1,stamina:10:1,durability:10:1" },
        { count: 1, id: "pal", affinity: "dark", motivation: ["exploring", "friendly", "goal_oriented"], vitals: "health:10:1,mana:10:1,stamina:10:1,durability:10:1",
          strategy: { goals: [{ kind: "follow", target: "hero-1", distance: 2 }] } },
      ],
      budgetTokens: 6000,
      runId: "orders-mcp",
      createdAt: "2026-10-14T00:00:00.000Z",
    });
    assert.equal(created.ok, true, JSON.stringify(created));

    await server.callTool("ak_play_start", { session: "mcp-orders", runId: "orders-mcp" });
    const ordered = await server.callTool("ak_play_order", {
      session: "mcp-orders", actor: "D2", strategy: { goals: [{ kind: "hold", place: { x: 1, y: 1 }, ticks: 1 }] },
    });
    assert.equal(ordered.ok, true, JSON.stringify(ordered));
    assert.equal(ordered.turns, 1);
    assert.equal(ordered.orders[0].id, "pal-1");
    assert.equal(ordered.orders[0].doing.kind, "hold");

    const advanced = await server.callTool("ak_play_advance", { session: "mcp-orders", ticks: 2 });
    assert.equal(advanced.ok, true, JSON.stringify(advanced));
    assert.equal(advanced.turns, 3);
    assert.equal(advanced.results[0].ticks, 2);
    await server.callTool("ak_play_end", { session: "mcp-orders" });
  } finally {
    await server.close();
  }
});

// ## TODO: Test Permutations
// - ak_play_order to a warden answers not_yours; a malformed strategy answers invalid_strategy with the reason.
// - ak_play_advance with until "contact" stops when a hostile comes into sight.
// - ak_play_start with dir, with simConfig + initialState, and with a bundled level.
// - ak_play_switch to a companion answers not_playable and keeps the seat.
// - ak_play_act on a name that was never started answers ok: false with the reason.
// - a game survives a server restart: start, close the server, act from a new server.

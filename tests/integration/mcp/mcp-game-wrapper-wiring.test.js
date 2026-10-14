// The MCP calls a Claude Code game session makes, run against the real server over stdio.
//
// Each test is one of the wiring gaps found when checking every ak_ tool for the game
// wrapper (W1–W6): a level authored in the session, played twice and compared; a scenario
// replaying that level; show listing what a run holds; tool descriptions that say what a
// result means; and a solve that answered nothing saying so.

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
      await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "game-wrapper-wiring-test", version: "1.0.0" } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    },
    async describe(name) {
      const { tools } = await request("tools/list", {});
      const tool = tools.find((entry) => entry.name === name);
      assert.ok(tool, `${name} is listed`);
      return tool;
    },
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

const LEVEL = {
  room: ["size=small;count=2"],
  delver: ["count=1;affinity=fire;motivation=attacking"],
  warden: ["count=1;affinity=dark;motivation=defending"],
  budgetTokens: 2000,
  createdAt: "2026-10-14T00:00:00.000Z",
};

async function authorLevel(server, runId) {
  const created = await server.callTool("ak_create", { ...LEVEL, runId });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created;
}

test("ak_diff compares two ak_run plays of a level authored in the session (W1)", async () => {
  const server = startServer();
  try {
    await server.initialize();
    const level = await authorLevel(server, "wiring_diff_level");
    const playA = await server.callTool("ak_run", { fromRun: "wiring_diff_level", runId: "wiring_diff_a", ticks: 2 });
    const playB = await server.callTool("ak_run", { fromRun: "wiring_diff_level", runId: "wiring_diff_b", ticks: 3 });
    assert.equal(playA.ok, true, JSON.stringify(playA));
    assert.equal(playB.ok, true, JSON.stringify(playB));

    const diff = await server.callTool("ak_diff", { runA: "wiring_diff_a", runB: "wiring_diff_b" });
    assert.equal(diff.ok, true, JSON.stringify(diff));
    assert.deepEqual(diff.ticks, { a: 2, b: 3, delta: 1 });
    const actorIds = diff.actors.map((actor) => actor.id);
    for (const actorId of level.actorIds) {
      assert.ok(actorIds.includes(actorId), `diff lists ${actorId}: ${JSON.stringify(actorIds)}`);
    }
  } finally {
    await server.close();
  }
});

test("ak_diff over unknown runs answers ok:false instead of failing the request", async () => {
  const server = startServer();
  try {
    await server.initialize();
    await authorLevel(server, "wiring_diff_missing_level");
    const diff = await server.callTool("ak_diff", { runA: "wiring_diff_missing_level", runB: "no_such_run_anywhere" });
    assert.equal(diff.ok, false);
    assert.equal(diff.command, "diff");
  } finally {
    await server.close();
  }
});

test("ak_scenario {fromRun} replays a level authored in the session (W2)", async () => {
  const server = startServer();
  try {
    await server.initialize();
    await authorLevel(server, "wiring_scenario_level");
    const scenario = await server.callTool("ak_scenario", { fromRun: "wiring_scenario_level", ticks: 2 });
    assert.equal(scenario.ok, true, JSON.stringify(scenario));
    assert.equal(scenario.runId, "wiring_scenario_level", "the run id defaults to the level's, as with the CLI");
  } finally {
    await server.close();
  }
});

test("ak_show lists the actors and rooms of a run played from a session level (W3)", async () => {
  const server = startServer();
  try {
    await server.initialize();
    const level = await authorLevel(server, "wiring_show_level");
    await server.callTool("ak_run", { fromRun: "wiring_show_level", runId: "wiring_show_play", ticks: 2 });

    const shown = await server.callTool("ak_show", { runId: "wiring_show_play" });
    assert.equal(shown.ok, true, JSON.stringify(shown));
    assert.deepEqual(shown.actorIds, [...level.actorIds].sort());
    assert.deepEqual(shown.roomIds, [...level.roomIds].sort());
  } finally {
    await server.close();
  }
});

test("ak_create says it builds from structured specs and points freeform requests elsewhere (W4)", async () => {
  const server = startServer();
  try {
    await server.initialize();
    const tool = await server.describe("ak_create");
    assert.doesNotMatch(tool.description, /from freeform/i);
    assert.match(tool.description, /ak_scenario|ak_llm_plan/);
    assert.match(tool.inputSchema.properties.text.description, /label/i);
  } finally {
    await server.close();
  }
});

test("dryRun on ak_create, ak_run and ak_scenario says the answer is in valid, not ok (W5)", async () => {
  const server = startServer();
  try {
    await server.initialize();
    for (const name of ["ak_create", "ak_run", "ak_scenario"]) {
      const tool = await server.describe(name);
      assert.match(tool.inputSchema.properties.dryRun.description, /`valid`/, `${name} dryRun description`);
    }
  } finally {
    await server.close();
  }
});

test("ak_solve on a free-text scenario reports solved:false with the solver's reason (W6)", async () => {
  const server = startServer();
  try {
    await server.initialize();
    const tool = await server.describe("ak_solve");
    assert.match(tool.description, /solved/);
    const solved = await server.callTool("ak_solve", { scenario: "two rooms joined by a corridor" });
    assert.equal(solved.command, "solve");
    assert.equal(solved.solved, false, JSON.stringify(solved));
    assert.equal(solved.status, "deferred");
    assert.equal(solved.reason, "constraint_domain_unsupported");
  } finally {
    await server.close();
  }
});

// ## TODO: Test Permutations
// - ak_diff where one run is remembered by the session and the other lives under artifacts/runs.
// - ak_scenario {fromRun, runId} keeps the caller's run id.
// - ak_scenario {fromRun} for a remembered ak_run id (no sim-config files) reports the --from-run error.
// - ak_show on an ak_scenario root lists the replayed level's actors.
// - ak_scenario {simConfig, initialState} given explicitly bypasses remembered-run resolution.

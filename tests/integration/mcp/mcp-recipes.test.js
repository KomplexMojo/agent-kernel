// #716: the recipe catalogue over MCP. ak_recipe_list and ak_recipe_show read the Configurator's
// recipes priced by the Allocator; ak_create takes a structured delver/warden with `recipe`.

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

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

test("ak_recipe_list lists the recipes with their prices, filtered by role; ak_recipe_show expands one", async () => {
  const server = startServer();
  try {
    await server.initialize();
    const all = await server.callTool("ak_recipe_list", {});
    assert.equal(all.ok, true);
    const shadowblade = all.recipes.find((row) => row.name === "shadowblade");
    assert.deepEqual(shadowblade.cost, { delver: 391, warden: 328 });
    assert.deepEqual(shadowblade.roles, { attack: 2, defence: 0, support: 1 });
    const support = await server.callTool("ak_recipe_list", { role: "support" });
    assert.ok(support.recipes.every((row) => row.roles.support > 0));
    assert.ok(support.recipes.some((row) => row.name === "cleric"));
    const ward = await server.callTool("ak_recipe_show", { name: "spellward", role: "warden", kind: "water" });
    assert.equal(ward.recipe.expansion.kind, "water");
    assert.deepEqual(ward.recipe.expansion.affinities.map((entry) => `${entry.kind}:${entry.expression}`), ["water:draw", "water:emit"]);
    assert.deepEqual(ward.recipe.expansion.dropped, [{ kind: "water", expression: "push" }]);
    assert.equal(ward.recipe.cost, ward.recipe.lineItems.reduce((sum, item) => sum + item.spendTokens, 0));
  } finally {
    await server.close();
  }
}, 60000);

test("ak_create builds a level from structured recipe specs and returns the warden's trim as a warning", async () => {
  const server = startServer();
  const outDir = mkdtempSync(join(tmpdir(), "mcp-recipes-"));
  try {
    await server.initialize();
    const created = await server.callTool("ak_create", {
      room: ["size=medium;count=3"],
      delver: [{ recipe: "shadowblade", motivation: ["user_controlled"] }],
      warden: [{ recipe: "lantern-bearer", count: 1 }],
      grade: "F", outDir, runId: "mcp-recipes", createdAt: "2026-11-04T00:00:00.000Z",
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.deepEqual(created.warnings, ["warden[1] recipe lantern-bearer keeps light:emit, light:pull; a warden has 2 slots, so light:push is left out."]);
  } finally {
    await server.close();
    rmSync(outDir, { recursive: true, force: true });
  }
}, 120000);

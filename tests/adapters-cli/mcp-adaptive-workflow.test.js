const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");
const INPUT = resolve(ROOT, "tests/fixtures/adaptive-workflow/mcp-tool-run-v1-basic.json");

class Harness {
  constructor() {
    this.id = 1; this.buffer = ""; this.pending = new Map(); this.stderr = "";
    this.child = spawn(process.execPath, [SERVER], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8"); this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.child.stdout.on("data", (chunk) => { this.buffer += chunk; let index; while ((index = this.buffer.indexOf("\n")) >= 0) { const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1); if (line.trim()) this.message(JSON.parse(line)); } });
  }
  message(message) { const queue = this.pending.get(message.id); const pending = queue?.shift(); if (!pending) return; clearTimeout(pending.timer); if (!queue.length) this.pending.delete(message.id); message.error ? pending.reject(new Error(`${message.error.message}\n${this.stderr}`)) : pending.resolve(message.result); }
  request(method, params = {}, id = this.id++) { return new Promise((resolveRequest, reject) => { const timer = setTimeout(() => reject(new Error(`timeout: ${method}\n${this.stderr}`)), 15000); const queue = this.pending.get(id) || []; queue.push({ resolve: resolveRequest, reject, timer }); this.pending.set(id, queue); this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); }); }
  async init() { const result = await this.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "m9-test", version: "1" } }); this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`); return result; }
  async call(name, args, id) { const result = await this.request("tools/call", { name, arguments: args }, id); return result.structuredContent; }
  close() { return new Promise((done) => { if (this.child.exitCode !== null) return done(this.child.exitCode); const timer = setTimeout(() => this.child.kill(), 1000); this.child.once("exit", (code) => { clearTimeout(timer); done(code); }); this.child.stdin.end(); }); }
}

test("MCP exposes typed workflow tools and safe resources without regressing existing tools", async () => {
  const h = new Harness(); try {
    const initialized = await h.init(); assert.deepEqual(initialized.capabilities.resources, {}); const listed = await h.request("tools/list"); const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.includes("ak_run"));
    for (const name of ["ak_workflow_run", "ak_workflow_status", "ak_workflow_replay", "ak_workflow_cancel", "ak_workflow_validate"]) {
      const schema = listed.tools.find((tool) => tool.name === name).inputSchema; assert.equal(schema.additionalProperties, false); assert.equal(schema.type, "object");
      assert.equal(Array.isArray(name.endsWith("run") || name.endsWith("validate") ? schema.oneOf : schema.anyOf), true);
      if (name.endsWith("run") || name.endsWith("validate")) { assert.equal(schema.properties.maxModelAttempts.type, "integer"); assert.equal(schema.properties.maxModelAttempts.minimum, 1); assert.equal(schema.properties.createdAt.format, "date-time"); }
    }
    const resources = await h.request("resources/list"); assert.deepEqual(resources.resources.map((item) => item.uri).sort(), ["agent-kernel://adaptive-workflow/policy", "agent-kernel://adaptive-workflow/run-history", "agent-kernel://adaptive-workflow/runtime-profile", "agent-kernel://adaptive-workflow/validators"]); assert.ok(resources.resources.every((item) => item.mimeType === "application/json"));
    const validators = await h.request("resources/read", { uri: "agent-kernel://adaptive-workflow/validators" }); assert.equal(validators.contents[0].mimeType, "application/json"); assert.deepEqual(JSON.parse(validators.contents[0].text).validators, [{ id: "workflow_required_keys", version: 1 }]);
    for (const uri of ["policy", "runtime-profile", "run-history"].map((name) => `agent-kernel://adaptive-workflow/${name}`)) { const read = await h.request("resources/read", { uri }); assert.equal(read.contents[0].uri, uri); assert.doesNotMatch(read.contents[0].text, /secret|credential|token/i); }
  } finally { await h.close(); }
});

test("workflow calls use temp persistence, remembered lifecycle, and duplicate request protection", async () => {
  const h = new Harness(); try {
    await h.init(); const first = await h.call("ak_workflow_run", { input: INPUT }, 41); const duplicate = await h.call("ak_workflow_run", { input: INPUT }, 41);
    assert.equal(first.outcome, "complete"); assert.equal(first.executionCalls, 1); assert.deepEqual(duplicate, first); assert.equal(first.artifactLocation.defaultedToTemp, true);
    const status = await h.call("ak_workflow_status", { runId: first.runId }); assert.equal(status.phase, "complete");
    const sourceState = readFileSync(join(first.outDir, "state.json"), "utf8");
    const replay = await h.call("ak_workflow_replay", { runId: first.runId }); assert.equal(replay.liveModelCalls, 0); assert.equal(replay.liveExecutionCalls, 0);
    assert.equal(readFileSync(join(first.outDir, "state.json"), "utf8"), sourceState); assert.equal(existsSync(join(first.outDir, "replay-state.json")), true);
    const cancel = await h.call("ak_workflow_cancel", { runId: first.runId }); assert.equal(cancel.terminal, true);
    const history = await h.request("resources/read", { uri: "agent-kernel://adaptive-workflow/run-history" }); assert.equal(JSON.parse(history.contents[0].text).runs[0].runId, first.runId);
  } finally { await h.close(); }
});

test("workflow schema and request-id conflicts fail without killing the server", async () => {
  const h = new Harness(); try {
    await h.init(); await assert.rejects(() => h.call("ak_workflow_validate", { input: INPUT, unknown: true }), /unknown/i);
    const valid = await h.call("ak_workflow_validate", { input: INPUT }, 99); assert.equal(valid.valid, true);
    await assert.rejects(() => h.call("ak_workflow_validate", { objective: "different" }, 99), /request id|conflict/i);
    const samePayload = await h.call("ak_workflow_validate", { input: INPUT }, 98); assert.equal(samePayload.valid, true); await assert.rejects(() => h.call("ak_workflow_status", { runId: "anything" }, 98), /request id|conflict/i);
    await assert.rejects(() => h.call("ak_workflow_run", {}, 97), /input form|requires/i); await assert.rejects(() => h.call("ak_workflow_validate", { input: INPUT }, 97), /request id|conflict/i); assert.equal((await h.call("ak_workflow_validate", { input: INPUT }, 96)).valid, true);
    assert.ok((await h.request("tools/list")).tools.some((tool) => tool.name === "ak_create"));
    await assert.rejects(() => h.request("resources/read", { uri: "agent-kernel://adaptive-workflow/unknown" }), /unknown/i);
    assert.ok((await h.request("tools/list")).tools.some((tool) => tool.name === "ak_create"));
  } finally { await h.close(); }
});

test("manual guards match the advertised workflow schemas", async () => {
  const h = new Harness(); try {
    await h.init();
    for (const [name, args] of [["ak_workflow_run", {}], ["ak_workflow_run", { input: INPUT, objective: "conflict" }], ["ak_workflow_run", { objective: " " }], ["ak_workflow_run", { objective: "x", maxModelAttempts: 0 }], ["ak_workflow_run", { objective: "x", maxModelAttempts: 1.5 }], ["ak_workflow_run", { objective: "x", createdAt: "0" }], ["ak_workflow_run", { objective: "x", createdAt: "2026-02-30T00:00:00Z" }], ["ak_workflow_status", {}], ["ak_workflow_status", { runId: " " }], ["ak_workflow_cancel", { runId: "missing", reason: " " }]]) await assert.rejects(() => h.call(name, args), /invalid|missing|requires|input form/i);
    assert.equal((await h.call("ak_workflow_validate", { objective: "valid", createdAt: "2026-07-13T12:00:00-07:00" }, 701)).valid, true);
  } finally { await h.close(); }
});

test("concurrent duplicate ids share one side effect while string and numeric ids remain distinct", async () => {
  const h = new Harness(); try {
    await h.init(); const [first, duplicate] = await Promise.all([h.call("ak_workflow_run", { input: INPUT }, 801), h.call("ak_workflow_run", { input: INPUT }, 801)]);
    assert.deepEqual(duplicate, first); assert.equal(first.executionCalls, 1);
    const numeric = await h.call("ak_workflow_validate", { objective: "numeric" }, 802); const string = await h.call("ak_workflow_validate", { objective: "string" }, "802");
    assert.equal(numeric.valid, true); assert.equal(string.valid, true);
    await assert.rejects(() => h.call("ak_workflow_status", { runId: "missing" }, 803), /missing|unknown/i);
    assert.equal((await h.call("ak_workflow_validate", { objective: "still alive" }, 804)).valid, true);
    for (let index = 0; index < 130; index += 1) assert.equal((await h.call("ak_workflow_validate", { objective: `bounded-${index}` }, 1000 + index)).valid, true);
    assert.equal((await h.call("ak_workflow_validate", { objective: "evicted" }, 1000)).valid, true);
  } finally { await h.close(); }
});

test("failed workflow results restore transport capture and process exit state", async () => {
  const h = new Harness(); let exitCode; try {
    await h.init(); const root = mkdtempSync(join(os.tmpdir(), "ak-mcp-workflow-fail-")); const inputPath = join(root, "input.json"); const input = JSON.parse(readFileSync(INPUT, "utf8")); input.runId = "mcp_workflow_failure"; input.requiredKeys = ["absent"]; writeFileSync(inputPath, JSON.stringify(input));
    const result = await h.call("ak_workflow_run", { input: inputPath }, 951); assert.equal(result.outcome, "failed"); assert.equal(result.executionCalls, 0);
    assert.equal((await h.call("ak_workflow_validate", { input: INPUT }, 952)).valid, true);
  } finally { exitCode = await h.close(); }
  assert.equal(exitCode, 0);
});

test("explicit persistence and validate-only paths preserve MCP resource availability", async () => {
  const h = new Harness(); try {
    await h.init(); const root = mkdtempSync(join(os.tmpdir(), "ak-mcp-workflow-")); const outDir = join(root, "run"); const validateDir = join(root, "validate-only");
    assert.equal((await h.call("ak_workflow_validate", { objective: "no writes", outDir: validateDir })).valid, true); assert.equal(existsSync(validateDir), false);
    await h.call("ak_workflow_validate", { input: INPUT }, 908); const running = h.call("ak_workflow_run", { input: INPUT, outDir }, 901); await new Promise((done) => setTimeout(done, 20));
    const errors = [h.call("ak_workflow_run", {}, 906), h.request("tools/call", { name: "ak_missing", arguments: {} }, 907), h.call("ak_workflow_validate", { objective: "conflict" }, 908)].map((request) => request.then(() => "", (error) => error.message));
    const [result, listed, resources, policy, validate, invalid, unknown, conflict] = await Promise.all([running, h.request("tools/list", {}, 902), h.request("resources/list", {}, 903), h.request("resources/read", { uri: "agent-kernel://adaptive-workflow/policy" }, 904), h.call("ak_workflow_validate", { input: INPUT }, 905), ...errors]);
    assert.equal(result.outDir, outDir); assert.ok(listed.tools.some((tool) => tool.name === "ak_create")); assert.equal(resources.resources.length, 4); assert.equal(JSON.parse(policy.contents[0].text).validationAuthority, "deterministic"); assert.equal(validate.valid, true);
    assert.match(invalid, /input form|requires/i); assert.match(unknown, /unknown tool/i); assert.match(conflict, /request id|conflict/i);
    assert.equal((await h.call("ak_workflow_status", { runId: result.runId })).phase, "complete");
  } finally { await h.close(); }
});

test("invalid payload, terminal cancel, missing replay, and id/payload conflict are handled", async () => {
  const h = new Harness();
  try {
    await h.init();
    // Invalid tool payload (two mutually exclusive input forms) fails without executing.
    await assert.rejects(() => h.call("ak_workflow_run", { input: INPUT, objective: "both" }, 601), /input form|invalid|requires/i);
    // A completed run stays terminal across repeated cancellations.
    const run = await h.call("ak_workflow_run", { input: INPUT }, 602);
    assert.equal(run.outcome, "complete");
    assert.equal((await h.call("ak_workflow_cancel", { runId: run.runId })).terminal, true);
    assert.equal((await h.call("ak_workflow_cancel", { runId: run.runId })).terminal, true);
    // Replay of an unknown run fails without live IO.
    await assert.rejects(() => h.call("ak_workflow_replay", { runId: "does-not-exist" }, 603), /missing|unknown/i);
    // Duplicate request id with a different payload conflicts; the server stays alive.
    assert.equal((await h.call("ak_workflow_validate", { input: INPUT }, 604)).valid, true);
    await assert.rejects(() => h.call("ak_workflow_validate", { objective: "different-payload" }, 604), /request id|conflict/i);
    assert.equal((await h.call("ak_workflow_validate", { objective: "still alive" }, 605)).valid, true);
  } finally {
    await h.close();
  }
});

// ## TODO: Test Permutations (expanded in M11)
// - invalid tool payload -> covered by "invalid payload, terminal cancel, missing replay ..."
// - cancellation of a completed run stays terminal -> covered by the same test
// - replay of a missing run fails without live IO -> covered by the same test
// - duplicate request id with a different payload conflicts -> covered by the same test

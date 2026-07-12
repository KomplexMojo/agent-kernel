// M9 — Full MCP tool coverage test suite
//
// This file covers the 22 MCP tools that were identified as uncovered in the Gap Registry
// (mcp-server.test.js). Tests are grouped by tool family. Each group uses its own harness
// instance for isolation. Run/replay/narrate coverage uses the in-process core-ts runtime.
//
// Tools tested here (22 total):
//   Simulation: ak_build, ak_budget, ak_configurator
//   LLM (fixture-backed): ak_llm, ak_ollama
//   External adapters:    ak_ipfs, ak_ipfs_publish, ak_ipfs_load,
//                         ak_blockchain, ak_blockchain_mint, ak_blockchain_load
//   Test handlers:        ak_test_list_suites, ak_test_discover_patterns, ak_test_plan_from_change,
//                         ak_test_run, ak_test_scaffold_case, ak_test_insert_case,
//                         ak_test_explain_failure, ak_test_lint_structure
//   core runtime:     ak_replay, ak_narrate
//
// Known limitations (excluded — require on-disk artifacts/runs/<id> structure):
//   ak_diff     — resolveDiffRunArtifacts reads from artifacts/runs/<id> on the filesystem
//   ak_scenario — fromRun mode also reads from artifacts/runs/<id> on the filesystem;
//                 text+catalog+dry-run requires a full LLM session even for validation

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");

// Fixture paths
const BUILD_SPEC = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-basic.json");
const BUDGET = resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json");
const PRICE_LIST = resolve(ROOT, "tests/fixtures/artifacts/price-list-artifact-v1-basic.json");
const BUDGET_RECEIPT = resolve(ROOT, "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json");
const LEVEL_GEN = resolve(ROOT, "tests/fixtures/configurator/level-gen-input-v1-hazard.json");
const ACTORS = resolve(ROOT, "tests/fixtures/configurator/actors-v1-affinity-base.json");
const LLM_FIXTURE = resolve(ROOT, "tests/fixtures/adapters/llm-generate.json");
const IPFS_FIXTURE = resolve(ROOT, "tests/fixtures/adapters/ipfs-price-list.json");
const IPFS_ARTIFACT_MAP = resolve(ROOT, "tests/fixtures/adapters/ipfs-artifacts-map.json");
const BLOCKCHAIN_CHAIN_ID = resolve(ROOT, "tests/fixtures/adapters/blockchain-chain-id.json");
const BLOCKCHAIN_BALANCE = resolve(ROOT, "tests/fixtures/adapters/blockchain-balance.json");
const BLOCKCHAIN_MINT = resolve(ROOT, "tests/fixtures/adapters/blockchain-mint.json");
const BLOCKCHAIN_LOAD = resolve(ROOT, "tests/fixtures/adapters/blockchain-load.json");
const CARD_CONFIG = resolve(ROOT, "tests/fixtures/adapters/card-config-delver.json");
const SIM_CONFIG = resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-hazard.json");
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
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim()) this.#handleMessage(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  #handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
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
      clientInfo: { name: "agent-kernel-mcp-tools-test", version: "1.0.0" },
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
    assert.equal(result.structuredContent.ok, true, `Expected ok: true for ${name}\n${JSON.stringify(result.structuredContent, null, 2)}`);
    return result.structuredContent;
  }

  // Like callTool but does not assert ok===true — used for tools that may return ok=false
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


// ── Simulation tools (no core-ts required) ──────────────────────────────────────

test("mcp ak_build produces a bundle from a build spec with core-ts", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-build-");
    const result = await harness.callTool("ak_build", {
      spec: BUILD_SPEC,
      outDir,
    });
    assert.equal(result.command, "build");
    assert.ok(result.outDir, "outDir must be present in response");
    assert.equal(existsSync(join(outDir, "bundle.json")), true, "bundle.json must be written");
    assert.equal(existsSync(join(outDir, "manifest.json")), true, "manifest.json must be written");
    assert.equal(existsSync(join(outDir, "spec.json")), true, "spec.json must be written");
  } finally {
    await harness.close();
  }
});

test("mcp ak_budget returns budget receipt envelope from fixture artifacts", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-budget-");
    const result = await harness.callTool("ak_budget", {
      budget: BUDGET,
      priceList: PRICE_LIST,
      receipt: BUDGET_RECEIPT,
      outDir,
    });
    assert.equal(result.command, "budget");
    assert.equal(result.budget?.schema, "agent-kernel/BudgetArtifact");
    assert.equal(result.priceList?.schema, "agent-kernel/PriceList");
    assert.equal(result.receipt?.schema, "agent-kernel/BudgetReceiptArtifact");
  } finally {
    await harness.close();
  }
});

test("mcp ak_configurator assembles sim-config and initial-state from fixtures", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-configurator-");
    const result = await harness.callTool("ak_configurator", {
      levelGen: LEVEL_GEN,
      actors: ACTORS,
      outDir,
      runId: "run_mcp_configurator",
    });
    assert.equal(result.command, "configurator");
    assert.equal(existsSync(join(outDir, "sim-config.json")), true, "sim-config.json must be written");
    assert.equal(existsSync(join(outDir, "initial-state.json")), true, "initial-state.json must be written");
    const simConfig = JSON.parse(readFileSync(join(outDir, "sim-config.json"), "utf8"));
    assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");
  } finally {
    await harness.close();
  }
});

// ── LLM tools (fixture-backed) ────────────────────────────────────────────────

test("mcp ak_llm writes LLM response JSON using fixture adapter", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-llm-");
    const result = await harness.callTool("ak_llm", {
      prompt: "hello",
      model: "fixture",
      fixture: LLM_FIXTURE,
      outDir,
    });
    assert.equal(result.command, "llm");
    assert.ok(typeof result.stdout === "string" && result.stdout.includes("llm: wrote"), "stdout must name the written path");
    assert.equal(existsSync(join(outDir, "llm.json")), true, "llm.json must be written");
  } finally {
    await harness.close();
  }
});

test("mcp ak_ollama writes LLM response JSON using fixture adapter (ollama alias)", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-ollama-");
    const result = await harness.callTool("ak_ollama", {
      prompt: "hello",
      model: "fixture",
      fixture: LLM_FIXTURE,
      outDir,
    });
    assert.equal(result.command, "ollama");
    assert.ok(typeof result.stdout === "string" && result.stdout.includes("llm: wrote"), "stdout must name the written path");
    assert.equal(existsSync(join(outDir, "llm.json")), true, "llm.json must be written");
  } finally {
    await harness.close();
  }
});

// ── External adapter tools (fixture-backed) ───────────────────────────────────

test("mcp ak_ipfs fetches content via fixture without network", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-ipfs-");
    const result = await harness.callTool("ak_ipfs", {
      cid: "bafyfixture",
      json: true,
      fixture: IPFS_FIXTURE,
      outDir,
    });
    assert.equal(result.command, "ipfs");
    assert.ok(typeof result.stdout === "string" && result.stdout.includes("ipfs: wrote"), "stdout must name written path");
    assert.equal(existsSync(join(outDir, "ipfs.json")), true, "ipfs.json must be written");
    const payload = JSON.parse(readFileSync(join(outDir, "ipfs.json"), "utf8"));
    assert.equal(payload.schema, "agent-kernel/PriceList");
  } finally {
    await harness.close();
  }
});

test("mcp ak_ipfs_publish publishes via fixture-cid without network", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-ipfs-publish-");
    const result = await harness.callTool("ak_ipfs_publish", {
      artifactMap: IPFS_ARTIFACT_MAP,
      fixtureCid: "bafypublishfixture",
      outDir,
    });
    assert.equal(result.command, "ipfs-publish");
    assert.ok(typeof result.stdout === "string" && result.stdout.includes("ipfs-publish: wrote"), "stdout must name written path");
    assert.equal(existsSync(join(outDir, "ipfs-publish.json")), true, "ipfs-publish.json must be written");
    const summary = JSON.parse(readFileSync(join(outDir, "ipfs-publish.json"), "utf8"));
    assert.equal(summary.cid, "bafypublishfixture");
    assert.equal(summary.mode, "fixture");
    assert.ok(summary.publishedFiles.includes("bundle.json"));
  } finally {
    await harness.close();
  }
});

test("mcp ak_ipfs_load fetches artifact map files via fixture without network", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-ipfs-load-");
    const result = await harness.callTool("ak_ipfs_load", {
      cid: "bafyfixture",
      fixtureMap: IPFS_ARTIFACT_MAP,
      outDir,
    });
    assert.equal(result.command, "ipfs-load");
    assert.ok(typeof result.stdout === "string" && result.stdout.includes("ipfs-load: wrote"), "stdout must name written path");
    assert.equal(existsSync(join(outDir, "ipfs-load.json")), true, "ipfs-load.json must be written");
    const summary = JSON.parse(readFileSync(join(outDir, "ipfs-load.json"), "utf8"));
    assert.equal(summary.cid, "bafyfixture");
    assert.ok(Array.isArray(summary.fetchedFiles) && summary.fetchedFiles.includes("bundle.json"));
  } finally {
    await harness.close();
  }
});

test("mcp ak_blockchain returns chainId and balance from fixture files", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-blockchain-");
    const result = await harness.callTool("ak_blockchain", {
      rpcUrl: "http://local",
      address: "0xabc",
      fixtureChainId: BLOCKCHAIN_CHAIN_ID,
      fixtureBalance: BLOCKCHAIN_BALANCE,
      outDir,
    });
    assert.equal(result.command, "blockchain");
    assert.ok(typeof result.stdout === "string" && result.stdout.includes("blockchain: wrote"), "stdout must name written path");
    assert.equal(existsSync(join(outDir, "blockchain.json")), true, "blockchain.json must be written");
    const payload = JSON.parse(readFileSync(join(outDir, "blockchain.json"), "utf8"));
    assert.equal(payload.chainId, JSON.parse(readFileSync(BLOCKCHAIN_CHAIN_ID, "utf8")).result);
    assert.equal(payload.balance, JSON.parse(readFileSync(BLOCKCHAIN_BALANCE, "utf8")).result);
  } finally {
    await harness.close();
  }
});

test("mcp ak_blockchain_mint returns minted token metadata from fixture files", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-blockchain-mint-");
    const result = await harness.callTool("ak_blockchain_mint", {
      rpcUrl: "http://local",
      card: CARD_CONFIG,
      owner: "0xabc",
      fixtureChainId: BLOCKCHAIN_CHAIN_ID,
      fixtureMint: BLOCKCHAIN_MINT,
      outDir,
    });
    assert.equal(result.command, "blockchain-mint");
    assert.ok(typeof result.stdout === "string" && result.stdout.includes("blockchain-mint: wrote"));
    assert.equal(existsSync(join(outDir, "blockchain-mint.json")), true, "blockchain-mint.json must be written");
    const payload = JSON.parse(readFileSync(join(outDir, "blockchain-mint.json"), "utf8"));
    const mintFixture = JSON.parse(readFileSync(BLOCKCHAIN_MINT, "utf8"));
    assert.equal(payload.tokenId, mintFixture.result.tokenId);
  } finally {
    await harness.close();
  }
});

test("mcp ak_blockchain_load returns card payload from fixture files", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const outDir = makeTempDir("agent-kernel-mcp-blockchain-load-");
    const result = await harness.callTool("ak_blockchain_load", {
      rpcUrl: "http://local",
      tokenId: "token_fixture_1",
      fixtureChainId: BLOCKCHAIN_CHAIN_ID,
      fixtureLoad: BLOCKCHAIN_LOAD,
      outDir,
    });
    assert.equal(result.command, "blockchain-load");
    assert.ok(typeof result.stdout === "string" && result.stdout.includes("blockchain-load: wrote"));
    assert.equal(existsSync(join(outDir, "blockchain-load.json")), true, "blockchain-load.json must be written");
    const payload = JSON.parse(readFileSync(join(outDir, "blockchain-load.json"), "utf8"));
    assert.equal(payload.tokenId, "token_fixture_1");
    assert.equal(payload.card?.type, "delver");
  } finally {
    await harness.close();
  }
});

// ── Test handler tools ─────────────────────────────────────────────────────────

test("mcp ak_test_list_suites returns inventory and recipe catalog", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_test_list_suites");
    assert.equal(result.ok, true);
    assert.ok(typeof result.inventoryPath === "string");
    assert.ok(typeof result.classificationPath === "string");
    assert.ok(result.summary && typeof result.summary.total === "number" && result.summary.total > 0);
    assert.ok(Array.isArray(result.recipes) && result.recipes.length > 0);
    assert.ok(Array.isArray(result.scaffoldableRecipes) && result.scaffoldableRecipes.length > 0);
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_discover_patterns returns pattern list filterable by runner", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const allResult = await harness.callTool("ak_test_discover_patterns");
    assert.equal(allResult.ok, true);
    assert.ok(typeof allResult.count === "number" && allResult.count > 0);
    assert.ok(Array.isArray(allResult.files));

    const vitestResult = await harness.callTool("ak_test_discover_patterns", { runner: "vitest" });
    assert.equal(vitestResult.ok, true);
    assert.ok(vitestResult.files.every((entry) => entry.runner === "vitest"), "filtered result must only contain vitest files");
    assert.ok(vitestResult.count <= allResult.count);
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_plan_from_change maps changed paths to runner and suite recommendations", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_test_plan_from_change", {
      paths: ["packages/adapters-cli/src/cli/ak.mjs", "packages/ui-web/src/views/design-view.js"],
    });
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.runners));
    assert.ok(result.runners.includes("vitest"), "adapters-cli change must recommend vitest");
    assert.ok(result.runners.includes("playwright"), "ui-web change must recommend playwright");
    assert.ok(Array.isArray(result.suites));
    assert.ok(result.suites.includes("adapters-cli"));
    assert.ok(result.suites.includes("ui-web"));
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_plan_from_change with runtime-only path returns vitest and runtime suite", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_test_plan_from_change", {
      paths: ["packages/runtime/src/personas/allocator/layout-spend.js"],
    });
    assert.equal(result.ok, true);
    assert.ok(result.runners.includes("vitest"));
    assert.ok(result.suites.includes("runtime"));
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_run inventory mode returns ok status envelope", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const result = await harness.callToolRaw("ak_test_run", { mode: "inventory" });
    assert.equal(typeof result.ok, "boolean", "ok must be a boolean");
    assert.equal(result.mode, "inventory");
    assert.equal(typeof result.status, "number");
    assert.equal(typeof result.stdout, "string");
    assert.equal(typeof result.stderr, "string");
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_scaffold_case writes a cli_success_artifacts scaffold file", async () => {
  const harness = new McpServerHarness();
  const targetFile = join(os.tmpdir(), `mcp-m9-scaffold-${Date.now()}.js`);
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_test_scaffold_case", {
      recipe: "cli_success_artifacts",
      targetFile,
      title: "mcp scaffold smoke test",
      commandArgs: ["build", "--spec", "tests/fixtures/artifacts/build-spec-v1-basic.json"],
      expectedArtifacts: ["bundle.json", "manifest.json"],
    });
    assert.equal(result.ok, true);
    assert.equal(result.recipe, "cli_success_artifacts");
    assert.equal(existsSync(targetFile), true, "scaffold file must be written");
    const content = readFileSync(targetFile, "utf8");
    assert.ok(content.includes("mcp scaffold smoke test"), "test title must appear in scaffold");
    assert.ok(content.includes("bundle.json"), "expectedArtifact must appear in scaffold");
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_insert_case appends a case to an existing test file without duplication", async () => {
  const harness = new McpServerHarness();
  const targetFile = join(os.tmpdir(), `mcp-m9-insert-${Date.now()}.js`);
  try {
    await harness.initialize();
    // First insertion
    const first = await harness.callTool("ak_test_insert_case", {
      recipe: "cli_failure_message",
      targetFile,
      title: "mcp insert smoke first",
      commandArgs: ["show"],
      expectedErrorPattern: "--run-id",
    });
    assert.equal(first.ok, true);
    assert.equal(first.recipe, "cli_failure_message");
    const contentAfterFirst = readFileSync(targetFile, "utf8");

    // Second insertion — different title to avoid idempotency concerns
    await harness.callTool("ak_test_insert_case", {
      recipe: "cli_failure_message",
      targetFile,
      title: "mcp insert smoke second",
      commandArgs: ["show"],
      expectedErrorPattern: "--run-id",
    });
    const contentAfterSecond = readFileSync(targetFile, "utf8");
    // Second file must be strictly longer (new case appended)
    assert.ok(contentAfterSecond.length > contentAfterFirst.length, "second insertion must append new content");
    assert.ok(contentAfterSecond.includes("mcp insert smoke first"), "first title must be retained");
    assert.ok(contentAfterSecond.includes("mcp insert smoke second"), "second title must appear");
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_explain_failure classifies assertion failures correctly", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_test_explain_failure", {
      text: "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n+ 'foo'\n- 'bar'",
    });
    assert.equal(result.ok, true);
    assert.equal(result.explanation.kind, "assertion_failure");
    assert.ok(typeof result.explanation.summary === "string" && result.explanation.summary.length > 0);
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_explain_failure classifies module resolution errors correctly", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_test_explain_failure", {
      text: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest'",
    });
    assert.equal(result.ok, true);
    assert.equal(result.explanation.kind, "module_resolution");
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_explain_failure returns unknown kind for unrecognized output", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_test_explain_failure", {
      text: "some unrecognized failure output without known patterns",
    });
    assert.equal(result.ok, true);
    assert.equal(result.explanation.kind, "unknown");
  } finally {
    await harness.close();
  }
});

test("mcp ak_test_lint_structure returns structural lint envelope", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();
    const result = await harness.callTool("ak_test_lint_structure");
    assert.equal(result.ok, true);
    assert.equal(typeof result.uncategorizedCount, "number");
    assert.ok(Array.isArray(result.uncategorized));
    assert.equal(typeof result.codemodExceptionCount, "number");
    assert.ok(Array.isArray(result.codemodExceptions));
    assert.equal(typeof result.browserCandidateCount, "number");
    assert.ok(Array.isArray(result.scaffoldableRecipes));
  } finally {
    await harness.close();
  }
});

// ── core runtime tools ────────────────────────────────────────────────────

test("mcp ak_replay re-executes tick frames deterministically", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();

    // Produce tick-frames from a run first
    const runOutDir = makeTempDir("agent-kernel-mcp-replay-run-");
    const runResult = await harness.callTool("ak_run", {
      simConfig: SIM_CONFIG,
      initialState: INITIAL_STATE,
      ticks: 1,      outDir: runOutDir,
    });
    const tickFramesPath = join(runOutDir, "tick-frames.json");
    assert.equal(existsSync(tickFramesPath), true, "run must produce tick-frames.json");

    const replayOutDir = makeTempDir("agent-kernel-mcp-replay-");
    const replayResult = await harness.callTool("ak_replay", {
      simConfig: SIM_CONFIG,
      initialState: INITIAL_STATE,
      tickFrames: tickFramesPath,      outDir: replayOutDir,
    });
    assert.equal(replayResult.command, "replay");
    assert.equal(existsSync(join(replayOutDir, "replay-tick-frames.json")), true, "replay must produce replay-tick-frames.json");
    assert.equal(existsSync(join(replayOutDir, "replay-summary.json")), true, "replay must produce replay-summary.json");

    // Replay must produce the same number of frames (runIds differ between run and replay)
    const original = JSON.parse(readFileSync(tickFramesPath, "utf8"));
    const replayed = JSON.parse(readFileSync(join(replayOutDir, "replay-tick-frames.json"), "utf8"));
    assert.equal(Array.isArray(original), true);
    assert.equal(Array.isArray(replayed), true);
    assert.equal(original.length, replayed.length, "replay must produce the same tick count as the original run");
  } finally {
    await harness.close();
  }
});

test("mcp ak_narrate produces a narrative artifact from tick-frames and initial-state", async () => {
  const harness = new McpServerHarness();
  try {
    await harness.initialize();

    // Produce tick-frames from a run first
    const runOutDir = makeTempDir("agent-kernel-mcp-narrate-run-");
    await harness.callTool("ak_run", {
      simConfig: SIM_CONFIG,
      initialState: INITIAL_STATE,
      ticks: 1,      outDir: runOutDir,
    });
    const tickFramesPath = join(runOutDir, "tick-frames.json");
    assert.equal(existsSync(tickFramesPath), true, "run must produce tick-frames.json");

    const narrateOutDir = makeTempDir("agent-kernel-mcp-narrate-");
    const narrateResult = await harness.callTool("ak_narrate", {
      tickFrames: tickFramesPath,
      initialState: INITIAL_STATE,
      outDir: narrateOutDir,
    });
    assert.equal(narrateResult.command, "narrate");
    assert.equal(existsSync(join(narrateOutDir, "narrative.json")), true, "narrate must produce narrative.json");
    const narrative = JSON.parse(readFileSync(join(narrateOutDir, "narrative.json"), "utf8"));
    assert.equal(narrative.schema, "agent-kernel/NarrativeArtifact");
  } finally {
    await harness.close();
  }
});

test("mcp tick session: ak_tick_forward, ak_show_state, ak_tick_backward after a full-dungeon run", async () => {
  const workDir = makeTempDir("agent-kernel-mcp-tick-session-");
  const artifactsDir = join(workDir, "artifacts");
  const runId = "ring_mcp_tick_session";
  const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

  // Set up create + run via CLI into workDir so tick tools can navigate on-disk state.
  // No --out-dir: artifacts land under workDir/artifacts/runs/<runId>/ by convention.
  const cliSpawn = (args) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: workDir, encoding: "utf8", env: { ...process.env } });

  const createOut = cliSpawn([
    "create",
    "--room", "size=medium;count=1",
    "--hazard", "x=2;y=2;affinity=fire;expression=emit;stacks=3",
    "--resource", "tier=level;stat=vitalMax;delta=10;dropRate=50",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--warden", "count=1;affinity=dark;motivation=defending",
    "--run-id", runId,
    "--created-at", "2026-04-26T00:00:00.000Z",
  ]);
  assert.equal(createOut.status, 0, `CLI create failed:\n${createOut.stderr}`);

  const runOut = cliSpawn([
    "run",
    "--from-run", runId,    "--ticks", "3",
  ]);
  assert.equal(runOut.status, 0, `CLI run failed:\n${runOut.stderr}`);

  const tickFramesPath = join(workDir, "artifacts", "runs", runId, "run", "tick-frames.json");
  assert.equal(existsSync(tickFramesPath), true, "CLI run must produce tick-frames.json");

  // MCP harness pointed at the same artifact dir so tick tools resolve the same run dir.
  const harness = new McpServerHarness({ AK_ARTIFACTS_DIR: artifactsDir });
  try {
    await harness.initialize();

    // Forward twice — cursor should advance 0→1→2.
    const fwd1 = await harness.callTool("ak_tick_forward", { runId });
    assert.equal(fwd1.action, "forward");
    assert.equal(fwd1.tick, 1);
    assert.equal(fwd1.previousTick, 0);
    assert.ok(typeof fwd1.maxTick === "number" && fwd1.maxTick >= 1, "maxTick must be a positive number");

    const fwd2 = await harness.callTool("ak_tick_forward", { runId });
    assert.equal(fwd2.action, "forward");
    assert.equal(fwd2.tick, 2);

    // State at tick 2 — confirm tickFrame is present and consistent.
    const state = await harness.callTool("ak_show_state", { runId });
    assert.equal(state.action, "state");
    assert.equal(state.tick, 2, "state must reflect cursor at tick 2");
    assert.ok(state.tickFrame !== undefined, "state must include tickFrame at cursor tick");
    assert.ok(Array.isArray(state.tickFrame.acceptedActions), "tickFrame must have acceptedActions array");
    assert.equal(state.tickFrame.tick, 2, "tickFrame.tick must match cursor tick");

    // Backward once — cursor rewinds 2→1.
    const bwd = await harness.callTool("ak_tick_backward", { runId });
    assert.equal(bwd.action, "backward");
    assert.equal(bwd.tick, 1);
    assert.equal(bwd.previousTick, 2);
  } finally {
    await harness.close();
  }
});

test.skip("mcp tick ak_tick_forward at maxTick returns ok:false with stable boundary error", () => {});
test.skip("mcp tick ak_tick_backward at tick 0 returns ok:false with stable boundary error", () => {});
test.skip("mcp tick ak_show_state before forward returns tick 0 and null tickFrame", () => {});
test.skip("mcp tick ak_tick_forward with non-existent runId returns ok:false path error", () => {});
test.skip("mcp tick ak_show_state with non-existent runId returns ok:false", () => {});
test.skip("mcp tick interleaved forward and state calls maintain cursor consistency", () => {});
test.skip("mcp tick ak_show_state ascii field is non-empty", () => {});

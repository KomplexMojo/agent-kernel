import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../..");
const SERVER = resolve(ROOT, "packages/adapters-cli/src/mcp/server.mjs");

const FIXTURES = {
  buildSpec: resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-basic.json"),
  budget: resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json"),
  priceList: resolve(ROOT, "tests/fixtures/artifacts/price-list-artifact-v1-basic.json"),
  budgetReceipt: resolve(ROOT, "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json"),
  levelGen: resolve(ROOT, "tests/fixtures/configurator/level-gen-input-v1-trap.json"),
  actors: resolve(ROOT, "tests/fixtures/configurator/actors-v1-affinity-base.json"),
  llmFixture: resolve(ROOT, "tests/fixtures/adapters/llm-generate-summary.json"),
  ipfsFixture: resolve(ROOT, "tests/fixtures/adapters/ipfs-price-list.json"),
  ipfsArtifactMap: resolve(ROOT, "tests/fixtures/adapters/ipfs-artifacts-map.json"),
  blockchainChainId: resolve(ROOT, "tests/fixtures/adapters/blockchain-chain-id.json"),
  blockchainBalance: resolve(ROOT, "tests/fixtures/adapters/blockchain-balance.json"),
  blockchainMint: resolve(ROOT, "tests/fixtures/adapters/blockchain-mint.json"),
  blockchainLoad: resolve(ROOT, "tests/fixtures/adapters/blockchain-load.json"),
  cardConfig: resolve(ROOT, "tests/fixtures/adapters/card-config-delver.json"),
  simConfig: resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json"),
  initialState: resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json"),
  catalog: resolve(ROOT, "tests/fixtures/pool/catalog-basic.json"),
};

const FAMILY_BY_TOOL = {
  ak_create: "authoring",
  ak_configure: "authoring",
  ak_room_plan: "authoring",
  ak_delver_plan: "authoring",
  ak_warden_plan: "authoring",
  ak_build: "simulation",
  ak_solve: "simulation",
  ak_run: "simulation",
  ak_configurator: "simulation",
  ak_budget: "simulation",
  ak_replay: "simulation",
  ak_scenario: "simulation",
  ak_schemas: "inspection",
  ak_inspect: "inspection",
  ak_narrate: "inspection",
  ak_show: "inspection",
  ak_diff: "inspection",
  ak_runs_list: "inspection",
  ak_llm: "llm",
  ak_ollama: "llm",
  ak_llm_plan: "llm",
  ak_ipfs: "external",
  ak_ipfs_publish: "external",
  ak_ipfs_load: "external",
  ak_blockchain: "external",
  ak_blockchain_mint: "external",
  ak_blockchain_load: "external",
  ak_test_list_suites: "testing",
  ak_test_discover_patterns: "testing",
  ak_test_plan_from_change: "testing",
  ak_test_run: "testing",
  ak_test_scaffold_case: "testing",
  ak_test_insert_case: "testing",
  ak_test_explain_failure: "testing",
  ak_test_lint_structure: "testing",
  ak_test_exercise_capabilities: "testing",
  ak_tick_forward: "tick",
  ak_tick_backward: "tick",
  ak_show_state: "tick",
  ak_push_to_ui: "ui",
};

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeTempDir(rootDir, name) {
  return mkdtempSync(join(rootDir, `${name}-`));
}

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

class McpHarness {
  constructor({ cwd = ROOT, env = {} } = {}) {
    this.nextId = 1;
    this.stdoutBuffer = "";
    this.stderr = "";
    this.pending = new Map();
    this.closed = false;
    this.process = spawn(process.execPath, [SERVER], {
      cwd,
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
      clientInfo: { name: "agent-kernel-capability-exercise", version: "1.0.0" },
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
      }, 45000);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    const contentText = result.content?.[0]?.text;
    const content = contentText ? JSON.parse(contentText) : null;
    if (content && result.structuredContent) {
      const left = JSON.stringify(content);
      const right = JSON.stringify(result.structuredContent);
      if (left !== right) {
        throw new Error(`Content and structuredContent differ for ${name}`);
      }
    }
    return result.structuredContent ?? content;
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

function makeMeta(runId, id) {
  return {
    id,
    runId,
    createdAt: "2026-04-10T00:00:00.000Z",
    producedBy: "mcp-capability-exercise",
  };
}

function writeDiffRun(rootDir, runId, ticks) {
  const runRoot = join(rootDir, "artifacts", "runs", runId);
  writeJson(join(runRoot, "build", "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: makeMeta(runId, `sim_${runId}`),
    layout: { kind: "grid", data: { rooms: [{ id: `room_${runId}` }] } },
  });
  writeJson(join(runRoot, "build", "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: makeMeta(runId, `initial_${runId}`),
    simConfigRef: { id: `sim_${runId}`, schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors: [
      { id: "actor_alpha", kind: "ambulatory", vitals: { health: { current: 10, max: 10, regen: 0 } } },
    ],
  });
  writeJson(join(runRoot, "run", "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: makeMeta(runId, `summary_${runId}`),
    outcome: "success",
    metrics: { ticks, effects: ticks },
  });
  writeJson(join(runRoot, "run", "tick-frames.json"), Array.from({ length: ticks }, (_, index) => ({
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    meta: makeMeta(runId, `frame_${runId}_${index + 1}`),
    tick: index + 1,
    phase: "execute",
    phaseDetail: index + 1 === ticks ? "summarize" : "apply",
    acceptedActions: [],
    emittedEffects: [{ kind: "telemetry" }],
    fulfilledEffects: [],
    emittedEvents: [],
  })));
}

function assertOk(toolName, result) {
  if (!result || result.ok !== true) {
    throw new Error(`${toolName} returned non-ok result: ${JSON.stringify(result, null, 2)}`);
  }
}

function createRecorder({ expectedTools, includeSelf }) {
  const families = {};
  const failures = [];
  const artifacts = [];
  const coveredTools = new Set();
  for (const toolName of expectedTools) {
    const family = FAMILY_BY_TOOL[toolName] ?? "unknown";
    families[family] ??= { tools: [], covered: 0, failed: 0 };
    families[family].tools.push(toolName);
  }

  function mark(toolName, result, extraArtifacts = []) {
    const family = FAMILY_BY_TOOL[toolName] ?? "unknown";
    families[family] ??= { tools: [], covered: 0, failed: 0 };
    if (!families[family].tools.includes(toolName)) families[family].tools.push(toolName);
    if (!coveredTools.has(toolName)) {
      coveredTools.add(toolName);
      families[family].covered += 1;
    }
    artifacts.push(...extraArtifacts.filter(Boolean));
    if (result?.artifactLocation?.outDir) artifacts.push(result.artifactLocation.outDir);
    if (result?.outDir) artifacts.push(result.outDir);
  }

  function fail(toolName, error) {
    const family = FAMILY_BY_TOOL[toolName] ?? "unknown";
    families[family] ??= { tools: [], covered: 0, failed: 0 };
    if (!families[family].tools.includes(toolName)) families[family].tools.push(toolName);
    families[family].failed += 1;
    failures.push({ tool: toolName, message: error?.message ?? String(error) });
  }

  if (includeSelf && expectedTools.includes("ak_test_exercise_capabilities")) {
    mark("ak_test_exercise_capabilities", { ok: true });
  }

  return { families, failures, artifacts, coveredTools, mark, fail };
}

export async function runMcpCapabilityExercise({ scope = "all", outDir, includeSelf = false } = {}) {
  const rootDir = resolve(outDir || mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-capability-")));
  mkdirSync(rootDir, { recursive: true });
  const bridgePort = await reserveFreePort();
  const diffWorkspace = join(rootDir, "diff-workspace");
  writeDiffRun(diffWorkspace, "run_capability_diff_a", 1);
  writeDiffRun(diffWorkspace, "run_capability_diff_b", 2);

  const harness = new McpHarness({
    env: {
      AK_SANDBOX_BRIDGE_PORT: String(bridgePort),
      AK_CAPABILITY_EXERCISE_OUT_DIR: rootDir,
    },
  });
  const diffHarness = new McpHarness({
    cwd: diffWorkspace,
    env: {
      AK_SANDBOX_BRIDGE_PORT: String(await reserveFreePort()),
      AK_CAPABILITY_EXERCISE_OUT_DIR: rootDir,
    },
  });

  const exercisedTools = Object.keys(FAMILY_BY_TOOL)
    .filter((toolName) => includeSelf || toolName !== "ak_test_exercise_capabilities")
    .filter((toolName) => scope === "all" || FAMILY_BY_TOOL[toolName] !== "testing" || toolName === "ak_test_exercise_capabilities");
  const recorder = createRecorder({
    expectedTools: exercisedTools,
    includeSelf,
  });
  const buildSpecObject = readJson(FIXTURES.buildSpec);

  async function exercise(toolName, args, { harness: selectedHarness = harness, expectOk = true, artifacts = [] } = {}) {
    try {
      const result = await selectedHarness.callTool(toolName, args);
      if (expectOk) assertOk(toolName, result);
      recorder.mark(toolName, result, artifacts);
      return result;
    } catch (error) {
      recorder.fail(toolName, error);
      return null;
    }
  }

  try {
    await harness.initialize();
    await diffHarness.initialize();
    const listed = await harness.request("tools/list", {});
    const liveTools = listed.tools.map((tool) => tool.name).sort();
    const expectedTools = [...exercisedTools].sort();
    for (const toolName of expectedTools) {
      if (!liveTools.includes(toolName)) {
        recorder.fail(toolName, new Error(`Tool missing from tools/list: ${toolName}`));
      }
    }

    const createRunId = "run_capability_create";
    await exercise("ak_create", {
      text: "Capability exercise dungeon",
      room: ["size=medium;count=1"],
      trap: ["x=1;y=1;affinity=fire;expression=emit;stacks=1"],
      delver: ["count=1;affinity=water;motivation=exploring"],
      warden: ["count=1;affinity=dark;motivation=defending"],
      runId: createRunId,
      createdAt: "2026-06-25T00:00:00.000Z",
    });
    await exercise("ak_configure", {
      text: "Capability configure dungeon",
      room: ["size=small;count=1"],
      delver: ["count=1;affinity=fire;motivation=exploring"],
      warden: ["count=1;affinity=dark;motivation=defending"],
      outDir: makeTempDir(rootDir, "configure"),
      runId: "run_capability_configure",
    });
    await exercise("ak_room_plan", {
      room: ["size=small;count=1"],
      outDir: makeTempDir(rootDir, "room-plan"),
      runId: "run_capability_room_plan",
    });
    await exercise("ak_delver_plan", {
      delver: ["count=1;affinity=fire;motivation=exploring"],
      outDir: makeTempDir(rootDir, "delver-plan"),
      runId: "run_capability_delver_plan",
    });
    await exercise("ak_warden_plan", {
      warden: ["count=1;affinity=dark;motivation=defending"],
      outDir: makeTempDir(rootDir, "warden-plan"),
      runId: "run_capability_warden_plan",
    });

    await exercise("ak_build", { spec: FIXTURES.buildSpec, outDir: makeTempDir(rootDir, "build") });
    await exercise("ak_solve", {
      scenario: "A small fixture scenario.",
      outDir: makeTempDir(rootDir, "solve"),
      runId: "run_capability_solve",
    });
    const runOutDir = makeTempDir(rootDir, "run");
    await exercise("ak_run", {
      simConfig: FIXTURES.simConfig,
      initialState: FIXTURES.initialState,
      ticks: 2,
      outDir: runOutDir,
      runId: "run_capability_run",
    });
    const tickFramesPath = join(runOutDir, "tick-frames.json");
    await exercise("ak_configurator", {
      levelGen: FIXTURES.levelGen,
      actors: FIXTURES.actors,
      outDir: makeTempDir(rootDir, "configurator"),
      runId: "run_capability_configurator",
    });
    await exercise("ak_budget", {
      budget: FIXTURES.budget,
      priceList: FIXTURES.priceList,
      receipt: FIXTURES.budgetReceipt,
      outDir: makeTempDir(rootDir, "budget"),
    });
    await exercise("ak_replay", {
      simConfig: FIXTURES.simConfig,
      initialState: FIXTURES.initialState,
      tickFrames: tickFramesPath,
      outDir: makeTempDir(rootDir, "replay"),
    });
    await exercise("ak_scenario", {
      text: "Build a compact fire dungeon with one delver and one defending warden.",
      catalog: FIXTURES.catalog,
      budgetTokens: 700,
      model: "fixture",
      fixture: FIXTURES.llmFixture,
      ticks: 1,
      outDir: makeTempDir(rootDir, "scenario"),
      runId: "run_capability_scenario",
      createdAt: "2026-06-25T00:00:00.000Z",
    });

    await exercise("ak_schemas", { outDir: makeTempDir(rootDir, "schemas") });
    await exercise("ak_inspect", { tickFrames: tickFramesPath, outDir: makeTempDir(rootDir, "inspect") });
    await exercise("ak_narrate", {
      tickFrames: tickFramesPath,
      initialState: FIXTURES.initialState,
      outDir: makeTempDir(rootDir, "narrate"),
    });
    await exercise("ak_show", { runId: createRunId });
    await exercise("ak_runs_list", {});
    await exercise("ak_diff", {
      runA: "run_capability_diff_a",
      runB: "run_capability_diff_b",
    }, { harness: diffHarness });

    await exercise("ak_llm", {
      prompt: "hello",
      model: "fixture",
      fixture: FIXTURES.llmFixture,
      outDir: makeTempDir(rootDir, "llm"),
    });
    await exercise("ak_ollama", {
      prompt: "hello",
      model: "fixture",
      fixture: FIXTURES.llmFixture,
      outDir: makeTempDir(rootDir, "ollama"),
    });
    await exercise("ak_llm_plan", {
      text: "Build a compact fire dungeon.",
      catalog: FIXTURES.catalog,
      model: "fixture",
      fixture: FIXTURES.llmFixture,
      budgetTokens: 700,
      outDir: makeTempDir(rootDir, "llm-plan"),
      runId: "run_capability_llm_plan",
    });

    await exercise("ak_ipfs", {
      cid: "bafyfixture",
      json: true,
      fixture: FIXTURES.ipfsFixture,
      outDir: makeTempDir(rootDir, "ipfs"),
    });
    await exercise("ak_ipfs_publish", {
      artifactMap: FIXTURES.ipfsArtifactMap,
      fixtureCid: "bafypublishfixture",
      outDir: makeTempDir(rootDir, "ipfs-publish"),
    });
    await exercise("ak_ipfs_load", {
      cid: "bafyfixture",
      fixtureMap: FIXTURES.ipfsArtifactMap,
      outDir: makeTempDir(rootDir, "ipfs-load"),
    });
    await exercise("ak_blockchain", {
      rpcUrl: "http://local",
      address: "0xabc",
      fixtureChainId: FIXTURES.blockchainChainId,
      fixtureBalance: FIXTURES.blockchainBalance,
      outDir: makeTempDir(rootDir, "blockchain"),
    });
    await exercise("ak_blockchain_mint", {
      rpcUrl: "http://local",
      card: FIXTURES.cardConfig,
      owner: "0xabc",
      fixtureChainId: FIXTURES.blockchainChainId,
      fixtureMint: FIXTURES.blockchainMint,
      outDir: makeTempDir(rootDir, "blockchain-mint"),
    });
    await exercise("ak_blockchain_load", {
      rpcUrl: "http://local",
      tokenId: "token_fixture_1",
      fixtureChainId: FIXTURES.blockchainChainId,
      fixtureLoad: FIXTURES.blockchainLoad,
      outDir: makeTempDir(rootDir, "blockchain-load"),
    });

    if (scope === "all") {
      await exercise("ak_test_list_suites", {});
      await exercise("ak_test_discover_patterns", {});
      await exercise("ak_test_plan_from_change", {
        paths: ["packages/adapters-cli/src/mcp/server.mjs", "packages/ui-web/src/views/design-view.js"],
      });
      await exercise("ak_test_run", { mode: "inventory" });
      await exercise("ak_test_scaffold_case", {
        recipe: "cli_success_artifacts",
        targetFile: join(rootDir, "scaffolded-case.js"),
        title: "capability scaffold case",
        commandArgs: ["build", "--spec", "tests/fixtures/artifacts/build-spec-v1-basic.json"],
        expectedArtifacts: ["bundle.json"],
      });
      await exercise("ak_test_insert_case", {
        recipe: "cli_failure_message",
        targetFile: join(rootDir, "inserted-case.js"),
        title: "capability inserted case",
        commandArgs: ["build"],
        expectedErrorPattern: "requires",
      });
      await exercise("ak_test_explain_failure", { text: "AssertionError: expected true to equal false" });
      await exercise("ak_test_lint_structure", {});
    }

    const tickWorkspace = join(rootDir, "tick-workspace");
    const tickRunId = "run_capability_tick";
    const tickCreate = await exercise("ak_create", {
      room: ["size=small;count=1"],
      delver: ["count=1;affinity=fire;motivation=exploring"],
      warden: ["count=1;affinity=dark;motivation=defending"],
      outDir: join(tickWorkspace, "artifacts", "runs", tickRunId, "create"),
      runId: tickRunId,
    });
    const tickRun = await exercise("ak_run", {
      simConfig: join(tickWorkspace, "artifacts", "runs", tickRunId, "create", "sim-config.json"),
      initialState: join(tickWorkspace, "artifacts", "runs", tickRunId, "create", "initial-state.json"),
      ticks: 2,
      outDir: join(tickWorkspace, "artifacts", "runs", tickRunId, "run"),
      runId: tickRunId,
    });
    if (tickCreate?.ok && tickRun?.ok) {
      const tickHarness = new McpHarness({
        cwd: tickWorkspace,
        env: { AK_SANDBOX_BRIDGE_PORT: String(await reserveFreePort()) },
      });
      try {
        await tickHarness.initialize();
        await exercise("ak_tick_forward", { runId: tickRunId }, { harness: tickHarness });
        await exercise("ak_show_state", { runId: tickRunId }, { harness: tickHarness });
        await exercise("ak_tick_backward", { runId: tickRunId }, { harness: tickHarness });
      } finally {
        await tickHarness.close();
      }
    }

    await exercise("ak_push_to_ui", {
      buildSpec: buildSpecObject,
      targetTab: "gameplay",
      requireClient: false,
      openBrowser: false,
      correlationId: "capability-exercise",
    });
  } finally {
    await Promise.allSettled([harness.close(), diffHarness.close()]);
  }

  const uniqueArtifacts = Array.from(new Set(recorder.artifacts)).sort();
  return {
    ok: recorder.failures.length === 0,
    command: "test-exercise-capabilities",
    scope,
    outDir: rootDir,
    toolCount: Object.keys(FAMILY_BY_TOOL).length,
    coveredToolCount: recorder.coveredTools.size,
    families: recorder.families,
    artifacts: uniqueArtifacts,
    failures: recorder.failures,
  };
}

function parseCliArgs(argv) {
  const parsed = { scope: "all", outDir: undefined, includeSelf: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scope") parsed.scope = argv[++index] || "all";
    else if (arg === "--out-dir") parsed.outDir = argv[++index];
    else if (arg === "--include-self") parsed.includeSelf = true;
  }
  return parsed;
}

if (process.argv[1] === __filename) {
  runMcpCapabilityExercise(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((error) => {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    });
}

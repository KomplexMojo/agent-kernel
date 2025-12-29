import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createIpfsAdapter } from "../adapters/ipfs/index.js";
import { createBlockchainAdapter } from "../adapters/blockchain/index.js";
import { createOllamaAdapter } from "../adapters/ollama/index.js";

const SCHEMAS = Object.freeze({
  intent: "agent-kernel/IntentEnvelope",
  plan: "agent-kernel/PlanArtifact",
  simConfig: "agent-kernel/SimConfigArtifact",
  initialState: "agent-kernel/InitialStateArtifact",
  executionPolicy: "agent-kernel/ExecutionPolicy",
  solverRequest: "agent-kernel/SolverRequest",
  solverResult: "agent-kernel/SolverResult",
  tickFrame: "agent-kernel/TickFrame",
  effect: "agent-kernel/Effect",
  telemetry: "agent-kernel/TelemetryRecord",
  runSummary: "agent-kernel/RunSummary",
});

const EFFECT_KIND = Object.freeze({
  Log: 1,
  InitInvalid: 2,
  ActionRejected: 3,
  LimitReached: 4,
  LimitViolated: 5,
});

const DEFAULT_WASM_PATH = "build/core-as.wasm";
const DEFAULT_TICKS = 1;

function usage() {
  const filename = fileURLToPath(import.meta.url);
  const base = resolve(dirname(filename), "../../../..");
  const rel = base && filename.startsWith(base)
    ? filename.slice(base.length + 1)
    : filename;
  return `Usage:
  node ${rel} solve --scenario "..." [--out-dir dir] [--run-id id] [--plan path] [--intent path] [--options path]
  node ${rel} run --sim-config path --initial-state path [--execution-policy path] [--ticks N] [--seed N] [--wasm path] [--out-dir dir] [--run-id id]
  node ${rel} replay --sim-config path --initial-state path --tick-frames path [--execution-policy path] [--ticks N] [--seed N] [--wasm path] [--out-dir dir]
  node ${rel} inspect --tick-frames path [--effects-log path] [--out-dir dir]
  node ${rel} ipfs --cid cid [--path path] [--gateway url] [--json] [--fixture path] [--out path] [--out-dir dir]
  node ${rel} blockchain --rpc-url url [--address addr] [--fixture-chain-id path] [--fixture-balance path] [--out path] [--out-dir dir]
  node ${rel} ollama --model model --prompt text [--base-url url] [--fixture path] [--out path] [--out-dir dir]

Options:
  --out-dir       Output directory (default: ./artifacts/<command>_<timestamp>)
  --out           Output file path (command-specific default when omitted)
  --wasm          Path to core-as WASM (default: ${DEFAULT_WASM_PATH})
  --ticks         Number of ticks for run/replay (default: ${DEFAULT_TICKS})
  --seed          Seed for init (default: 0)
  --help          Show this help
`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        args[key] = arg.slice(eqIndex + 1);
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
      continue;
    }
    args._.push(arg);
  }
  return args;
}

function resolvePath(input, cwd = process.cwd()) {
  if (!input) {
    return null;
  }
  return isAbsolute(input) ? input : resolve(cwd, input);
}

function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function createMeta({ producedBy, runId, correlationId, note } = {}) {
  return {
    id: makeId("artifact"),
    runId: runId || makeId("run"),
    createdAt: new Date().toISOString(),
    producedBy: producedBy || "cli",
    correlationId,
    note,
  };
}

function toRef(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return null;
  }
  if (!artifact.schema || !artifact.schemaVersion) {
    return null;
  }
  const id = artifact.meta?.id || makeId("artifact");
  return {
    id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
  };
}

async function readJson(filePath) {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function readText(filePath) {
  return readFile(filePath, "utf8");
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, content, "utf8");
}

async function writeText(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function assertSchema(artifact, expectedSchema) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(`Expected ${expectedSchema} artifact.`);
  }
  if (artifact.schema !== expectedSchema) {
    throw new Error(`Expected schema ${expectedSchema}, got ${artifact.schema || "missing"}.`);
  }
  if (artifact.schemaVersion !== 1) {
    throw new Error(`Expected schemaVersion 1 for ${expectedSchema}.`);
  }
}

function defaultOutDir(command) {
  return resolve(process.cwd(), "artifacts", `${command}_${Date.now().toString(36)}`);
}

async function loadCoreFromWasm(wasmPath) {
  const buffer = await readFile(wasmPath);
  const { instance } = await WebAssembly.instantiate(buffer, {
    env: {
      abort(_msg, _file, line, column) {
        throw new Error(`WASM abort at ${line}:${column}`);
      },
    },
  });
  const exports = instance.exports;
  return {
    init: exports.init,
    step: exports.step,
    applyAction: exports.applyAction,
    getCounter: exports.getCounter,
    setBudget: exports.setBudget,
    getBudget: exports.getBudget,
    getBudgetUsage: exports.getBudgetUsage,
    getEffectCount: exports.getEffectCount,
    getEffectKind: exports.getEffectKind,
    getEffectValue: exports.getEffectValue,
    clearEffects: exports.clearEffects,
    version: exports.version,
  };
}

function resolveBudgetCategoryId(name) {
  if (typeof name === "number" && Number.isFinite(name)) {
    return name;
  }
  if (typeof name !== "string") {
    return null;
  }
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  const categoryIds = {
    movement: 0,
    cognition: 1,
    structure: 2,
    effects: 3,
    solver: 4,
    custom: 5,
  };
  return categoryIds[normalized] ?? null;
}

function applyBudgetCaps(core, simConfig) {
  const caps = simConfig?.constraints?.categoryCaps?.caps;
  if (!caps || !core?.setBudget) {
    return [];
  }
  const applied = [];
  for (const [category, cap] of Object.entries(caps)) {
    const categoryId = resolveBudgetCategoryId(category);
    if (categoryId === null) {
      continue;
    }
    const numericCap = Number(cap);
    if (!Number.isFinite(numericCap)) {
      continue;
    }
    core.setBudget(categoryId, numericCap);
    applied.push({ category, categoryId, cap: numericCap });
  }
  return applied;
}

function dispatchEffect(adapters, kind, value) {
  const logger = adapters?.logger;
  switch (kind) {
    case EFFECT_KIND.Log:
      if (!logger?.log) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: logger.log(value) };
    case EFFECT_KIND.InitInvalid:
      if (!logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: logger.warn("Init invalid", value) };
    case EFFECT_KIND.ActionRejected:
      if (!logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: logger.warn("Action rejected", value) };
    case EFFECT_KIND.LimitReached:
      if (!logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: logger.warn("Budget limit reached", value) };
    case EFFECT_KIND.LimitViolated:
      if (!logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: logger.warn("Budget limit violated", value) };
    default:
      if (!logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: logger.warn(`Unhandled effect kind: ${kind}`, value) };
  }
}

function buildEffect({ tick, kind, value }) {
  return {
    schema: SCHEMAS.effect,
    schemaVersion: 1,
    tick,
    fulfillment: "deterministic",
    kind: "custom",
    data: { kind, value },
  };
}

function createRunner({ core, runId, adapters = {} }) {
  if (!core) {
    throw new Error("Runner requires a core instance.");
  }
  let tick = 0;
  let frameCounter = 0;
  const effectLog = [];
  const tickFrames = [];
  const phases = ["observe", "collect", "apply", "emit"];

  function nextFrameMeta() {
    frameCounter += 1;
    return {
      id: `frame_${frameCounter}`,
      runId,
      createdAt: new Date().toISOString(),
      producedBy: "moderator",
    };
  }

  function flushEffects() {
    const count = core.getEffectCount();
    const emittedEffects = [];
    const fulfilledEffects = [];
    for (let i = 0; i < count; i += 1) {
      const kind = core.getEffectKind(i);
      const value = core.getEffectValue(i);
      const effect = buildEffect({ tick, kind, value });
      const outcome = dispatchEffect(adapters, kind, value);
      emittedEffects.push(effect);
      fulfilledEffects.push({
        effect,
        status: outcome?.status || "fulfilled",
        result: outcome?.result,
        reason: outcome?.reason,
      });
      effectLog.push({
        tick,
        kind,
        value,
        status: outcome?.status || "fulfilled",
        result: outcome?.result,
        reason: outcome?.reason,
      });
    }
    core.clearEffects();
    return { emittedEffects, fulfilledEffects };
  }

  function recordFrame({ emittedEffects, fulfilledEffects, phaseDetail }) {
    tickFrames.push({
      schema: SCHEMAS.tickFrame,
      schemaVersion: 1,
      meta: nextFrameMeta(),
      tick,
      phase: "execute",
      phaseDetail,
      acceptedActions: [],
      emittedEffects,
      fulfilledEffects,
    });
  }

  return {
    init(seed, simConfig) {
      tick = 0;
      effectLog.length = 0;
      tickFrames.length = 0;
      core.init(seed);
      applyBudgetCaps(core, simConfig);
      const frameEffects = flushEffects();
      recordFrame({ ...frameEffects, phaseDetail: "init" });
    },
    step() {
      tick += 1;
      recordFrame({ emittedEffects: [], fulfilledEffects: [], phaseDetail: phases[0] });
      recordFrame({ emittedEffects: [], fulfilledEffects: [], phaseDetail: phases[1] });
      if (core.applyAction) {
        core.applyAction(1, 1);
      } else {
        core.step();
      }
      recordFrame({ emittedEffects: [], fulfilledEffects: [], phaseDetail: phases[2] });
      const frameEffects = flushEffects();
      recordFrame({ ...frameEffects, phaseDetail: phases[3] });
    },
    getTickFrames() {
      return tickFrames.slice();
    },
    getEffectLog() {
      return effectLog.slice();
    },
  };
}

async function solveCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const scenario = args.scenario || null;
  const scenarioFile = resolvePath(args["scenario-file"]);
  const planPath = resolvePath(args.plan);
  const intentPath = resolvePath(args.intent);
  const optionsPath = resolvePath(args.options);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("solve");
  const runId = args["run-id"] || makeId("run");

  let scenarioData = scenario;
  if (!scenarioData && scenarioFile) {
    scenarioData = await readText(scenarioFile);
  }
  if (!scenarioData && !planPath && !intentPath) {
    throw new Error("solve requires --scenario, --scenario-file, --plan, or --intent.");
  }

  let planArtifact = null;
  let intentArtifact = null;
  if (planPath) {
    planArtifact = await readJson(planPath);
    assertSchema(planArtifact, SCHEMAS.plan);
  }
  if (intentPath) {
    intentArtifact = await readJson(intentPath);
    assertSchema(intentArtifact, SCHEMAS.intent);
  }

  let options = null;
  if (optionsPath) {
    options = await readJson(optionsPath);
  }

  const requestMeta = createMeta({ producedBy: "cli-solve", runId });
  const solverRequest = {
    schema: SCHEMAS.solverRequest,
    schemaVersion: 1,
    meta: requestMeta,
    intentRef: toRef(intentArtifact),
    planRef: toRef(planArtifact),
    problem: {
      language: "custom",
      data: scenarioData || { planRef: toRef(planArtifact) },
    },
    options: options || undefined,
  };

  const solverResult = {
    schema: SCHEMAS.solverResult,
    schemaVersion: 1,
    meta: createMeta({ producedBy: "cli-solve", runId }),
    requestRef: toRef(solverRequest),
    status: "unknown",
  };

  await writeJson(join(outDir, "solver-request.json"), solverRequest);
  await writeJson(join(outDir, "solver-result.json"), solverResult);

  console.log(`solve: wrote ${outDir}`);
}

async function runCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const simConfigPath = resolvePath(args["sim-config"]);
  const initialStatePath = resolvePath(args["initial-state"]);
  const executionPolicyPath = resolvePath(args["execution-policy"]);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("run");
  const wasmPath = resolvePath(args.wasm || DEFAULT_WASM_PATH);
  const ticks = args.ticks ? Number(args.ticks) : DEFAULT_TICKS;
  const seed = args.seed ? Number(args.seed) : 0;
  const runId = args["run-id"] || makeId("run");

  if (!simConfigPath || !initialStatePath) {
    throw new Error("run requires --sim-config and --initial-state.");
  }
  if (!Number.isFinite(ticks) || ticks < 0) {
    throw new Error("run requires a valid --ticks value.");
  }
  if (!Number.isFinite(seed)) {
    throw new Error("run requires a valid --seed value.");
  }
  if (!wasmPath || !existsSync(wasmPath)) {
    throw new Error(`WASM not found at ${wasmPath}`);
  }

  const simConfig = await readJson(simConfigPath);
  assertSchema(simConfig, SCHEMAS.simConfig);
  const initialState = await readJson(initialStatePath);
  assertSchema(initialState, SCHEMAS.initialState);
  let executionPolicy = null;
  if (executionPolicyPath) {
    executionPolicy = await readJson(executionPolicyPath);
    assertSchema(executionPolicy, SCHEMAS.executionPolicy);
  }

  const core = await loadCoreFromWasm(wasmPath);
  const runner = createRunner({ core, runId });
  runner.init(seed, simConfig);
  for (let i = 0; i < ticks; i += 1) {
    runner.step();
  }
  const tickFrames = runner.getTickFrames();
  const effectLog = runner.getEffectLog();

  const runSummary = {
    schema: SCHEMAS.runSummary,
    schemaVersion: 1,
    meta: createMeta({ producedBy: "cli-run", runId }),
    simConfigRef: toRef(simConfig),
    outcome: "unknown",
    metrics: {
      ticks,
      frames: tickFrames.length,
      effects: effectLog.length,
    },
  };

  await writeJson(join(outDir, "tick-frames.json"), tickFrames);
  await writeJson(join(outDir, "effects-log.json"), effectLog);
  await writeJson(join(outDir, "run-summary.json"), runSummary);

  console.log(`run: wrote ${outDir}`);
}

function summarizeFrame(frame) {
  const emittedEffects = Array.isArray(frame.emittedEffects) ? frame.emittedEffects.length : 0;
  const fulfilledEffects = Array.isArray(frame.fulfilledEffects) ? frame.fulfilledEffects.length : 0;
  return {
    tick: frame.tick,
    phase: frame.phase,
    phaseDetail: frame.phaseDetail || null,
    emittedEffects,
    fulfilledEffects,
  };
}

async function replayCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const simConfigPath = resolvePath(args["sim-config"]);
  const initialStatePath = resolvePath(args["initial-state"]);
  const executionPolicyPath = resolvePath(args["execution-policy"]);
  const tickFramesPath = resolvePath(args["tick-frames"]);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("replay");
  const wasmPath = resolvePath(args.wasm || DEFAULT_WASM_PATH);
  const seed = args.seed ? Number(args.seed) : 0;

  if (!simConfigPath || !initialStatePath || !tickFramesPath) {
    throw new Error("replay requires --sim-config, --initial-state, and --tick-frames.");
  }
  if (!Number.isFinite(seed)) {
    throw new Error("replay requires a valid --seed value.");
  }
  if (!wasmPath || !existsSync(wasmPath)) {
    throw new Error(`WASM not found at ${wasmPath}`);
  }

  const simConfig = await readJson(simConfigPath);
  assertSchema(simConfig, SCHEMAS.simConfig);
  const initialState = await readJson(initialStatePath);
  assertSchema(initialState, SCHEMAS.initialState);
  if (executionPolicyPath) {
    const executionPolicy = await readJson(executionPolicyPath);
    assertSchema(executionPolicy, SCHEMAS.executionPolicy);
  }

  const expectedFrames = await readJson(tickFramesPath);
  const expectedSummaries = expectedFrames.map(summarizeFrame);
  const ticks = args.ticks
    ? Number(args.ticks)
    : Math.max(0, ...expectedSummaries.map((frame) => frame.tick));
  if (!Number.isFinite(ticks) || ticks < 0) {
    throw new Error("replay requires a valid --ticks value.");
  }

  const core = await loadCoreFromWasm(wasmPath);
  const runId = makeId("replay");
  const runner = createRunner({ core, runId });
  runner.init(seed, simConfig);
  for (let i = 0; i < ticks; i += 1) {
    runner.step();
  }
  const actualFrames = runner.getTickFrames();
  const actualSummaries = actualFrames.map(summarizeFrame);

  let mismatchCount = 0;
  let firstMismatch = null;
  const maxFrames = Math.max(expectedSummaries.length, actualSummaries.length);
  for (let i = 0; i < maxFrames; i += 1) {
    const expected = expectedSummaries[i];
    const actual = actualSummaries[i];
    if (!expected || !actual) {
      mismatchCount += 1;
      if (!firstMismatch) {
        firstMismatch = {
          index: i,
          reason: !expected ? "missing_expected_frame" : "missing_actual_frame",
          expected: expected || null,
          actual: actual || null,
        };
      }
      continue;
    }
    const matches = expected.tick === actual.tick
      && expected.phase === actual.phase
      && expected.phaseDetail === actual.phaseDetail
      && expected.emittedEffects === actual.emittedEffects
      && expected.fulfilledEffects === actual.fulfilledEffects;
    if (!matches) {
      mismatchCount += 1;
      if (!firstMismatch) {
        firstMismatch = { index: i, reason: "frame_mismatch", expected, actual };
      }
    }
  }

  const summary = {
    match: mismatchCount === 0,
    expectedFrames: expectedSummaries.length,
    actualFrames: actualSummaries.length,
    mismatches: mismatchCount,
    firstMismatch,
  };

  await writeJson(join(outDir, "replay-summary.json"), summary);
  await writeJson(join(outDir, "replay-tick-frames.json"), actualFrames);

  console.log(`replay: wrote ${outDir}`);
}

async function inspectCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const tickFramesPath = resolvePath(args["tick-frames"]);
  const effectsLogPath = resolvePath(args["effects-log"]);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("inspect");

  let frames = [];
  const warnings = [];
  if (!tickFramesPath || !existsSync(tickFramesPath)) {
    warnings.push("missing_tick_frames");
    console.warn("inspect: missing --tick-frames (summary will be empty)");
  } else {
    frames = await readJson(tickFramesPath);
  }
  const phaseCounts = {};
  let totalEmitted = 0;
  let fulfilled = 0;
  let deferred = 0;
  let maxTick = 0;

  for (const frame of frames) {
    maxTick = Math.max(maxTick, frame.tick || 0);
    const phaseKey = frame.phaseDetail || frame.phase || "unknown";
    phaseCounts[phaseKey] = (phaseCounts[phaseKey] || 0) + 1;
    if (Array.isArray(frame.emittedEffects)) {
      totalEmitted += frame.emittedEffects.length;
    }
    if (Array.isArray(frame.fulfilledEffects)) {
      for (const record of frame.fulfilledEffects) {
        if (record.status === "fulfilled") {
          fulfilled += 1;
        } else if (record.status === "deferred") {
          deferred += 1;
        }
      }
    }
  }

  const effectsLog = effectsLogPath ? await readJson(effectsLogPath) : null;
  const runId = frames[0]?.meta?.runId || makeId("run");
  const summary = {
    schema: SCHEMAS.telemetry,
    schemaVersion: 1,
    meta: createMeta({ producedBy: "cli-inspect", runId }),
    scope: "run",
    data: {
      frames: frames.length,
      ticks: maxTick,
      phaseCounts,
      effects: {
        emitted: totalEmitted,
        fulfilled,
        deferred,
        logEntries: Array.isArray(effectsLog) ? effectsLog.length : 0,
      },
      warnings,
    },
  };

  await writeJson(join(outDir, "inspect-summary.json"), summary);
  console.log(`inspect: wrote ${outDir}`);
}

async function ipfsCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const cid = args.cid;
  const path = args.path || "";
  const gatewayUrl = args.gateway || "https://ipfs.io/ipfs";
  const fixturePath = resolvePath(args.fixture);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("ipfs");
  const outPath = resolvePath(args.out) || join(outDir, args.json ? "ipfs.json" : "ipfs.txt");

  if (!cid) {
    throw new Error("ipfs requires --cid.");
  }

  let fetchFn;
  if (fixturePath) {
    const fixtureText = await readText(fixturePath);
    fetchFn = async () => ({ ok: true, text: async () => fixtureText });
  }

  const adapter = createIpfsAdapter({ gatewayUrl, fetchFn });
  if (args.json) {
    const payload = await adapter.fetchJson(cid, path);
    await writeJson(outPath, payload);
  } else {
    const text = await adapter.fetchText(cid, path);
    await writeText(outPath, text);
  }

  console.log(`ipfs: wrote ${outPath}`);
}

async function blockchainCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const rpcUrl = args["rpc-url"];
  const address = args.address;
  const chainFixturePath = resolvePath(args["fixture-chain-id"]);
  const balanceFixturePath = resolvePath(args["fixture-balance"]);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("blockchain");
  const outPath = resolvePath(args.out) || join(outDir, "blockchain.json");

  if (!rpcUrl) {
    throw new Error("blockchain requires --rpc-url.");
  }

  let fetchFn;
  if (chainFixturePath || balanceFixturePath) {
    const chainFixture = chainFixturePath ? JSON.parse(await readText(chainFixturePath)) : null;
    const balanceFixture = balanceFixturePath ? JSON.parse(await readText(balanceFixturePath)) : null;
    fetchFn = async (_url, options) => {
      const body = JSON.parse(options?.body || "{}");
      if (body.method === "eth_chainId" && chainFixture) {
        return { ok: true, json: async () => chainFixture };
      }
      if (body.method === "eth_getBalance" && balanceFixture) {
        return { ok: true, json: async () => balanceFixture };
      }
      return { ok: false, status: 500, statusText: "Missing fixture" };
    };
  }

  const adapter = createBlockchainAdapter({ rpcUrl, fetchFn });
  const result = { rpcUrl };
  result.chainId = await adapter.getChainId();
  if (address) {
    result.address = address;
    result.balance = await adapter.getBalance(address);
  }
  await writeJson(outPath, result);
  console.log(`blockchain: wrote ${outPath}`);
}

async function ollamaCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const model = args.model;
  const prompt = args.prompt;
  const baseUrl = args["base-url"] || "http://localhost:11434";
  const fixturePath = resolvePath(args.fixture);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("ollama");
  const outPath = resolvePath(args.out) || join(outDir, "ollama.json");

  if (!model || !prompt) {
    throw new Error("ollama requires --model and --prompt.");
  }

  let fetchFn;
  if (fixturePath) {
    const fixtureJson = JSON.parse(await readText(fixturePath));
    fetchFn = async () => ({ ok: true, json: async () => fixtureJson });
  }

  const adapter = createOllamaAdapter({ baseUrl, fetchFn });
  const response = await adapter.generate({ model, prompt, stream: false });
  await writeJson(outPath, response);
  console.log(`ollama: wrote ${outPath}`);
}

const COMMANDS = {
  solve: solveCommand,
  run: runCommand,
  replay: replayCommand,
  inspect: inspectCommand,
  ipfs: ipfsCommand,
  blockchain: blockchainCommand,
  ollama: ollamaCommand,
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.log(usage());
    process.exit(1);
  }
  try {
    await handler(rest);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}

await main();

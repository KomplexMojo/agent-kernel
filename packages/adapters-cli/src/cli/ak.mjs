import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createIpfsAdapter } from "../adapters/ipfs/index.js";
import { createBlockchainAdapter } from "../adapters/blockchain/index.js";
import { createLlmAdapter } from "../adapters/llm/index.js";
import { buildEffectFromCore as buildRuntimeEffect, dispatchEffect as dispatchRuntimeEffect } from "../../../runtime/src/ports/effects.js";
import { applyInitialStateToCore, applySimConfigToCore } from "../../../runtime/src/runner/core-setup.mjs";
import { resolveAffinityEffects } from "../../../runtime/src/personas/configurator/affinity-effects.js";
import { generateGridLayoutFromInput } from "../../../runtime/src/personas/configurator/level-layout.js";
import { buildSimConfigArtifact, buildInitialStateArtifact } from "../../../runtime/src/personas/configurator/artifact-builders.js";
import { evaluateConfiguratorSpend } from "../../../runtime/src/personas/configurator/spend-proposal.js";

const SCHEMAS = Object.freeze({
  intent: "agent-kernel/IntentEnvelope",
  plan: "agent-kernel/PlanArtifact",
  budgetReceipt: "agent-kernel/BudgetReceipt",
  budgetArtifact: "agent-kernel/BudgetArtifact",
  budgetReceiptArtifact: "agent-kernel/BudgetReceiptArtifact",
  priceList: "agent-kernel/PriceList",
  simConfig: "agent-kernel/SimConfigArtifact",
  initialState: "agent-kernel/InitialStateArtifact",
  executionPolicy: "agent-kernel/ExecutionPolicy",
  solverRequest: "agent-kernel/SolverRequest",
  solverResult: "agent-kernel/SolverResult",
  tickFrame: "agent-kernel/TickFrame",
  effect: "agent-kernel/Effect",
  telemetry: "agent-kernel/TelemetryRecord",
  runSummary: "agent-kernel/RunSummary",
  affinityPreset: "agent-kernel/AffinityPresetArtifact",
  actorLoadout: "agent-kernel/ActorLoadoutArtifact",
  affinitySummary: "agent-kernel/AffinitySummary",
});

const DEFAULT_WASM_PATH = "build/core-as.wasm";
const DEFAULT_TICKS = 1;
const VITAL_KEYS = Object.freeze(["health", "mana", "stamina", "durability"]);

function usage() {
  const filename = fileURLToPath(import.meta.url);
  const base = resolve(dirname(filename), "../../../..");
  const rel = base && filename.startsWith(base)
    ? filename.slice(base.length + 1)
    : filename;
  return `Usage:
  node ${rel} solve --scenario "..." [--out-dir dir] [--run-id id] [--plan path] [--intent path] [--options path]
  node ${rel} run --sim-config path --initial-state path [--execution-policy path] [--ticks N] [--seed N] [--wasm path] [--out-dir dir] [--run-id id] [--actor spec] [--vital spec] [--vital-default spec] [--tile-wall xy] [--tile-barrier xy] [--tile-floor xy] [--actions path] [--affinity-presets path] [--affinity-loadouts path] [--affinity-summary path]
  node ${rel} configurator --level-gen path --actors path [--plan path] [--budget-receipt path] [--budget path --price-list path --receipt-out path] [--affinity-presets path] [--affinity-loadouts path] [--out-dir dir] [--run-id id]
  node ${rel} budget --budget path [--price-list path] [--receipt path] [--out-dir dir] [--out path] [--receipt-out path]
  node ${rel} replay --sim-config path --initial-state path --tick-frames path [--execution-policy path] [--ticks N] [--seed N] [--wasm path] [--out-dir dir]
  node ${rel} inspect --tick-frames path [--effects-log path] [--out-dir dir]
  node ${rel} ipfs --cid cid [--path path] [--gateway url] [--json] [--fixture path] [--out path] [--out-dir dir]
  node ${rel} blockchain --rpc-url url [--address addr] [--fixture-chain-id path] [--fixture-balance path] [--out path] [--out-dir dir]
  node ${rel} llm --model model --prompt text [--base-url url] [--fixture path] [--out path] [--out-dir dir]

Options:
  --out-dir       Output directory (default: ./artifacts/<command>_<timestamp>)
  --out           Output file path (command-specific default when omitted)
  --wasm          Path to core-as WASM (default: ${DEFAULT_WASM_PATH})
  --ticks         Number of ticks for run/replay (default: ${DEFAULT_TICKS})
  --seed          Seed for init (default: 0)
  --solver-fixture Fixture path for solve command (no network)
  --actor         Actor spec: id,x,y,kind (kind: motivated/ambulatory/stationary)
  --vital         Vital spec: actorId,vital,current,max,regen
  --vital-default Vital default: vital,current,max,regen
  --tile-wall     Tile wall coordinate: x,y (repeatable)
  --tile-barrier  Tile barrier coordinate: x,y (repeatable)
  --tile-floor    Tile floor override: x,y (repeatable)
  --actions       Action log (ActionSequence) path for deterministic replay
  --affinity-presets  Affinity preset artifact path (AffinityPresetArtifact)
  --affinity-loadouts Actor loadout artifact path (ActorLoadoutArtifact)
  --affinity-summary  Write affinity summary JSON (default: <out-dir>/affinity-summary.json)
  --level-gen     Level generation input path (Configurator levelGen input)
  --actors        Actors input path (object with actors array)
  --budget-receipt Budget receipt artifact path (BudgetReceipt)
  --budget        Budget artifact path (BudgetArtifact)
  --price-list    Price list artifact path (PriceList)
  --receipt       Budget receipt artifact path (BudgetReceiptArtifact)
  --receipt-out   Output path for budget receipt JSON
  --help          Show this help
`;
}

function parseArgs(argv) {
  const args = { _: [] };
  const repeatable = new Set([
    "actor",
    "vital",
    "vital-default",
    "tile-wall",
    "tile-barrier",
    "tile-floor",
  ]);
  function pushArg(key, value) {
    if (!repeatable.has(key)) {
      args[key] = value;
      return;
    }
    if (args[key] === undefined) {
      args[key] = value;
      return;
    }
    if (Array.isArray(args[key])) {
      args[key].push(value);
      return;
    }
    args[key] = [args[key], value];
  }

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
        pushArg(key, arg.slice(eqIndex + 1));
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        pushArg(key, next);
        i += 1;
      } else {
        pushArg(key, true);
      }
      continue;
    }
    args._.push(arg);
  }
  return args;
}

function normalizeList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseCoordinate(value, label) {
  const parts = String(value).split(",");
  if (parts.length < 2) {
    throw new Error(`${label} expects x,y`);
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${label} expects numeric x,y`);
  }
  return { x, y };
}

function parseActorSpec(value) {
  const parts = String(value).split(",");
  if (parts.length < 3) {
    throw new Error("--actor expects id,x,y[,kind]");
  }
  const id = parts[0];
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  if (!id) {
    throw new Error("--actor requires id");
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("--actor expects numeric x,y");
  }
  const rawKind = (parts[3] || "motivated").toLowerCase();
  let kind;
  if (rawKind === "motivated" || rawKind === "ambulatory") {
    kind = "ambulatory";
  } else if (rawKind === "stationary") {
    kind = "stationary";
  } else {
    throw new Error(`--actor kind must be motivated/ambulatory/stationary, got ${rawKind}`);
  }
  return { id, position: { x, y }, kind };
}

function parseVitalSpec(value, withActorId) {
  const parts = String(value).split(",");
  const offset = withActorId ? 1 : 0;
  if (parts.length < 4 + offset) {
    throw new Error(withActorId ? "--vital expects actorId,vital,current,max,regen" : "--vital-default expects vital,current,max,regen");
  }
  const actorId = withActorId ? parts[0] : null;
  const vital = parts[offset].toLowerCase();
  const current = Number(parts[offset + 1]);
  const max = Number(parts[offset + 2]);
  const regen = Number(parts[offset + 3]);
  const valid = ["health", "mana", "stamina", "durability"];
  if (!valid.includes(vital)) {
    throw new Error(`Unknown vital ${vital}`);
  }
  if (!Number.isFinite(current) || !Number.isFinite(max) || !Number.isFinite(regen)) {
    throw new Error("Vital values must be numeric");
  }
  return { actorId, vital, current, max, regen };
}

function getGridBounds(layoutData) {
  if (!layoutData) {
    return null;
  }
  if (Number.isFinite(layoutData.width) && Number.isFinite(layoutData.height)) {
    return { width: Number(layoutData.width), height: Number(layoutData.height) };
  }
  if (Array.isArray(layoutData.tiles)) {
    const height = layoutData.tiles.length;
    const width = layoutData.tiles.reduce((max, row) => Math.max(max, String(row).length), 0);
    return { width, height };
  }
  return null;
}

function applyTileOverrides(simConfig, { walls, barriers, floors }) {
  if (!walls.length && !barriers.length && !floors.length) {
    return { simConfig, mutated: false };
  }
  const layout = simConfig?.layout;
  if (!layout || layout.kind !== "grid") {
    throw new Error("tile overrides require a grid layout");
  }
  const data = layout.data;
  if (!Array.isArray(data?.tiles)) {
    throw new Error("tile overrides require layout.data.tiles");
  }
  const rows = data.tiles.map((row) => String(row).split(""));
  const height = rows.length;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  function setCell({ x, y }, char) {
    if (y < 0 || y >= height || x < 0 || x >= rows[y].length) {
      throw new Error(`tile override out of bounds at ${x},${y}`);
    }
    rows[y][x] = char;
  }
  walls.forEach((spec) => setCell(parseCoordinate(spec, "--tile-wall"), "#"));
  barriers.forEach((spec) => setCell(parseCoordinate(spec, "--tile-barrier"), "B"));
  floors.forEach((spec) => setCell(parseCoordinate(spec, "--tile-floor"), "."));

  data.tiles = rows.map((row) => row.join(""));
  data.width = data.width ?? width;
  data.height = data.height ?? height;
  data.legend = data.legend || {};
  if (!data.legend["#"]) data.legend["#"] = { tile: "wall" };
  if (!data.legend["."]) data.legend["."] = { tile: "floor" };
  if (barriers.length && !data.legend["B"]) data.legend["B"] = { tile: "barrier" };
  data.render = data.render || {};
  if (barriers.length && !data.render.barrier) data.render.barrier = "B";
  return { simConfig, mutated: true };
}

function applyActorOverrides(initialState, simConfig, { actorSpecs, vitalSpecs, vitalDefaults }) {
  if (!actorSpecs.length && !vitalSpecs.length && !vitalDefaults) {
    return { initialState, mutated: false };
  }
  const actors = Array.isArray(initialState.actors) ? initialState.actors.map((actor) => ({ ...actor })) : [];
  const byId = new Map();
  actors.forEach((actor, index) => {
    if (actor?.id) byId.set(actor.id, index);
  });

  const bounds = getGridBounds(simConfig?.layout?.data);
  if (!bounds) {
    throw new Error("actor overrides require layout bounds");
  }

  actorSpecs.forEach((spec) => {
    const actor = parseActorSpec(spec);
    if (actor.position.x < 0 || actor.position.y < 0 || actor.position.x >= bounds.width || actor.position.y >= bounds.height) {
      throw new Error(`actor ${actor.id} out of bounds at ${actor.position.x},${actor.position.y}`);
    }
    if (byId.has(actor.id)) {
      const index = byId.get(actor.id);
      actors[index] = { ...actors[index], ...actor };
    } else {
      actors.push(actor);
      byId.set(actor.id, actors.length - 1);
    }
  });

  const defaultVitals = vitalDefaults || {
    health: { current: 10, max: 10, regen: 0 },
    mana: { current: 0, max: 0, regen: 0 },
    stamina: { current: 0, max: 0, regen: 0 },
    durability: { current: 0, max: 0, regen: 0 },
  };

  if (actorSpecs.length || vitalSpecs.length || vitalDefaults) {
    actors.forEach((actor) => {
      const existingVitals = actor.vitals && typeof actor.vitals === "object" ? actor.vitals : {};
      const vitals = {};
      VITAL_KEYS.forEach((key) => {
        const record = defaultVitals[key];
        const existing = existingVitals[key] || {};
        vitals[key] = {
          current: Number.isFinite(existing.current) ? existing.current : record.current,
          max: Number.isFinite(existing.max) ? existing.max : record.max,
          regen: Number.isFinite(existing.regen) ? existing.regen : record.regen,
        };
      });
      actor.vitals = vitals;
    });
  }

  vitalSpecs.forEach((spec) => {
    const vital = parseVitalSpec(spec, true);
    if (!vital.actorId || !byId.has(vital.actorId)) {
      throw new Error(`--vital references unknown actor ${vital.actorId || "unknown"}`);
    }
    const actor = actors[byId.get(vital.actorId)];
    actor.vitals = actor.vitals || { ...defaultVitals };
    actor.vitals[vital.vital] = { current: vital.current, max: vital.max, regen: vital.regen };
  });

  actors.sort((a, b) => {
    const left = a?.id || "";
    const right = b?.id || "";
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  });
  initialState.actors = actors;
  return { initialState, mutated: true };
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

function baseVitalsFromActors(actors) {
  const baseVitalsByActorId = {};
  const list = Array.isArray(actors) ? actors : [];
  list.forEach((actor) => {
    if (!actor?.id) {
      return;
    }
    if (actor.vitals) {
      baseVitalsByActorId[actor.id] = actor.vitals;
    }
  });
  return baseVitalsByActorId;
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
    configureGrid: exports.configureGrid,
    setTileAt: exports.setTileAt,
    spawnActorAt: exports.spawnActorAt,
    setActorVital: exports.setActorVital,
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

function dispatchEffect(adapters, effect) {
  if (effect?.kind === "need_external_fact") {
    if (effect.sourceRef) {
      return {
        status: "fulfilled",
        result: { sourceRef: effect.sourceRef, requestId: effect.requestId, targetAdapter: effect.targetAdapter },
      };
    }
    return { status: "deferred", reason: "missing_source_ref" };
  }
  if (effect?.fulfillment === "deferred") {
    return { status: "deferred", reason: "deferred_effect" };
  }
  return dispatchRuntimeEffect(adapters, effect);
}

function buildEffect({ tick, index, kind, value }) {
  return buildRuntimeEffect({ tick, index, kind, value });
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
    const records = [];
    for (let i = 0; i < count; i += 1) {
      const kind = core.getEffectKind(i);
      const value = core.getEffectValue(i);
      const effect = buildEffect({ tick, index: i, kind, value });
      const outcome = dispatchEffect(adapters, effect);
      records.push({
        effect,
        outcome,
        index: i,
        coreKind: kind,
        coreValue: value,
      });
    }
    core.clearEffects();

    records.sort((a, b) => {
      const left = a.effect?.id || "";
      const right = b.effect?.id || "";
      if (left === right) {
        return a.index - b.index;
      }
      return left < right ? -1 : 1;
    });

    const emittedEffects = records.map((record) => record.effect);
    const fulfilledEffects = records.map((record) => ({
      effect: record.effect,
      status: record.outcome?.status || "fulfilled",
      result: record.outcome?.result,
      reason: record.outcome?.reason,
      requestId: record.effect?.requestId,
    }));

    for (const record of records) {
      effectLog.push({
        tick,
        kind: record.effect?.kind ?? record.coreKind,
        value: record.coreValue,
        effectId: record.effect?.id,
        requestId: record.effect?.requestId,
        status: record.outcome?.status || "fulfilled",
        result: record.outcome?.result,
        reason: record.outcome?.reason,
      });
    }

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
    init(seed, simConfig, initialState) {
      tick = 0;
      effectLog.length = 0;
      tickFrames.length = 0;
      core.init(seed);
      if (simConfig?.layout) {
        const layoutResult = applySimConfigToCore(core, simConfig);
        if (!layoutResult.ok) {
          throw new Error(`Failed to apply sim config layout: ${layoutResult.reason || "unknown"}`);
        }
        if (initialState) {
          const actorResult = applyInitialStateToCore(core, initialState, { spawn: layoutResult.spawn });
          if (!actorResult.ok) {
            throw new Error(`Failed to apply initial state: ${actorResult.reason || "unknown"}`);
          }
        }
      } else if (initialState) {
        const actorResult = applyInitialStateToCore(core, initialState);
        if (!actorResult.ok) {
          throw new Error(`Failed to apply initial state: ${actorResult.reason || "unknown"}`);
        }
      }
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
  const solverFixturePath = resolvePath(args["solver-fixture"]);

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

  const { createSolverAdapter } = await import("../adapters/solver-z3/index.js");
  const solverAdapter = createSolverAdapter({ fixturePath: solverFixturePath });
  const solverResult = await solverAdapter.solve(solverRequest);
  if (!solverResult.meta) {
    solverResult.meta = createMeta({ producedBy: "cli-solve", runId });
  }
  solverResult.schema = solverResult.schema || SCHEMAS.solverResult;
  solverResult.schemaVersion = solverResult.schemaVersion || 1;
  solverResult.requestRef = solverResult.requestRef || toRef(solverRequest);

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
  const actionsPath = resolvePath(args.actions);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("run");
  const affinityPresetsPath = resolvePath(args["affinity-presets"]);
  const affinityLoadoutsPath = resolvePath(args["affinity-loadouts"]);
  const affinitySummaryArg = args["affinity-summary"];
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
  let affinityPresets = null;
  let affinityLoadouts = null;
  const wantsAffinitySummary = affinitySummaryArg !== undefined || (affinityPresetsPath && affinityLoadoutsPath);
  if (wantsAffinitySummary && (!affinityPresetsPath || !affinityLoadoutsPath)) {
    throw new Error("Affinity summary requires --affinity-presets and --affinity-loadouts.");
  }
  if (affinityPresetsPath) {
    affinityPresets = await readJson(affinityPresetsPath);
    assertSchema(affinityPresets, SCHEMAS.affinityPreset);
  }
  if (affinityLoadoutsPath) {
    affinityLoadouts = await readJson(affinityLoadoutsPath);
    assertSchema(affinityLoadouts, SCHEMAS.actorLoadout);
  }
  let executionPolicy = null;
  if (executionPolicyPath) {
    executionPolicy = await readJson(executionPolicyPath);
    assertSchema(executionPolicy, SCHEMAS.executionPolicy);
  }
  let actionLog = null;
  if (actionsPath) {
    actionLog = await readJson(actionsPath);
    if (!Array.isArray(actionLog.actions)) {
      throw new Error("actions file must include an actions array.");
    }
    actionLog.schema = actionLog.schema || "agent-kernel/ActionSequence";
    actionLog.schemaVersion = actionLog.schemaVersion || 1;
    actionLog.meta = actionLog.meta || createMeta({ producedBy: "cli-run", runId });
    actionLog.simConfigRef = actionLog.simConfigRef || toRef(simConfig);
    actionLog.initialStateRef = actionLog.initialStateRef || toRef(initialState);
  } else {
    actionLog = {
      schema: "agent-kernel/ActionSequence",
      schemaVersion: 1,
      meta: createMeta({ producedBy: "cli-run", runId }),
      simConfigRef: toRef(simConfig),
      initialStateRef: toRef(initialState),
      actions: [],
    };
  }

  const actorSpecs = normalizeList(args.actor);
  const vitalSpecs = normalizeList(args.vital);
  const vitalDefaultSpecs = normalizeList(args["vital-default"]);
  const tileWalls = normalizeList(args["tile-wall"]);
  const tileBarriers = normalizeList(args["tile-barrier"]);
  const tileFloors = normalizeList(args["tile-floor"]);

  let vitalDefaults = null;
  if (vitalDefaultSpecs.length > 0) {
    vitalDefaults = {
      health: { current: 10, max: 10, regen: 0 },
      mana: { current: 0, max: 0, regen: 0 },
      stamina: { current: 0, max: 0, regen: 0 },
      durability: { current: 0, max: 0, regen: 0 },
    };
    vitalDefaultSpecs.forEach((spec) => {
      const vital = parseVitalSpec(spec, false);
      vitalDefaults[vital.vital] = { current: vital.current, max: vital.max, regen: vital.regen };
    });
  }

  const tileOverrideResult = applyTileOverrides(simConfig, {
    walls: tileWalls,
    barriers: tileBarriers,
    floors: tileFloors,
  });
  const actorOverrideResult = applyActorOverrides(initialState, simConfig, {
    actorSpecs,
    vitalSpecs,
    vitalDefaults,
  });
  const overridesApplied = tileOverrideResult.mutated || actorOverrideResult.mutated;
  const affinitySummaryPath = wantsAffinitySummary
    ? (typeof affinitySummaryArg === "string" ? resolvePath(affinitySummaryArg) : join(outDir, "affinity-summary.json"))
    : null;
  let affinitySummary = null;
  if (wantsAffinitySummary) {
    const baseVitalsByActorId = baseVitalsFromActors(initialState?.actors);
    const traps = simConfig?.layout?.data?.traps;
    const resolved = resolveAffinityEffects({
      presets: affinityPresets?.presets,
      loadouts: affinityLoadouts?.loadouts,
      baseVitalsByActorId,
      traps: Array.isArray(traps) ? traps : [],
    });
    affinitySummary = {
      schema: SCHEMAS.affinitySummary,
      schemaVersion: 1,
      meta: createMeta({ producedBy: "cli-run", runId }),
      presetsRef: toRef(affinityPresets),
      loadoutsRef: toRef(affinityLoadouts),
      simConfigRef: toRef(simConfig),
      initialStateRef: toRef(initialState),
      actors: resolved.actors,
      traps: resolved.traps,
    };
  }

  const core = await loadCoreFromWasm(wasmPath);
  const runner = createRunner({ core, runId });
  runner.init(seed, simConfig, initialState);
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
  await writeJson(join(outDir, "action-log.json"), actionLog);
  if (affinitySummary && affinitySummaryPath) {
    await writeJson(affinitySummaryPath, affinitySummary);
  }
  if (overridesApplied) {
    await writeJson(join(outDir, "resolved-sim-config.json"), simConfig);
    await writeJson(join(outDir, "resolved-initial-state.json"), initialState);
  }

  console.log(`run: wrote ${outDir}`);
}

async function configuratorCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const levelGenPath = resolvePath(args["level-gen"]);
  const actorsPath = resolvePath(args.actors);
  const planPath = resolvePath(args.plan);
  const budgetReceiptPath = resolvePath(args["budget-receipt"]);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);
  const receiptOutPath = resolvePath(args["receipt-out"]);
  const affinityPresetsPath = resolvePath(args["affinity-presets"]);
  const affinityLoadoutsPath = resolvePath(args["affinity-loadouts"]);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("configurator");
  const runId = args["run-id"] || makeId("run");

  if (!levelGenPath || !actorsPath) {
    throw new Error("configurator requires --level-gen and --actors.");
  }
  if ((affinityPresetsPath && !affinityLoadoutsPath) || (!affinityPresetsPath && affinityLoadoutsPath)) {
    throw new Error("configurator requires both --affinity-presets and --affinity-loadouts.");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("configurator requires both --budget and --price-list.");
  }
  if (budgetReceiptPath && (budgetPath || priceListPath)) {
    throw new Error("configurator accepts either --budget-receipt or --budget/--price-list, not both.");
  }
  if (receiptOutPath && !(budgetPath && priceListPath)) {
    throw new Error("configurator requires --budget and --price-list when using --receipt-out.");
  }

  const levelGenInput = await readJson(levelGenPath);
  const layoutResult = generateGridLayoutFromInput(levelGenInput);
  if (!layoutResult.ok) {
    const details = layoutResult.errors.map((err) => `${err.field}:${err.code}`).join(", ");
    throw new Error(`level-gen input invalid: ${details}`);
  }
  const actorsInput = await readJson(actorsPath);
  if (!actorsInput || !Array.isArray(actorsInput.actors)) {
    throw new Error("actors file must include an actors array.");
  }

  let plan = null;
  let budgetReceipt = null;
  let budget = null;
  let priceList = null;
  if (planPath) {
    plan = await readJson(planPath);
    assertSchema(plan, SCHEMAS.plan);
  }
  if (budgetReceiptPath) {
    budgetReceipt = await readJson(budgetReceiptPath);
    assertSchema(budgetReceipt, SCHEMAS.budgetReceipt);
  }
  if (budgetPath) {
    budget = await readJson(budgetPath);
    assertSchema(budget, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceList = await readJson(priceListPath);
    assertSchema(priceList, SCHEMAS.priceList);
  }

  let affinityPresets = null;
  let affinityLoadouts = null;
  if (affinityPresetsPath) {
    affinityPresets = await readJson(affinityPresetsPath);
    assertSchema(affinityPresets, SCHEMAS.affinityPreset);
  }
  if (affinityLoadoutsPath) {
    affinityLoadouts = await readJson(affinityLoadoutsPath);
    assertSchema(affinityLoadouts, SCHEMAS.actorLoadout);
  }

  const layout = layoutResult.value;
  const baseVitalsByActorId = baseVitalsFromActors(actorsInput.actors);
  const resolvedEffects = (affinityPresets && affinityLoadouts)
    ? resolveAffinityEffects({
      presets: affinityPresets.presets,
      loadouts: affinityLoadouts.loadouts,
      baseVitalsByActorId,
      traps: Array.isArray(layout.traps) ? layout.traps : [],
    })
    : {};
  const seed = Number.isFinite(levelGenInput.seed) ? levelGenInput.seed : 0;

  if (budget && priceList) {
    const spendResult = evaluateConfiguratorSpend({
      budget,
      priceList,
      layout,
      actors: actorsInput.actors,
      proposalMeta: createMeta({ producedBy: "cli-configurator", runId }),
      receiptMeta: createMeta({ producedBy: "cli-configurator", runId }),
    });
    budgetReceipt = spendResult.receipt;
  }

  const simConfig = buildSimConfigArtifact({
    meta: createMeta({ producedBy: "cli-configurator", runId }),
    planRef: plan ? toRef(plan) : undefined,
    budgetReceiptRef: budgetReceipt ? toRef(budgetReceipt) : undefined,
    seed,
    layout,
  });
  const initialState = buildInitialStateArtifact({
    meta: createMeta({ producedBy: "cli-configurator", runId }),
    simConfigRef: toRef(simConfig),
    actors: actorsInput.actors,
    resolvedEffects,
  });

  await writeJson(join(outDir, "sim-config.json"), simConfig);
  await writeJson(join(outDir, "initial-state.json"), initialState);
  if (budget && priceList && budgetReceipt) {
    const receiptPath = join(outDir, "budget-receipt.json");
    await writeJson(receiptPath, budgetReceipt);
    if (receiptOutPath) {
      await writeJson(receiptOutPath, budgetReceipt);
    }
  }

  console.log(`configurator: wrote ${outDir}`);
}

async function budgetCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);
  const receiptPath = resolvePath(args.receipt);
  const receiptOutPath = resolvePath(args["receipt-out"]);
  const outDir = resolvePath(args["out-dir"]);
  const outPath = resolvePath(args.out);

  if (!budgetPath && !priceListPath && !receiptPath) {
    throw new Error("budget requires at least one of --budget, --price-list, or --receipt.");
  }

  let budget = null;
  let priceList = null;
  let receipt = null;

  if (budgetPath) {
    budget = await readJson(budgetPath);
    assertSchema(budget, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceList = await readJson(priceListPath);
    assertSchema(priceList, SCHEMAS.priceList);
  }
  if (receiptPath) {
    receipt = await readJson(receiptPath);
    assertSchema(receipt, SCHEMAS.budgetReceiptArtifact);
  }

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    if (budget) await writeJson(join(outDir, "budget.json"), budget);
    if (priceList) await writeJson(join(outDir, "price-list.json"), priceList);
    if (receipt) await writeJson(join(outDir, "budget-receipt.json"), receipt);
  }
  if (receiptOutPath && receipt) {
    await writeJson(receiptOutPath, receipt);
  }

  const output = {};
  if (budget) output.budget = budget;
  if (priceList) output.priceList = priceList;
  if (receipt) output.receipt = receipt;

  if (outPath) {
    await writeJson(outPath, output);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
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
  runner.init(seed, simConfig, initialState);
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

async function llmCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const model = args.model;
  const prompt = args.prompt;
  const baseUrl = args["base-url"] || "http://localhost:11434";
  const fixturePath = resolvePath(args.fixture);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("llm");
  const outPath = resolvePath(args.out) || join(outDir, "llm.json");

  if (!model || !prompt) {
    throw new Error("llm requires --model and --prompt.");
  }

  let fetchFn;
  if (fixturePath) {
    const fixtureJson = JSON.parse(await readText(fixturePath));
    fetchFn = async () => ({ ok: true, json: async () => fixtureJson });
  }

  const adapter = createLlmAdapter({ baseUrl, fetchFn });
  const response = await adapter.generate({ model, prompt, stream: false });
  await writeJson(outPath, response);
  console.log(`llm: wrote ${outPath}`);
}

const COMMANDS = {
  solve: solveCommand,
  run: runCommand,
  configurator: configuratorCommand,
  budget: budgetCommand,
  replay: replayCommand,
  inspect: inspectCommand,
  ipfs: ipfsCommand,
  blockchain: blockchainCommand,
  llm: llmCommand,
  ollama: llmCommand,
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

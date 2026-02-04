import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createIpfsAdapter } from "../adapters/ipfs/index.js";
import { createBlockchainAdapter } from "../adapters/blockchain/index.js";
import { createLlmAdapter } from "../adapters/llm/index.js";
import { orchestrateBuild } from "../../../runtime/src/build/orchestrate-build.js";
import { buildBuildTelemetryRecord } from "../../../runtime/src/build/telemetry.js";
import { createSchemaCatalog, filterSchemaCatalogEntries } from "../../../runtime/src/contracts/schema-catalog.js";
import { createRuntime } from "../../../runtime/src/runner/runtime.js";
import { buildBuildSpecFromSummary } from "../../../runtime/src/personas/director/buildspec-assembler.js";
import { resolveAffinityEffects } from "../../../runtime/src/personas/configurator/affinity-effects.js";
import { generateGridLayoutFromInput } from "../../../runtime/src/personas/configurator/level-layout.js";
import { buildSimConfigArtifact, buildInitialStateArtifact } from "../../../runtime/src/personas/configurator/artifact-builders.js";
import { evaluateConfiguratorSpend } from "../../../runtime/src/personas/configurator/spend-proposal.js";
import { runLlmSession } from "../../../runtime/src/personas/orchestrator/llm-session.js";
import { runLlmBudgetLoop } from "../../../runtime/src/personas/orchestrator/llm-budget-loop.js";
import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_MOTIVATIONS,
  buildMenuPrompt,
  deriveAllowedOptionsFromCatalog,
  normalizeSummary,
} from "../../../runtime/src/personas/orchestrator/prompt-contract.js";
import { mapSummaryToPool } from "../../../runtime/src/personas/director/pool-mapper.js";

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
  capturedInput: "agent-kernel/CapturedInputArtifact",
});

const DEFAULT_WASM_PATH = "build/core-as.wasm";
const DEFAULT_ARTIFACTS_DIR = "artifacts";
const DEFAULT_RUNS_DIR = "runs";
const DEFAULT_TICKS = 1;
const VITAL_KEYS = Object.freeze(["health", "mana", "stamina", "durability"]);

function usage() {
  const filename = fileURLToPath(new URL("./ak.mjs", import.meta.url));
  const base = resolve(dirname(filename), "../../../..");
  const rel = base && filename.startsWith(base)
    ? filename.slice(base.length + 1)
    : filename;
  return `Usage:
  node ${rel} build --spec path [--out-dir dir]
  node ${rel} schemas [--out-dir dir]
  node ${rel} solve --scenario "..." [--out-dir dir] [--run-id id] [--plan path] [--intent path] [--options path]
  node ${rel} run --sim-config path --initial-state path [--execution-policy path] [--ticks N] [--seed N] [--wasm path] [--out-dir dir] [--run-id id] [--actor spec] [--vital spec] [--vital-default spec] [--tile-wall xy] [--tile-barrier xy] [--tile-floor xy] [--actions path] [--affinity-presets path] [--affinity-loadouts path] [--affinity-summary path]
  node ${rel} configurator --level-gen path --actors path [--plan path] [--budget-receipt path] [--budget path --price-list path --receipt-out path] [--affinity-presets path] [--affinity-loadouts path] [--out-dir dir] [--run-id id]
  node ${rel} budget --budget path [--price-list path] [--receipt path] [--out-dir dir] [--out path] [--receipt-out path]
  node ${rel} replay --sim-config path --initial-state path --tick-frames path [--execution-policy path] [--ticks N] [--seed N] [--wasm path] [--out-dir dir]
  node ${rel} inspect --tick-frames path [--effects-log path] [--out-dir dir]
  node ${rel} ipfs --cid cid [--path path] [--gateway url] [--json] [--fixture path] [--out path] [--out-dir dir]
  node ${rel} blockchain --rpc-url url [--address addr] [--fixture-chain-id path] [--fixture-balance path] [--out path] [--out-dir dir]
  node ${rel} llm --model model --prompt text [--base-url url] [--fixture path] [--out path] [--out-dir dir]
  node ${rel} llm-plan [--scenario path | --prompt text --catalog path] --model model [--goal text] [--budget-tokens N] [--base-url url] [--fixture path] [--budget-loop] [--budget-pool id=weight --budget-reserve N] [--out-dir dir] [--run-id id] [--created-at iso]

Options:
  --out-dir       Output directory (default: ./artifacts/runs/<runId>/<command>)
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
  --spec          Build spec JSON path (build command only)
  --scenario      Scenario fixture path for llm-plan
  --catalog       Catalog path for prompt-only llm-plan runs
  --goal          Goal text override (llm-plan prompt-only)
  --budget-tokens Budget token hint (llm-plan prompt-only)
  --prompt        Prompt override (llm-plan)
  --budget-loop   Enable budget loop (layout then actors)
  --budget-pool   Budget pool weight entry (repeatable): id=weight (e.g., player=0.2)
  --budget-reserve Reserve tokens before pooling (llm-plan budget loop)
  --fixture       Fixture response for adapter commands (no network)
  --run-id        Override run id for output artifacts
  --created-at    Override createdAt timestamp (ISO-8601) for llm-plan
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
    "budget-pool",
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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeFileSegment(value) {
  const raw = String(value || "").toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "capture";
}

function sanitizeFileName(value) {
  const raw = String(value || "");
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "capture";
}

function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function buildSpecMeta(spec, producedBy, suffix) {
  return {
    id: `${spec.meta.id}_${suffix}`,
    runId: spec.meta.runId,
    createdAt: spec.meta.createdAt,
    producedBy,
    correlationId: spec.meta.correlationId,
    note: spec.meta.note,
  };
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

function createDeterministicClock(seed) {
  let baseTime = 0;
  if (typeof seed === "string") {
    const parsed = Date.parse(seed);
    if (Number.isFinite(parsed)) {
      baseTime = parsed;
    }
  } else if (typeof seed === "number" && Number.isFinite(seed)) {
    baseTime = seed;
  }
  let offset = 0;
  return () => new Date(baseTime + offset++).toISOString();
}

function resolveClockSeed(simConfig, initialState) {
  return simConfig?.meta?.createdAt
    || initialState?.meta?.createdAt
    || null;
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

function defaultRunDir(runId) {
  return resolve(process.cwd(), DEFAULT_ARTIFACTS_DIR, DEFAULT_RUNS_DIR, runId);
}

function defaultRunCommandOutDir(command, runId) {
  return resolve(defaultRunDir(runId), command);
}

function defaultOutDir(command, runId) {
  const resolvedRunId = runId || makeId("run");
  return defaultRunCommandOutDir(command, resolvedRunId);
}

function defaultBuildOutDir(spec) {
  return defaultRunCommandOutDir("build", spec.meta.runId);
}

function defaultLlmPlanOutDir(runId) {
  return defaultRunCommandOutDir("llm-plan", runId);
}

function allowNetworkRequests() {
  const value = process.env.AK_ALLOW_NETWORK;
  return value === "1" || value === "true";
}

function isLlmLiveEnabled() {
  const value = process.env.AK_LLM_LIVE;
  return value === "1" || value === "true";
}

function isLlmStrictEnabled() {
  const value = process.env.AK_LLM_STRICT;
  return value === "1" || value === "true";
}

function isLlmBudgetLoopEnabled() {
  const value = process.env.AK_LLM_BUDGET_LOOP;
  return value === "1" || value === "true";
}

function isLocalBaseUrl(raw) {
  if (!isNonEmptyString(raw)) {
    return false;
  }
  try {
    const url = new URL(raw);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch (error) {
    const lowered = raw.toLowerCase();
    return lowered.startsWith("localhost")
      || lowered.startsWith("127.0.0.1")
      || lowered.startsWith("[::1]")
      || lowered.startsWith("http://localhost")
      || lowered.startsWith("http://127.0.0.1")
      || lowered.startsWith("http://[::1]");
  }
}

function resolveScenarioAssetPath(rawPath, baseDir) {
  if (!rawPath) {
    return null;
  }
  const primary = resolvePath(rawPath);
  if (primary && existsSync(primary)) {
    return primary;
  }
  if (!baseDir) {
    return primary;
  }
  const fallback = resolvePath(rawPath, baseDir);
  if (fallback && existsSync(fallback)) {
    return fallback;
  }
  return primary || fallback;
}

function injectBudgetTokens(prompt, budgetTokens) {
  if (!isNonEmptyString(prompt)) {
    return prompt;
  }
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return prompt;
  }
  if (prompt.includes("Budget tokens:")) {
    return prompt;
  }
  return `Budget tokens: ${budgetTokens}\n${prompt}`;
}

function unwrapCodeFence(text) {
  if (!text) return text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1].trim() : text;
}

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = unwrapCodeFence(text).trim();
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    return cleaned;
  }
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }
  return null;
}

function appendJsonOnlyInstruction(promptText) {
  if (!isNonEmptyString(promptText)) {
    return promptText;
  }
  const suffix = "Final request: return the JSON now. Output JSON only (no markdown, no commentary).";
  if (promptText.includes(suffix)) {
    return promptText;
  }
  return `${promptText}\n\n${suffix}`;
}

function deriveAllowedPairs(catalog) {
  const entries = Array.isArray(catalog?.entries)
    ? catalog.entries
    : Array.isArray(catalog)
      ? catalog
      : [];
  const pairs = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const { motivation, affinity } = entry;
    if (typeof motivation !== "string" || typeof affinity !== "string") return;
    const key = `${motivation}|${affinity}`;
    if (!pairs.has(key)) {
      pairs.set(key, { motivation, affinity });
    }
  });
  return Array.from(pairs.values()).sort(
    (a, b) => a.motivation.localeCompare(b.motivation) || a.affinity.localeCompare(b.affinity),
  );
}

function formatAllowedPairs(pairs) {
  return pairs.map((pair) => `(${pair.motivation}, ${pair.affinity})`).join(", ");
}

function countInstances(selections, kind) {
  return selections
    .filter((sel) => sel.kind === kind && Array.isArray(sel.instances))
    .reduce((sum, sel) => sum + sel.instances.length, 0);
}

function summarizeMissingSelections(selections) {
  return selections
    .filter((sel) => !sel.applied)
    .map((sel) => `${sel.kind}:${sel.requested?.motivation || "?"}/${sel.requested?.affinity || "?"}`)
    .join(", ");
}

function buildRepairPrompt({ basePrompt, errors, responseText, allowedOptions, allowedPairsText }) {
  const extracted = extractJsonObject(responseText) || responseText;
  const affinities = allowedOptions?.affinities?.length ? allowedOptions.affinities : ALLOWED_AFFINITIES;
  const motivations = allowedOptions?.motivations?.length ? allowedOptions.motivations : ALLOWED_MOTIVATIONS;
  const expressions = ALLOWED_AFFINITY_EXPRESSIONS;
  const errorText = JSON.stringify(errors);
  const preview = String(extracted || "").slice(0, 4000);
  return [
    basePrompt,
    "",
    "Your previous response failed validation. Fix it and return corrected JSON only.",
    `Errors: ${errorText}`,
    `Allowed affinities: ${affinities.join(", ")}`,
    `Allowed expressions: ${expressions.join(", ")}`,
    `Allowed motivations: ${motivations.join(", ")}`,
    allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}` : null,
    "Provide at least one room and one actor; each count must be >= 1.",
    "tokenHint must be a positive integer if provided; otherwise omit it.",
    "Example affinity entry: {\"kind\":\"water\",\"expression\":\"push\",\"stacks\":1}",
    "Invalid response JSON (fix to match schema):",
    preview,
    "",
    "Final request: return corrected JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function assertAllowedBuildArgs(args) {
  const allowed = new Set(["spec", "out-dir"]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`build only accepts --spec and --out-dir. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedSchemasArgs(args) {
  const allowed = new Set(["out-dir"]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`schemas only accepts --out-dir. Unknown: ${unknown.join(", ")}`);
  }
}

function addManifestEntry(entries, artifact, path) {
  if (!artifact || typeof artifact !== "object") {
    return;
  }
  const id = artifact.meta?.id;
  if (!id) {
    return;
  }
  entries.push({
    id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
    path,
  });
}

function buildArtifactRefs(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    schema: entry.schema,
    schemaVersion: entry.schemaVersion,
  }));
}

function buildCapturedInputPath(adapter, index, outputRefId) {
  if (isNonEmptyString(outputRefId)) {
    return `${sanitizeFileName(outputRefId)}.json`;
  }
  const safeAdapter = sanitizeFileSegment(adapter);
  return `captured-input-${safeAdapter}-${index + 1}.json`;
}

async function captureAdapterPayload({ capture, index, baseDir, spec, producedBy, allowNetwork }) {
  if (!capture || typeof capture !== "object") {
    throw new Error("build capture requires an object entry.");
  }
  const adapterRaw = capture.adapter;
  if (!isNonEmptyString(adapterRaw)) {
    throw new Error("build capture requires adapter name.");
  }

  const adapterKey = adapterRaw.toLowerCase();
  const request = isObject(capture.request) ? capture.request : {};
  const outputRef = capture.outputRef;
  if (outputRef) {
    if (outputRef.schema !== SCHEMAS.capturedInput) {
      throw new Error(`capture outputRef schema must be ${SCHEMAS.capturedInput}.`);
    }
    if (outputRef.schemaVersion !== 1) {
      throw new Error("capture outputRef schemaVersion must be 1.");
    }
  }

  const suffix = `capture_${sanitizeFileSegment(adapterKey)}_${index + 1}`;
  const meta = buildSpecMeta(spec, producedBy, suffix);
  if (outputRef?.id) {
    meta.id = outputRef.id;
  }

  const source = {
    adapter: adapterRaw,
    requestId: isNonEmptyString(request.requestId) ? request.requestId : undefined,
    request,
  };

  let payload;
  let contentType = capture.contentType || request.contentType;

  if (adapterKey === "ipfs") {
    const cid = request.cid;
    if (!isNonEmptyString(cid)) {
      throw new Error("ipfs capture requires request.cid.");
    }
    const path = request.path || "";
    const gatewayUrl = request.gatewayUrl || "https://ipfs.io/ipfs";
    const wantJson = request.json !== undefined
      ? Boolean(request.json)
      : contentType === "application/json";
    const fixturePath = resolvePath(capture.fixturePath || request.fixturePath, baseDir);

    let fetchFn;
    if (fixturePath) {
      const fixtureText = await readText(fixturePath);
      fetchFn = async () => ({ ok: true, text: async () => fixtureText });
    } else if (!allowNetwork) {
      throw new Error("ipfs capture requires fixturePath unless AK_ALLOW_NETWORK=1.");
    }

    const adapter = createIpfsAdapter({ gatewayUrl, fetchFn });
    payload = wantJson ? await adapter.fetchJson(cid, path) : await adapter.fetchText(cid, path);
    contentType = contentType || (wantJson ? "application/json" : "text/plain");
  } else if (adapterKey === "blockchain") {
    const rpcUrl = request.rpcUrl;
    if (!isNonEmptyString(rpcUrl)) {
      throw new Error("blockchain capture requires request.rpcUrl.");
    }
    const address = request.address;
    const fixtureChainIdPath = resolvePath(request.fixtureChainIdPath, baseDir);
    const fixtureBalancePath = resolvePath(request.fixtureBalancePath, baseDir);

    if ((!fixtureChainIdPath || (address && !fixtureBalancePath)) && !allowNetwork) {
      throw new Error("blockchain capture requires fixtures unless AK_ALLOW_NETWORK=1.");
    }

    let fetchFn;
    if (fixtureChainIdPath || fixtureBalancePath) {
      const chainFixture = fixtureChainIdPath ? JSON.parse(await readText(fixtureChainIdPath)) : null;
      const balanceFixture = fixtureBalancePath ? JSON.parse(await readText(fixtureBalancePath)) : null;
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
    payload = { rpcUrl };
    payload.chainId = await adapter.getChainId();
    if (address) {
      payload.address = address;
      payload.balance = await adapter.getBalance(address);
    }
    contentType = contentType || "application/json";
  } else if (adapterKey === "llm" || adapterKey === "ollama") {
    const model = request.model;
    const prompt = request.prompt;
    if (!isNonEmptyString(model) || !isNonEmptyString(prompt)) {
      throw new Error("llm capture requires request.model and request.prompt.");
    }
    const baseUrl = request.baseUrl || request.base_url || "http://localhost:11434";
    const fixturePath = resolvePath(capture.fixturePath || request.fixturePath, baseDir);

    let fetchFn;
    if (fixturePath) {
      const fixtureJson = JSON.parse(await readText(fixturePath));
      fetchFn = async () => ({ ok: true, json: async () => fixtureJson });
    } else if (!allowNetwork && !isLocalBaseUrl(baseUrl)) {
      throw new Error("llm capture requires fixturePath unless AK_ALLOW_NETWORK=1.");
    }

    const options = isObject(request.options) ? request.options : undefined;
    const adapter = createLlmAdapter({ baseUrl, fetchFn });
    payload = await adapter.generate({
      model,
      prompt,
      options,
      stream: Boolean(request.stream),
    });
    contentType = contentType || "application/json";
  } else {
    throw new Error(`unknown capture adapter ${adapterRaw}`);
  }

  const artifact = {
    schema: SCHEMAS.capturedInput,
    schemaVersion: 1,
    meta,
    source,
    contentType: contentType || "application/json",
    payload,
  };

  return {
    artifact,
    path: buildCapturedInputPath(adapterKey, index, outputRef?.id),
  };
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



async function buildCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedBuildArgs(args);

  if (typeof args.spec !== "string") {
    throw new Error("build requires --spec <path>.");
  }
  if (args["out-dir"] !== undefined && typeof args["out-dir"] !== "string") {
    throw new Error("build requires --out-dir <path> when provided.");
  }

  const specPath = resolvePath(args.spec);
  if (!specPath) {
    throw new Error("build requires --spec <path>.");
  }

  let spec = null;
  let outDir = null;
  let result = null;
  let manifestEntries = [];
  let capturedInputs = [];
  const producedBy = "cli-build";
  const baseDir = dirname(specPath);

  try {
    spec = await readJson(specPath);
    outDir = resolvePath(args["out-dir"]) || defaultBuildOutDir(spec);

    let solver = null;
    const solverSpec = spec.plan?.hints?.solver ?? spec.intent?.hints?.solver;
    if (solverSpec !== undefined) {
      if (!solverSpec || typeof solverSpec !== "object" || Array.isArray(solverSpec)) {
        throw new Error("build requires solver hints as an object when provided.");
      }
      const fixturePath = resolvePath(solverSpec.fixture || solverSpec.fixturePath, baseDir);
      if (!fixturePath) {
        throw new Error("build requires solver fixture path (solver.fixture).");
      }
      const scenarioFile = resolvePath(solverSpec.scenarioFile, baseDir);
      const optionsPath = resolvePath(solverSpec.optionsPath, baseDir);
      let scenarioData = solverSpec.scenario;
      if (scenarioData === undefined && scenarioFile) {
        scenarioData = await readText(scenarioFile);
      }
      let options = solverSpec.options;
      if (options === undefined && optionsPath) {
        options = await readJson(optionsPath);
      }

      const { createSolverAdapter } = await import("../adapters/solver-z3/index.js");
      const solverAdapter = createSolverAdapter({ fixturePath });
      solver = {
        adapter: solverAdapter,
        scenario: scenarioData,
        options,
        clock: () => spec.meta.createdAt,
      };
    }

    result = await orchestrateBuild({ spec, producedBy, solver });

    await writeJson(join(outDir, "spec.json"), result.spec);
    await writeJson(join(outDir, "intent.json"), result.intent);
    await writeJson(join(outDir, "plan.json"), result.plan);

    if (result.budget?.budget) {
      await writeJson(join(outDir, "budget.json"), result.budget.budget);
    }
    if (result.budget?.priceList) {
      await writeJson(join(outDir, "price-list.json"), result.budget.priceList);
    }
    if (result.budgetReceipt) {
      await writeJson(join(outDir, "budget-receipt.json"), result.budgetReceipt);
    }
    if (result.solverRequest) {
      await writeJson(join(outDir, "solver-request.json"), result.solverRequest);
    }
    if (result.solverResult) {
      await writeJson(join(outDir, "solver-result.json"), result.solverResult);
    }
    if (result.simConfig) {
      await writeJson(join(outDir, "sim-config.json"), result.simConfig);
    }
    if (result.initialState) {
      await writeJson(join(outDir, "initial-state.json"), result.initialState);
    }

    const captures = Array.isArray(spec.adapters?.capture) ? spec.adapters.capture : [];
    if (captures.length > 0) {
      const allowNetwork = allowNetworkRequests();
      for (let i = 0; i < captures.length; i += 1) {
        const captured = await captureAdapterPayload({
          capture: captures[i],
          index: i,
          baseDir,
          spec,
          producedBy,
          allowNetwork,
        });
        await writeJson(join(outDir, captured.path), captured.artifact);
        capturedInputs.push(captured);
      }
    }

    const bundleArtifacts = [];
    if (result.intent) bundleArtifacts.push(result.intent);
    if (result.plan) bundleArtifacts.push(result.plan);
    if (result.budget?.budget) bundleArtifacts.push(result.budget.budget);
    if (result.budget?.priceList) bundleArtifacts.push(result.budget.priceList);
    if (result.budgetReceipt) bundleArtifacts.push(result.budgetReceipt);
    if (result.solverRequest) bundleArtifacts.push(result.solverRequest);
    if (result.solverResult) bundleArtifacts.push(result.solverResult);
    if (result.simConfig) bundleArtifacts.push(result.simConfig);
    if (result.initialState) bundleArtifacts.push(result.initialState);
    capturedInputs.forEach((capture) => {
      bundleArtifacts.push(capture.artifact);
    });

    bundleArtifacts.sort((a, b) => {
      if (a.schema === b.schema) {
        return a.meta.id.localeCompare(b.meta.id);
      }
      return a.schema.localeCompare(b.schema);
    });

    addManifestEntry(manifestEntries, result.intent, "intent.json");
    addManifestEntry(manifestEntries, result.plan, "plan.json");
    addManifestEntry(manifestEntries, result.budget?.budget, "budget.json");
    addManifestEntry(manifestEntries, result.budget?.priceList, "price-list.json");
    addManifestEntry(manifestEntries, result.budgetReceipt, "budget-receipt.json");
    addManifestEntry(manifestEntries, result.solverRequest, "solver-request.json");
    addManifestEntry(manifestEntries, result.solverResult, "solver-result.json");
    addManifestEntry(manifestEntries, result.simConfig, "sim-config.json");
    addManifestEntry(manifestEntries, result.initialState, "initial-state.json");
    capturedInputs.forEach((capture) => {
      addManifestEntry(manifestEntries, capture.artifact, capture.path);
    });

    manifestEntries.sort((a, b) => {
      if (a.schema === b.schema) {
        return a.id.localeCompare(b.id);
      }
      return a.schema.localeCompare(b.schema);
    });

    const schemaEntries = filterSchemaCatalogEntries({
      schemaRefs: [
        { schema: spec.schema, schemaVersion: spec.schemaVersion },
        ...manifestEntries,
      ],
    });

    const bundle = {
      spec: result.spec,
      schemas: schemaEntries,
      artifacts: bundleArtifacts,
    };

    await writeJson(join(outDir, "bundle.json"), bundle);

    const manifest = {
      specPath: "spec.json",
      correlation: {
        runId: spec.meta.runId,
        source: spec.meta.source,
        correlationId: spec.meta.correlationId,
      },
      schemas: schemaEntries,
      artifacts: manifestEntries,
    };

    if (!manifest.correlation.correlationId) {
      delete manifest.correlation.correlationId;
    }

    await writeJson(join(outDir, "manifest.json"), manifest);

    const artifactRefs = buildArtifactRefs(manifestEntries);
    const telemetry = buildBuildTelemetryRecord({
      spec,
      status: "success",
      artifactRefs,
      producedBy,
      clock: () => spec.meta.createdAt,
    });
    await writeJson(join(outDir, "telemetry.json"), telemetry);

    console.log(`build: wrote ${outDir}`);
  } catch (error) {
    const message = error?.message || String(error);
    const runId = spec?.meta?.runId || "run_unknown";
    outDir = outDir || defaultRunCommandOutDir("build", runId);
    let artifactRefs = buildArtifactRefs(manifestEntries);
    if (artifactRefs.length === 0 && result) {
      const fallbackEntries = [];
      addManifestEntry(fallbackEntries, result.intent, "intent.json");
      addManifestEntry(fallbackEntries, result.plan, "plan.json");
      addManifestEntry(fallbackEntries, result.budget?.budget, "budget.json");
      addManifestEntry(fallbackEntries, result.budget?.priceList, "price-list.json");
      addManifestEntry(fallbackEntries, result.budgetReceipt, "budget-receipt.json");
      addManifestEntry(fallbackEntries, result.solverRequest, "solver-request.json");
      addManifestEntry(fallbackEntries, result.solverResult, "solver-result.json");
      addManifestEntry(fallbackEntries, result.simConfig, "sim-config.json");
      addManifestEntry(fallbackEntries, result.initialState, "initial-state.json");
      capturedInputs.forEach((capture) => {
        addManifestEntry(fallbackEntries, capture.artifact, capture.path);
      });
      artifactRefs = buildArtifactRefs(fallbackEntries);
    }
    const telemetry = buildBuildTelemetryRecord({
      spec,
      status: "error",
      errors: [message],
      artifactRefs,
      producedBy,
      clock: () => spec?.meta?.createdAt || "1970-01-01T00:00:00.000Z",
    });
    await writeJson(join(outDir, "telemetry.json"), telemetry);
    throw error;
  }
}

async function schemasCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedSchemasArgs(args);

  if (args["out-dir"] !== undefined && typeof args["out-dir"] !== "string") {
    throw new Error("schemas requires --out-dir <path> when provided.");
  }

  const outDir = resolvePath(args["out-dir"]);
  const clockOverride = process.env.AK_SCHEMA_CATALOG_TIME;
  const catalog = createSchemaCatalog({
    clock: clockOverride ? () => clockOverride : undefined,
  });

  if (outDir) {
    await writeJson(join(outDir, "schemas.json"), catalog);
    console.log(`schemas: wrote ${outDir}`);
    return;
  }

  console.log(`${JSON.stringify(catalog, null, 2)}`);
}

async function solveCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = args["run-id"] || makeId("run");
  const scenario = args.scenario || null;
  const scenarioFile = resolvePath(args["scenario-file"]);
  const planPath = resolvePath(args.plan);
  const intentPath = resolvePath(args.intent);
  const optionsPath = resolvePath(args.options);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("solve", runId);
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
  const affinityPresetsPath = resolvePath(args["affinity-presets"]);
  const affinityLoadoutsPath = resolvePath(args["affinity-loadouts"]);
  const affinitySummaryArg = args["affinity-summary"];
  const wasmPath = resolvePath(args.wasm || DEFAULT_WASM_PATH);
  const ticks = args.ticks ? Number(args.ticks) : DEFAULT_TICKS;
  const seed = args.seed ? Number(args.seed) : 0;

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
  const runId = args["run-id"]
    || simConfig?.meta?.runId
    || initialState?.meta?.runId
    || makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("run", runId);
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

  const clock = createDeterministicClock(resolveClockSeed(simConfig, initialState));
  const core = await loadCoreFromWasm(wasmPath);
  const runtime = createRuntime({ core, adapters: {}, runId, clock });
  await runtime.init({ seed, simConfig, initialState, clock });
  for (let i = 0; i < ticks; i += 1) {
    await runtime.step();
  }
  const tickFrames = runtime.getTickFrames();
  const effectLog = runtime.getEffectLog();

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
  const runId = args["run-id"] || makeId("run");
  const levelGenPath = resolvePath(args["level-gen"]);
  const actorsPath = resolvePath(args.actors);
  const planPath = resolvePath(args.plan);
  const budgetReceiptPath = resolvePath(args["budget-receipt"]);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);
  const receiptOutPath = resolvePath(args["receipt-out"]);
  const affinityPresetsPath = resolvePath(args["affinity-presets"]);
  const affinityLoadoutsPath = resolvePath(args["affinity-loadouts"]);
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("configurator", runId);

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
  const runId = makeId("replay");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("replay", runId);
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

  const clock = createDeterministicClock(resolveClockSeed(simConfig, initialState));
  const core = await loadCoreFromWasm(wasmPath);
  const runtime = createRuntime({ core, adapters: {}, runId, clock });
  await runtime.init({ seed, simConfig, initialState, clock });
  for (let i = 0; i < ticks; i += 1) {
    await runtime.step();
  }
  const actualFrames = runtime.getTickFrames();
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
  const outDirOverride = resolvePath(args["out-dir"]);

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

  const runId = frames[0]?.meta?.runId || makeId("run");
  const outDir = outDirOverride || defaultOutDir("inspect", runId);
  const effectsLog = effectsLogPath ? await readJson(effectsLogPath) : null;
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
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("ipfs", runId);
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
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("blockchain", runId);
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
  const llmFormat = process.env.AK_LLM_FORMAT;
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("llm", runId);
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
  const response = await adapter.generate({
    model,
    prompt,
    stream: false,
    format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
  });
  await writeJson(outPath, response);
  console.log(`llm: wrote ${outPath}`);
}

async function llmPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const scenarioPath = resolvePath(args.scenario);
  const promptRaw = args.prompt;
  const catalogOverride = resolvePath(args.catalog);
  const goalOverride = args.goal;
  const budgetTokensRaw = args["budget-tokens"];
  const model = args.model || process.env.AK_LLM_MODEL;
  const baseUrl = args["base-url"] || process.env.AK_LLM_BASE_URL || "http://localhost:11434";
  const fixturePath = resolvePath(args.fixture);
  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultLlmPlanOutDir(runId);

  if (!scenarioPath && !catalogOverride) {
    throw new Error("llm-plan requires --scenario or --catalog.");
  }
  if (!scenarioPath && !isNonEmptyString(promptRaw)) {
    throw new Error("llm-plan requires --prompt when --scenario is omitted.");
  }

  let budgetTokens;
  if (budgetTokensRaw !== undefined) {
    budgetTokens = Number(budgetTokensRaw);
    if (!Number.isFinite(budgetTokens)) {
      throw new Error("llm-plan requires --budget-tokens to be a number.");
    }
  }

  const budgetReserveRaw = args["budget-reserve"];
  let budgetReserveTokens;
  if (budgetReserveRaw !== undefined) {
    budgetReserveTokens = Number(budgetReserveRaw);
    if (!Number.isFinite(budgetReserveTokens) || budgetReserveTokens < 0) {
      throw new Error("llm-plan requires --budget-reserve to be a non-negative number.");
    }
  }

  const budgetPoolRaw = args["budget-pool"];
  const budgetPools = [];
  if (budgetPoolRaw !== undefined) {
    const entries = Array.isArray(budgetPoolRaw) ? budgetPoolRaw : [budgetPoolRaw];
    entries.forEach((entry) => {
      if (typeof entry !== "string" || !entry.includes("=")) {
        throw new Error("llm-plan --budget-pool must be in id=weight form.");
      }
      const [idRaw, weightRaw] = entry.split("=");
      const id = idRaw.trim();
      const weight = Number(weightRaw);
      if (!id) {
        throw new Error("llm-plan --budget-pool requires a non-empty id.");
      }
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`llm-plan --budget-pool weight must be >= 0 for ${id}.`);
      }
      budgetPools.push({ id, weight });
    });
  }

  const scenario = scenarioPath ? await readJson(scenarioPath) : null;
  const scenarioBaseDir = scenarioPath ? dirname(scenarioPath) : process.cwd();
  const catalogPath = catalogOverride
    || (scenario ? resolveScenarioAssetPath(scenario.catalogPath, scenarioBaseDir) : null);
  if (!catalogPath) {
    if (scenario) {
      throw new Error("llm-plan requires scenario.catalogPath or --catalog.");
    }
    throw new Error("llm-plan requires --catalog when --scenario is omitted.");
  }
  const catalog = await readJson(catalogPath);
  const allowedOptions = deriveAllowedOptionsFromCatalog(catalog);
  const allowedPairs = deriveAllowedPairs(catalog);
  const allowedPairsText = allowedPairs.length > 0 ? formatAllowedPairs(allowedPairs) : "";
  const budgetLoopEnabled = Boolean(args["budget-loop"]) || isLlmBudgetLoopEnabled();

  const goal = isNonEmptyString(goalOverride)
    ? goalOverride
    : scenario?.goal || "LLM planning request";
  const resolvedBudgetTokens = budgetTokens !== undefined ? budgetTokens : scenario?.budgetTokens;
  if (!Number.isFinite(resolvedBudgetTokens) || resolvedBudgetTokens <= 0) {
    throw new Error("llm-plan requires --budget-tokens or scenario.budgetTokens > 0.");
  }
  const prompt = injectBudgetTokens(
    isNonEmptyString(promptRaw) ? promptRaw : undefined,
    resolvedBudgetTokens,
  );
  const notes = [
    scenario?.notes,
    "Include at least one room and one actor; counts must be > 0.",
    allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const basePrompt = isNonEmptyString(prompt)
    ? prompt
    : buildMenuPrompt({
      goal,
      notes,
      budgetTokens: resolvedBudgetTokens,
    });
  const constraintLines = [
    "Constraints:",
    "- In affinities[] entries, kind must be from Affinities and expression must be from Affinity expressions.",
    "- Omit optional fields instead of using null.",
    "- Provide at least one room and one actor; counts must be > 0.",
    allowedPairsText ? `- Allowed profiles (motivation, affinity): ${allowedPairsText}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const finalPrompt = appendJsonOnlyInstruction(`${basePrompt}\n\n${constraintLines}`);
  const llmFormat = process.env.AK_LLM_FORMAT;

  const liveEnabled = isLlmLiveEnabled();
  let capture = null;
  let captures = [];
  let summary = null;
  let mappedSelections;
  let loopTrace = null;
  let budgetAllocation = null;
  let budgetPoolWeights = null;
  let budgetPoolBudgets = null;
  let budgetPoolPolicy = null;

  if (liveEnabled) {
    if (!isNonEmptyString(model)) {
      throw new Error("llm-plan requires --model or AK_LLM_MODEL when AK_LLM_LIVE=1.");
    }
    if (!fixturePath && !allowNetworkRequests() && !isLocalBaseUrl(baseUrl)) {
      throw new Error("llm-plan requires --fixture unless AK_ALLOW_NETWORK=1 or base URL is local.");
    }

    let fetchFn;
    if (fixturePath) {
      const fixtureJson = JSON.parse(await readText(fixturePath));
      const responses = Array.isArray(fixtureJson)
        ? fixtureJson
        : Array.isArray(fixtureJson?.responses)
          ? fixtureJson.responses
          : [fixtureJson];
      let fixtureIndex = 0;
      fetchFn = async () => {
        if (responses.length > 1 && fixtureIndex >= responses.length) {
          return { ok: false, status: 500, statusText: "Missing fixture response" };
        }
        const payload = responses[Math.min(fixtureIndex, responses.length - 1)];
        fixtureIndex += 1;
        return { ok: true, json: async () => payload };
      };
    }

    const adapter = createLlmAdapter({ baseUrl, fetchFn });
    const repairPromptBuilder = ({ errors, responseText }) => buildRepairPrompt({
      basePrompt: finalPrompt,
      errors,
      responseText,
      allowedOptions,
      allowedPairsText,
    });
    if (budgetLoopEnabled) {
      const poolPolicy = Number.isFinite(budgetReserveTokens) ? { reserveTokens: budgetReserveTokens } : undefined;
      const loopResult = await runLlmBudgetLoop({
        adapter,
        model,
        baseUrl,
        catalog,
        goal,
        notes,
        budgetTokens: resolvedBudgetTokens,
        poolWeights: budgetPools.length > 0 ? budgetPools : undefined,
        poolPolicy,
        strict: isLlmStrictEnabled(),
        format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
        runId,
        clock: () => createdAt,
        producedBy: "orchestrator",
      });
      captures = loopResult.captures || [];
      loopTrace = loopResult.trace || null;
      budgetAllocation = loopResult.budgetAllocation || null;
      budgetPoolWeights = loopResult.poolWeights || null;
      budgetPoolBudgets = loopResult.poolBudgets || null;
      budgetPoolPolicy = loopResult.poolPolicy || poolPolicy || null;
      if (!loopResult.ok) {
        if (captures.length > 0) {
          for (let i = 0; i < captures.length; i += 1) {
            const artifact = captures[i];
            const capturePath = buildCapturedInputPath("llm", i, artifact?.meta?.id);
            await writeJson(join(outDir, capturePath), artifact);
          }
        }
        throw new Error(`llm-plan budget loop failed: ${JSON.stringify(loopResult.errors || [])}`);
      }
      summary = loopResult.summary;
      mappedSelections = loopResult.selections;
    } else {
      let session = await runLlmSession({
        adapter,
        model,
        baseUrl,
        prompt: isNonEmptyString(finalPrompt) ? finalPrompt : undefined,
        goal,
        budgetTokens: resolvedBudgetTokens,
        strict: isLlmStrictEnabled(),
        repairPromptBuilder,
        requireSummary: { minRooms: 1, minActors: 1 },
        runId,
        clock: () => createdAt,
        producedBy: "orchestrator",
        format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
      });
      if (!session.ok) {
        if (session.capture) {
          const capturePath = buildCapturedInputPath("llm", 0, session.capture.meta?.id);
          await writeJson(join(outDir, capturePath), session.capture);
        }
        throw new Error(`llm-plan session failed: ${JSON.stringify(session.errors || [])}`);
      }
      summary = session.summary;
      capture = session.capture;

      let mapped = mapSummaryToPool({ summary, catalog });
      let actorInstances = countInstances(mapped.selections, "actor");
      if (actorInstances === 0) {
        const missingSelections = summarizeMissingSelections(mapped.selections);
        const catalogRepairPrompt = [
          basePrompt,
          "",
          "Your previous response did not match the pool catalog. Choose only from the allowed profiles below.",
          allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}` : null,
          missingSelections ? `Unmatched picks: ${missingSelections}` : null,
          "Provide at least one actor entry with count >= 1.",
          "Final request: return corrected JSON only.",
        ]
          .filter(Boolean)
          .join("\n");

        session = await runLlmSession({
          adapter,
          model,
          baseUrl,
          prompt: catalogRepairPrompt,
          goal,
          budgetTokens: resolvedBudgetTokens,
          strict: isLlmStrictEnabled(),
          repairPromptBuilder,
          requireSummary: { minRooms: 1, minActors: 1 },
          runId,
          clock: () => createdAt,
          producedBy: "orchestrator",
          format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
        });

        if (!session.ok) {
          if (session.capture) {
            const capturePath = buildCapturedInputPath("llm", 0, session.capture.meta?.id);
            await writeJson(join(outDir, capturePath), session.capture);
          }
          throw new Error(`llm-plan session failed: ${JSON.stringify(session.errors || [])}`);
        }

        summary = session.summary;
        capture = session.capture;
        mapped = mapSummaryToPool({ summary, catalog });
        actorInstances = countInstances(mapped.selections, "actor");
        if (actorInstances === 0) {
          const finalMissing = summarizeMissingSelections(mapped.selections);
          throw new Error(
            `llm-plan summary did not match catalog entries (actors=${actorInstances}).` +
              (finalMissing ? ` Unmatched picks: ${finalMissing}` : "")
          );
        }
      }

      mappedSelections = mapped.selections;
    }
  } else {
    if (isNonEmptyString(prompt)) {
      throw new Error("llm-plan requires AK_LLM_LIVE=1 when using --prompt.");
    }
    if (!scenario) {
      throw new Error("llm-plan requires AK_LLM_LIVE=1 when --scenario is omitted.");
    }
    const summaryPath = resolveScenarioAssetPath(scenario.summaryPath, scenarioBaseDir);
    if (!summaryPath) {
      throw new Error("llm-plan requires scenario.summaryPath when AK_LLM_LIVE is off.");
    }
    const summaryFixture = await readJson(summaryPath);
    const normalized = normalizeSummary(summaryFixture);
    if (!normalized.ok) {
      throw new Error(`llm-plan summary fixture invalid: ${normalized.errors.map((err) => err.code).join(", ")}`);
    }
    summary = normalized.value;
  }

  let summaryForSpec = summary;
  if (!scenario) {
    summaryForSpec = { ...summary };
    if (isNonEmptyString(goal)) {
      summaryForSpec.goal = goal;
    }
    if (Number.isFinite(resolvedBudgetTokens) && summaryForSpec.budgetTokens === undefined) {
      summaryForSpec.budgetTokens = resolvedBudgetTokens;
    }
  }

  const buildSpecResult = buildBuildSpecFromSummary({
    summary: summaryForSpec,
    catalog,
    selections: mappedSelections || undefined,
    runId,
    createdAt,
    source: "cli-llm-plan",
  });
  if (!buildSpecResult.ok) {
    throw new Error(`llm-plan build spec failed: ${buildSpecResult.errors.join("\n")}`);
  }

  const capturedInputsForBuild = captures.length > 0 ? captures : capture ? [capture] : undefined;
  const buildResult = await orchestrateBuild({
    spec: buildSpecResult.spec,
    producedBy: "cli-llm-plan",
    capturedInputs: capturedInputsForBuild,
  });

  await writeJson(join(outDir, "spec.json"), buildResult.spec);
  await writeJson(join(outDir, "intent.json"), buildResult.intent);
  await writeJson(join(outDir, "plan.json"), buildResult.plan);

  if (buildResult.budget?.budget) {
    await writeJson(join(outDir, "budget.json"), buildResult.budget.budget);
  }
  if (buildResult.budget?.priceList) {
    await writeJson(join(outDir, "price-list.json"), buildResult.budget.priceList);
  }
  if (buildResult.budgetReceipt) {
    await writeJson(join(outDir, "budget-receipt.json"), buildResult.budgetReceipt);
  }
  if (budgetAllocation) {
    await writeJson(join(outDir, "budget-allocation.json"), budgetAllocation);
  }
  if (buildResult.solverRequest) {
    await writeJson(join(outDir, "solver-request.json"), buildResult.solverRequest);
  }
  if (buildResult.solverResult) {
    await writeJson(join(outDir, "solver-result.json"), buildResult.solverResult);
  }
  if (buildResult.simConfig) {
    await writeJson(join(outDir, "sim-config.json"), buildResult.simConfig);
  }
  if (buildResult.initialState) {
    await writeJson(join(outDir, "initial-state.json"), buildResult.initialState);
  }

  const capturedInputs = Array.isArray(buildResult.capturedInputs) ? buildResult.capturedInputs : [];
  for (let i = 0; i < capturedInputs.length; i += 1) {
    const artifact = capturedInputs[i];
    const capturePath = buildCapturedInputPath("llm", i, artifact?.meta?.id);
    await writeJson(join(outDir, capturePath), artifact);
  }

  const bundleArtifacts = [];
  if (buildResult.intent) bundleArtifacts.push(buildResult.intent);
  if (buildResult.plan) bundleArtifacts.push(buildResult.plan);
  if (buildResult.budget?.budget) bundleArtifacts.push(buildResult.budget.budget);
  if (buildResult.budget?.priceList) bundleArtifacts.push(buildResult.budget.priceList);
  if (buildResult.budgetReceipt) bundleArtifacts.push(buildResult.budgetReceipt);
  if (budgetAllocation) bundleArtifacts.push(budgetAllocation);
  if (buildResult.solverRequest) bundleArtifacts.push(buildResult.solverRequest);
  if (buildResult.solverResult) bundleArtifacts.push(buildResult.solverResult);
  if (buildResult.simConfig) bundleArtifacts.push(buildResult.simConfig);
  if (buildResult.initialState) bundleArtifacts.push(buildResult.initialState);
  capturedInputs.forEach((artifact) => bundleArtifacts.push(artifact));

  bundleArtifacts.sort((a, b) => {
    if (a.schema === b.schema) {
      return a.meta.id.localeCompare(b.meta.id);
    }
    return a.schema.localeCompare(b.schema);
  });

  const manifestEntries = [];
  addManifestEntry(manifestEntries, buildResult.intent, "intent.json");
  addManifestEntry(manifestEntries, buildResult.plan, "plan.json");
  addManifestEntry(manifestEntries, buildResult.budget?.budget, "budget.json");
  addManifestEntry(manifestEntries, buildResult.budget?.priceList, "price-list.json");
  addManifestEntry(manifestEntries, buildResult.budgetReceipt, "budget-receipt.json");
  addManifestEntry(manifestEntries, budgetAllocation, "budget-allocation.json");
  addManifestEntry(manifestEntries, buildResult.solverRequest, "solver-request.json");
  addManifestEntry(manifestEntries, buildResult.solverResult, "solver-result.json");
  addManifestEntry(manifestEntries, buildResult.simConfig, "sim-config.json");
  addManifestEntry(manifestEntries, buildResult.initialState, "initial-state.json");
  capturedInputs.forEach((artifact, index) => {
    const capturePath = buildCapturedInputPath("llm", index, artifact?.meta?.id);
    addManifestEntry(manifestEntries, artifact, capturePath);
  });

  manifestEntries.sort((a, b) => {
    if (a.schema === b.schema) {
      return a.id.localeCompare(b.id);
    }
    return a.schema.localeCompare(b.schema);
  });

  const schemaEntries = filterSchemaCatalogEntries({
    schemaRefs: [
      { schema: buildResult.spec.schema, schemaVersion: buildResult.spec.schemaVersion },
      ...manifestEntries,
    ],
  });

  const bundle = {
    spec: buildResult.spec,
    schemas: schemaEntries,
    artifacts: bundleArtifacts,
  };
  await writeJson(join(outDir, "bundle.json"), bundle);

  const manifest = {
    specPath: "spec.json",
    correlation: {
      runId: buildResult.spec.meta.runId,
      source: buildResult.spec.meta.source,
      correlationId: buildResult.spec.meta.correlationId,
    },
    schemas: schemaEntries,
    artifacts: manifestEntries,
  };
  if (!manifest.correlation.correlationId) {
    delete manifest.correlation.correlationId;
  }
  await writeJson(join(outDir, "manifest.json"), manifest);

  const telemetry = buildBuildTelemetryRecord({
    spec: buildResult.spec,
    status: "success",
    artifactRefs: buildArtifactRefs(manifestEntries),
    producedBy: "cli-llm-plan",
    clock: () => buildResult.spec.meta.createdAt,
    data: loopTrace ? {
      llm: {
        budgetLoop: true,
        trace: loopTrace,
        budgetAllocation: budgetAllocation
          ? {
            pools: budgetAllocation.pools,
            weights: budgetPoolWeights || undefined,
            policy: budgetPoolPolicy || budgetAllocation.policy,
            totals: budgetPoolBudgets || undefined,
          }
          : undefined,
      },
    } : undefined,
  });
  await writeJson(join(outDir, "telemetry.json"), telemetry);

  console.log(`llm-plan: wrote ${outDir}`);
}

const COMMANDS = {
  build: buildCommand,
  schemas: schemasCommand,
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
  "llm-plan": llmPlanCommand,
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

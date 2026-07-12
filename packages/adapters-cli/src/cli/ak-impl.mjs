import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createIpfsAdapter } from "../adapters/ipfs/index.js";
import { createBlockchainAdapter } from "../adapters/blockchain/index.js";
import { createLlmAdapter } from "../adapters/llm/index.js";
import {
  buildBuildArtifacts,
  buildBuildManifestEntries,
  collectBuildOutputArtifactRecords,
  createCommandKernel,
} from "../../../runtime/src/commands/kernel.js";
import { orchestrateBuild } from "../../../runtime/src/build/orchestrate-build.js";
import { summarizeMixedRoomAssemblies, formatMixedRoomAssembliesCliLines } from "../../../runtime/src/build/mixed-room-summary.js";
import { buildBuildTelemetryRecord } from "../../../runtime/src/build/telemetry.js";
import { createSchemaCatalog, filterSchemaCatalogEntries } from "../../../runtime/src/contracts/schema-catalog.js";
import { buildBuildSpecFromSummary } from "../../../runtime/src/personas/director/buildspec-assembler.js";
import { mapSummaryToPool } from "../../../runtime/src/personas/director/pool-mapper.js";
import { ROOM_CARD_SIZE_IDS } from "../../../runtime/src/personas/configurator/card-model.js";
import {
  calculateActorConfigurationUnitCost,
  calculateRoomCardUnitCost,
} from "../../../runtime/src/personas/configurator/spend-proposal.js";
import { validateAffinityPrereqs } from "../../../runtime/src/personas/configurator/cost-model.js";
import { buildPriceMap } from "../../../runtime/src/personas/allocator/validate-spend.js";
import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_DELVER_SETUP_MODES,
  ALLOWED_MOTIVATIONS,
  deriveAllowedOptionsFromCatalog,
  normalizeSummary,
} from "../../../runtime/src/personas/orchestrator/prompt-contract.js";
import { runLlmSession } from "../../../runtime/src/personas/orchestrator/llm-session.js";
import { runLlmBudgetLoop } from "../../../runtime/src/personas/orchestrator/llm-budget-loop.js";
import {
  applyActorOverrides,
  applyTileOverrides,
  normalizeArgList,
  resolveVitalDefaults,
  summarizeFrame,
} from "../../../runtime/src/commands/run-helpers.js";
import {
  resolveRunDir as resolveTickRunDir,
  readMaxTick,
  readCursor,
  writeCursor,
  renderAscii,
  readTickFrame,
  buildVisualizationSnapshot,
  validateVisualizationMode,
} from "../tick-session.mjs";
import { validateBuildSpec } from "../../../runtime/src/contracts/build-spec.js";
import { SANDBOX_SESSION_SCHEMA } from "../../../runtime/src/contracts/sandbox-session.mjs";
import { executeSandboxPlace, executeSandboxMove } from "../mcp/tools/sandbox.mjs";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_ROOM_AFFINITY_EXPRESSION,
  DEFAULT_ROOM_CARD_AFFINITY,
  DEFAULT_VITALS,
  LLM_REPAIR_TEXT,
  HAZARD_VITAL_KEYS,
  VITAL_KEYS,
  appendLlmPromptSuffix,
  buildLlmActorConfigPromptTemplate,
  buildLlmCatalogRepairPromptTemplate,
  buildLlmConstraintSection,
  buildLlmRepairPromptTemplate,
} from "../../../runtime/src/contracts/domain-constants.js";

const SCHEMAS = Object.freeze({
  intent: "agent-kernel/IntentEnvelope",
  plan: "agent-kernel/PlanArtifact",
  budgetReceipt: "agent-kernel/BudgetReceiptArtifact",
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
  narrative: "agent-kernel/NarrativeArtifact",
  agentCommandRequest: "agent-kernel/AgentCommandRequestArtifact",
  affinityPreset: "agent-kernel/AffinityPresetArtifact",
  actorLoadout: "agent-kernel/ActorLoadoutArtifact",
  affinitySummary: "agent-kernel/AffinitySummary",
  capturedInput: "agent-kernel/CapturedInputArtifact",
});

const DEFAULT_ARTIFACTS_DIR = "artifacts";
const DEFAULT_RUNS_DIR = "runs";
const DEFAULT_TICKS = 1;
const AUTHORING_GOAL_PRIORITIES = new Set(["low", "medium", "high"]);
const AUTHORING_VALIDATION_OUTCOMES = Object.freeze({
  valid: "valid",
  invalidRequirements: "invalid_requirements",
  conflictingRequirements: "conflicting_requirements",
  insufficientBudget: "insufficient_budget",
});

function usage() {
  const filename = fileURLToPath(new URL("./ak.mjs", import.meta.url));
  const base = resolve(dirname(filename), "../../../..");
  const rel = base && filename.startsWith(base)
    ? filename.slice(base.length + 1)
    : filename;
  return `Usage:
  node ${rel} build --spec path [--out-dir dir] [--emit-intermediates]
  node ${rel} schemas [--out-dir dir]
  node ${rel} solve --scenario "..." [--out-dir dir] [--run-id id] [--plan path] [--intent path] [--options path]
  node ${rel} run (--sim-config path --initial-state path | --from-run runId) [--execution-policy path] [--ticks N] [--seed N] [--out-dir dir] [--run-id id] [--actor spec] [--vital spec] [--vital-default spec] [--tile-wall xy] [--tile-barrier xy] [--tile-floor xy] [--actions path] [--affinity-presets path] [--affinity-loadouts path] [--affinity-summary path] [--progress] [--dry-run]
  node ${rel} configurator --level-gen path --actors path [--plan path] [--budget-receipt path] [--budget path --price-list path --receipt-out path] [--affinity-presets path] [--affinity-loadouts path] [--out-dir dir] [--run-id id]
  node ${rel} budget --budget path [--price-list path] [--receipt path] [--out-dir dir] [--out path] [--receipt-out path]
  node ${rel} replay --sim-config path --initial-state path --tick-frames path [--execution-policy path] [--ticks N] [--seed N] [--out-dir dir]
  node ${rel} inspect --tick-frames path [--effects-log path] [--out-dir dir]
  node ${rel} narrate --tick-frames path --initial-state path [--out-dir dir]
  node ${rel} ipfs --cid cid [--path path] [--gateway url] [--json] [--fixture path] [--out path] [--out-dir dir]
  node ${rel} ipfs-publish --artifact-map path [--path root] [--gateway url] [--fixture-cid cid] [--out path] [--out-dir dir]
  node ${rel} ipfs-load --cid cid [--path root] [--file name --file name] [--gateway url] [--fixture-map path] [--out path] [--out-dir dir]
  node ${rel} blockchain --rpc-url url [--address addr] [--fixture-chain-id path] [--fixture-balance path] [--out path] [--out-dir dir]
  node ${rel} blockchain-mint --rpc-url url --card path [--owner addr] [--contract addr] [--token-id id] [--fixture-chain-id path] [--fixture-mint path] [--out path] [--out-dir dir]
  node ${rel} blockchain-load --rpc-url url --token-id id [--owner addr] [--contract addr] [--fixture-chain-id path] [--fixture-load path] [--out path] [--out-dir dir]
  node ${rel} llm [--model model] --prompt text [--base-url url] [--fixture path] [--out path] [--out-dir dir]
  node ${rel} llm-plan [--scenario path | (--text text | --prompt text) --catalog path] [--model model] [--goal text] [--budget-tokens N] [--base-url url] [--fixture path] [--budget-loop] [--budget-pool id=weight --budget-reserve N] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} scenario (--text text --catalog path [--model model] [--goal text] [--budget-tokens N] [--base-url url] [--fixture path] [--budget-loop] [--budget-pool id=weight --budget-reserve N] [--created-at iso] [--emit-intermediates] | --from-run runId) [--ticks N] [--seed N] [--out-dir dir] [--run-id id] [--dry-run]
  node ${rel} show --run-id id
  node ${rel} diff --run-a id --run-b id
  node ${rel} create [--text text] [--room "..."] [--floor-tile "..."] [--hazard "..."] [--resource "..."] [--delver "..."] [--warden "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--dungeon-budget-tokens N] [--delver-budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates] [--dry-run]
  node ${rel} configure [--text text] [--room "..."] [--floor-tile "..."] [--hazard "..."] [--resource "..."] [--delver "..."] [--warden "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--dungeon-budget-tokens N] [--delver-budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} room-plan --room "size=small;count=2" [--room "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} hazard-plan --hazard "affinity=fire;expression=emit;proximityRadius=2[;mana=one-time:<amount>|regen:<current>:<max>:<regen>]" [--hazard "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} resource-plan --resource "permanenceMode=<consumable|level|permanent>;vital=<health|mana|stamina>;delta=<n>" [--resource "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} delver-plan --delver "count=2;affinity=fire;motivation=attacking[;goals=max_mana:high,mana_regen:high]" [--delver "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} warden-plan --warden "count=2;affinity=dark;motivation=defending" [--warden "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} runs list

Options:
  --out-dir       Output directory (default: ./artifacts/runs/<runId>/<command>)
  --out           Output file path (command-specific default when omitted)
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
  --from-run      Resolve sim-config.json and initial-state.json from artifacts/runs/<runId>/*
  --affinity-presets  Affinity preset artifact path (AffinityPresetArtifact)
  --affinity-loadouts Actor loadout artifact path (ActorLoadoutArtifact)
  --affinity-summary  Write affinity summary JSON (default: <out-dir>/affinity-summary.json)
  --level-gen     Level generation input path (Configurator levelGen input)
  --actors        Actors input path (object with actors array)
  --budget-receipt Budget receipt artifact path (BudgetReceiptArtifact)
  --budget        Budget artifact path (BudgetArtifact)
  --price-list    Price list artifact path (PriceList)
  --receipt       Budget receipt artifact path (BudgetReceiptArtifact)
  --receipt-out   Output path for budget receipt JSON
  --spec          Build spec JSON path (build command only)
  --text          Freeform agent authoring text captured in AgentCommandRequestArtifact
  --scenario      Scenario fixture path for llm-plan
  --catalog       Catalog path for text/prompt-only llm-plan runs
  --goal          Goal text override (llm-plan prompt-only)
  --text          Freeform text for llm-plan; when no fixture is provided, CLI falls back to the default stub summary fixture
  --dungeon-affinity Dungeon affinity for plan summary defaults
  --budget-tokens Hard budget cap in tokens. If freeform text also states a budget, they must match.
  --dungeon-budget-tokens Separate hard budget cap for dungeon-side objects (rooms, tiles, placedHazards, hazards).
  --delver-budget-tokens  Separate hard budget cap for delver-side objects (delvers, wardens).
  --emit-intermediates Persist non-canonical sidecar artifacts such as request/intent/plan/solver/captured-input files
  --floor-tile    Floor tile spec for create/configure (repeatable): count=<n>[;id=<id>]
  --hazard        Hazard spec for create/configure/hazard-plan (repeatable): affinity=<kind>;expression=<push|pull|emit|draw>;proximityRadius=<n>[;mana=one-time:<amount>|regen:<current>:<max>:<regen>]
  --resource      Resource artifact spec for create/configure/resource-plan (repeatable): permanenceMode=<consumable|level|permanent>;vital=<health|mana|stamina>;delta=<n>[;id=<id>] or legacy tier=<level|permanent>;stat=<vitalMax|vitalRegen|affinity|affinityStack|pushExpression>;delta=<n>;dropRate=<n>[;id=<id>]
  --hazard          Hazard spec for create/configure (repeatable): x=<n>;y=<n>;affinity=<kind>[;expression=<push|pull|emit|draw>][;stacks=<n>][;blocking=<true|false>][;id=<id>][;vitals=<vital>:<max>:<regen>|<vital>:<current>:<max>:<regen>,...]
  --room          Room spec for room-plan (repeatable): size=<small|medium|large>;count=<n>  (rooms are generic containers; affinity comes from --hazard placement)
                    where <expression> is push|pull (spatial) or emit|draw (field)
  --delver      Delver spec for delver-plan (repeatable): count=<n>;affinity=<kind>;motivation=<kind>[;id=<id>][;affinities=<kind>[:<expression>[:<stacks>]],...][;vitals=<vital>:<max>:<regen>,...|<vital>:<current>:<max>:<regen>,...][;setup-mode=<auto|user|hybrid>][;goals=max_mana[:<priority>],mana_regen[:<priority>]]
                    where <expression> is push|pull (spatial) or emit|draw (field)
  --warden      Warden spec for warden-plan (repeatable): count=<n>;affinity=<kind>;motivation=<kind>[;id=<id>][;affinities=<kind>[:<expression>[:<stacks>]],...][;vitals=<vital>:<max>:<regen>,...|<vital>:<current>:<max>:<regen>,...]
                    where <expression> is push|pull (spatial) or emit|draw (field)
  --prompt        Prompt override (llm-plan)
  --budget-loop   Enable budget loop (layout then actors)
  --budget-pool   Budget pool weight entry (repeatable): id=weight (e.g., player=0.2)
  --budget-reserve Reserve tokens before pooling (llm-plan budget loop)
  --model         LLM model name (default: ${DEFAULT_LLM_MODEL})
  --fixture       Fixture response for adapter commands (no network)
  --artifact-map  Canonical artifact JSON map path for ipfs-publish
  --fixture-cid   Deterministic CID for ipfs-publish fixture mode
  --fixture-map   Fixture JSON map for ipfs-load (keys are artifact paths under CID)
  --card          Card configuration JSON path for blockchain-mint
  --contract      Contract address or alias for blockchain-mint/load
  --token-id      Token identifier for blockchain-mint/load
  --fixture-mint  Fixture JSON-RPC response for blockchain-mint
  --fixture-load  Fixture JSON-RPC response for blockchain-load
  --run-id        Override run id for output artifacts
  --created-at    Override createdAt timestamp (ISO-8601) for llm-plan/room-plan/hazard-plan/resource-plan/delver-plan/warden-plan
  --dry-run       Validate schema/budget inputs without executing run or writing artifacts
  --help          Show this help

Schema discovery:
  schemas output includes ${SCHEMAS.agentCommandRequest} for the canonical
  agent-friendly authoring taxonomy and compilation contract.
`;
}

function parseArgs(argv) {
  const args = { _: [] };
  const repeatable = new Set([
    "actor",
    "delver",
    "warden",
    "vital",
    "vital-default",
    "tile-wall",
    "tile-barrier",
    "tile-floor",
    "budget-pool",
    "room",
    "floor-tile",
    "hazard",
    "hazard",
    "resource",
    "file",
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

function normalizeAuthoringToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function buildOptimizationGoal({ kind, scope, priority = "high", vital, source } = {}) {
  const goal = { kind, scope, priority };
  if (vital) goal.vital = vital;
  if (source) goal.source = source;
  return goal;
}

function parseOptimizationPriority(value, label) {
  const normalized = normalizeAuthoringToken(value);
  if (AUTHORING_GOAL_PRIORITIES.has(normalized)) {
    return normalized;
  }
  throw new Error(`${label} priority must be one of: ${Array.from(AUTHORING_GOAL_PRIORITIES).join(", ")}.`);
}

function parseOptimizationGoalEntry(value, { label, defaultScope, source = "object_flag" } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`${label} goal must be non-empty.`);
  }

  let goalId = raw;
  let priority = "high";
  const segments = raw.split(":").map((part) => part.trim()).filter(Boolean);
  if (segments.length === 2 && AUTHORING_GOAL_PRIORITIES.has(normalizeAuthoringToken(segments[1]))) {
    [goalId] = segments;
    priority = parseOptimizationPriority(segments[1], `${label} goal "${raw}"`);
  } else if (segments.length > 2) {
    throw new Error(`${label} goal "${raw}" is invalid.`);
  }

  const normalized = normalizeAuthoringToken(goalId);
  switch (normalized) {
    case "maximize_budget_spend":
    case "maximize_spend":
    case "max_spend":
    case "full_budget":
      return buildOptimizationGoal({
        kind: "maximize_budget_spend",
        scope: "shared_config",
        priority,
        source,
      });
    case "maximize_vital_max":
    case "max_mana":
    case "mana_max":
    case "high_max_mana":
    case "high_mana_max":
      return buildOptimizationGoal({
        kind: "maximize_vital_max",
        scope: defaultScope,
        priority,
        vital: "mana",
        source,
      });
    case "maximize_vital_regen":
    case "mana_regen":
    case "high_mana_regen":
    case "max_mana_regen":
      return buildOptimizationGoal({
        kind: "maximize_vital_regen",
        scope: defaultScope,
        priority,
        vital: "mana",
        source,
      });
    default:
      throw new Error(`${label} goal "${raw}" is not supported. Use max_mana[:priority], mana_regen[:priority], or maximize_spend[:priority].`);
  }
}

function parseOptimizationGoalList(value, { label, defaultScope, source = "object_flag" } = {}) {
  if (!isNonEmptyString(value)) {
    return [];
  }
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => parseOptimizationGoalEntry(entry, {
      label: `${label}[${index + 1}]`,
      defaultScope,
      source,
    }));
}

function dedupeOptimizationGoals(goals) {
  const deduped = new Map();
  normalizeList(goals)
    .flat()
    .filter(Boolean)
    .forEach((goal) => {
      const key = [goal.kind, goal.scope, goal.vital || "", goal.priority || "high"].join(":");
      const existing = deduped.get(key);
      if (!existing || (!existing.source && goal.source)) {
        deduped.set(key, goal);
      }
    });
  return Array.from(deduped.values());
}

function extractBudgetTokensFromText(text, label = "freeform text") {
  if (!isNonEmptyString(text)) {
    return undefined;
  }
  const matches = [];
  const patterns = [
    /\b(?:total\s+)?budget\s+(?:of\s+)?(\d+)\s+tokens?\b/gi,
    /\b(\d+)\s+tokens?\s+budget\b/gi,
    /\bcap(?:ped)?\s+(?:at|to)\s+(\d+)\s+tokens?\b/gi,
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push(Number.parseInt(match[1], 10));
    }
  });
  const unique = Array.from(new Set(matches));
  if (unique.length > 1) {
    throw new Error(`${label} contains conflicting budget directives: ${unique.join(", ")}.`);
  }
  return unique[0];
}

function textIncludesMaximizeSpend(text) {
  if (!isNonEmptyString(text)) {
    return false;
  }
  const normalized = text.toLowerCase();
  return /\bmaximize\s+(?:valid\s+)?spend\b/.test(normalized)
    || /\bspend as much as possible\b/.test(normalized)
    || /\buse the full budget\b/.test(normalized)
    || /\bmaximize\s+budget\b/.test(normalized);
}

function textMentionsVitalGoals(text) {
  if (!isNonEmptyString(text)) {
    return false;
  }
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  return /\b(?:high|higher|maximi[sz]e)\s+(?:max\s+mana|mana\s+max)\b/.test(normalized)
    || /\b(?:high|higher|maximi[sz]e)\s+mana\s+regen\b/.test(normalized);
}

function extractVitalOptimizationGoalsFromText(text, { scope } = {}) {
  if (!isNonEmptyString(text) || !scope) {
    return [];
  }
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  const goals = [];
  if (/\b(?:high|higher|maximi[sz]e)\s+(?:max\s+mana|mana\s+max)\b/.test(normalized)) {
    goals.push(buildOptimizationGoal({
      kind: "maximize_vital_max",
      scope,
      priority: "high",
      vital: "mana",
      source: "text",
    }));
  }
  if (/\b(?:high|higher|maximi[sz]e)\s+mana\s+regen\b/.test(normalized)) {
    goals.push(buildOptimizationGoal({
      kind: "maximize_vital_regen",
      scope,
      priority: "high",
      vital: "mana",
      source: "text",
    }));
  }
  return dedupeOptimizationGoals(goals);
}

function resolveTextVitalOptimizationGoals({ commandName, text, scope } = {}) {
  if (!textMentionsVitalGoals(text)) {
    return [];
  }
  if (!scope) {
    throw new Error(`${commandName} freeform text mentions vitals goals, but they must target exactly one authored actor kind. Use delver goals=... or keep the request to a single actor kind.`);
  }
  return extractVitalOptimizationGoalsFromText(text, { scope });
}

function resolveAuthoringBudget({
  commandName,
  textBudgetTokens,
  flagBudgetTokens,
  budgetArtifact,
} = {}) {
  const budgetArtifactTokens = Number.isInteger(budgetArtifact?.budget?.tokens)
    ? budgetArtifact.budget.tokens
    : undefined;
  const inputs = [];
  if (Number.isInteger(textBudgetTokens)) inputs.push({ source: "text", totalTokens: textBudgetTokens });
  if (Number.isInteger(flagBudgetTokens)) inputs.push({ source: "flag", totalTokens: flagBudgetTokens });
  if (Number.isInteger(budgetArtifactTokens)) inputs.push({ source: "budget_artifact", totalTokens: budgetArtifactTokens });

  const distinct = Array.from(new Set(inputs.map((entry) => entry.totalTokens)));
  if (distinct.length > 1) {
    const detail = inputs.map((entry) => `${entry.source}=${entry.totalTokens}`).join(", ");
    throw new Error(`${commandName} hard budget inputs disagree: ${detail}. Freeform text, --budget-tokens, and budget artifact tokens must agree.`);
  }

  if (inputs.length === 0) {
    return { resolvedBudgetTokens: undefined, constraints: undefined };
  }

  return {
    resolvedBudgetTokens: inputs[0].totalTokens,
    constraints: {
      hardBudget: {
        totalTokens: inputs[0].totalTokens,
        sources: Array.from(new Set(inputs.map((entry) => entry.source))),
      },
    },
  };
}

function buildSharedOptimizationGoals({ text, hardBudgetConstraint } = {}) {
  if (!textIncludesMaximizeSpend(text)) {
    return [];
  }
  return dedupeOptimizationGoals([
    buildOptimizationGoal({
      kind: "maximize_budget_spend",
      scope: "shared_config",
      priority: "high",
      source: "text",
    }),
  ]);
}

function buildAuthoringSection({
  objectKinds,
  request,
  constraints,
  sharedOptimizationGoals = [],
  objectOptimizationGoals = [],
} = {}) {
  const normalizedKinds = Array.from(new Set(normalizeList(objectKinds).filter(Boolean)));
  const aggregatedGoals = dedupeOptimizationGoals([
    ...sharedOptimizationGoals,
    ...objectOptimizationGoals,
  ]);
  if ((constraints || sharedOptimizationGoals.length > 0) && !normalizedKinds.includes("shared_config")) {
    normalizedKinds.push("shared_config");
  }

  if (!request && !constraints && aggregatedGoals.length === 0) {
    return undefined;
  }

  const authoring = {
    objectKinds: normalizedKinds,
  };
  if (request) {
    authoring.request = request;
  }
  if (constraints) {
    authoring.constraints = constraints;
  }
  if (aggregatedGoals.length > 0) {
    authoring.optimizationGoals = aggregatedGoals;
  }
  return authoring;
}

function applyAuthoringSection(spec, authoring, commandName) {
  if (!authoring) {
    return;
  }
  spec.authoring = authoring;
  const validation = validateBuildSpec(spec);
  if (!validation.ok) {
    throw new Error(`${commandName} build spec failed: ${validation.errors.join("; ")}`);
  }
}

function parsePositiveIntStrict(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeIntStrict(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function parseActorAffinityTuple(value, actorType, actorIndex, affinityIndex) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`${actorType}[${actorIndex}] affinity[${affinityIndex}] is empty.`);
  }
  const parts = raw.split(":").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > 3) {
    throw new Error(`${actorType}[${actorIndex}] affinity[${affinityIndex}] must be kind[:expression[:stacks]].`);
  }

  const kind = parts[0].toLowerCase();
  if (!ALLOWED_AFFINITIES.includes(kind)) {
    throw new Error(`${actorType}[${actorIndex}] affinity[${affinityIndex}] has invalid affinity kind "${parts[0]}".`);
  }

  const expression = (parts[1] || "emit").toLowerCase();
  if (!ALLOWED_AFFINITY_EXPRESSIONS.includes(expression)) {
    throw new Error(`${actorType}[${actorIndex}] affinity[${affinityIndex}] has invalid affinity expression "${parts[1]}".`);
  }

  const stacks = parts[2] === undefined
    ? 1
    : parsePositiveIntStrict(parts[2], `${actorType}[${actorIndex}] affinity[${affinityIndex}] stacks`);

  return { kind, expression, stacks };
}

function parseActorAffinities(value, actorType, actorIndex) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const entries = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return null;
  }
  const merged = new Map();
  entries.forEach((entry, index) => {
    const tuple = parseActorAffinityTuple(entry, actorType, actorIndex, index + 1);
    const key = `${tuple.kind}:${tuple.expression}`;
    const existing = merged.get(key);
    if (existing) {
      existing.stacks += tuple.stacks;
      return;
    }
    merged.set(key, { ...tuple });
  });
  return Array.from(merged.values());
}

function parseActorVitals(value, actorType, actorIndex) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const entries = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return null;
  }
  const vitals = {};
  entries.forEach((entry, index) => {
    const parts = entry.split(":").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) {
      throw new Error(`${actorType}[${actorIndex}] vital[${index + 1}] must be vital:max:regen or vital:current:max:regen.`);
    }
    const vital = String(parts[0] || "").toLowerCase();
    if (!VITAL_KEYS.includes(vital)) {
      throw new Error(`${actorType}[${actorIndex}] vital[${index + 1}] has invalid vital kind "${parts[0]}".`);
    }

    let current;
    let max;
    let regen;
    if (parts.length === 3) {
      max = parseNonNegativeIntStrict(parts[1], `${actorType}[${actorIndex}] vital[${index + 1}] max`);
      regen = parseNonNegativeIntStrict(parts[2], `${actorType}[${actorIndex}] vital[${index + 1}] regen`);
      current = max;
    } else {
      current = parseNonNegativeIntStrict(parts[1], `${actorType}[${actorIndex}] vital[${index + 1}] current`);
      max = parseNonNegativeIntStrict(parts[2], `${actorType}[${actorIndex}] vital[${index + 1}] max`);
      regen = parseNonNegativeIntStrict(parts[3], `${actorType}[${actorIndex}] vital[${index + 1}] regen`);
    }
    if (current > max) {
      throw new Error(`${actorType}[${actorIndex}] vital[${index + 1}] current cannot exceed max.`);
    }
    vitals[vital] = { current, max, regen };
  });
  return vitals;
}

function parseRoomSpec(value, roomIndex) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`room[${roomIndex}] requires a non-empty spec.`);
  }

  const allowedFields = new Set(["size", "count"]);
  const fields = new Map();
  const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`room[${roomIndex}] requires at least one field.`);
  }

  segments.forEach((segment) => {
    if (!segment.includes("=")) {
      const shorthand = segment.toLowerCase();
      if (!ROOM_CARD_SIZE_IDS.includes(shorthand)) {
        throw new Error(`room[${roomIndex}] segment "${segment}" is invalid; expected key=value.`);
      }
      fields.set("size", shorthand);
      return;
    }

    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator).trim().toLowerCase();
    const fieldValue = segment.slice(separator + 1).trim();
    if (key === "affinity" || key === "affinities") {
      throw new Error(`room[${roomIndex}] field "${key}" is not supported — rooms are generic containers; use --hazard to place affinity in a room.`);
    }
    if (!allowedFields.has(key)) {
      throw new Error(`room[${roomIndex}] field "${key}" is not supported.`);
    }
    if (!fieldValue) {
      throw new Error(`room[${roomIndex}] field "${key}" requires a value.`);
    }
    fields.set(key, fieldValue);
  });

  const size = String(fields.get("size") || "medium").trim().toLowerCase();
  if (!ROOM_CARD_SIZE_IDS.includes(size)) {
    throw new Error(`room[${roomIndex}] size must be one of: ${ROOM_CARD_SIZE_IDS.join(", ")}.`);
  }
  const count = fields.has("count")
    ? parsePositiveIntStrict(fields.get("count"), `room[${roomIndex}] count`)
    : 1;

  return {
    value: { size, count },
    sizeFlexible: !fields.has("size"),
  };
}

function parseRoomSpecs(rawRooms) {
  const values = normalizeList(rawRooms)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error("room-plan requires at least one --room entry.");
  }
  return values.map((value, index) => parseRoomSpec(value, index + 1));
}

function parseFloorTileSpec(value, floorTileIndex) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`floor-tile[${floorTileIndex}] requires a non-empty spec.`);
  }

  const allowedFields = new Set(["id", "count", "tiles", "walkable-target"]);
  const fields = new Map();
  const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`floor-tile[${floorTileIndex}] requires at least one field.`);
  }

  segments.forEach((segment) => {
    if (!segment.includes("=")) {
      throw new Error(`floor-tile[${floorTileIndex}] segment "${segment}" is invalid; expected key=value.`);
    }
    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator).trim().toLowerCase();
    const fieldValue = segment.slice(separator + 1).trim();
    if (!allowedFields.has(key)) {
      throw new Error(`floor-tile[${floorTileIndex}] field "${key}" is not supported.`);
    }
    if (!fieldValue) {
      throw new Error(`floor-tile[${floorTileIndex}] field "${key}" requires a value.`);
    }
    fields.set(key, fieldValue);
  });

  const countValue = fields.get("count") || fields.get("tiles") || fields.get("walkable-target");
  if (!countValue) {
    throw new Error(`floor-tile[${floorTileIndex}] requires count=<n>.`);
  }

  return {
    id: isNonEmptyString(fields.get("id"))
      ? String(fields.get("id")).trim()
      : `floor_tile_${floorTileIndex}`,
    count: parsePositiveIntStrict(countValue, `floor-tile[${floorTileIndex}] count`),
  };
}

function parseFloorTileSpecs(rawFloorTiles) {
  const values = normalizeList(rawFloorTiles)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    return [];
  }
  return values.map((value, index) => parseFloorTileSpec(value, index + 1));
}

function parsePlacedHazardVitals(value, hazardIndex) {
  if (!isNonEmptyString(value)) {
    return undefined;
  }
  const entries = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return undefined;
  }

  const vitals = {};
  entries.forEach((entry, index) => {
    const parts = entry.split(":").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) {
      throw new Error(`hazard[${hazardIndex}] vital[${index + 1}] must be vital:max:regen or vital:current:max:regen.`);
    }
    const vital = String(parts[0] || "").toLowerCase();
    if (!HAZARD_VITAL_KEYS.includes(vital)) {
      throw new Error(`hazard[${hazardIndex}] vital[${index + 1}] has invalid vital kind "${parts[0]}".`);
    }

    let current;
    let max;
    let regen;
    if (parts.length === 3) {
      max = parseNonNegativeIntStrict(parts[1], `hazard[${hazardIndex}] vital[${index + 1}] max`);
      regen = parseNonNegativeIntStrict(parts[2], `hazard[${hazardIndex}] vital[${index + 1}] regen`);
      current = max;
    } else {
      current = parseNonNegativeIntStrict(parts[1], `hazard[${hazardIndex}] vital[${index + 1}] current`);
      max = parseNonNegativeIntStrict(parts[2], `hazard[${hazardIndex}] vital[${index + 1}] max`);
      regen = parseNonNegativeIntStrict(parts[3], `hazard[${hazardIndex}] vital[${index + 1}] regen`);
    }
    if (current > max) {
      throw new Error(`hazard[${hazardIndex}] vital[${index + 1}] current cannot exceed max.`);
    }
    vitals[vital] = { current, max, regen };
  });

  return vitals;
}

function parseBooleanStrict(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${label} must be true or false.`);
}

function parsePlacedHazardSpec(value, hazardIndex) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`hazard[${hazardIndex}] requires a non-empty spec.`);
  }

  const allowedFields = new Set(["id", "x", "y", "affinity", "expression", "stacks", "blocking", "vitals"]);
  const fields = new Map();
  const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`hazard[${hazardIndex}] requires at least one field.`);
  }

  segments.forEach((segment) => {
    if (!segment.includes("=")) {
      throw new Error(`hazard[${hazardIndex}] segment "${segment}" is invalid; expected key=value.`);
    }
    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator).trim().toLowerCase();
    const fieldValue = segment.slice(separator + 1).trim();
    if (!allowedFields.has(key)) {
      throw new Error(`hazard[${hazardIndex}] field "${key}" is not supported.`);
    }
    if (!fieldValue) {
      throw new Error(`hazard[${hazardIndex}] field "${key}" requires a value.`);
    }
    fields.set(key, fieldValue);
  });

  const affinity = String(fields.get("affinity") || "").trim().toLowerCase();
  if (!ALLOWED_AFFINITIES.includes(affinity)) {
    throw new Error(`hazard[${hazardIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }
  const expression = String(fields.get("expression") || "emit").trim().toLowerCase();
  if (!ALLOWED_AFFINITY_EXPRESSIONS.includes(expression)) {
    throw new Error(`hazard[${hazardIndex}] expression must be one of: ${ALLOWED_AFFINITY_EXPRESSIONS.join(", ")}.`);
  }

  return {
    id: isNonEmptyString(fields.get("id"))
      ? String(fields.get("id")).trim()
      : `hazard_${hazardIndex}`,
    x: parseNonNegativeIntStrict(fields.get("x"), `hazard[${hazardIndex}] x`),
    y: parseNonNegativeIntStrict(fields.get("y"), `hazard[${hazardIndex}] y`),
    blocking: fields.has("blocking")
      ? parseBooleanStrict(fields.get("blocking"), `hazard[${hazardIndex}] blocking`)
      : false,
    affinity: {
      kind: affinity,
      expression,
      stacks: fields.has("stacks")
        ? parsePositiveIntStrict(fields.get("stacks"), `hazard[${hazardIndex}] stacks`)
        : 1,
      targetType: "floor",
    },
    vitals: parsePlacedHazardVitals(fields.get("vitals"), hazardIndex),
  };
}

function parsePlacedHazardSpecs(rawHazards) {
  const values = normalizeList(rawHazards)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    return [];
  }
  return values.map((value, index) => parsePlacedHazardSpec(value, index + 1));
}

function parseHazardVitalSpec(value, field, hazardIndex) {
  if (!value) {
    return { kind: "one-time", amount: 0 };
  }
  const parts = value.split(":").map((s) => s.trim());
  if (parts[0] === "one-time" && parts.length === 2) {
    const amount = parseNonNegativeIntStrict(parts[1], `hazard[${hazardIndex}] ${field} amount`);
    return { kind: "one-time", amount };
  }
  if (parts[0] === "regen" && parts.length === 4) {
    const current = parseNonNegativeIntStrict(parts[1], `hazard[${hazardIndex}] ${field} current`);
    const max = parseNonNegativeIntStrict(parts[2], `hazard[${hazardIndex}] ${field} max`);
    const regen = parseNonNegativeIntStrict(parts[3], `hazard[${hazardIndex}] ${field} regen`);
    if (current > max) {
      throw new Error(`hazard[${hazardIndex}] ${field} current cannot exceed max.`);
    }
    return { kind: "regen", current, max, regen };
  }
  throw new Error(`hazard[${hazardIndex}] ${field} must be one-time:<amount> or regen:<current>:<max>:<regen>.`);
}

function placementVitalToHazardVital(vital) {
  if (!vital || typeof vital !== "object") {
    return undefined;
  }
  const current = Number.isFinite(vital.current) ? vital.current : 0;
  const max = Number.isFinite(vital.max) ? vital.max : current;
  const regen = Number.isFinite(vital.regen) ? vital.regen : 0;
  return { kind: "regen", current, max, regen };
}

function buildCanonicalHazard({
  id,
  affinity,
  expression,
  stacks = 1,
  proximityRadius = 0,
  mana,
  durability,
  x,
  y,
  blocking,
} = {}) {
  const resolvedStacks = Number.isInteger(stacks) && stacks > 0 ? stacks : 1;
  return {
    id,
    affinity,
    expression,
    proximityRadius,
    affinityStacks: [{
      kind: affinity,
      expression,
      stacks: resolvedStacks,
      targetType: "floor",
    }],
    vitals: {
      mana: mana || { kind: "one-time", amount: 0 },
      durability: durability || { kind: "one-time", amount: 1 },
    },
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(blocking !== undefined ? { blocking: blocking === true } : {}),
    _schemaVersion: 3,
  };
}

function canonicalizePlacedHazard(hazard, hazardIndex) {
  const affinity = hazard?.affinity || {};
  const id = isNonEmptyString(hazard?.id) ? hazard.id : `hazard_${hazardIndex}`;
  return buildCanonicalHazard({
    id,
    affinity: affinity.kind,
    expression: affinity.expression || "emit",
    stacks: affinity.stacks,
    proximityRadius: 0,
    mana: placementVitalToHazardVital(hazard?.vitals?.mana),
    durability: placementVitalToHazardVital(hazard?.vitals?.durability),
    x: hazard?.x,
    y: hazard?.y,
    blocking: hazard?.blocking,
  });
}

function parseHazardSpec(value, hazardIndex) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`hazard[${hazardIndex}] requires a non-empty spec.`);
  }
  const allowedFields = new Set(["id", "affinity", "expression", "stacks", "proximityRadius", "mana", "durability"]);
  const fields = new Map();
  const segments = raw.split(";").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`hazard[${hazardIndex}] requires at least one field.`);
  }
  segments.forEach((segment) => {
    if (!segment.includes("=")) {
      throw new Error(`hazard[${hazardIndex}] segment "${segment}" is invalid; expected key=value.`);
    }
    const eqIdx = segment.indexOf("=");
    const key = segment.slice(0, eqIdx).trim();
    const val = segment.slice(eqIdx + 1).trim();
    if (!allowedFields.has(key)) {
      throw new Error(`hazard[${hazardIndex}] field "${key}" is not supported.`);
    }
    if (!val) {
      throw new Error(`hazard[${hazardIndex}] field "${key}" requires a value.`);
    }
    fields.set(key, val);
  });
  if (!fields.has("affinity") || !ALLOWED_AFFINITIES.includes(fields.get("affinity"))) {
    throw new Error(`hazard[${hazardIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }
  if (!fields.has("expression") || !ALLOWED_AFFINITY_EXPRESSIONS.includes(fields.get("expression"))) {
    throw new Error(`hazard[${hazardIndex}] expression must be one of: ${ALLOWED_AFFINITY_EXPRESSIONS.join(", ")}.`);
  }
  if (!fields.has("proximityRadius")) {
    throw new Error(`hazard[${hazardIndex}] proximityRadius is required.`);
  }
  const affinity = fields.get("affinity");
  const expression = fields.get("expression");
  const stacks = fields.has("stacks")
    ? parsePositiveIntStrict(fields.get("stacks"), `hazard[${hazardIndex}] stacks`)
    : 1;
  return buildCanonicalHazard({
    id: fields.has("id") ? fields.get("id") : `hazard_${hazardIndex}`,
    affinity,
    expression,
    stacks,
    proximityRadius: parseNonNegativeIntStrict(fields.get("proximityRadius"), `hazard[${hazardIndex}] proximityRadius`),
    mana: parseHazardVitalSpec(fields.get("mana"), "mana", hazardIndex),
    durability: fields.has("durability")
      ? parseHazardVitalSpec(fields.get("durability"), "durability", hazardIndex)
      : undefined,
  });
}

function parseHazardSpecs(rawHazards) {
  const values = normalizeList(rawHazards)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error("hazard-plan requires at least one --hazard entry.");
  }
  return values.map((value, index) => ({
    prompt: value,
    value: parseHazardSpec(value, index + 1),
  }));
}

function parseAuthoringHazardSpec(value, hazardIndex) {
  const raw = String(value || "").trim();
  const hasPlacementFields = /(?:^|;)\s*(?:x|y|blocking|vitals)\s*=/i.test(raw);
  return hasPlacementFields
    ? canonicalizePlacedHazard(parsePlacedHazardSpec(raw, hazardIndex), hazardIndex)
    : parseHazardSpec(raw, hazardIndex);
}

const RESOURCE_ALLOWED_TIERS = new Set(["level", "permanent"]);
const RESOURCE_ALLOWED_STATS = new Set([
  "vitalMax", "vitalRegen", "affinity", "affinityStack", "pushExpression",
]);
const RESOURCE_ALLOWED_PERMANENCE_MODES = new Set(["consumable", "level", "permanent"]);
const RESOURCE_ALLOWED_VITAL_KEYS = new Set(["health", "mana", "stamina"]);

function parseResourceSpec(value, resourceIndex) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`resource[${resourceIndex}] requires a non-empty spec.`);
  }
  const fields = new Map();
  const segments = raw.split(";").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`resource[${resourceIndex}] requires at least one field.`);
  }

  // Detect schema version from first key seen
  const isV3 = segments.some((seg) => {
    const key = seg.split("=")[0].trim();
    return key === "permanenceMode" || key === "vital";
  });

  if (isV3) {
    // V3: permanenceMode + vital + delta
    const allowedFields = new Set(["id", "permanenceMode", "vital", "delta"]);
    segments.forEach((segment) => {
      if (!segment.includes("=")) {
        throw new Error(`resource[${resourceIndex}] segment "${segment}" is invalid; expected key=value.`);
      }
      const eqIdx = segment.indexOf("=");
      const key = segment.slice(0, eqIdx).trim();
      const val = segment.slice(eqIdx + 1).trim();
      if (!allowedFields.has(key)) {
        throw new Error(`resource[${resourceIndex}] field "${key}" is not supported in V3 spec.`);
      }
      if (!val) {
        throw new Error(`resource[${resourceIndex}] field "${key}" requires a value.`);
      }
      fields.set(key, val);
    });
    const permanenceMode = fields.get("permanenceMode");
    if (!RESOURCE_ALLOWED_PERMANENCE_MODES.has(permanenceMode)) {
      throw new Error(`resource[${resourceIndex}] permanenceMode must be one of: ${[...RESOURCE_ALLOWED_PERMANENCE_MODES].join(", ")}.`);
    }
    const vitalKey = fields.get("vital");
    if (!vitalKey || !RESOURCE_ALLOWED_VITAL_KEYS.has(vitalKey)) {
      throw new Error(`resource[${resourceIndex}] vital must be one of: ${[...RESOURCE_ALLOWED_VITAL_KEYS].join(", ")}.`);
    }
    if (!fields.has("delta")) {
      throw new Error(`resource[${resourceIndex}] delta is required.`);
    }
    const delta = Number(fields.get("delta"));
    if (!Number.isFinite(delta)) {
      throw new Error(`resource[${resourceIndex}] delta must be a number.`);
    }
    return {
      id: fields.has("id") ? fields.get("id") : `resource_${resourceIndex}`,
      permanenceMode,
      vitals: [{ key: vitalKey, delta }],
      _schemaVersion: 3,
    };
  }

  // V1 (backward compat): tier + stat + delta + dropRate
  const allowedFields = new Set(["id", "tier", "stat", "delta", "dropRate"]);
  segments.forEach((segment) => {
    if (!segment.includes("=")) {
      throw new Error(`resource[${resourceIndex}] segment "${segment}" is invalid; expected key=value.`);
    }
    const eqIdx = segment.indexOf("=");
    const key = segment.slice(0, eqIdx).trim();
    const val = segment.slice(eqIdx + 1).trim();
    if (!allowedFields.has(key)) {
      throw new Error(`resource[${resourceIndex}] field "${key}" is not supported.`);
    }
    if (!val) {
      throw new Error(`resource[${resourceIndex}] field "${key}" requires a value.`);
    }
    fields.set(key, val);
  });
  if (!fields.has("tier") || !RESOURCE_ALLOWED_TIERS.has(fields.get("tier"))) {
    throw new Error(`resource[${resourceIndex}] tier must be one of: ${[...RESOURCE_ALLOWED_TIERS].join(", ")}.`);
  }
  if (!fields.has("stat") || !RESOURCE_ALLOWED_STATS.has(fields.get("stat"))) {
    throw new Error(`resource[${resourceIndex}] stat must be one of: ${[...RESOURCE_ALLOWED_STATS].join(", ")}.`);
  }
  if (!fields.has("delta")) {
    throw new Error(`resource[${resourceIndex}] delta is required.`);
  }
  if (!fields.has("dropRate")) {
    throw new Error(`resource[${resourceIndex}] dropRate is required.`);
  }
  const delta = Number(fields.get("delta"));
  if (!Number.isFinite(delta)) {
    throw new Error(`resource[${resourceIndex}] delta must be a number.`);
  }
  const dropRate = parseInt(fields.get("dropRate"), 10);
  if (!Number.isInteger(dropRate) || dropRate <= 0) {
    throw new Error(`resource[${resourceIndex}] dropRate must be a positive integer.`);
  }
  return {
    id: fields.has("id") ? fields.get("id") : `resource_${resourceIndex}`,
    tier: fields.get("tier"),
    stat: fields.get("stat"),
    delta,
    dropRate,
    _schemaVersion: 1,
  };
}

function parseResourceSpecs(rawResources) {
  const values = normalizeList(rawResources)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error("resource-plan requires at least one --resource entry.");
  }
  return values.map((value, index) => ({
    prompt: value,
    value: parseResourceSpec(value, index + 1),
  }));
}

function parseDelverSpec(value, delverIndex, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`delver[${delverIndex}] requires a non-empty spec.`);
  }

  const allowedFields = new Set(["id", "count", "affinity", "affinities", "motivation", "vitals", "setup-mode", "setupmode", "goals"]);
  const fields = new Map();
  const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`delver[${delverIndex}] requires at least one field.`);
  }

  segments.forEach((segment) => {
    if (!segment.includes("=")) {
      const shorthand = segment.trim().toLowerCase();
      if (ALLOWED_AFFINITIES.includes(shorthand)) {
        fields.set("affinity", shorthand);
        return;
      }
      if (ALLOWED_MOTIVATIONS.includes(shorthand)) {
        if (fields.has("motivation")) {
          throw new Error(`delver[${delverIndex}] motivation may only be specified once.`);
        }
        fields.set("motivation", shorthand);
        return;
      }
      throw new Error(`delver[${delverIndex}] segment "${segment}" is invalid; expected key=value.`);
    }

    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator).trim().toLowerCase();
    const fieldValue = segment.slice(separator + 1).trim();
    if (!allowedFields.has(key)) {
      throw new Error(`delver[${delverIndex}] field "${key}" is not supported.`);
    }
    if (!fieldValue) {
      throw new Error(`delver[${delverIndex}] field "${key}" requires a value.`);
    }
    if (key === "motivation" && fields.has("motivation")) {
      throw new Error(`delver[${delverIndex}] motivation may only be specified once.`);
    }
    fields.set(key, fieldValue);
  });

  const affinity = String(fields.get("affinity") || defaultAffinity).trim().toLowerCase();
  if (!ALLOWED_AFFINITIES.includes(affinity)) {
    throw new Error(`delver[${delverIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const motivation = String(fields.get("motivation") || "attacking").trim().toLowerCase();
  if (!ALLOWED_MOTIVATIONS.includes(motivation)) {
    throw new Error(`delver[${delverIndex}] motivation must be one of: ${ALLOWED_MOTIVATIONS.join(", ")}.`);
  }

  const count = fields.has("count")
    ? parsePositiveIntStrict(fields.get("count"), `delver[${delverIndex}] count`)
    : 1;
  const id = isNonEmptyString(fields.get("id"))
    ? String(fields.get("id")).trim()
    : `card_delver_${delverIndex}`;
  const affinities = parseActorAffinities(fields.get("affinities"), "delver", delverIndex);
  const vitals = parseActorVitals(fields.get("vitals"), "delver", delverIndex);
  const optimizationGoals = parseOptimizationGoalList(fields.get("goals"), {
    label: `delver[${delverIndex}].goals`,
    defaultScope: "delver",
    source: "object_flag",
  });
  const setupModeRaw = fields.get("setup-mode") || fields.get("setupmode");
  let setupMode;
  if (isNonEmptyString(setupModeRaw)) {
    setupMode = String(setupModeRaw).trim().toLowerCase();
    if (!ALLOWED_DELVER_SETUP_MODES.includes(setupMode)) {
      throw new Error(`delver[${delverIndex}] setup-mode must be one of: ${ALLOWED_DELVER_SETUP_MODES.join(", ")}.`);
    }
  }

  const delver = {
    id,
    type: "delver",
    source: "actor",
    count,
    affinity,
    motivations: Array.from(new Set([motivation, "user_controlled"])),
  };
  if (affinities && affinities.length > 0) {
    delver.affinities = affinities;
  }
  if (vitals && Object.keys(vitals).length > 0) {
    delver.vitals = vitals;
  }
  if (setupMode) {
    delver.setupMode = setupMode;
  }
  return {
    value: delver,
    optimizationGoals,
    vitalsFlexible: !fields.has("vitals"),
  };
}

function parseDelverSpecs(rawDelvers, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const values = normalizeList(rawDelvers)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error("delver-plan requires at least one --delver entry.");
  }
  return values.map((value, index) => parseDelverSpec(value, index + 1, { defaultAffinity }));
}

function parseWardenSpec(value, wardenIndex, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`warden[${wardenIndex}] requires a non-empty spec.`);
  }

  const allowedFields = new Set(["id", "count", "affinity", "affinities", "motivation", "vitals"]);
  const fields = new Map();
  const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`warden[${wardenIndex}] requires at least one field.`);
  }

  segments.forEach((segment) => {
    if (!segment.includes("=")) {
      const shorthand = segment.trim().toLowerCase();
      if (ALLOWED_AFFINITIES.includes(shorthand)) {
        fields.set("affinity", shorthand);
        return;
      }
      if (ALLOWED_MOTIVATIONS.includes(shorthand)) {
        if (fields.has("motivation")) {
          throw new Error(`warden[${wardenIndex}] motivation may only be specified once.`);
        }
        fields.set("motivation", shorthand);
        return;
      }
      throw new Error(`warden[${wardenIndex}] segment "${segment}" is invalid; expected key=value.`);
    }

    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator).trim().toLowerCase();
    const fieldValue = segment.slice(separator + 1).trim();
    if (!allowedFields.has(key)) {
      throw new Error(`warden[${wardenIndex}] field "${key}" is not supported.`);
    }
    if (!fieldValue) {
      throw new Error(`warden[${wardenIndex}] field "${key}" requires a value.`);
    }
    if (key === "motivation" && fields.has("motivation")) {
      throw new Error(`warden[${wardenIndex}] motivation may only be specified once.`);
    }
    fields.set(key, fieldValue);
  });

  const affinity = String(fields.get("affinity") || defaultAffinity).trim().toLowerCase();
  if (!ALLOWED_AFFINITIES.includes(affinity)) {
    throw new Error(`warden[${wardenIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const motivation = String(fields.get("motivation") || "defending").trim().toLowerCase();
  if (!ALLOWED_MOTIVATIONS.includes(motivation)) {
    throw new Error(`warden[${wardenIndex}] motivation must be one of: ${ALLOWED_MOTIVATIONS.join(", ")}.`);
  }

  const count = fields.has("count")
    ? parsePositiveIntStrict(fields.get("count"), `warden[${wardenIndex}] count`)
    : 1;
  const id = isNonEmptyString(fields.get("id"))
    ? String(fields.get("id")).trim()
    : `card_warden_${wardenIndex}`;
  const affinities = parseActorAffinities(fields.get("affinities"), "warden", wardenIndex);
  const vitals = parseActorVitals(fields.get("vitals"), "warden", wardenIndex);

  const warden = {
    id,
    type: "warden",
    source: "actor",
    count,
    affinity,
    motivations: [motivation],
  };
  if (affinities && affinities.length > 0) {
    warden.affinities = affinities;
  }
  if (vitals && Object.keys(vitals).length > 0) {
    warden.vitals = vitals;
  }
  return warden;
}

function parseWardenSpecs(rawWardens, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const values = normalizeList(rawWardens)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error("warden-plan requires at least one --warden entry.");
  }
  return values.map((value, index) => parseWardenSpec(value, index + 1, { defaultAffinity }));
}

function hasNonStationaryMobilityMotivation(motivations = []) {
  return motivations.some((motivation) => motivation === "random" || motivation === "exploring" || motivation === "patrolling");
}

function requiresMovementStamina(card = null) {
  const motivations = Array.isArray(card?.motivations) ? card.motivations : [];
  return card?.type === "delver" || hasNonStationaryMobilityMotivation(motivations);
}

function cloneVitals(vitals = DEFAULT_VITALS) {
  return VITAL_KEYS.reduce((acc, key) => {
    const source = vitals?.[key] && typeof vitals[key] === "object"
      ? vitals[key]
      : DEFAULT_VITALS[key];
    const max = Number.isInteger(source?.max) ? source.max : DEFAULT_VITALS[key].max;
    const current = Number.isInteger(source?.current) ? source.current : max;
    const regen = Number.isInteger(source?.regen) ? source.regen : DEFAULT_VITALS[key].regen;
    acc[key] = {
      current: Math.max(0, current),
      max: Math.max(0, max),
      regen: Math.max(0, regen),
    };
    return acc;
  }, {});
}

function calculateDelverCardUnitCost(card, priceMap) {
  return calculateActorConfigurationUnitCost({
    entry: {
      motivations: Array.isArray(card?.motivations) ? card.motivations : [],
      affinities: Array.isArray(card?.affinities) ? card.affinities : [],
      vitals: cloneVitals(card?.vitals),
    },
    priceMap,
  }).cost;
}

function createAuthoringValidationIssue({ code, message, path } = {}) {
  const issue = {
    code,
    message,
  };
  if (path) {
    issue.path = path;
  }
  return issue;
}

function createAuthoringValidation({ outcome, summary, issues = [] } = {}) {
  return {
    outcome,
    summary,
    issues: issues
      .filter((issue) => issue && typeof issue === "object")
      .map((issue) => createAuthoringValidationIssue(issue))
      .sort((left, right) => {
        const leftPath = left.path || "";
        const rightPath = right.path || "";
        if (leftPath !== rightPath) {
          return leftPath.localeCompare(rightPath);
        }
        return left.code.localeCompare(right.code);
      }),
  };
}

function formatAffinityList(affinities = []) {
  return normalizeList(affinities)
    .map((entry) => {
      const kind = String(entry?.kind || "affinity").trim().toLowerCase();
      const expression = String(entry?.expression || DEFAULT_ROOM_AFFINITY_EXPRESSION).trim().toLowerCase();
      const stacks = Number.isInteger(entry?.stacks) && entry.stacks > 0 ? entry.stacks : 1;
      return `${kind}:${expression}:${stacks}`;
    })
    .join(", ");
}

function joinConstraintClauses(clauses = []) {
  const filtered = clauses.filter((entry) => isNonEmptyString(entry));
  if (filtered.length === 0) {
    return "";
  }
  if (filtered.length === 1) {
    return filtered[0];
  }
  if (filtered.length === 2) {
    return `${filtered[0]} and ${filtered[1]}`;
  }
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered.at(-1)}`;
}

function formatAuthoringValidationMessage(commandName, validation) {
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  const details = issues.map((issue) => issue.message).join("; ");
  return `${commandName} infeasible (${validation.outcome}): ${validation.summary}${details ? ` Blocking constraints: ${details}` : ""}`;
}

function toRequirementVitals(vitals = DEFAULT_VITALS) {
  return VITAL_KEYS.reduce((acc, key) => {
    const source = vitals?.[key] && typeof vitals[key] === "object"
      ? vitals[key]
      : DEFAULT_VITALS[key];
    acc[key] = Number.isInteger(source?.max) ? source.max : 0;
    return acc;
  }, {});
}

function toRequirementRegen(vitals = DEFAULT_VITALS) {
  return VITAL_KEYS.reduce((acc, key) => {
    const source = vitals?.[key] && typeof vitals[key] === "object"
      ? vitals[key]
      : DEFAULT_VITALS[key];
    acc[key] = Number.isInteger(source?.regen) ? source.regen : 0;
    return acc;
  }, {});
}

function buildMinimumRequiredDelverCard(card) {
  const next = {
    ...card,
    vitals: cloneVitals(card?.vitals),
  };
  const affinities = Array.isArray(card?.affinities) ? card.affinities : [];

  if (affinities.length > 0) {
    next.vitals.mana.max = Math.max(next.vitals.mana.max, 1);
    next.vitals.mana.current = next.vitals.mana.max;
    next.vitals.mana.regen = Math.max(next.vitals.mana.regen, 1);
  }
  if (requiresMovementStamina(card)) {
    next.vitals.stamina.regen = Math.max(next.vitals.stamina.regen, 1);
  }

  return next;
}

function collectBudgetedDelverConflictIssues(entry, delverIndex) {
  const issues = [];
  if (entry?.vitalsFlexible === true) {
    return issues;
  }

  const card = entry?.value;
  const path = `delver[${delverIndex}]`;
  const vitals = cloneVitals(card?.vitals);
  const prereqResult = validateAffinityPrereqs({
    vitals: toRequirementVitals(vitals),
    regen: toRequirementRegen(vitals),
    affinities: Array.isArray(card?.affinities) ? card.affinities : [],
    fieldBase: `${path}.affinities`,
  });

  prereqResult.errors.forEach((error) => {
    if (error.code === "affinity_requires_mana") {
      issues.push(createAuthoringValidationIssue({
        code: error.code,
        path: `${path}.vitals.mana.max`,
        message: `${path} affinities require mana.max >= 1.`,
      }));
      return;
    }
    if (error.code === "affinity_requires_mana_regen") {
      issues.push(createAuthoringValidationIssue({
        code: error.code,
        path: `${path}.vitals.mana.regen`,
        message: `${path} affinities require mana.regen >= 1.`,
      }));
    }
  });

  if (requiresMovementStamina(card) && vitals?.stamina?.regen <= 0) {
    issues.push(createAuthoringValidationIssue({
      code: "movement_requires_stamina_regen",
      path: `${path}.vitals.stamina.regen`,
      message: `${path} movement requires stamina.regen >= 1.`,
    }));
  }

  return issues;
}

function assessBudgetedRoomRequirement(entry, roomIndex, priceListArtifact) {
  const candidateSizes = entry?.sizeFlexible === true
    ? ROOM_CARD_SIZE_IDS
    : [String(entry?.value?.roomSize || entry?.value?.size || "medium").trim().toLowerCase()];
  let minimum = null;

  candidateSizes.forEach((roomSize, sizeIndex) => {
    if (!ROOM_CARD_SIZE_IDS.includes(roomSize)) {
      return;
    }
    const candidateCard = {
      ...entry.value,
      size: roomSize,
      roomSize,
    };
    const count = Number.isInteger(candidateCard?.count) && candidateCard.count > 0 ? candidateCard.count : 1;
    const totalCost = calculateRoomCardUnitCost({
      card: candidateCard,
      priceList: priceListArtifact,
    }).cost * count;
    const requirementSummary = entry?.sizeFlexible === true
      ? `requested affinities ${formatAffinityList(candidateCard.affinities)} at the smallest supported room size`
      : `requested room size ${roomSize} with affinities ${formatAffinityList(candidateCard.affinities)}`;
    const assessment = {
      path: `room[${roomIndex}]`,
      totalCost,
      requirementSummary,
      sizeIndex,
    };
    if (!minimum || assessment.totalCost < minimum.totalCost || (
      assessment.totalCost === minimum.totalCost && assessment.sizeIndex < minimum.sizeIndex
    )) {
      minimum = assessment;
    }
  });

  return minimum;
}

function assessBudgetedDelverRequirement(entry, delverIndex, priceListArtifact) {
  const candidateCard = buildMinimumRequiredDelverCard(entry.value);
  const count = Number.isInteger(candidateCard?.count) && candidateCard.count > 0 ? candidateCard.count : 1;
  const priceMap = buildPriceMap(priceListArtifact);
  const totalCost = calculateDelverCardUnitCost(candidateCard, priceMap) * count;
  const requirementParts = [];
  if (Array.isArray(candidateCard?.affinities) && candidateCard.affinities.length > 0) {
    requirementParts.push(`affinities ${formatAffinityList(candidateCard.affinities)}`);
    requirementParts.push("mana.max >= 1");
    requirementParts.push("mana.regen >= 1");
  }
  if (!(Array.isArray(candidateCard?.motivations) ? candidateCard.motivations : []).includes("stationary")) {
    requirementParts.push("stamina.regen >= 1");
  }
  return {
    path: `delver[${delverIndex}]`,
    totalCost,
    requirementSummary: requirementParts.length > 0
      ? `requested ${joinConstraintClauses(requirementParts)}`
      : "requested delver configuration",
  };
}

function assessBudgetedWardenRequirement(entry, wardenIndex, priceListArtifact) {
  const card = entry?.value && typeof entry.value === "object" ? entry.value : {};
  const count = Number.isInteger(card?.count) && card.count > 0 ? card.count : 1;
  const priceMap = buildPriceMap(priceListArtifact);
  const totalCost = calculateDelverCardUnitCost(card, priceMap) * count;
  const requirementParts = [];
  if (Array.isArray(card?.affinities) && card.affinities.length > 0) {
    requirementParts.push(`affinities ${formatAffinityList(card.affinities)}`);
  }
  if (card?.vitals && typeof card.vitals === "object") {
    requirementParts.push("explicit vitals");
  }
  return {
    path: `warden[${wardenIndex}]`,
    totalCost,
    requirementSummary: requirementParts.length > 0
      ? `requested ${joinConstraintClauses(requirementParts)}`
      : "requested warden configuration",
  };
}

function requirementKind(path = "") {
  if (path.startsWith("room[")) return "room";
  if (path.startsWith("warden[")) return "warden";
  return "delver";
}

function ensureBudgetedFulfillmentFeasible({
  commandName,
  budgetTokens,
  rooms = [],
  delvers = [],
  wardens = [],
  priceListArtifact,
} = {}) {
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return;
  }

  const conflictIssues = delvers.flatMap((entry, index) => collectBudgetedDelverConflictIssues(entry, index + 1));
  if (conflictIssues.length > 0) {
    const validation = createAuthoringValidation({
      outcome: AUTHORING_VALIDATION_OUTCOMES.conflictingRequirements,
      summary: "explicit hard requirements conflict with the minimum support needed for the requested configuration.",
      issues: conflictIssues,
    });
    const error = new Error(formatAuthoringValidationMessage(commandName, validation));
    error.validation = validation;
    throw error;
  }

  const roomRequirements = rooms.map((entry, index) => assessBudgetedRoomRequirement(entry, index + 1, priceListArtifact)).filter(Boolean);
  const delverRequirements = delvers.map((entry, index) => assessBudgetedDelverRequirement(entry, index + 1, priceListArtifact)).filter(Boolean);
  const wardenRequirements = wardens.map((entry, index) => assessBudgetedWardenRequirement(entry, index + 1, priceListArtifact)).filter(Boolean);
  const requirements = [...roomRequirements, ...delverRequirements, ...wardenRequirements];
  const minimumRequiredTokens = requirements.reduce((sum, entry) => sum + entry.totalCost, 0);

  if (minimumRequiredTokens > budgetTokens) {
    const validation = createAuthoringValidation({
      outcome: AUTHORING_VALIDATION_OUTCOMES.insufficientBudget,
      summary: `hard budget is ${budgetTokens} tokens but minimum required spend is ${minimumRequiredTokens} tokens.`,
      issues: requirements.map((entry) => createAuthoringValidationIssue({
        code: `${requirementKind(entry.path)}_minimum_cost_exceeds_budget`,
        path: entry.path,
        message: `${entry.path} requires at least ${entry.totalCost} tokens to preserve ${entry.requirementSummary}.`,
      })),
    });
    const error = new Error(formatAuthoringValidationMessage(commandName, validation));
    error.validation = validation;
    throw error;
  }
}

function compareNumericTuple(left = [], right = []) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(left[index] || 0);
    const rightValue = Number(right[index] || 0);
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  return 0;
}

function resolveDelverGoalOrder(goals = []) {
  const ordered = [];
  normalizeList(goals).forEach((goal) => {
    if (goal?.kind === "maximize_vital_max" && goal?.vital === "mana") {
      ordered.push("mana_max");
      return;
    }
    if (goal?.kind === "maximize_vital_regen" && goal?.vital === "mana") {
      ordered.push("mana_regen");
    }
  });
  if (ordered.length > 0) return ordered;
  return ["mana_max", "mana_regen"];
}

function fillFlexibleDelverVitals(vitals, remainingTokens) {
  const next = cloneVitals(vitals);
  let remaining = Number.isInteger(remainingTokens) ? remainingTokens : 0;
  if (remaining <= 0) {
    return next;
  }
  if (remaining % 2 === 1) {
    next.stamina.max += 1;
    next.stamina.current = next.stamina.max;
    remaining -= 1;
  }
  if (remaining <= 0) {
    return next;
  }
  const manaIncrease = Math.floor(remaining / 2);
  if (manaIncrease > 0) {
    next.mana.max += manaIncrease;
    next.mana.current = next.mana.max;
  }
  return next;
}

function maximizeBudgetCappedDelverCard(card, {
  availableTokens,
  priceListArtifact,
  optimizationGoals = [],
  allowVitalTuning = false,
} = {}) {
  if (!allowVitalTuning || !Number.isInteger(availableTokens) || availableTokens <= 0) {
    return card;
  }

  const count = Number.isInteger(card?.count) && card.count > 0 ? card.count : 1;
  const perUnitBudget = Math.floor(availableTokens / count);
  if (perUnitBudget <= 0) {
    return card;
  }

  const priceMap = buildPriceMap(priceListArtifact);
  const goals = resolveDelverGoalOrder(optimizationGoals);
  const baseVitals = cloneVitals(card?.vitals);
  const affinities = Array.isArray(card?.affinities) ? card.affinities : [];
  const motivations = Array.isArray(card?.motivations) ? card.motivations : [];

  if (affinities.length > 0) {
    baseVitals.mana.max = Math.max(baseVitals.mana.max, 1);
    baseVitals.mana.current = baseVitals.mana.max;
    baseVitals.mana.regen = Math.max(baseVitals.mana.regen, 1);
  }
  if (requiresMovementStamina(card)) {
    baseVitals.stamina.regen = Math.max(baseVitals.stamina.regen, 1);
  }

  const maximumManaRegen = Math.max(
    baseVitals.mana.regen,
    Math.floor(Math.sqrt(Math.max(0, perUnitBudget) / 5)) + 2,
  );
  const maximumMana = Math.max(
    baseVitals.mana.max,
    Math.floor(Math.max(0, perUnitBudget) / 2) + baseVitals.mana.max,
  );

  let best = null;
  for (let manaRegen = baseVitals.mana.regen; manaRegen <= maximumManaRegen; manaRegen += 1) {
    for (let manaMax = baseVitals.mana.max; manaMax <= maximumMana; manaMax += 1) {
      const candidateVitals = cloneVitals(baseVitals);
      candidateVitals.mana.max = manaMax;
      candidateVitals.mana.current = manaMax;
      candidateVitals.mana.regen = manaRegen;

      const candidateCost = calculateActorConfigurationUnitCost({
        entry: {
          motivations,
          affinities,
          vitals: candidateVitals,
        },
        priceMap,
      }).cost;
      if (!Number.isInteger(candidateCost) || candidateCost <= 0 || candidateCost > perUnitBudget) {
        continue;
      }

      const filledVitals = fillFlexibleDelverVitals(candidateVitals, perUnitBudget - candidateCost);
      const filledCost = calculateActorConfigurationUnitCost({
        entry: {
          motivations,
          affinities,
          vitals: filledVitals,
        },
        priceMap,
      }).cost;
      if (!Number.isInteger(filledCost) || filledCost <= 0 || filledCost > perUnitBudget) {
        continue;
      }

      const goalTuple = goals.map((goal) => (
        goal === "mana_regen"
          ? filledVitals.mana.regen
          : filledVitals.mana.max
      ));
      const candidate = {
        card: {
          ...card,
          vitals: filledVitals,
        },
        totalCost: filledCost * count,
        goalTuple,
      };
      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.totalCost !== best.totalCost) {
        if (candidate.totalCost > best.totalCost) best = candidate;
        continue;
      }
      if (compareNumericTuple(candidate.goalTuple, best.goalTuple) > 0) {
        best = candidate;
      }
    }
  }

  return best?.card || card;
}

function maximizeBudgetCappedRoomCard(card, {
  availableTokens,
  priceListArtifact,
  allowSizeTuning = false,
} = {}) {
  if (!allowSizeTuning || !Number.isInteger(availableTokens) || availableTokens <= 0) {
    return card;
  }
  const count = Number.isInteger(card?.count) && card.count > 0 ? card.count : 1;
  let best = null;

  ROOM_CARD_SIZE_IDS.forEach((roomSize, sizeIndex) => {
    const candidateCard = {
      ...card,
      size: roomSize,
      roomSize,
    };
    const unitCost = calculateRoomCardUnitCost({
      card: candidateCard,
      priceList: priceListArtifact,
    }).cost;
    const totalCost = unitCost * count;
    if (!Number.isInteger(totalCost) || totalCost <= 0 || totalCost > availableTokens) {
      return;
    }
    const candidate = {
      card: candidateCard,
      totalCost,
      sizeIndex,
    };
    if (!best || candidate.totalCost > best.totalCost || (
      candidate.totalCost === best.totalCost && candidate.sizeIndex > best.sizeIndex
    )) {
      best = candidate;
    }
  });

  return best?.card || card;
}

function applyBudgetCappedFulfillment({
  rooms = [],
  delvers = [],
  priceListArtifact,
  budgetTokens,
} = {}) {
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return {
      rooms: rooms.map((entry) => ({ ...entry })),
      delvers: delvers.map((entry) => ({ ...entry })),
    };
  }

  const nextRooms = rooms.map((entry) => ({
    ...entry,
    value: entry?.value && typeof entry.value === "object" ? { ...entry.value } : entry?.value,
  }));
  const nextDelvers = delvers.map((entry) => ({
    ...entry,
    value: entry?.value && typeof entry.value === "object" ? { ...entry.value } : entry?.value,
    optimizationGoals: Array.isArray(entry?.optimizationGoals) ? entry.optimizationGoals.slice() : [],
  }));
  const priceMap = buildPriceMap(priceListArtifact);

  const calculateCurrentTotal = () => {
    const roomTotal = nextRooms.reduce((sum, entry) => sum + calculateRoomCardUnitCost({
      card: entry.value,
      priceList: priceListArtifact,
    }).cost * (entry?.value?.count || 1), 0);
    const delverTotal = nextDelvers.reduce((sum, entry) => sum + calculateDelverCardUnitCost(entry.value, priceMap) * (entry?.value?.count || 1), 0);
    return roomTotal + delverTotal;
  };

  nextRooms.forEach((entry, roomIndex) => {
    const currentCardCost = calculateRoomCardUnitCost({
      card: entry.value,
      priceList: priceListArtifact,
    }).cost * (entry?.value?.count || 1);
    const otherCost = calculateCurrentTotal() - currentCardCost;
    const availableTokens = Math.max(0, budgetTokens - otherCost);
    nextRooms[roomIndex].value = maximizeBudgetCappedRoomCard(entry.value, {
      availableTokens,
      priceListArtifact,
      allowSizeTuning: entry?.sizeFlexible === true,
    });
  });

  nextDelvers.forEach((entry, delverIndex) => {
    const currentCardCost = calculateDelverCardUnitCost(entry.value, priceMap) * (entry?.value?.count || 1);
    const otherCost = calculateCurrentTotal() - currentCardCost;
    const availableTokens = Math.max(0, budgetTokens - otherCost);
    nextDelvers[delverIndex].value = maximizeBudgetCappedDelverCard(entry.value, {
      availableTokens,
      priceListArtifact,
      optimizationGoals: entry.optimizationGoals,
      allowVitalTuning: entry?.vitalsFlexible === true,
    });
  });

  return {
    rooms: nextRooms,
    delvers: nextDelvers,
  };
}

function resolvePath(input, cwd = process.cwd()) {
  if (!input) {
    return null;
  }
  return isAbsolute(input) ? input : resolve(cwd, input);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeFileSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "capture";
}

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "capture";
}

function buildCapturedInputPath(adapter, index, outputRefId) {
  if (isNonEmptyString(outputRefId)) {
    return `${sanitizeFileName(outputRefId)}.json`;
  }
  return `captured-input-${sanitizeFileSegment(adapter)}-${index + 1}.json`;
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

function defaultRunDir(runId) {
  return resolve(process.cwd(), DEFAULT_ARTIFACTS_DIR, DEFAULT_RUNS_DIR, runId);
}

function defaultRunCommandOutDir(command, runId) {
  return resolve(defaultRunDir(runId), command);
}

const FROM_RUN_STAGE_PRIORITY = Object.freeze([
  "llm-plan",
  "build",
  "configurator",
  "create",
  "configure",
  "room-plan",
  "hazard-plan",
  "resource-plan",
  "delver-plan",
  "warden-plan",
  "run",
]);

function compareFromRunStagePriority(left, right) {
  const leftIndex = FROM_RUN_STAGE_PRIORITY.indexOf(left);
  const rightIndex = FROM_RUN_STAGE_PRIORITY.indexOf(right);
  const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft - normalizedRight;
  }
  return left.localeCompare(right);
}

function normalizeCommandOutDirEntries(commandOutDirs) {
  if (commandOutDirs instanceof Map) {
    return Array.from(commandOutDirs.entries()).map(([command, outDir]) => ({ command, outDir }));
  }
  if (Array.isArray(commandOutDirs)) {
    return commandOutDirs
      .map((entry) => ({
        command: entry?.command,
        outDir: entry?.outDir,
      }));
  }
  if (commandOutDirs && typeof commandOutDirs === "object") {
    return Object.entries(commandOutDirs).map(([command, outDir]) => ({ command, outDir }));
  }
  return [];
}

function deriveCommonAncestor(paths) {
  const normalized = paths
    .map((value) => (isNonEmptyString(value) ? resolve(value) : ""))
    .filter(Boolean);
  if (normalized.length === 0) {
    return "";
  }
  const splitPaths = normalized.map((value) => value.split(sep).filter(Boolean));
  const prefix = [];
  const first = splitPaths[0];
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (!splitPaths.every((parts) => parts[index] === segment)) {
      break;
    }
    prefix.push(segment);
  }
  if (prefix.length === 0) {
    return dirname(normalized[0]);
  }
  const absolutePrefix = `${sep}${prefix.join(sep)}`;
  return absolutePrefix || sep;
}

function deriveRememberedRunDir(entries) {
  const outDirs = entries
    .map((entry) => entry?.outDir)
    .filter((value) => isNonEmptyString(value));
  if (outDirs.length === 0) {
    return "";
  }
  if (outDirs.length === 1) {
    return outDirs[0];
  }
  return deriveCommonAncestor(outDirs);
}

export async function resolveFromRunArtifactPathsFromCommandOutDirs({
  runId,
  commandOutDirs,
} = {}) {
  if (!isNonEmptyString(runId)) {
    throw new Error("--from-run requires a non-empty run id.");
  }
  const entries = normalizeCommandOutDirEntries(commandOutDirs)
    .filter((entry) => isNonEmptyString(entry.command) && isNonEmptyString(entry.outDir))
    .sort((left, right) => compareFromRunStagePriority(left.command, right.command));
  if (entries.length === 0) {
    throw new Error(`--from-run could not find remembered artifacts for run ${runId}.`);
  }

  const runDir = deriveRememberedRunDir(entries);
  for (const entry of entries) {
    const simConfigPath = join(entry.outDir, "sim-config.json");
    const initialStatePath = join(entry.outDir, "initial-state.json");
    if (existsSync(simConfigPath) && existsSync(initialStatePath)) {
      return {
        runDir,
        sourceDir: entry.outDir,
        simConfigPath,
        initialStatePath,
      };
    }
  }

  let simConfigPath = null;
  let initialStatePath = null;
  for (const entry of entries) {
    if (!simConfigPath) {
      const candidate = join(entry.outDir, "sim-config.json");
      if (existsSync(candidate)) {
        simConfigPath = candidate;
      }
    }
    if (!initialStatePath) {
      const candidate = join(entry.outDir, "initial-state.json");
      if (existsSync(candidate)) {
        initialStatePath = candidate;
      }
    }
  }

  if (!simConfigPath || !initialStatePath) {
    throw new Error(`--from-run requires sim-config.json and initial-state.json for remembered run ${runId}.`);
  }

  return {
    runDir,
    sourceDir: dirname(simConfigPath) === dirname(initialStatePath) ? dirname(simConfigPath) : runDir,
    simConfigPath,
    initialStatePath,
  };
}

async function resolveFromRunArtifactPaths(runId) {
  if (!isNonEmptyString(runId)) {
    throw new Error("--from-run requires a non-empty run id.");
  }

  const runDir = defaultRunDir(runId);
  if (!existsSync(runDir)) {
    throw new Error(`--from-run could not find artifacts for run ${runId} under ${runDir}.`);
  }

  const dirents = await readdir(runDir, { withFileTypes: true });
  const candidateDirs = [
    runDir,
    ...dirents
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(runDir, entry.name))
      .sort((left, right) => compareFromRunStagePriority(left.slice(runDir.length + 1), right.slice(runDir.length + 1))),
  ];

  for (const candidateDir of candidateDirs) {
    const simConfigPath = join(candidateDir, "sim-config.json");
    const initialStatePath = join(candidateDir, "initial-state.json");
    if (existsSync(simConfigPath) && existsSync(initialStatePath)) {
      return { runDir, sourceDir: candidateDir, simConfigPath, initialStatePath };
    }
  }

  let simConfigPath = null;
  let initialStatePath = null;
  for (const candidateDir of candidateDirs) {
    if (!simConfigPath) {
      const candidate = join(candidateDir, "sim-config.json");
      if (existsSync(candidate)) {
        simConfigPath = candidate;
      }
    }
    if (!initialStatePath) {
      const candidate = join(candidateDir, "initial-state.json");
      if (existsSync(candidate)) {
        initialStatePath = candidate;
      }
    }
  }

  if (!simConfigPath || !initialStatePath) {
    throw new Error(`--from-run requires sim-config.json and initial-state.json under ${runDir}.`);
  }

  return {
    runDir,
    sourceDir: dirname(simConfigPath) === dirname(initialStatePath) ? dirname(simConfigPath) : runDir,
    simConfigPath,
    initialStatePath,
  };
}

async function resolveRunInputArgs(args, { commandName }) {
  const fromRunId = args["from-run"];
  if (!isNonEmptyString(fromRunId)) {
    return { ...args };
  }
  if (args["sim-config"] || args["initial-state"]) {
    throw new Error(`${commandName} does not allow --from-run together with --sim-config or --initial-state.`);
  }
  const resolved = await resolveFromRunArtifactPaths(fromRunId);
  return {
    ...args,
    "sim-config": resolved.simConfigPath,
    "initial-state": resolved.initialStatePath,
  };
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

const STRUCTURED_STDOUT_COMMANDS = new Set([
  "build",
  "budget",
  "create",
  "configure",
  "room-plan",
  "hazard-plan",
  "resource-plan",
  "delver-plan",
  "warden-plan",
  "run",
  "inspect",
  "narrate",
  "llm-plan",
  "scenario",
  "show",
  "diff",
  "runs",
  "tick",
  "sandbox-create",
  "sandbox-place",
  "sandbox-move",
]);

const RUN_INDEX_INPUT_FILES = Object.freeze([
  ["request", "request.json"],
  ["spec", "spec.json"],
  ["sim_config", "sim-config.json"],
  ["initial_state", "initial-state.json"],
  ["resolved_sim_config", "resolved-sim-config.json"],
  ["resolved_initial_state", "resolved-initial-state.json"],
  ["action_log", "action-log.json"],
]);

const RUN_INDEX_OUTPUT_FILES = Object.freeze([
  ["intent", "intent.json"],
  ["plan", "plan.json"],
  ["budget", "budget.json"],
  ["price_list", "price-list.json"],
  ["budget_receipt", "budget-receipt.json"],
  ["solver_request", "solver-request.json"],
  ["solver_result", "solver-result.json"],
  ["sim_config", "sim-config.json"],
  ["initial_state", "initial-state.json"],
  ["resource_bundle", "resource-bundle.json"],
  ["bundle", "bundle.json"],
  ["manifest", "manifest.json"],
  ["telemetry", "telemetry.json"],
  ["run_summary", "run-summary.json"],
  ["tick_frames", "tick-frames.json"],
  ["effects_log", "effects-log.json"],
  ["runtime_decision_captures", "runtime-decision-captures.json"],
  ["inspect_summary", "inspect-summary.json"],
  ["narrative", "narrative.json"],
  ["affinity_summary", "affinity-summary.json"],
]);

function emitJsonStdout(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitJsonStderr(payload) {
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

async function listDirectoryNames(path) {
  if (!path || !existsSync(path)) {
    return [];
  }
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function buildArtifactPathMap({ outDir, manifestEntries = [] } = {}) {
  const artifactPaths = {};
  artifactPaths.spec = join(outDir, "spec.json");
  artifactPaths.bundle = join(outDir, "bundle.json");
  artifactPaths.manifest = join(outDir, "manifest.json");
  artifactPaths.telemetry = join(outDir, "telemetry.json");
  manifestEntries.forEach((entry) => {
    if (!entry?.path) {
      return;
    }
    const key = entry.path.replace(/\.json$/i, "").replaceAll(/[^A-Za-z0-9]+/g, "_");
    artifactPaths[key] = join(outDir, entry.path);
  });
  return artifactPaths;
}

function deriveActorIds(initialState) {
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  return actors
    .map((actor) => actor?.id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

function deriveRoomIds(simConfig) {
  const rooms = Array.isArray(simConfig?.layout?.data?.rooms) ? simConfig.layout.data.rooms : [];
  return rooms
    .map((room) => room?.id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

const REQUIRED_PREVIEW_CARD_TYPES = Object.freeze(["room", "delver", "warden"]);

function stablePreviewCardKey(card, index) {
  const id = typeof card?.id === "string" ? card.id.trim() : "";
  if (id) return `id:${id}`;
  return `index:${index}:${JSON.stringify(card || {})}`;
}

function mergePreviewCardArrays(...sources) {
  const merged = new Map();
  sources.forEach((cards) => {
    if (!Array.isArray(cards)) return;
    cards.forEach((card, index) => {
      if (!card || typeof card !== "object" || Array.isArray(card)) return;
      const key = stablePreviewCardKey(card, index);
      const previous = merged.get(key);
      merged.set(key, previous ? { ...previous, ...card } : { ...card });
    });
  });
  return Array.from(merged.values());
}

function collectPreviewCardSet(spec) {
  return mergePreviewCardArrays(
    spec?.configurator?.inputs?.cardSet,
    spec?.plan?.hints?.cardSet,
  );
}

function normalizePreviewCardType(type) {
  const normalized = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (normalized === "attacker") return "delver";
  if (normalized === "defender") return "warden";
  return normalized;
}

function readConfiguredPreviewCount(count) {
  const parsed = Number(count);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function buildPreviewSummary({
  outDir,
  manifestEntries = [],
  initialState = null,
  simConfig = null,
  spec = null,
} = {}) {
  const resourceBundleEntry = manifestEntries.find((entry) => entry?.path === "resource-bundle.json");
  const cardSet = collectPreviewCardSet(spec);
  const counts = REQUIRED_PREVIEW_CARD_TYPES.reduce((acc, type) => ({ ...acc, [type]: 0 }), {});
  cardSet.forEach((entry) => {
    const type = normalizePreviewCardType(entry?.type);
    if (!REQUIRED_PREVIEW_CARD_TYPES.includes(type)) return;
    counts[type] += readConfiguredPreviewCount(entry?.count ?? 1);
  });
  return {
    ready: Boolean(simConfig && resourceBundleEntry),
    bundlePath: join(outDir, "bundle.json"),
    manifestPath: join(outDir, "manifest.json"),
    resourceBundlePath: join(outDir, "resource-bundle.json"),
    hasActors: deriveActorIds(initialState).length > 0,
    runReady: REQUIRED_PREVIEW_CARD_TYPES.every((type) => counts[type] > 0),
  };
}

function buildStructuredSuccessSummary({
  command,
  outDir,
  runId,
  manifestEntries = [],
  initialState = null,
  simConfig = null,
  spec = null,
  extra = {},
} = {}) {
  const summary = {
    ok: true,
    command,
    runId,
    outDir,
    actorIds: deriveActorIds(initialState),
    roomIds: deriveRoomIds(simConfig),
    artifactPaths: buildArtifactPathMap({ outDir, manifestEntries }),
    preview: buildPreviewSummary({
      outDir,
      manifestEntries,
      initialState,
      simConfig,
      spec,
    }),
  };
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined) {
      summary[key] = value;
    }
  });
  return summary;
}

async function readJsonIfExists(path) {
  if (!path || !existsSync(path)) {
    return null;
  }
  return readJson(path);
}

async function summarizeBuildLikeOutput({
  command,
  outDir,
  extra = {},
} = {}) {
  const manifest = await readJsonIfExists(join(outDir, "manifest.json"));
  const spec = await readJsonIfExists(join(outDir, "spec.json"));
  const simConfig = await readJsonIfExists(join(outDir, "sim-config.json"));
  const initialState = await readJsonIfExists(join(outDir, "initial-state.json"));
  return buildStructuredSuccessSummary({
    command,
    outDir,
    runId: spec?.meta?.runId || manifest?.correlation?.runId || "",
    manifestEntries: Array.isArray(manifest?.artifacts) ? manifest.artifacts : [],
    initialState,
    simConfig,
    spec,
    extra,
  });
}

const GAMEPLAY_BUNDLE_SCHEMA = "agent-kernel/GameplayBundle";

// Assemble a post-run agent-kernel/GameplayBundle by merging the resolved
// SimConfig/InitialState artifacts that `run` writes with the tick frames it
// recorded. Matches the shape produced by
// packages/runtime/src/runner/core-facade.js compileScenarioPlaybackBundle
// ({ schema, schemaVersion, meta, artifacts: [simConfig, initialState], spec, tickFrames })
// so the UI's window.__ak_loadGameplayBundle / sandbox-bridge-client can consume
// it unchanged. Unlike compileScenarioPlaybackBundle (which re-runs the
// simulation itself), this reuses the tick frames already produced by `run`
// rather than re-executing the sim.
function buildGameplayBundleFromRunArtifacts({ runId, createdAt, simConfig, initialState, tickFrames, spec } = {}) {
  if (!simConfig || !initialState || !Array.isArray(tickFrames)) {
    return null;
  }
  return {
    schema: GAMEPLAY_BUNDLE_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: runId || simConfig?.meta?.runId || initialState?.meta?.runId || "run",
      runId: runId || simConfig?.meta?.runId || initialState?.meta?.runId || "run",
      createdAt: createdAt || new Date().toISOString(),
      producedBy: "cli-run",
    },
    artifacts: [simConfig, initialState],
    ...(spec ? { spec } : {}),
    tickFrames,
  };
}

async function summarizeRunOutput({ outDir, args } = {}) {
  const runSummary = await readJsonIfExists(join(outDir, "run-summary.json"));
  const resolvedSimConfigPath = join(outDir, "resolved-sim-config.json");
  const resolvedInitialStatePath = join(outDir, "resolved-initial-state.json");
  const simConfig = await readJsonIfExists(
    existsSync(resolvedSimConfigPath) ? resolvedSimConfigPath : resolvePath(args["sim-config"])
  );
  const initialState = await readJsonIfExists(
    existsSync(resolvedInitialStatePath) ? resolvedInitialStatePath : resolvePath(args["initial-state"])
  );
  const artifactPaths = {
    tick_frames: join(outDir, "tick-frames.json"),
    effects_log: join(outDir, "effects-log.json"),
    runtime_decision_captures: join(outDir, "runtime-decision-captures.json"),
    run_summary: join(outDir, "run-summary.json"),
    action_log: join(outDir, "action-log.json"),
  };
  const affinitySummaryPath = join(outDir, "affinity-summary.json");
  if (existsSync(affinitySummaryPath)) {
    artifactPaths.affinity_summary = affinitySummaryPath;
  }
  if (existsSync(resolvedSimConfigPath)) {
    artifactPaths.resolved_sim_config = resolvedSimConfigPath;
  }
  if (existsSync(resolvedInitialStatePath)) {
    artifactPaths.resolved_initial_state = resolvedInitialStatePath;
  }

  // M7 gap 3: stitch a post-run agent-kernel/GameplayBundle from the artifacts
  // this run just (re)wrote so ak_push_to_ui has something to deliver to the UI.
  const runId = runSummary?.meta?.runId || simConfig?.meta?.runId || initialState?.meta?.runId || "";
  const tickFrames = await readJsonIfExists(artifactPaths.tick_frames);
  // When the run's inputs came from an ak_create outDir, that directory holds
  // the pre-run preview bundle.json ({ spec, schemas, artifacts } — no
  // schema/schemaVersion/tickFrames). Carry its spec/schemas and any artifacts
  // that the run does not supersede (e.g. ResourceBundleArtifact) into the
  // post-run bundle, and upgrade that sibling bundle.json in place so the
  // create outDir also ends up holding a loadable playback bundle.
  const sourceSimConfigPath = resolvePath(args["sim-config"]);
  const createBundlePath = sourceSimConfigPath ? join(dirname(sourceSimConfigPath), "bundle.json") : null;
  const createBundle = createBundlePath && createBundlePath !== join(outDir, "bundle.json")
    ? await readJsonIfExists(createBundlePath)
    : null;
  // Only stitch when the run's inputs came from an authored create outDir
  // (identified by its pre-run bundle.json sibling). Fixture-driven runs stay
  // bundle-free so CLI run output remains artifact-for-artifact equivalent to
  // the browser host's run output (tests/integration/ui-cli-equivalence.test.js).
  const bundle = createBundle && typeof createBundle === "object"
    ? buildGameplayBundleFromRunArtifacts({
      runId,
      createdAt: runSummary?.meta?.createdAt,
      simConfig,
      initialState,
      tickFrames: Array.isArray(tickFrames) ? tickFrames : null,
      spec: createBundle.spec,
    })
    : null;
  if (bundle) {
    const SUPERSEDED_BY_RUN = new Set([
      simConfig?.schema,
      initialState?.schema,
    ]);
    const carriedArtifacts = Array.isArray(createBundle.artifacts)
      ? createBundle.artifacts.filter((artifact) => artifact?.schema && !SUPERSEDED_BY_RUN.has(artifact.schema))
      : [];
    if (carriedArtifacts.length > 0) {
      bundle.artifacts = [...bundle.artifacts, ...carriedArtifacts];
    }
    if (createBundle.schemas !== undefined) {
      bundle.schemas = createBundle.schemas;
    }
    const bundlePath = join(outDir, "bundle.json");
    await writeJson(bundlePath, bundle);
    artifactPaths.bundle = bundlePath;
    await writeJson(createBundlePath, bundle);
    artifactPaths.create_bundle = createBundlePath;
  }

  return {
    ok: true,
    command: "run",
    runId,
    outDir,
    actorIds: deriveActorIds(initialState),
    roomIds: deriveRoomIds(simConfig),
    artifactPaths,
    ticks: runSummary?.metrics?.ticks,
  };
}

async function summarizeInspectOutput({ outDir } = {}) {
  const inspectSummary = await readJsonIfExists(join(outDir, "inspect-summary.json"));
  return {
    ok: true,
    command: "inspect",
    runId: inspectSummary?.meta?.runId || "",
    outDir,
    actorIds: [],
    roomIds: [],
    artifactPaths: {
      inspect_summary: join(outDir, "inspect-summary.json"),
    },
    ticks: inspectSummary?.data?.ticks,
  };
}

async function summarizeNarrateOutput({ outDir } = {}) {
  const narrative = await readJsonIfExists(join(outDir, "narrative.json"));
  return {
    ok: true,
    command: "narrate",
    runId: narrative?.meta?.runId || "",
    outDir,
    actorIds: Array.isArray(narrative?.cast) ? narrative.cast.map((entry) => entry.id) : [],
    roomIds: [],
    artifactPaths: {
      narrative: join(outDir, "narrative.json"),
    },
    ticks: narrative?.source?.ticks ?? (Array.isArray(narrative?.turns) ? narrative.turns.length : undefined),
  };
}

function humanizeToken(value) {
  return String(value || "").replaceAll("_", " ").trim();
}

function formatNarrativeValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatNarrativeValue(entry)).join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return "";
}

function formatNarrativeDetails(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "";
  }
  const entries = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${humanizeToken(key)}=${formatNarrativeValue(value)}`);
  return entries.length > 0 ? ` (${entries.join(", ")})` : "";
}

function buildNarrativeCast(initialState) {
  return Array.isArray(initialState?.actors)
    ? initialState.actors.map((actor) => ({
      id: actor.id,
      label: isNonEmptyString(actor?.archetype) ? `${actor.archetype} ${actor.id}` : actor.id,
      kind: actor.kind,
      archetype: actor.archetype,
    }))
    : [];
}

function buildNarrativeActorLabelLookup(cast) {
  return new Map(cast.map((entry) => [entry.id, entry.label]));
}

function getNarrativeActorLabel(actorId, actorLabels) {
  return actorLabels.get(actorId) || actorId || "system";
}

function describeNarrativeAction(action, actorLabels) {
  const subject = getNarrativeActorLabel(action?.actorId, actorLabels);
  return `${subject} chose ${humanizeToken(action?.kind || "action")}${formatNarrativeDetails(action?.params)}.`;
}

function describeNarrativePreCoreRejection(record, actorLabels) {
  const action = record?.action || {};
  const subject = getNarrativeActorLabel(action.actorId, actorLabels);
  const reason = isNonEmptyString(record?.reason) ? record.reason.trim() : "rejected before core execution";
  return `${subject} could not ${humanizeToken(action.kind || "act")}: ${reason}.`;
}

function describeNarrativeEvent(event, actorLabels) {
  const subject = getNarrativeActorLabel(event?.actorId, actorLabels);
  if (event?.kind === "action_applied" && isNonEmptyString(event?.data?.action)) {
    return `${subject} completed ${humanizeToken(event.data.action)}.`;
  }
  if (event?.kind === "actor_moved") {
    const destination = event?.data?.to || event?.data?.position;
    if (destination && typeof destination === "object") {
      return `${subject} moved to ${formatNarrativeValue(destination)}.`;
    }
  }
  if (event?.kind === "actor_blocked") {
    return `${subject} was blocked${formatNarrativeDetails(event?.data)}.`;
  }
  if (event?.kind === "state_changed" && isNonEmptyString(event?.data?.state)) {
    return `${subject} changed state to ${event.data.state}.`;
  }
  return `${subject} triggered ${humanizeToken(event?.kind || "event")}${formatNarrativeDetails(event?.data)}.`;
}

function describeNarrativeEffect(effect) {
  const source = isNonEmptyString(effect?.personaRef) ? effect.personaRef : "runtime";
  return `${source} emitted ${humanizeToken(effect?.kind || "effect")}${formatNarrativeDetails(effect?.data)}.`;
}

function describeNarrativeFulfillment(record) {
  const kind = humanizeToken(record?.effect?.kind || "effect");
  const status = record?.status || "processed";
  const reason = isNonEmptyString(record?.reason) ? `: ${record.reason.trim()}` : "";
  const result = record?.result && typeof record.result === "object"
    ? ` ${formatNarrativeDetails(record.result).trim()}`
    : "";
  return `${kind} was ${status}${reason}${result}.`;
}

function buildNarrativeTurns(frames, actorLabels) {
  const grouped = new Map();
  for (const frame of frames) {
    const tick = Number.isFinite(frame?.tick) ? frame.tick : 0;
    if (!grouped.has(tick)) {
      grouped.set(tick, []);
    }
    grouped.get(tick).push(frame);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([tick, tickFrames]) => {
      const lines = [];
      let actions = 0;
      let events = 0;
      let effects = 0;
      const phases = new Set();

      for (const frame of tickFrames) {
        phases.add(frame?.phaseDetail || frame?.phase || "unknown");

        for (const action of Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : []) {
          actions += 1;
          lines.push(describeNarrativeAction(action, actorLabels));
        }
        for (const record of Array.isArray(frame?.preCoreRejections) ? frame.preCoreRejections : []) {
          actions += 1;
          lines.push(describeNarrativePreCoreRejection(record, actorLabels));
        }
        for (const event of Array.isArray(frame?.emittedEvents) ? frame.emittedEvents : []) {
          events += 1;
          lines.push(describeNarrativeEvent(event, actorLabels));
        }
        for (const effect of Array.isArray(frame?.emittedEffects) ? frame.emittedEffects : []) {
          effects += 1;
          lines.push(describeNarrativeEffect(effect));
        }
        for (const record of Array.isArray(frame?.fulfilledEffects) ? frame.fulfilledEffects : []) {
          effects += 1;
          lines.push(describeNarrativeFulfillment(record));
        }
      }

      const phaseSummary = Array.from(phases).join(", ");
      const summary = `Observed ${tickFrames.length} frame${tickFrames.length === 1 ? "" : "s"} during ${phaseSummary}; ${actions} action${actions === 1 ? "" : "s"}, ${events} event${events === 1 ? "" : "s"}, ${effects} effect${effects === 1 ? "" : "s"}.`;
      return {
        tick,
        title: `Turn ${tick}`,
        summary,
        lines: lines.length > 0 ? lines : ["No notable actions were recorded."],
        stats: {
          frames: tickFrames.length,
          actions,
          events,
          effects,
        },
      };
    });
}

function buildNarrativeStory(turns) {
  return turns.map((turn) => [
    `${turn.title}: ${turn.summary}`,
    ...turn.lines.map((line) => `- ${line}`),
  ].join("\n")).join("\n\n");
}

function createNarrativeArtifact({ initialState, frames, runId } = {}) {
  const cast = buildNarrativeCast(initialState);
  const actorLabels = buildNarrativeActorLabelLookup(cast);
  const turns = buildNarrativeTurns(frames, actorLabels);
  const story = buildNarrativeStory(turns);
  return {
    schema: SCHEMAS.narrative,
    schemaVersion: 1,
    meta: createMeta({ producedBy: "cli-narrate", runId }),
    source: {
      initialStateRef: toRef(initialState) || undefined,
      frames: frames.length,
      ticks: turns.length,
    },
    cast,
    summary: `Generated ${turns.length} turn${turns.length === 1 ? "" : "s"} from ${frames.length} tick frame${frames.length === 1 ? "" : "s"}.`,
    story,
    turns,
  };
}

function prefixArtifactPaths(paths, prefix) {
  return Object.fromEntries(
    Object.entries(paths || {}).map(([key, value]) => [`${prefix}${key}`, value])
  );
}

function buildScenarioSummary({
  runId,
  outDir,
  llmPlanSummary,
  sourceArtifactPaths,
  runSummary,
  inspectSummary,
} = {}) {
  return {
    ok: true,
    command: "scenario",
    runId,
    outDir,
    actorIds: Array.isArray(runSummary?.actorIds) ? runSummary.actorIds : [],
    roomIds: Array.isArray(runSummary?.roomIds) ? runSummary.roomIds : [],
    artifactPaths: {
      ...prefixArtifactPaths(llmPlanSummary?.artifactPaths, "llm_plan_"),
      ...(sourceArtifactPaths || {}),
      ...prefixArtifactPaths(runSummary?.artifactPaths, ""),
      ...prefixArtifactPaths(inspectSummary?.artifactPaths, ""),
    },
    ticks: inspectSummary?.ticks ?? runSummary?.ticks,
  };
}

function toRunIndexArtifactRecord({ key, outDir, fileName, payload } = {}) {
  const record = {
    key,
    path: join(outDir, fileName),
  };
  if (payload?.schema) {
    record.schema = payload.schema;
  }
  if (payload?.schemaVersion !== undefined) {
    record.schemaVersion = payload.schemaVersion;
  }
  if (payload?.meta?.id) {
    record.id = payload.meta.id;
  }
  if (payload?.meta?.createdAt) {
    record.createdAt = payload.meta.createdAt;
  }
  return record;
}

async function collectRunIndexArtifactRecords(outDir, entries) {
  const records = [];
  for (const [key, fileName] of entries) {
    const payload = await readJsonIfExists(join(outDir, fileName));
    if (!payload) {
      continue;
    }
    records.push(toRunIndexArtifactRecord({ key, outDir, fileName, payload }));
  }
  return records;
}

function deriveRunIndexStatus({ telemetry, runSummary, outputCount } = {}) {
  if (isNonEmptyString(telemetry?.data?.status)) {
    return telemetry.data.status;
  }
  if (isNonEmptyString(runSummary?.outcome) && runSummary.outcome !== "unknown") {
    return runSummary.outcome;
  }
  if (outputCount > 0) {
    return "success";
  }
  return "incomplete";
}

function deriveRunStatus(commands) {
  const statuses = Array.from(new Set(commands.map((entry) => entry.status).filter(isNonEmptyString)));
  if (statuses.length === 0) {
    return "unknown";
  }
  if (statuses.length === 1) {
    return statuses[0];
  }
  return "mixed";
}

function deriveBudgetSpend(budgetReceipt) {
  if (!budgetReceipt || budgetReceipt.schema !== SCHEMAS.budgetReceiptArtifact) {
    return undefined;
  }
  const summary = {
    status: budgetReceipt.status,
    totalCost: budgetReceipt.totalCost,
    remaining: budgetReceipt.remaining,
  };
  if (budgetReceipt.scenarioSpendReport && typeof budgetReceipt.scenarioSpendReport === "object") {
    summary.scenarioSpendReport = budgetReceipt.scenarioSpendReport;
  }
  return summary;
}

const DIFF_STAGE_PRIORITY = Object.freeze([
  "run",
  "replay",
  "scenario",
  "inspect",
  "build",
  "create",
  "configure",
  "llm-plan",
]);

function compareDiffStagePriority(left, right) {
  const leftIndex = DIFF_STAGE_PRIORITY.indexOf(left);
  const rightIndex = DIFF_STAGE_PRIORITY.indexOf(right);
  const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft - normalizedRight;
  }
  return left.localeCompare(right);
}

function deriveTickCount(runSummary, tickFrames) {
  if (Number.isFinite(runSummary?.metrics?.ticks)) {
    return runSummary.metrics.ticks;
  }
  return Array.isArray(tickFrames)
    ? tickFrames.reduce((maxTick, frame) => Math.max(maxTick, Number.isFinite(frame?.tick) ? frame.tick : 0), 0)
    : 0;
}

function deriveEffectCount(runSummary, tickFrames) {
  if (Number.isFinite(runSummary?.metrics?.effects)) {
    return runSummary.metrics.effects;
  }
  return Array.isArray(tickFrames)
    ? tickFrames.reduce(
      (total, frame) => total + (Array.isArray(frame?.emittedEffects) ? frame.emittedEffects.length : 0),
      0,
    )
    : 0;
}

function buildActorRecordMap(initialState) {
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  return new Map(
    actors
      .filter((actor) => isNonEmptyString(actor?.id))
      .map((actor) => [actor.id, actor]),
  );
}

function addActorDamage(damageByActorId, actorId, amount) {
  if (!isNonEmptyString(actorId) || !Number.isFinite(amount)) {
    return;
  }
  damageByActorId.set(actorId, (damageByActorId.get(actorId) || 0) + amount);
}

function recordEventDamage(damageByActorId, event) {
  if (!event || typeof event !== "object") {
    return;
  }
  const data = event.data && typeof event.data === "object" ? event.data : {};
  const targetActorId = data.targetActorId || data.targetId || event.targetActorId || event.targetId || event.actorId;
  const damage = Number.isFinite(data.damage)
    ? data.damage
    : Number.isFinite(data.amount) && String(event.kind || "").toLowerCase().includes("damage")
      ? data.amount
      : null;
  if (Number.isFinite(damage)) {
    addActorDamage(damageByActorId, targetActorId, damage);
  }
}

function recordEffectDamage(damageByActorId, effect, result) {
  if ((!effect || typeof effect !== "object") && (!result || typeof result !== "object")) {
    return;
  }
  const effectData = effect?.data && typeof effect.data === "object" ? effect.data : {};
  const resultData = result && typeof result === "object" ? result : {};
  const kind = String(effect?.kind || resultData.kind || "").toLowerCase();
  const targetActorId = (
    effectData.targetActorId
    || effectData.targetId
    || resultData.targetActorId
    || resultData.targetId
    || effect?.actorId
    || resultData.actorId
  );
  const damage = Number.isFinite(effectData.damage)
    ? effectData.damage
    : Number.isFinite(effectData.amount) && kind.includes("damage")
      ? effectData.amount
      : Number.isFinite(resultData.damage)
        ? resultData.damage
        : Number.isFinite(resultData.amount) && kind.includes("damage")
          ? resultData.amount
          : null;
  if (Number.isFinite(damage)) {
    addActorDamage(damageByActorId, targetActorId, damage);
  }
}

function deriveDamageSummary(tickFrames) {
  const damageByActorId = new Map();
  if (!Array.isArray(tickFrames)) {
    return { total: 0, byActorId: damageByActorId };
  }
  tickFrames.forEach((frame) => {
    (Array.isArray(frame?.emittedEvents) ? frame.emittedEvents : []).forEach((event) => {
      recordEventDamage(damageByActorId, event);
    });
    (Array.isArray(frame?.emittedEffects) ? frame.emittedEffects : []).forEach((effect) => {
      recordEffectDamage(damageByActorId, effect, effect?.data);
    });
    (Array.isArray(frame?.fulfilledEffects) ? frame.fulfilledEffects : []).forEach((record) => {
      recordEffectDamage(damageByActorId, record?.effect, record?.result);
      (Array.isArray(record?.result?.events) ? record.result.events : []).forEach((event) => {
        recordEventDamage(damageByActorId, event);
      });
    });
  });
  const total = Array.from(damageByActorId.values()).reduce((sum, value) => sum + value, 0);
  return { total, byActorId: damageByActorId };
}

function normalizeDiffFrameSummary(frame) {
  if (!frame || typeof frame !== "object") {
    return null;
  }
  return summarizeFrame(frame);
}

function findFirstFrameDivergence(tickFramesA, tickFramesB) {
  const normalizedA = Array.isArray(tickFramesA) ? tickFramesA.map(normalizeDiffFrameSummary) : [];
  const normalizedB = Array.isArray(tickFramesB) ? tickFramesB.map(normalizeDiffFrameSummary) : [];
  const max = Math.max(normalizedA.length, normalizedB.length);
  for (let index = 0; index < max; index += 1) {
    const frameA = normalizedA[index] || null;
    const frameB = normalizedB[index] || null;
    if (!frameA || !frameB) {
      return {
        index,
        reason: !frameA ? "missing_run_a_frame" : "missing_run_b_frame",
        tick: frameA?.tick ?? frameB?.tick ?? null,
        frameA,
        frameB,
      };
    }
    if (JSON.stringify(frameA) !== JSON.stringify(frameB)) {
      return {
        index,
        reason: "frame_mismatch",
        tick: frameA.tick ?? frameB.tick ?? null,
        frameA,
        frameB,
      };
    }
  }
  return null;
}

async function resolveDiffRunArtifacts(runId) {
  if (!isNonEmptyString(runId)) {
    throw new Error("diff requires non-empty run ids.");
  }
  const runDir = defaultRunDir(runId);
  if (!existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir}`);
  }

  const sourcePaths = await resolveFromRunArtifactPaths(runId);
  const commandNames = await listDirectoryNames(runDir);
  const candidateCommands = [...commandNames].sort(compareDiffStagePriority);
  let compareDir = null;
  let compareCommand = "";

  for (const command of candidateCommands) {
    const candidateDir = join(runDir, command);
    if (existsSync(join(candidateDir, "tick-frames.json")) || existsSync(join(candidateDir, "run-summary.json"))) {
      compareDir = candidateDir;
      compareCommand = command;
      break;
    }
  }

  if (!compareDir) {
    throw new Error(`diff could not find tick-frames.json or run-summary.json for run ${runId} under ${runDir}.`);
  }

  const [simConfig, initialState, runSummary, tickFrames] = await Promise.all([
    readJson(sourcePaths.simConfigPath),
    readJson(sourcePaths.initialStatePath),
    readJsonIfExists(join(compareDir, "run-summary.json")),
    readJsonIfExists(join(compareDir, "tick-frames.json")),
  ]);
  assertSchema(simConfig, SCHEMAS.simConfig);
  assertSchema(initialState, SCHEMAS.initialState);
  if (runSummary) {
    assertSchema(runSummary, SCHEMAS.runSummary);
  }
  if (tickFrames && !Array.isArray(tickFrames)) {
    throw new Error(`diff expects tick-frames.json for run ${runId} to contain a JSON array.`);
  }
  (Array.isArray(tickFrames) ? tickFrames : []).forEach((frame) => assertSchema(frame, SCHEMAS.tickFrame));

  return {
    runId,
    runDir,
    sourceDir: sourcePaths.sourceDir,
    compareDir,
    compareCommand,
    simConfig,
    initialState,
    runSummary,
    tickFrames: Array.isArray(tickFrames) ? tickFrames : [],
    ticks: deriveTickCount(runSummary, tickFrames),
    effects: deriveEffectCount(runSummary, tickFrames),
    damage: deriveDamageSummary(tickFrames),
    actorRecords: buildActorRecordMap(initialState),
  };
}

function buildActorDiffRecords(runA, runB) {
  const actorIds = Array.from(new Set([
    ...runA.actorRecords.keys(),
    ...runB.actorRecords.keys(),
    ...runA.damage.byActorId.keys(),
    ...runB.damage.byActorId.keys(),
  ])).sort((left, right) => left.localeCompare(right));

  return actorIds.map((actorId) => {
    const actorA = runA.actorRecords.get(actorId) || null;
    const actorB = runB.actorRecords.get(actorId) || null;
    const damageA = runA.damage.byActorId.get(actorId) || 0;
    const damageB = runB.damage.byActorId.get(actorId) || 0;
    return {
      id: actorId,
      presentInA: Boolean(actorA),
      presentInB: Boolean(actorB),
      kindA: actorA?.kind,
      kindB: actorB?.kind,
      vitalsA: actorA?.vitals || null,
      vitalsB: actorB?.vitals || null,
      damageReceivedA: damageA,
      damageReceivedB: damageB,
      damageDelta: damageB - damageA,
    };
  });
}

async function summarizeRunDiff({ runA, runB } = {}) {
  const [resolvedA, resolvedB] = await Promise.all([
    resolveDiffRunArtifacts(runA),
    resolveDiffRunArtifacts(runB),
  ]);
  const divergence = findFirstFrameDivergence(resolvedA.tickFrames, resolvedB.tickFrames);
  return {
    ok: true,
    command: "diff",
    runA: resolvedA.runId,
    runB: resolvedB.runId,
    sourceA: {
      runDir: resolvedA.runDir,
      sourceDir: resolvedA.sourceDir,
      compareDir: resolvedA.compareDir,
      command: resolvedA.compareCommand,
    },
    sourceB: {
      runDir: resolvedB.runDir,
      sourceDir: resolvedB.sourceDir,
      compareDir: resolvedB.compareDir,
      command: resolvedB.compareCommand,
    },
    ticks: {
      a: resolvedA.ticks,
      b: resolvedB.ticks,
      delta: resolvedB.ticks - resolvedA.ticks,
    },
    effects: {
      a: resolvedA.effects,
      b: resolvedB.effects,
      delta: resolvedB.effects - resolvedA.effects,
    },
    damage: {
      a: resolvedA.damage.total,
      b: resolvedB.damage.total,
      delta: resolvedB.damage.total - resolvedA.damage.total,
    },
    actors: buildActorDiffRecords(resolvedA, resolvedB),
    divergesAtTick: divergence?.tick ?? null,
    divergence,
  };
}

async function summarizeRunIndexCommand({ runId, command, outDir } = {}) {
  const request = await readJsonIfExists(join(outDir, "request.json"));
  const spec = await readJsonIfExists(join(outDir, "spec.json"));
  const simConfig = await readJsonIfExists(join(outDir, "sim-config.json"));
  const initialState = await readJsonIfExists(join(outDir, "initial-state.json"));
  const telemetry = await readJsonIfExists(join(outDir, "telemetry.json"));
  const runSummary = await readJsonIfExists(join(outDir, "run-summary.json"));
  const budgetReceipt = await readJsonIfExists(join(outDir, "budget-receipt.json"));
  const inputs = await collectRunIndexArtifactRecords(outDir, RUN_INDEX_INPUT_FILES);
  const outputs = await collectRunIndexArtifactRecords(outDir, RUN_INDEX_OUTPUT_FILES);
  const createdAt = (
    spec?.meta?.createdAt
    || request?.meta?.createdAt
    || telemetry?.meta?.createdAt
    || runSummary?.meta?.createdAt
    || ""
  );
  return {
    command,
    runId,
    status: deriveRunIndexStatus({ telemetry, runSummary, outputCount: outputs.length }),
    outDir,
    createdAt,
    source: (
      spec?.meta?.source
      || telemetry?.data?.source
      || request?.meta?.producedBy
      || runSummary?.meta?.producedBy
      || ""
    ),
    actorIds: deriveActorIds(initialState),
    roomIds: deriveRoomIds(simConfig),
    ticks: runSummary?.metrics?.ticks,
    budgetSpend: deriveBudgetSpend(budgetReceipt),
    inputs,
    outputs,
  };
}

async function summarizeRunShow({ runId } = {}) {
  if (!isNonEmptyString(runId)) {
    throw new Error("show requires --run-id <id>.");
  }
  const runDir = defaultRunDir(runId);
  if (!existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir}`);
  }

  const commandNames = await listDirectoryNames(runDir);
  const commands = [];
  for (const command of commandNames) {
    commands.push(await summarizeRunIndexCommand({
      runId,
      command,
      outDir: join(runDir, command),
    }));
  }
  commands.sort((a, b) => a.command.localeCompare(b.command));

  const actorIds = Array.from(new Set(commands.flatMap((entry) => entry.actorIds || [])))
    .sort((a, b) => a.localeCompare(b));
  const roomIds = Array.from(new Set(commands.flatMap((entry) => entry.roomIds || [])))
    .sort((a, b) => a.localeCompare(b));
  const artifactPaths = Array.from(new Set(commands.flatMap((entry) => [
    ...(entry.inputs || []).map((record) => record.path),
    ...(entry.outputs || []).map((record) => record.path),
  ]))).sort((a, b) => a.localeCompare(b));
  const budgetSpend = commands.find((entry) => entry.budgetSpend)?.budgetSpend;

  return {
    ok: true,
    command: "show",
    runId,
    runDir,
    status: deriveRunStatus(commands),
    commandCount: commands.length,
    actorIds,
    roomIds,
    actorCount: actorIds.length,
    roomCount: roomIds.length,
    budgetSpend,
    artifactPaths,
    commands,
  };
}

export async function summarizeRunShowFromCommandOutDirs({
  runId,
  commandOutDirs,
} = {}) {
  if (!isNonEmptyString(runId)) {
    throw new Error("show requires --run-id <id>.");
  }
  const entries = normalizeCommandOutDirEntries(commandOutDirs)
    .filter((entry) => isNonEmptyString(entry.command) && isNonEmptyString(entry.outDir));
  if (entries.length === 0) {
    throw new Error(`Run directory not found for remembered run: ${runId}`);
  }

  const commands = [];
  for (const entry of entries) {
    commands.push(await summarizeRunIndexCommand({
      runId,
      command: entry.command,
      outDir: entry.outDir,
    }));
  }
  commands.sort((a, b) => a.command.localeCompare(b.command));

  const actorIds = Array.from(new Set(commands.flatMap((entry) => entry.actorIds || [])))
    .sort((a, b) => a.localeCompare(b));
  const roomIds = Array.from(new Set(commands.flatMap((entry) => entry.roomIds || [])))
    .sort((a, b) => a.localeCompare(b));
  const artifactPaths = Array.from(new Set(commands.flatMap((entry) => [
    ...(entry.inputs || []).map((record) => record.path),
    ...(entry.outputs || []).map((record) => record.path),
  ]))).sort((a, b) => a.localeCompare(b));
  const budgetSpend = commands.find((entry) => entry.budgetSpend)?.budgetSpend;

  return {
    ok: true,
    command: "show",
    runId,
    runDir: deriveRememberedRunDir(entries),
    status: deriveRunStatus(commands),
    commandCount: commands.length,
    actorIds,
    roomIds,
    actorCount: actorIds.length,
    roomCount: roomIds.length,
    budgetSpend,
    artifactPaths,
    commands,
  };
}

async function summarizeRunsIndex({ rootDir } = {}) {
  const runIds = await listDirectoryNames(rootDir);
  const runs = [];
  for (const runId of runIds) {
    const runDir = join(rootDir, runId);
    const commandNames = await listDirectoryNames(runDir);
    const commands = [];
    for (const command of commandNames) {
      commands.push(await summarizeRunIndexCommand({
        runId,
        command,
        outDir: join(runDir, command),
      }));
    }
    commands.sort((a, b) => {
      const aTime = Date.parse(a.createdAt || "");
      const bTime = Date.parse(b.createdAt || "");
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime;
      }
      return a.command.localeCompare(b.command);
    });
    runs.push({
      runId,
      status: deriveRunStatus(commands),
      commandCount: commands.length,
      commands,
    });
  }
  runs.sort((a, b) => a.runId.localeCompare(b.runId));
  return {
    ok: true,
    command: "runs",
    action: "list",
    rootDir,
    runs,
  };
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

function resolveDefaultLlmFixturePath({ resolvePath: resolveCliPath, exists, cwd }) {
  const candidates = [
    resolveCliPath("tests/fixtures/adapters/llm-generate-summary.json"),
    resolveCliPath("tests/fixtures/adapters/llm-generate-summary.json", cwd()),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
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
  return appendLlmPromptSuffix(promptText);
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

function buildRepairPrompt({ basePrompt, errors, responseText, allowedOptions, allowedPairsText }) {
  const extracted = extractJsonObject(responseText) || responseText;
  const affinities = allowedOptions?.affinities?.length ? allowedOptions.affinities : ALLOWED_AFFINITIES;
  const motivations = allowedOptions?.motivations?.length ? allowedOptions.motivations : ALLOWED_MOTIVATIONS;
  return buildLlmRepairPromptTemplate({
    basePrompt,
    errors,
    responseText: extracted,
    affinities,
    affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    motivations,
    allowedPairsText,
    phaseRequirement: LLM_REPAIR_TEXT.phaseActorsRequirement,
    extraLines: [
      LLM_REPAIR_TEXT.tokenHintRule,
      LLM_REPAIR_TEXT.exampleAffinityEntry,
    ],
  });
}

function buildDryRunBudgetEstimate({ budgetReceipt, spendProposal, budgetTokens } = {}) {
  const total = Number.isInteger(budgetReceipt?.budget?.tokens)
    ? budgetReceipt.budget.tokens
    : Number.isInteger(budgetReceipt?.totalBudget)
      ? budgetReceipt.totalBudget
      : Number.isInteger(budgetTokens)
        ? budgetTokens
        : Number.isInteger(spendProposal?.summary?.budgetTokens)
          ? spendProposal.summary.budgetTokens
          : undefined;
  const used = Number.isFinite(budgetReceipt?.totalCost)
    ? budgetReceipt.totalCost
    : Number.isFinite(spendProposal?.summary?.totalSpentTokens)
      ? spendProposal.summary.totalSpentTokens
      : undefined;
  const remaining = Number.isFinite(budgetReceipt?.remaining)
    ? budgetReceipt.remaining
    : Number.isFinite(spendProposal?.summary?.remainingTokens)
      ? spendProposal.summary.remainingTokens
      : Number.isFinite(total) && Number.isFinite(used)
        ? Math.max(0, total - used)
        : undefined;
  if (total === undefined && used === undefined && remaining === undefined) {
    return undefined;
  }
  return { total, used, remaining };
}

function buildDryRunSuccess({
  command,
  runId,
  outDir,
  actorIds = [],
  roomIds = [],
  budgetEstimate,
  warnings = [],
  extra = {},
} = {}) {
  const summary = {
    ok: true,
    command,
    runId,
    valid: true,
    dryRun: true,
    actorIds,
    roomIds,
    warnings,
  };
  if (outDir) {
    summary.outDir = outDir;
  }
  if (budgetEstimate) {
    summary.budgetEstimate = budgetEstimate;
  }
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined) {
      summary[key] = value;
    }
  });
  return summary;
}

function buildDryRunFailure({ command, runId, outDir, error } = {}) {
  const summary = {
    ok: true,
    command,
    runId,
    valid: false,
    dryRun: true,
    errors: [error?.message || String(error)],
    warnings: [],
  };
  if (outDir) {
    summary.outDir = outDir;
  }
  return summary;
}

function assertAllowedBuildArgs(args) {
  const allowed = new Set(["spec", "out-dir", "emit-intermediates"]);
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
    throw new Error(`build only accepts --spec, --out-dir, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
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

function assertAllowedRoomPlanArgs(args) {
  const allowed = new Set([
    "room",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
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
    throw new Error(`room-plan only accepts --room, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedHazardPlanArgs(args) {
  const allowed = new Set([
    "hazard",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
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
    throw new Error(`hazard-plan only accepts --hazard, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedResourcePlanArgs(args) {
  const allowed = new Set([
    "resource",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
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
    throw new Error(`resource-plan only accepts --resource, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedDelverPlanArgs(args) {
  const allowed = new Set([
    "delver",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
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
    throw new Error(`delver-plan only accepts --delver, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedWardenPlanArgs(args) {
  const allowed = new Set([
    "warden",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
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
    throw new Error(`warden-plan only accepts --warden, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedAgentAuthoringArgs(command, args, { allowDryRun = false } = {}) {
  const allowed = new Set([
    "text",
    "room",
    "floor-tile",
    "hazard",
    "hazard",
    "resource",
    "delver",
    "warden",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "dungeon-budget-tokens",
    "delver-budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
  if (allowDryRun) {
    allowed.add("dry-run");
  }
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
    throw new Error(`${command} only accepts --text, --room, --floor-tile, --hazard, --resource, --delver, --warden, --goal, --dungeon-affinity, --budget-tokens, --dungeon-budget-tokens, --delver-budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, --emit-intermediates${allowDryRun ? ", and --dry-run" : ""}. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedScenarioArgs(args) {
  const allowed = new Set([
    "text",
    "from-run",
    "catalog",
    "model",
    "goal",
    "budget-tokens",
    "base-url",
    "fixture",
    "budget-loop",
    "budget-pool",
    "budget-reserve",
    "ticks",
    "seed",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
    "dry-run",
  ]);
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
    throw new Error(`scenario only accepts --text, --from-run, --catalog, --model, --goal, --budget-tokens, --base-url, --fixture, --budget-loop, --budget-pool, --budget-reserve, --ticks, --seed, --out-dir, --run-id, --created-at, --emit-intermediates, and --dry-run. Unknown: ${unknown.join(", ")}`);
  }
}

function makeAgentCommandRoutes(kind) {
  switch (kind) {
    case "room":
      return [
        { target: "build_spec_plan", path: "plan.hints.rooms", legacyFlow: "room-plan" },
        { target: "build_spec_configurator", path: "configurator.inputs.cardSet", legacyFlow: "room-plan" },
      ];
    case "floor_tile":
      return [
        { target: "build_spec_configurator", path: "configurator.inputs.levelGen.walkableTilesTarget", legacyFlow: "configurator" },
      ];
    case "hazard":
      return [
        { target: "build_spec_configurator", path: "configurator.inputs.levelGen.placedHazards", legacyFlow: "configurator" },
      ];
    case "hazard":
      return [
        { target: "build_spec_configurator", path: "configurator.inputs.levelGen.hazards", legacyFlow: "hazard-plan" },
      ];
    case "resource":
      return [
        { target: "build_spec_configurator", path: "configurator.inputs.resources", legacyFlow: "resource-plan" },
      ];
    case "delver":
      return [
        { target: "build_spec_plan", path: "plan.hints.cardSet", legacyFlow: "delver-plan" },
        { target: "build_spec_configurator", path: "configurator.inputs.actors", legacyFlow: "delver-plan" },
      ];
    case "warden":
      return [
        { target: "build_spec_plan", path: "plan.hints.cardSet", legacyFlow: "warden-plan" },
        { target: "build_spec_configurator", path: "configurator.inputs.actors", legacyFlow: "warden-plan" },
      ];
    case "shared_config":
      return [
        { target: "build_spec_intent", path: "intent.hints" },
        { target: "build_spec_configurator", path: "configurator.inputs" },
      ];
    default:
      return [];
  }
}

function buildAgentCommandRequestArtifact({
  action,
  commandText,
  runId,
  createdAt,
  objectRequests,
  sharedConfig,
} = {}) {
  const kinds = Array.from(new Set(objectRequests.map((entry) => entry.kind)));
  return {
    schema: SCHEMAS.agentCommandRequest,
    schemaVersion: 1,
    meta: {
      id: `agent_command_${action}_${runId}`,
      runId,
      createdAt,
      producedBy: `cli-${action}`,
    },
    command: {
      action,
      text: commandText,
      source: `cli-${action}`,
      taxonomyVersion: 1,
    },
    objects: objectRequests,
    sharedConfig: sharedConfig && Object.keys(sharedConfig).length > 0 ? sharedConfig : undefined,
    compilation: {
      rules: kinds.map((kind) => ({
        kind,
        compileTo: makeAgentCommandRoutes(kind),
      })),
    },
    compatibility: {
      preserveExistingCommands: true,
      supportedLegacyFlows: Array.from(new Set(
        kinds.flatMap((kind) => makeAgentCommandRoutes(kind).map((route) => route.legacyFlow).filter(Boolean)).concat(["build", "configurator"]),
      )),
    },
  };
}

function describeAgentCommandText({ action, text, objects }) {
  if (isNonEmptyString(text)) {
    return text.trim();
  }
  const counts = {};
  objects.forEach((entry) => {
    counts[entry.kind] = (counts[entry.kind] || 0) + (Number.isInteger(entry.count) && entry.count > 0 ? entry.count : 1);
  });
  const summary = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${count} ${kind.replaceAll("_", "-")}${count === 1 ? "" : "s"}`)
    .join(", ");
  return `${action === "configure" ? "Configure" : "Create"} ${summary}.`;
}

function deriveGoalForAgentCommand({ action, goal, objects }) {
  if (isNonEmptyString(goal)) {
    return goal.trim();
  }
  const labels = Array.from(new Set(objects.map((entry) => entry.kind.replaceAll("_", "-"))));
  return `${action === "configure" ? "Configure" : "Author"} ${labels.join(", ")} into a playable dungeon bundle.`;
}

// Minimum room dimensions when placedHazards/hazards occupy floor tiles alongside entrance + exit.
// A room smaller than medium (roomMinSize=5) compresses all elements into too few walkable cells.
const MIN_ROOM_SIZE_WITH_ITEMS = 5;
const MIN_ROOM_MAX_SIZE_WITH_ITEMS = 8;

// Room size profiles: map CLI size token → { roomMinSize, roomMaxSize }
const ROOM_SIZE_PROFILES = {
  small:  { roomMinSize: 3,  roomMaxSize: 5  },
  medium: { roomMinSize: 5,  roomMaxSize: 8  },
  large:  { roomMinSize: 8,  roomMaxSize: 12 },
};

// Pick the largest profile requested by any room in parsedRooms.
// Falls back to medium when no rooms are present.
function resolveRoomSizeProfile(rooms) {
  const order = ["small", "medium", "large"];
  let best = "medium";
  for (const entry of (rooms || [])) {
    const size = String(entry?.value?.size || entry?.value?.roomSize || "medium").toLowerCase();
    if (order.indexOf(size) > order.indexOf(best)) best = size;
  }
  return ROOM_SIZE_PROFILES[best] || ROOM_SIZE_PROFILES.medium;
}

function ensureAuthoringLevelGenCapacity(levelGen, { walkableTilesTarget, placedHazards, rooms }) {
  const blockingHazardCount = placedHazards.reduce((sum, hazard) => sum + (hazard.blocking === true ? 1 : 0), 0);
  const walkableTarget = Number.isInteger(walkableTilesTarget) && walkableTilesTarget > 0 ? walkableTilesTarget : 0;
  // Authored hazard x/y are room-relative (mapped into a room's interior by
  // level-layout.js's mapHazardsToRooms), not absolute grid coordinates, so
  // they must not drive grid sizing here — doing so previously let e.g.
  // hazard x=99;y=99 silently inflate the grid to 102x102 to contain a raw
  // coordinate. Out-of-bounds room-relative placedHazards are now rejected with a
  // structured error by the layout layer instead.
  const requestedWalkable = walkableTarget + blockingHazardCount;
  const walkableSide = requestedWalkable > 0
    ? Math.max(5, Math.ceil(Math.sqrt(Math.ceil(requestedWalkable / 0.5))) + 2)
    : 5;

  // Resolve the room-size profile early so we can size the grid to fit it.
  // level-layout.js clamps roomMinSize to (min(width,height) - 2), so the grid must be at
  // least (roomMinSize + 4) on each side for the profile to take effect.
  const sizeProfile = resolveRoomSizeProfile(rooms);
  const profileMinSize = placedHazards.length > 0
    ? Math.max(MIN_ROOM_SIZE_WITH_ITEMS, sizeProfile.roomMinSize)
    : sizeProfile.roomMinSize;
  // +4 = 2 walls + 2 padding so the clamp in readRoomSettings allows the full room size
  const profileGridSide = profileMinSize + 4;

  // Grid capacity must also scale with the TOTAL requested room count, not just a single
  // room's size profile. level-layout.js's placeRooms() lays candidate rooms out in a
  // roughly-square grid of surface slots (buildRoomSurfaceSlots); if the interior is only
  // just big enough for one room of roomMaxSize, additional rooms silently fail to place
  // and orchestrateBuild returns fewer rooms than requested (confirmed: a 15x15 grid with
  // roomCount=5/roomMinSize=roomMaxSize=5 deterministically yields only 4 placed rooms).
  // Size the grid so a sqrt(roomCount) x sqrt(roomCount) arrangement of roomMaxSize rooms
  // (plus 1-tile spacing per room and a 4-tile wall/padding border) always fits. Only
  // applies when more than one room is requested — profileGridSide already sizes the
  // single-room case correctly, and widening it here would shift absolute tile
  // coordinates that other authoring flags (e.g. --hazard x=..;y=..) depend on.
  const requestedRoomCount = rooms.reduce((sum, entry) => {
    const count = Number.isInteger(entry?.value?.count) && entry.value.count > 0 ? entry.value.count : 1;
    return sum + count;
  }, 0);
  const roomCapacitySide = requestedRoomCount > 1
    ? (() => {
      const columns = Math.ceil(Math.sqrt(requestedRoomCount));
      const gridRows = Math.max(1, Math.ceil(requestedRoomCount / columns));
      return Math.max(columns, gridRows) * (sizeProfile.roomMaxSize + 1) + 4;
    })()
    : 0;

  const width = Math.max(
    Number.isInteger(levelGen?.width) ? levelGen.width : 0,
    walkableSide,
    profileGridSide,
    roomCapacitySide,
  );
  const height = Math.max(
    Number.isInteger(levelGen?.height) ? levelGen.height : 0,
    walkableSide,
    profileGridSide,
    roomCapacitySide,
  );
  const shape = levelGen?.shape && typeof levelGen.shape === "object" && !Array.isArray(levelGen.shape)
    ? { ...levelGen.shape }
    : {};
  if (!Number.isInteger(shape.roomCount) || shape.roomCount <= 0) {
    shape.roomCount = 1;
  }
  // When placedHazards are present, enforce the requested room-size profile (at least medium) to avoid
  // compressing entrance, exit, and hazard tiles into an unusably small floor area.
  const minRoomSize = profileMinSize;
  if (!Number.isInteger(shape.roomMinSize) || shape.roomMinSize < minRoomSize) {
    shape.roomMinSize = minRoomSize;
  }
  const minRoomMax = placedHazards.length > 0
    ? Math.max(shape.roomMinSize, sizeProfile.roomMaxSize)
    : Math.max(shape.roomMinSize, 3);
  if (!Number.isInteger(shape.roomMaxSize) || shape.roomMaxSize < minRoomMax) {
    shape.roomMaxSize = minRoomMax;
  }
  if (!Number.isInteger(shape.corridorWidth) || shape.corridorWidth <= 0) {
    shape.corridorWidth = 1;
  }
  return {
    ...levelGen,
    width,
    height,
    shape,
  };
}

async function writeBuildOutputs({
  outDir,
  spec,
  buildResult,
  requestArtifact = null,
  emitIntermediates = false,
  commandName,
  producedBy,
} = {}) {
  await writeJson(join(outDir, "spec.json"), spec);

  const capturedInputs = Array.isArray(buildResult.capturedInputs) ? buildResult.capturedInputs : [];
  const capturedArtifacts = capturedInputs.map((entry, index) => {
    const artifact = entry?.artifact || entry;
    return {
      artifact,
      path: entry?.path || buildCapturedInputPath(artifact?.source?.adapter || "llm", index, artifact?.meta?.id),
    };
  });
  const persistedArtifacts = collectBuildOutputArtifactRecords(buildResult, {
    requestArtifact,
    capturedInputs: capturedArtifacts,
    emitIntermediates,
    includeAffinitySummary: true,
  });
  for (const entry of persistedArtifacts) {
    await writeJson(join(outDir, entry.path), entry.artifact);
  }

  const bundleArtifacts = buildBuildArtifacts(buildResult, {
    requestArtifact,
    capturedInputs: capturedArtifacts,
    emitIntermediates,
    includeAffinitySummary: true,
  });

  const manifestEntries = buildBuildManifestEntries(buildResult, {
    requestArtifact,
    capturedInputs: capturedArtifacts,
    emitIntermediates,
    includeAffinitySummary: true,
  });

  const schemaEntries = filterSchemaCatalogEntries({
    schemaRefs: [
      { schema: spec.schema, schemaVersion: spec.schemaVersion },
      ...manifestEntries,
    ],
  });

  const bundle = {
    spec,
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

  const telemetry = buildBuildTelemetryRecord({
    spec,
    status: "success",
    artifactRefs: buildArtifactRefs(manifestEntries),
    producedBy,
    clock: () => spec.meta.createdAt,
  });
  await writeJson(join(outDir, "telemetry.json"), telemetry);

  const costSummary = buildCostSummary(buildResult.budgetReceipt, buildResult.spendProposal, outDir);

  return buildStructuredSuccessSummary({
    command: commandName,
    outDir,
    runId: spec.meta.runId,
    manifestEntries,
    initialState: buildResult.initialState,
    simConfig: buildResult.simConfig,
    spec,
    extra: costSummary !== undefined ? { cost: costSummary } : {},
  });
}

function buildCostSummary(budgetReceipt, spendProposal, outDir) {
  if (!budgetReceipt || budgetReceipt.schema !== SCHEMAS.budgetReceiptArtifact) {
    return undefined;
  }
  const totalSpend = budgetReceipt.totalCost ?? 0;
  const remaining = budgetReceipt.remaining ?? 0;
  return {
    totalSpend,
    budgetTokens: totalSpend + remaining,
    remaining,
    status: budgetReceipt.status,
    receiptPath: join(outDir, "budget-receipt.json"),
    proposalPath: spendProposal ? join(outDir, "spend-proposal.json") : undefined,
  };
}

async function writeHazardArtifactFiles({ parsedHazards = [], outDir, runId, createdAt, producedBy } = {}) {
  for (let i = 0; i < parsedHazards.length; i += 1) {
    const h = parsedHazards[i].value;
    const hazardVersion = h._schemaVersion ?? 3;
    const hazardArtifact = {
      schema: "agent-kernel/HazardArtifact",
      schemaVersion: hazardVersion,
      meta: {
        id: h.id,
        runId,
        createdAt,
        producedBy,
      },
      affinity: h.affinity,
      expression: h.expression,
      ...(hazardVersion === 3
        ? {
          proximityRadius: h.proximityRadius,
          affinityStacks: h.affinityStacks.map((entry) => ({ ...entry })),
          vitals: {
            mana: { ...h.vitals.mana },
            durability: { ...h.vitals.durability },
          },
        }
        : {
          proximityRadius: h.proximityRadius,
          mana: { ...h.mana },
          ...(hazardVersion === 1 && h.durability ? { durability: { ...h.durability } } : {}),
        }),
    };
    await writeJson(join(outDir, `hazard-${i + 1}.json`), hazardArtifact);
  }
}

async function writeResourceArtifactFiles({ parsedResources = [], outDir, runId, createdAt, producedBy } = {}) {
  for (let i = 0; i < parsedResources.length; i += 1) {
    const r = parsedResources[i].value;
    const resourceVersion = r._schemaVersion ?? 1;
    const meta = { id: r.id, runId, createdAt, producedBy };
    let resourceArtifact;
    if (resourceVersion === 3) {
      resourceArtifact = {
        schema: "agent-kernel/ResourceArtifact",
        schemaVersion: 3,
        meta,
        vitals: r.vitals,
        permanenceMode: r.permanenceMode,
      };
    } else {
      resourceArtifact = {
        schema: "agent-kernel/ResourceArtifact",
        schemaVersion: 1,
        meta,
        tier: r.tier,
        stat: r.stat,
        delta: r.delta,
        dropRate: r.dropRate,
      };
    }
    await writeJson(join(outDir, `resource-${i + 1}.json`), resourceArtifact);
  }
}

const AUTHORING_POOL_WEIGHT_DEFAULTS = Object.freeze({
  rooms: 0.44,
  hazards: 0.12,
  wardens: 0.16,
  resources: 0.08,
  delver: 0.20,
});

function buildPoolWeightsForAuthoredKinds({
  rooms = [],
  floorTiles = [],
  placedHazards = [],
  hazards = [],
  resources = [],
  delvers = [],
  wardens = [],
} = {}) {
  const weights = [];
  if (rooms.length > 0 || floorTiles.length > 0 || placedHazards.length > 0) {
    weights.push({ id: "rooms", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.rooms });
  }
  if (hazards.length > 0) weights.push({ id: "hazards", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.hazards });
  if (wardens.length > 0) weights.push({ id: "wardens", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.wardens });
  if (resources.length > 0) weights.push({ id: "resources", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.resources });
  if (delvers.length > 0) weights.push({ id: "delver", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.delver });
  return weights;
}

function buildPoolWeightsForSummary(summary = {}) {
  const cards = Array.isArray(summary.cardSet)
    ? summary.cardSet
    : Array.isArray(summary.cards) ? summary.cards : [];
  const layout = summary.layout && typeof summary.layout === "object" ? summary.layout : null;
  const rooms = [
    ...(Array.isArray(summary.rooms) ? summary.rooms : []),
    ...cards.filter((entry) => entry?.type === "room" || entry?.source === "room"),
  ];
  const floorTiles = layout && Number.isInteger(layout.floorTiles) ? [layout] : [];
  const placedHazards = layout && Array.isArray(layout.placedHazards) ? layout.placedHazards : [];
  const hazards = [
    ...(Array.isArray(summary.hazards) ? summary.hazards : []),
    ...cards.filter((entry) => entry?.type === "hazard" || entry?.source === "hazard"),
  ];
  const resources = [
    ...(Array.isArray(summary.resources) ? summary.resources : []),
    ...cards.filter((entry) => entry?.type === "resource" || entry?.source === "resource"),
  ];
  const actorCards = cards.filter((entry) => entry?.type === "delver" || entry?.type === "warden");
  const actorEntries = Array.isArray(summary.actors) ? summary.actors : [];
  const delvers = [
    ...actorCards.filter((entry) => entry.type === "delver"),
    ...actorEntries.filter((entry) => {
      const role = String(entry?.actorType || entry?.type || entry?.role || entry?.motivation || "").toLowerCase();
      return role.includes("delver") || role.includes("attack");
    }),
  ];
  const wardens = [
    ...actorCards.filter((entry) => entry.type === "warden"),
    ...actorEntries.filter((entry) => {
      const role = String(entry?.actorType || entry?.type || entry?.role || entry?.motivation || "").toLowerCase();
      return role.includes("warden") || role.includes("defend") || role.includes("stationary");
    }),
  ];
  return buildPoolWeightsForAuthoredKinds({ rooms, floorTiles, placedHazards, hazards, resources, delvers, wardens });
}

async function validateRunDryRun(args) {
  const simConfigPath = resolvePath(args["sim-config"]);
  const initialStatePath = resolvePath(args["initial-state"]);
  const executionPolicyPath = resolvePath(args["execution-policy"]);
  const actionsPath = resolvePath(args.actions);
  const affinityPresetsPath = resolvePath(args["affinity-presets"]);
  const affinityLoadoutsPath = resolvePath(args["affinity-loadouts"]);
  const affinitySummaryArg = args["affinity-summary"];
  const ticks = args.ticks !== undefined ? Number(args.ticks) : DEFAULT_TICKS;
  const seed = args.seed !== undefined ? Number(args.seed) : 0;

  if (!simConfigPath || !initialStatePath) {
    throw new Error("run requires --sim-config and --initial-state.");
  }
  if (!Number.isFinite(ticks) || ticks < 0) {
    throw new Error("run requires a valid --ticks value.");
  }
  if (!Number.isFinite(seed)) {
    throw new Error("run requires a valid --seed value.");
  }

  const simConfig = await readJson(simConfigPath);
  assertSchema(simConfig, SCHEMAS.simConfig);
  const initialState = await readJson(initialStatePath);
  assertSchema(initialState, SCHEMAS.initialState);
  const runId = args["run-id"]
    || simConfig?.meta?.runId
    || initialState?.meta?.runId
    || makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("run", runId);

  if (executionPolicyPath) {
    const executionPolicy = await readJson(executionPolicyPath);
    assertSchema(executionPolicy, SCHEMAS.executionPolicy);
  }

  const wantsAffinitySummary = affinitySummaryArg !== undefined || (affinityPresetsPath && affinityLoadoutsPath);
  if (wantsAffinitySummary && (!affinityPresetsPath || !affinityLoadoutsPath)) {
    throw new Error("Affinity summary requires --affinity-presets and --affinity-loadouts.");
  }
  if (affinityPresetsPath) {
    const affinityPresets = await readJson(affinityPresetsPath);
    assertSchema(affinityPresets, SCHEMAS.affinityPreset);
  }
  if (affinityLoadoutsPath) {
    const affinityLoadouts = await readJson(affinityLoadoutsPath);
    assertSchema(affinityLoadouts, SCHEMAS.actorLoadout);
  }

  if (actionsPath) {
    const actionLog = await readJson(actionsPath);
    if (!Array.isArray(actionLog.actions)) {
      throw new Error("actions file must include an actions array.");
    }
  }

  const actorSpecs = normalizeArgList(args.actor);
  const vitalSpecs = normalizeArgList(args.vital);
  const vitalDefaultSpecs = normalizeArgList(args["vital-default"]);
  const tileWalls = normalizeArgList(args["tile-wall"]);
  const tileBarriers = normalizeArgList(args["tile-barrier"]);
  const tileFloors = normalizeArgList(args["tile-floor"]);
  const vitalDefaults = resolveVitalDefaults(vitalDefaultSpecs);

  const resolvedSimConfig = JSON.parse(JSON.stringify(simConfig));
  const resolvedInitialState = JSON.parse(JSON.stringify(initialState));
  applyTileOverrides(resolvedSimConfig, {
    walls: tileWalls,
    barriers: tileBarriers,
    floors: tileFloors,
  });
  applyActorOverrides(resolvedInitialState, resolvedSimConfig, {
    actorSpecs,
    vitalSpecs,
    vitalDefaults,
  });

  return buildDryRunSuccess({
    command: "run",
    runId,
    outDir,
    actorIds: deriveActorIds(resolvedInitialState),
    roomIds: deriveRoomIds(resolvedSimConfig),
    extra: {
      ticks,
    },
  });
}

async function validateScenarioDryRun(args) {
  const fromRunId = args["from-run"];
  if (isNonEmptyString(fromRunId)) {
    if (isNonEmptyString(args.text)) {
      throw new Error("scenario does not allow --text together with --from-run.");
    }
    const resolvedFromRun = await resolveFromRunArtifactPaths(fromRunId);
    const runId = args["run-id"] || fromRunId;
    const outDir = resolvePath(args["out-dir"]) || defaultRunDir(runId);
    const runValidation = await validateRunDryRun({
      "sim-config": resolvedFromRun.simConfigPath,
      "initial-state": resolvedFromRun.initialStatePath,
      ticks: args.ticks,
      seed: args.seed,
      "run-id": runId,
      "out-dir": join(outDir, "run"),
      actor: args.actor,
      vital: args.vital,
      "vital-default": args["vital-default"],
      "tile-wall": args["tile-wall"],
      "tile-barrier": args["tile-barrier"],
      "tile-floor": args["tile-floor"],
      actions: args.actions,
      "execution-policy": args["execution-policy"],
      "affinity-presets": args["affinity-presets"],
      "affinity-loadouts": args["affinity-loadouts"],
      "affinity-summary": args["affinity-summary"],
    });
    return {
      ...runValidation,
      command: "scenario",
      outDir,
      artifactPaths: {
        source_sim_config: resolvedFromRun.simConfigPath,
        source_initial_state: resolvedFromRun.initialStatePath,
      },
    };
  }

  const scenarioPath = resolvePath(args.scenario);
  const textRaw = args.text;
  const promptRaw = args.prompt;
  const catalogOverride = resolvePath(args.catalog);
  const goalOverride = args.goal;
  const budgetTokensRaw = args["budget-tokens"];
  const model = args.model || process.env.AK_LLM_MODEL || DEFAULT_LLM_MODEL;
  const baseUrl = args["base-url"] || process.env.AK_LLM_BASE_URL || DEFAULT_LLM_BASE_URL;
  const promptInput = isNonEmptyString(promptRaw)
    ? promptRaw
    : isNonEmptyString(textRaw)
      ? textRaw
      : undefined;
  const fixturePath = resolvePath(args.fixture)
    || (!scenarioPath && isNonEmptyString(textRaw)
      ? resolveDefaultLlmFixturePath({ resolvePath, exists: existsSync, cwd: () => process.cwd() })
      : null);
  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunDir(runId);

  if (!scenarioPath && !catalogOverride) {
    throw new Error("llm-plan requires --scenario or --catalog.");
  }
  if (!scenarioPath && !isNonEmptyString(promptInput)) {
    throw new Error("llm-plan requires --text or --prompt when --scenario is omitted.");
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
    : scenario?.goal || promptInput || "LLM planning request";
  const resolvedBudgetTokens = budgetTokens !== undefined ? budgetTokens : scenario?.budgetTokens;
  if (!Number.isFinite(resolvedBudgetTokens) || resolvedBudgetTokens <= 0) {
    throw new Error("llm-plan requires --budget-tokens or scenario.budgetTokens > 0.");
  }

  const prompt = injectBudgetTokens(promptInput, resolvedBudgetTokens);
  const notes = [
    scenario?.notes,
    "Include at least one actor; counts must be > 0.",
    allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const basePrompt = isNonEmptyString(prompt)
    ? prompt
    : buildLlmActorConfigPromptTemplate({
      goal,
      notes,
      budgetTokens: resolvedBudgetTokens,
      affinities: allowedOptions.affinities,
      affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
      motivations: allowedOptions.motivations,
    });
  const constraintLines = buildLlmConstraintSection({ allowedPairsText });
  const finalPrompt = appendJsonOnlyInstruction(`${basePrompt}\n\n${constraintLines}`);
  const llmFormat = process.env.AK_LLM_FORMAT;

  let capture = null;
  let captures = [];
  let summary = null;
  let mappedSelections;
  let budgetPoolWeights = null;

  if (isLlmLiveEnabled() || Boolean(fixturePath)) {
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
      if (!loopResult.ok) {
        throw new Error(`llm-plan budget loop failed: ${JSON.stringify(loopResult.errors || [])}`);
      }
      captures = loopResult.captures || [];
      summary = loopResult.summary;
      mappedSelections = loopResult.selections;
      budgetPoolWeights = loopResult.poolWeights || null;
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
        throw new Error(`llm-plan session failed: ${JSON.stringify(session.errors || [])}`);
      }
      summary = session.summary;
      capture = session.capture;

      let mapped = mapSummaryToPool({ summary, catalog });
      let actorInstances = countInstances(mapped.selections, "actor");
      if (actorInstances === 0) {
        const missingSelections = summarizeMissingSelections(mapped.selections);
        const catalogRepairPrompt = buildLlmCatalogRepairPromptTemplate({
          basePrompt,
          allowedPairsText,
          missingSelections,
        });
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
          throw new Error(`llm-plan session failed: ${JSON.stringify(session.errors || [])}`);
        }
        summary = session.summary;
        capture = session.capture;
        mapped = mapSummaryToPool({ summary, catalog });
        actorInstances = countInstances(mapped.selections, "actor");
        if (actorInstances === 0) {
          const finalMissing = summarizeMissingSelections(mapped.selections);
          throw new Error(
            `llm-plan summary did not match catalog entries (actors=${actorInstances}).`
            + (finalMissing ? ` Unmatched picks: ${finalMissing}` : ""),
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
      throw new Error(`llm-plan summary fixture invalid: ${normalized.errors.map((entry) => entry.code).join(", ")}`);
    }
    summary = normalized.value;
  }

  let summaryForSpec = summary;
  if (!scenario) {
    summaryForSpec = { ...summary };
    if (isNonEmptyString(goal)) {
      summaryForSpec.goal = goal;
    }
    if (Number.isFinite(resolvedBudgetTokens)) {
      summaryForSpec.budgetTokens = resolvedBudgetTokens;
    }
  }
  if (!Array.isArray(summaryForSpec?.poolWeights) || summaryForSpec.poolWeights.length === 0) {
    const poolWeights = Array.isArray(budgetPoolWeights) && budgetPoolWeights.length > 0
      ? budgetPoolWeights
      : buildPoolWeightsForSummary(summaryForSpec);
    if (poolWeights.length > 0) {
      summaryForSpec = { ...summaryForSpec, poolWeights };
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

  return buildDryRunSuccess({
    command: "scenario",
    runId,
    outDir,
    actorIds: deriveActorIds(buildResult.initialState),
    roomIds: deriveRoomIds(buildResult.simConfig),
    budgetEstimate: buildDryRunBudgetEstimate({
      budgetReceipt: buildResult.budgetReceipt,
      spendProposal: buildResult.spendProposal,
      budgetTokens: resolvedBudgetTokens,
    }),
    extra: {
      ticks: args.ticks !== undefined ? Number(args.ticks) : undefined,
    },
  });
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

// Extract the primary motivation string from a parsed delver/warden card's
// `motivations` array. Delver cards append a synthetic "user_controlled" tag
// (see parseDelverSpec) alongside the actual requested motivation, so that
// tag must be excluded when resolving the single motivation.kind value the
// runtime persona layer reads (resolveActorMotivationKind expects
// actor.motivation.kind — see packages/runtime/src/personas/actor/controller.js).
function resolvePrimaryCardMotivation(card) {
  const motivations = Array.isArray(card?.motivations) ? card.motivations : [];
  return motivations.find((entry) => entry && entry !== "user_controlled") || null;
}

// ak_create/ak_configure accept --delver/--warden "motivation=<kind>" but
// orchestrateBuild (packages/runtime) does not carry that value through onto
// the actor records it writes into InitialStateArtifact — it is only used
// authoring-side for cost calculation (hasNonStationaryMobilityMotivation /
// requiresMovementStamina). Patch `motivation: { kind }` onto each actor here,
// matched by archetype + base-id prefix back to the parsed CLI card that
// produced it. InitialStateArtifactV1.actors entries are not a closed/enumerated
// key set (packages/runtime/src/contracts/artifacts.ts), so adding this field
// does not require a schemaVersion bump.
function applyMotivationToInitialStateActors(initialState, { parsedDelvers = [], parsedWardens = [] } = {}) {
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  if (actors.length === 0) {
    return;
  }

  const cardsByArchetype = {
    delver: parsedDelvers.map((entry) => ({
      baseId: entry?.value?.id,
      motivation: resolvePrimaryCardMotivation(entry?.value),
    })).filter((entry) => isNonEmptyString(entry.baseId) && isNonEmptyString(entry.motivation)),
    warden: parsedWardens.map((entry) => ({
      baseId: entry?.value?.id,
      motivation: resolvePrimaryCardMotivation(entry?.value),
    })).filter((entry) => isNonEmptyString(entry.baseId) && isNonEmptyString(entry.motivation)),
  };

  if (cardsByArchetype.delver.length === 0 && cardsByArchetype.warden.length === 0) {
    return;
  }

  actors.forEach((actor) => {
    const cards = cardsByArchetype[actor?.archetype];
    if (!cards || cards.length === 0) {
      return;
    }
    const match = cards.find((card) => actor.id === card.baseId || actor.id.startsWith(`${card.baseId}-`));
    if (match) {
      actor.motivation = { kind: match.motivation };
    }
  });
}

function attachMixedRoomAssembliesToBuildResult(buildResult) {
  const assemblies = summarizeMixedRoomAssemblies(buildResult?.simConfig?.layout?.data?.rooms);
  if (buildResult?.affinitySummary && typeof buildResult.affinitySummary === "object") {
    buildResult.affinitySummary = {
      ...buildResult.affinitySummary,
      mixedRoomAssemblies: assemblies,
    };
  }
  return assemblies;
}

function logMixedRoomAssembliesFromBuildResult(buildResult) {
  const assemblies = attachMixedRoomAssembliesToBuildResult(buildResult);
  formatMixedRoomAssembliesCliLines(assemblies).forEach((line) => {
    console.error(line);
  });
}

const commandKernel = createCommandKernel({
  readJson,
  readText,
  writeJson,
  resolvePath,
  join,
  dirname,
  exists: existsSync,
  makeId,
  createMeta,
  toRef,
  defaultBuildOutDir,
  defaultRunCommandOutDir,
  defaultLlmPlanOutDir,
  allowNetworkRequests,
  isLlmLiveEnabled,
  isLlmStrictEnabled,
  isLlmBudgetLoopEnabled,
  isLocalBaseUrl,
  createIpfsAdapter,
  createBlockchainAdapter,
  createLlmAdapter,
  createSolverAdapter: async (options) => {
    const { createSolverAdapter } = await import("../adapters/solver-z3/index.js");
    return createSolverAdapter(options);
  },
  nowIso: () => new Date().toISOString(),
  env: process.env,
  cwd: () => process.cwd(),
  log: (...parts) => console.error(...parts),
  warn: (...parts) => console.error(...parts),
});



async function buildCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedBuildArgs(args);
  const result = await commandKernel.build(args);
  emitJsonStdout(await summarizeBuildLikeOutput({
    command: "build",
    outDir: result.outDir,
  }));
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
  await commandKernel.solve(args);
}

async function runCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const resolvedArgs = await resolveRunInputArgs(args, { commandName: "run" });
  if (args["dry-run"]) {
    try {
      emitJsonStdout(await validateRunDryRun(resolvedArgs));
    } catch (error) {
      emitJsonStdout(buildDryRunFailure({
        command: "run",
        runId: resolvedArgs["run-id"] || "",
        outDir: resolvePath(resolvedArgs["out-dir"]),
        error,
      }));
    }
    return;
  }
  const progressEnabled = args.progress === true;
  const kernelArgs = progressEnabled
    ? {
        ...resolvedArgs,
        log: () => {},
        onTickProgress: (payload) => emitJsonStderr(payload),
      }
    : resolvedArgs;
  const result = await commandKernel.run(kernelArgs);
  emitJsonStdout(await summarizeRunOutput({ outDir: result.outDir, args: resolvedArgs }));
}

async function configuratorCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  await commandKernel.configurator(args);
}

async function budgetCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await commandKernel.budget(args);
  emitJsonStdout({ ok: true, command: "budget", ...result.output });
}

async function replayCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  await commandKernel.replay(args);
}

async function inspectCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await commandKernel.inspect(args);
  emitJsonStdout(await summarizeInspectOutput({ outDir: result.outDir }));
}

async function narrateCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const tickFramesPath = resolvePath(args["tick-frames"]);
  const initialStatePath = resolvePath(args["initial-state"]);
  if (!tickFramesPath || !initialStatePath) {
    throw new Error("narrate requires --tick-frames and --initial-state.");
  }

  const [frames, initialState] = await Promise.all([
    readJson(tickFramesPath),
    readJson(initialStatePath),
  ]);
  assertSchema(initialState, SCHEMAS.initialState);
  if (!Array.isArray(frames)) {
    throw new Error("narrate expects --tick-frames to contain a JSON array.");
  }
  frames.forEach((frame) => assertSchema(frame, SCHEMAS.tickFrame));

  const runId = initialState?.meta?.runId || frames[0]?.meta?.runId || makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("narrate", runId);
  const narrative = createNarrativeArtifact({ initialState, frames, runId });
  await writeJson(join(outDir, "narrative.json"), narrative);
  emitJsonStdout(await summarizeNarrateOutput({ outDir }));
}

async function ipfsCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("ipfs", runId);
  const outPath = resolvePath(args.out) || join(outDir, args.json ? "ipfs.json" : "ipfs.txt");
  const result = await commandKernel.ipfs(args);
  if (args.json) await writeJson(outPath, result.output);
  else await writeText(outPath, result.output);

  console.log(`ipfs: wrote ${outPath}`);
}

async function ipfsPublishCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const artifactMapPath = resolvePath(args["artifact-map"]);
  if (!artifactMapPath) {
    throw new Error("ipfs-publish requires --artifact-map.");
  }

  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("ipfs-publish", runId);
  const outPath = resolvePath(args.out) || join(outDir, "ipfs-publish.json");
  const artifactMap = await readJson(artifactMapPath);

  const result = await commandKernel.ipfsPublish({
    path: args.path,
    gateway: args.gateway,
    "fixture-cid": args["fixture-cid"],
    "artifact-map": artifactMap,
  });
  await writeJson(outPath, {
    cid: result.cid,
    rootPath: result.rootPath || "",
    publishedFiles: result.publishedFiles || [],
    mode: result.mode || "live",
  });
  console.log(`ipfs-publish: wrote ${outPath}`);
}

async function ipfsLoadCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("ipfs-load", runId);
  const outPath = resolvePath(args.out) || join(outDir, "ipfs-load.json");
  const fixtureMapPath = resolvePath(args["fixture-map"]);
  const fixtureMap = fixtureMapPath ? await readJson(fixtureMapPath) : undefined;

  const result = await commandKernel.ipfsLoad({
    cid: args.cid,
    path: args.path,
    file: args.file,
    gateway: args.gateway,
    "fixture-map": fixtureMap,
  });

  const fetched = result?.fetched || {};
  for (const [fileName, payload] of Object.entries(fetched)) {
    await writeJson(join(outDir, fileName), payload);
  }
  await writeJson(outPath, {
    cid: result.cid,
    rootPath: result.rootPath || "",
    fetchedFiles: Object.keys(fetched),
    missing: result.missing || [],
  });
  console.log(`ipfs-load: wrote ${outDir}`);
}

async function blockchainCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("blockchain", runId);
  const outPath = resolvePath(args.out) || join(outDir, "blockchain.json");
  const result = await commandKernel.blockchain(args);
  await writeJson(outPath, result.output);
  console.log(`blockchain: wrote ${outPath}`);
}

async function blockchainMintCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("blockchain-mint", runId);
  const outPath = resolvePath(args.out) || join(outDir, "blockchain-mint.json");
  const result = await commandKernel.blockchainMint(args);
  await writeJson(outPath, result.output);
  console.log(`blockchain-mint: wrote ${outPath}`);
}

async function blockchainLoadCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("blockchain-load", runId);
  const outPath = resolvePath(args.out) || join(outDir, "blockchain-load.json");
  const result = await commandKernel.blockchainLoad(args);
  await writeJson(outPath, result.output);
  console.log(`blockchain-load: wrote ${outPath}`);
}

async function llmCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("llm", runId);
  const outPath = resolvePath(args.out) || join(outDir, "llm.json");
  const result = await commandKernel.llm(args);
  await writeJson(outPath, result.output);
  console.log(`llm: wrote ${outPath}`);
}

async function agentAuthoringCommand(argv, { commandName, action, allowDryRun = false } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedAgentAuthoringArgs(commandName, args, { allowDryRun });

  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir(commandName, runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : DEFAULT_DUNGEON_AFFINITY;
  if (!ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`${commandName} --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], `${commandName} --budget-tokens`);
  }
  let dungeonBudgetTokensFlag;
  if (args["dungeon-budget-tokens"] !== undefined) {
    dungeonBudgetTokensFlag = parsePositiveIntStrict(args["dungeon-budget-tokens"], `${commandName} --dungeon-budget-tokens`);
  }
  let delverBudgetTokensFlag;
  if (args["delver-budget-tokens"] !== undefined) {
    delverBudgetTokensFlag = parsePositiveIntStrict(args["delver-budget-tokens"], `${commandName} --delver-budget-tokens`);
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error(`${commandName} requires both --budget and --price-list.`);
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const authoringText = [args.text, args.goal].filter(isNonEmptyString).join("\n");
  const textBudgetTokens = extractBudgetTokensFromText(authoringText, `${commandName} freeform text`);
  const {
    resolvedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName,
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });

  const parsedRooms = normalizeList(args.room)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((value, index) => ({ prompt: value, ...parseRoomSpec(value, index + 1) }));
  const parsedFloorTiles = normalizeList(args["floor-tile"])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((value, index) => ({ prompt: value, value: parseFloorTileSpec(value, index + 1) }));
  const parsedHazards = normalizeList(args.hazard)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((value, index) => ({ prompt: value, value: parseAuthoringHazardSpec(value, index + 1) }));
  const canonicalHazardEntries = parsedHazards;
  const occupiedHazardPositions = new Set();
  for (const entry of canonicalHazardEntries) {
    const hazard = entry.value;
    if (!Number.isFinite(hazard?.x) || !Number.isFinite(hazard?.y)) continue;
    const positionKey = `${hazard.x},${hazard.y}`;
    if (occupiedHazardPositions.has(positionKey)) {
      throw new Error(`duplicate_hazard: multiple hazards occupy room-relative position (${positionKey})`);
    }
    occupiedHazardPositions.add(positionKey);
  }
  const parsedResources = normalizeList(args.resource)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((value, index) => ({ prompt: value, value: parseResourceSpec(value, index + 1) }));
  const parsedDelvers = normalizeList(args.delver)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((value, index) => ({ prompt: value, ...parseDelverSpec(value, index + 1, { defaultAffinity: dungeonAffinity }) }));
  const parsedWardens = normalizeList(args.warden)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((value, index) => ({ prompt: value, value: parseWardenSpec(value, index + 1, { defaultAffinity: dungeonAffinity }) }));

  // No size=small precheck for placed hazards: size=small generates the identical
  // grid/room geometry size=medium does (ensureAuthoringLevelGenCapacity bumps
  // roomMinSize to MIN_ROOM_SIZE_WITH_ITEMS when placedHazards are present), so rejecting
  // small rooms contradicts the geometry the generator actually produces. Hazard
  // placement is validated against the real generated room: room-relative
  // coordinates that exceed the room's interior are rejected with a structured
  // hazard_outside_room error by the level-gen layer (level-layout.js).

  if (
    parsedRooms.length === 0
    && parsedFloorTiles.length === 0
    && parsedHazards.length === 0
    && parsedResources.length === 0
    && parsedDelvers.length === 0
    && parsedWardens.length === 0
  ) {
    throw new Error(`${commandName} requires at least one authored object via --room, --floor-tile, --hazard, --resource, --delver, or --warden.`);
  }

  const textVitalScope = parsedDelvers.length > 0 && parsedWardens.length === 0
    ? "delver"
    : parsedWardens.length > 0 && parsedDelvers.length === 0
      ? "warden"
      : null;
  const textVitalGoals = resolveTextVitalOptimizationGoals({
    commandName,
    text: authoringText,
    scope: textVitalScope,
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: authoringText,
    hardBudgetConstraint: authoringConstraints,
  });
  const shouldMaximizeSpend = sharedOptimizationGoals.some((entry) => entry.kind === "maximize_budget_spend");
  const textDelverGoals = textVitalScope === "delver" ? textVitalGoals : [];
  const textWardenGoals = textVitalScope === "warden" ? textVitalGoals : [];
  // Resolve split budgets: explicit split flags take priority over combined budget.
  const resolvedDungeonBudgetTokens = dungeonBudgetTokensFlag !== undefined
    ? dungeonBudgetTokensFlag
    : (delverBudgetTokensFlag !== undefined ? undefined : resolvedBudgetTokens);
  const resolvedDelverBudgetTokens = delverBudgetTokensFlag !== undefined
    ? delverBudgetTokensFlag
    : (dungeonBudgetTokensFlag !== undefined ? undefined : resolvedBudgetTokens);
  const hasSplitBudget = dungeonBudgetTokensFlag !== undefined || delverBudgetTokensFlag !== undefined;

  if (hasSplitBudget) {
    // Split-budget feasibility: check dungeon and delver sides independently.
    if (Number.isInteger(resolvedDungeonBudgetTokens) && parsedFloorTiles.length === 0 && parsedHazards.length === 0) {
      ensureBudgetedFulfillmentFeasible({
        commandName,
        budgetTokens: resolvedDungeonBudgetTokens,
        rooms: parsedRooms,
        delvers: [],
        wardens: [],
        priceListArtifact,
      });
    }
    if (Number.isInteger(resolvedDelverBudgetTokens)) {
      ensureBudgetedFulfillmentFeasible({
        commandName,
        budgetTokens: resolvedDelverBudgetTokens,
        rooms: [],
        delvers: parsedDelvers.map((entry) => ({
          ...entry,
          optimizationGoals: dedupeOptimizationGoals([
            ...(entry.optimizationGoals || []),
            ...textDelverGoals,
          ]),
        })),
        wardens: parsedWardens,
        priceListArtifact,
      });
    }
  } else if (
    Number.isInteger(resolvedBudgetTokens)
    && parsedFloorTiles.length === 0
    && parsedHazards.length === 0
    && parsedHazards.length === 0
    && parsedResources.length === 0
  ) {
    ensureBudgetedFulfillmentFeasible({
      commandName,
      budgetTokens: resolvedBudgetTokens,
      rooms: parsedRooms,
      delvers: parsedDelvers.map((entry) => ({
        ...entry,
        optimizationGoals: dedupeOptimizationGoals([
          ...(entry.optimizationGoals || []),
          ...textDelverGoals,
        ]),
      })),
      wardens: parsedWardens,
      priceListArtifact,
    });
  }

  let fulfilled;
  if (hasSplitBudget) {
    // Split-budget fulfillment: maximize each side against its own budget.
    const dungeonFulfilled = (shouldMaximizeSpend && parsedFloorTiles.length === 0 && parsedHazards.length === 0)
      ? applyBudgetCappedFulfillment({
        rooms: parsedRooms,
        delvers: [],
        priceListArtifact,
        budgetTokens: resolvedDungeonBudgetTokens,
      })
      : { rooms: parsedRooms, delvers: [] };
    const delverFulfilled = shouldMaximizeSpend && parsedWardens.length === 0
      ? applyBudgetCappedFulfillment({
        rooms: [],
        delvers: parsedDelvers.map((entry) => ({
          ...entry,
          optimizationGoals: dedupeOptimizationGoals([
            ...(entry.optimizationGoals || []),
            ...textDelverGoals,
          ]),
        })),
        priceListArtifact,
        budgetTokens: resolvedDelverBudgetTokens,
      })
      : { rooms: [], delvers: parsedDelvers };
    fulfilled = { rooms: dungeonFulfilled.rooms, delvers: delverFulfilled.delvers };
  } else {
    fulfilled = (
      shouldMaximizeSpend
      && parsedFloorTiles.length === 0
      && parsedHazards.length === 0
      && parsedHazards.length === 0
      && parsedResources.length === 0
      && parsedWardens.length === 0
    )
      ? applyBudgetCappedFulfillment({
        rooms: parsedRooms,
        delvers: parsedDelvers.map((entry) => ({
          ...entry,
          optimizationGoals: dedupeOptimizationGoals([
            ...(entry.optimizationGoals || []),
            ...textDelverGoals,
          ]),
        })),
        priceListArtifact,
        budgetTokens: resolvedBudgetTokens,
      })
      : { rooms: parsedRooms, delvers: parsedDelvers };
  }

  const summary = {
    goal: deriveGoalForAgentCommand({
      action,
      goal: args.goal,
      objects: [
        ...parsedRooms.map((entry) => ({ kind: "room" })),
        ...parsedFloorTiles.map((entry) => ({ kind: "floor_tile" })),
        ...canonicalHazardEntries.map((entry) => ({ kind: "hazard" })),
        ...parsedResources.map((entry) => ({ kind: "resource" })),
        ...parsedDelvers.map((entry) => ({ kind: "delver" })),
        ...parsedWardens.map((entry) => ({ kind: "warden" })),
      ],
    }),
    dungeonAffinity,
    rooms: fulfilled.rooms.map((entry) => entry.value),
    actors: [...fulfilled.delvers.map((entry) => entry.value), ...parsedWardens.map((entry) => entry.value)],
    poolWeights: buildPoolWeightsForAuthoredKinds({
      rooms: fulfilled.rooms,
      floorTiles: parsedFloorTiles,
      hazards: parsedHazards,
      hazards: canonicalHazardEntries,
      resources: parsedResources,
      delvers: fulfilled.delvers,
      wardens: parsedWardens,
    }),
  };
  if (parsedRooms.length === 0 && parsedFloorTiles.length === 0 && parsedHazards.length === 0) {
    summary.budgetScaffold = true;
  }
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }
  if (dungeonBudgetTokensFlag !== undefined) {
    summary.dungeonBudgetTokens = dungeonBudgetTokensFlag;
  }
  if (delverBudgetTokensFlag !== undefined) {
    summary.delverBudgetTokens = delverBudgetTokensFlag;
  }

  const built = buildBuildSpecFromSummary({
    summary,
    runId,
    createdAt,
    source: `cli-${commandName}`,
    budgetArtifact: budgetArtifact || undefined,
    priceListArtifact: priceListArtifact || undefined,
  });
  if (!built.ok || !built.spec) {
    throw new Error(`${commandName} build spec failed: ${built.errors.join("; ")}`);
  }

  const walkableTilesTarget = parsedFloorTiles.reduce((sum, entry) => sum + entry.value.count, 0);
  const placedHazards = canonicalHazardEntries
    .map((entry) => entry.value)
    .filter((entry) => entry.x !== undefined && entry.y !== undefined);
  const levelGen = ensureAuthoringLevelGenCapacity(
    built.spec.configurator?.inputs?.levelGen || {},
    { walkableTilesTarget, placedHazards, rooms: parsedRooms },
  );
  if (walkableTilesTarget > 0) {
    levelGen.walkableTilesTarget = walkableTilesTarget;
  }
  if (canonicalHazardEntries.length > 0) {
    levelGen.hazards = canonicalHazardEntries.map(({ value: entry }) => {
      if (entry.x === undefined || entry.y === undefined) {
        return { ...entry };
      }
      return {
        id: entry.id,
        x: entry.x,
        y: entry.y,
        blocking: entry.blocking === true,
        affinity: { ...entry.affinityStacks[0] },
        vitals: { ...entry.vitals },
      };
    });
  }
  built.spec.configurator.inputs.levelGen = levelGen;

  if (sharedOptimizationGoals.some((entry) => entry.kind === "maximize_budget_spend")) {
    built.spec.configurator.inputs.maximizeBudget = true;
  }

  const resources = parsedResources.map((entry) => entry.value);
  if (resources.length > 0) {
    built.spec.configurator.inputs.resources = resources.map((entry) => {
      if (entry._schemaVersion === 3) {
        return { id: entry.id, permanenceMode: entry.permanenceMode, vitals: entry.vitals };
      }
      return { id: entry.id, tier: entry.tier, stat: entry.stat, delta: entry.delta, dropRate: entry.dropRate };
    });
  }

  const sharedConfig = {
    dungeonAffinity,
    budgetTokens: resolvedBudgetTokens,
    roomCount: fulfilled.rooms.reduce((sum, entry) => sum + entry.value.count, 0) || undefined,
    constraints: authoringConstraints,
    optimizationGoals: sharedOptimizationGoals.length > 0 ? sharedOptimizationGoals : undefined,
  };
  Object.keys(sharedConfig).forEach((key) => {
    if (sharedConfig[key] === undefined) delete sharedConfig[key];
  });

  const objectRequests = [
    ...fulfilled.rooms.map((entry) => ({
      kind: "room",
      prompt: entry.prompt,
      count: entry.value.count,
      attributes: {
        size: entry.value.size,
        affinity: entry.value.affinity,
        affinities: entry.value.affinities,
      },
    })),
    ...parsedFloorTiles.map((entry) => ({
      kind: "floor_tile",
      prompt: entry.prompt,
      count: entry.value.count,
      id: entry.value.id,
      attributes: {
        count: entry.value.count,
      },
    })),
    ...parsedHazards.map((entry) => ({
      kind: "hazard",
      prompt: entry.prompt,
      id: entry.value.id,
      attributes: {
        affinity: entry.value.affinity,
        expression: entry.value.expression,
        proximityRadius: entry.value.proximityRadius,
        affinityStacks: entry.value.affinityStacks,
        vitals: entry.value.vitals,
      },
    })),
    ...parsedResources.map((entry) => ({
      kind: "resource",
      prompt: entry.prompt,
      id: entry.value.id,
      attributes: {
        tier: entry.value.tier,
        stat: entry.value.stat,
        delta: entry.value.delta,
        dropRate: entry.value.dropRate,
      },
    })),
    ...fulfilled.delvers.map((entry) => ({
      kind: "delver",
      prompt: entry.prompt,
      id: entry.value.id,
      count: entry.value.count,
      attributes: {
        affinity: entry.value.affinity,
        motivations: entry.value.motivations,
        affinities: entry.value.affinities,
        vitals: entry.value.vitals,
        setupMode: entry.value.setupMode,
      },
      optimizationGoals: dedupeOptimizationGoals([
        ...(entry.optimizationGoals || []),
        ...textDelverGoals,
      ]),
    })),
    ...parsedWardens.map((entry) => ({
      kind: "warden",
      prompt: entry.prompt,
      id: entry.value.id,
      count: entry.value.count,
      attributes: {
        affinity: entry.value.affinity,
        motivations: entry.value.motivations,
        affinities: entry.value.affinities,
        vitals: entry.value.vitals,
      },
      optimizationGoals: dedupeOptimizationGoals(textWardenGoals),
    })),
  ];
  objectRequests.forEach((entry) => {
    if (!entry.optimizationGoals || entry.optimizationGoals.length === 0) {
      delete entry.optimizationGoals;
    }
  });
  if (Object.keys(sharedConfig).length > 0) {
    objectRequests.push({
      kind: "shared_config",
      prompt: isNonEmptyString(args.text) ? args.text.trim() : `shared config for ${commandName}`,
      attributes: { ...sharedConfig },
    });
  }

  const requestArtifact = buildAgentCommandRequestArtifact({
    action,
    commandText: describeAgentCommandText({ action, text: args.text, objects: objectRequests }),
    runId,
    createdAt,
    objectRequests,
    sharedConfig,
  });
  applyAuthoringSection(built.spec, buildAuthoringSection({
    objectKinds: Array.from(new Set(objectRequests.map((entry) => entry.kind))),
    request: requestArtifact,
    constraints: authoringConstraints,
    sharedOptimizationGoals,
    objectOptimizationGoals: objectRequests.flatMap((entry) => entry.optimizationGoals || []),
  }), commandName);

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: `cli-${commandName}`,
  });
  attachMixedRoomAssembliesToBuildResult(buildResult);
  applyMotivationToInitialStateActors(buildResult.initialState, { parsedDelvers, parsedWardens });

  if (args["dry-run"]) {
    emitJsonStdout(buildDryRunSuccess({
      command: commandName,
      runId,
      outDir,
      actorIds: deriveActorIds(buildResult.initialState),
      roomIds: deriveRoomIds(buildResult.simConfig),
      budgetEstimate: buildDryRunBudgetEstimate({
        budgetReceipt: buildResult.budgetReceipt,
        spendProposal: buildResult.spendProposal,
        budgetTokens: resolvedBudgetTokens,
      }),
    }));
    return;
  }

  const stdoutSummary = await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    requestArtifact,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName,
    producedBy: `cli-${commandName}`,
  });

  await writeHazardArtifactFiles({
    parsedHazards: canonicalHazardEntries,
    outDir,
    runId,
    createdAt,
    producedBy: `cli-${commandName}`,
  });
  await writeResourceArtifactFiles({
    parsedResources,
    outDir,
    runId,
    createdAt,
    producedBy: `cli-${commandName}`,
  });

  emitJsonStdout(stdoutSummary);
}

async function createCommand(argv) {
  const args = parseArgs(argv);
  if (args["dry-run"]) {
    try {
      await agentAuthoringCommand(argv, { commandName: "create", action: "author", allowDryRun: true });
    } catch (error) {
      emitJsonStdout(buildDryRunFailure({
        command: "create",
        runId: args["run-id"] || "",
        outDir: resolvePath(args["out-dir"]),
        error,
      }));
    }
    return;
  }
  await agentAuthoringCommand(argv, { commandName: "create", action: "author", allowDryRun: true });
}

async function configureAuthoringCommand(argv) {
  await agentAuthoringCommand(argv, { commandName: "configure", action: "configure" });
}

async function roomPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedRoomPlanArgs(args);

  const parsedRooms = parseRoomSpecs(args.room);
  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("room-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : DEFAULT_ROOM_CARD_AFFINITY;
  if (!ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`room-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "room-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("room-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author dungeon rooms (${parsedRooms.length} configuration${parsedRooms.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "room-plan --goal");
  const {
    resolvedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "room-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  resolveTextVitalOptimizationGoals({
    commandName: "room-plan",
    text: goal,
    scope: null,
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  ensureBudgetedFulfillmentFeasible({
    commandName: "room-plan",
    budgetTokens: resolvedBudgetTokens,
    rooms: parsedRooms,
    delvers: [],
    priceListArtifact,
  });
  const fulfilledRooms = applyBudgetCappedFulfillment({
    rooms: parsedRooms,
    delvers: [],
    priceListArtifact,
    budgetTokens: resolvedBudgetTokens,
  }).rooms;
  const summary = {
    goal,
    dungeonAffinity,
    rooms: fulfilledRooms.map((entry) => entry.value),
    actors: [],
    poolWeights: [{ id: "rooms", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const built = buildBuildSpecFromSummary({
    summary,
    runId,
    createdAt,
    source: "cli-room-plan",
    budgetArtifact: budgetArtifact || undefined,
    priceListArtifact: priceListArtifact || undefined,
  });
  if (!built.ok) {
    throw new Error(`room-plan build spec failed: ${built.errors.join("; ")}`);
  }
  applyAuthoringSection(built.spec, buildAuthoringSection({
    objectKinds: ["room"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
  }), "room-plan");

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: "cli-room-plan",
  });
  attachMixedRoomAssembliesToBuildResult(buildResult);
  emitJsonStdout(await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "room-plan",
    producedBy: "cli-room-plan",
  }));
}

async function hazardPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedHazardPlanArgs(args);

  const parsedHazards = parseHazardSpecs(args.hazard);
  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("hazard-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : DEFAULT_DUNGEON_AFFINITY;
  if (!ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`hazard-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "hazard-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("hazard-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author hazards (${parsedHazards.length} configuration${parsedHazards.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "hazard-plan --goal");
  const {
    resolvedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "hazard-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  const hazards = parsedHazards.map((entry) => entry.value);
  const summary = {
    goal,
    dungeonAffinity,
    hazards,
    budgetScaffold: true,
    poolWeights: [{ id: "hazards", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const built = buildBuildSpecFromSummary({
    summary,
    runId,
    createdAt,
    source: "cli-hazard-plan",
    budgetArtifact: budgetArtifact || undefined,
    priceListArtifact: priceListArtifact || undefined,
  });
  if (!built.ok) {
    throw new Error(`hazard-plan build spec failed: ${built.errors.join("; ")}`);
  }
  applyAuthoringSection(built.spec, buildAuthoringSection({
    objectKinds: ["hazard"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
  }), "hazard-plan");

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: "cli-hazard-plan",
  });
  attachMixedRoomAssembliesToBuildResult(buildResult);
  const stdoutSummary = await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "hazard-plan",
    producedBy: "cli-hazard-plan",
  });
  await writeHazardArtifactFiles({
    parsedHazards,
    outDir,
    runId,
    createdAt,
    producedBy: "cli-hazard-plan",
  });
  emitJsonStdout(stdoutSummary);
}

async function resourcePlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedResourcePlanArgs(args);

  const parsedResources = parseResourceSpecs(args.resource);
  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("resource-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : DEFAULT_DUNGEON_AFFINITY;
  if (!ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`resource-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "resource-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("resource-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author resources (${parsedResources.length} configuration${parsedResources.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "resource-plan --goal");
  const {
    resolvedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "resource-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  const resources = parsedResources.map((entry) => entry.value);
  const summary = {
    goal,
    dungeonAffinity,
    resources,
    budgetScaffold: true,
    poolWeights: [{ id: "resources", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const built = buildBuildSpecFromSummary({
    summary,
    runId,
    createdAt,
    source: "cli-resource-plan",
    budgetArtifact: budgetArtifact || undefined,
    priceListArtifact: priceListArtifact || undefined,
  });
  if (!built.ok) {
    throw new Error(`resource-plan build spec failed: ${built.errors.join("; ")}`);
  }
  applyAuthoringSection(built.spec, buildAuthoringSection({
    objectKinds: ["resource"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
  }), "resource-plan");

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: "cli-resource-plan",
  });
  attachMixedRoomAssembliesToBuildResult(buildResult);
  const stdoutSummary = await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "resource-plan",
    producedBy: "cli-resource-plan",
  });
  await writeResourceArtifactFiles({
    parsedResources,
    outDir,
    runId,
    createdAt,
    producedBy: "cli-resource-plan",
  });
  emitJsonStdout(stdoutSummary);
}

async function delverPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedDelverPlanArgs(args);

  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("delver-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : DEFAULT_DUNGEON_AFFINITY;
  if (!ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`delver-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const parsedDelvers = parseDelverSpecs(args.delver, { defaultAffinity: dungeonAffinity });

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "delver-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("delver-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author delvers (${parsedDelvers.length} configuration${parsedDelvers.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "delver-plan --goal");
  const {
    resolvedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "delver-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  const textVitalGoals = resolveTextVitalOptimizationGoals({
    commandName: "delver-plan",
    text: goal,
    scope: "delver",
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  const delverOptimizationGoals = dedupeOptimizationGoals([
    ...parsedDelvers.flatMap((entry) => entry.optimizationGoals || []),
    ...textVitalGoals,
  ]);
  ensureBudgetedFulfillmentFeasible({
    commandName: "delver-plan",
    budgetTokens: resolvedBudgetTokens,
    rooms: [],
    delvers: parsedDelvers.map((entry) => ({
      ...entry,
      optimizationGoals: dedupeOptimizationGoals([
        ...(entry.optimizationGoals || []),
        ...textVitalGoals,
      ]),
    })),
    priceListArtifact,
  });
  const fulfilledDelvers = applyBudgetCappedFulfillment({
    rooms: [],
    delvers: parsedDelvers.map((entry) => ({
      ...entry,
      optimizationGoals: dedupeOptimizationGoals([
        ...(entry.optimizationGoals || []),
        ...textVitalGoals,
      ]),
    })),
    priceListArtifact,
    budgetTokens: resolvedBudgetTokens,
  }).delvers;
  const summary = {
    goal,
    dungeonAffinity,
    cardSet: fulfilledDelvers.map((entry) => entry.value),
    budgetScaffold: true,
    poolWeights: [{ id: "delver", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const built = buildBuildSpecFromSummary({
    summary,
    runId,
    createdAt,
    source: "cli-delver-plan",
    budgetArtifact: budgetArtifact || undefined,
    priceListArtifact: priceListArtifact || undefined,
  });
  if (!built.ok) {
    throw new Error(`delver-plan build spec failed: ${built.errors.join("; ")}`);
  }
  applyAuthoringSection(built.spec, buildAuthoringSection({
    objectKinds: ["delver"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
    objectOptimizationGoals: delverOptimizationGoals,
  }), "delver-plan");

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: "cli-delver-plan",
  });
  attachMixedRoomAssembliesToBuildResult(buildResult);
  emitJsonStdout(await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "delver-plan",
    producedBy: "cli-delver-plan",
  }));
}

async function wardenPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedWardenPlanArgs(args);

  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("warden-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : DEFAULT_DUNGEON_AFFINITY;
  if (!ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`warden-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const wardens = parseWardenSpecs(args.warden, { defaultAffinity: dungeonAffinity });

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "warden-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("warden-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author wardens (${wardens.length} configuration${wardens.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "warden-plan --goal");
  const {
    resolvedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "warden-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  const textVitalGoals = resolveTextVitalOptimizationGoals({
    commandName: "warden-plan",
    text: goal,
    scope: "warden",
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  ensureBudgetedFulfillmentFeasible({
    commandName: "warden-plan",
    budgetTokens: resolvedBudgetTokens,
    rooms: [],
    delvers: [],
    wardens: wardens.map((entry) => ({
      value: entry,
      optimizationGoals: dedupeOptimizationGoals(textVitalGoals),
    })),
    priceListArtifact,
  });
  const summary = {
    goal,
    dungeonAffinity,
    cardSet: wardens,
    budgetScaffold: true,
    poolWeights: [{ id: "wardens", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const built = buildBuildSpecFromSummary({
    summary,
    runId,
    createdAt,
    source: "cli-warden-plan",
    budgetArtifact: budgetArtifact || undefined,
    priceListArtifact: priceListArtifact || undefined,
  });
  if (!built.ok) {
    throw new Error(`warden-plan build spec failed: ${built.errors.join("; ")}`);
  }
  applyAuthoringSection(built.spec, buildAuthoringSection({
    objectKinds: ["warden"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
    objectOptimizationGoals: textVitalGoals,
  }), "warden-plan");

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: "cli-warden-plan",
  });
  attachMixedRoomAssembliesToBuildResult(buildResult);
  emitJsonStdout(await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "warden-plan",
    producedBy: "cli-warden-plan",
  }));
}

async function llmPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await commandKernel.llmPlan(args);
  emitJsonStdout(await summarizeBuildLikeOutput({
    command: "llm-plan",
    outDir: result.outDir,
  }));
}

async function scenarioCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  assertAllowedScenarioArgs(args);
  const fromRunId = args["from-run"];
  const hasFromRun = isNonEmptyString(fromRunId);
  if (!hasFromRun && !isNonEmptyString(args.text)) {
    throw new Error("scenario requires --text or --from-run.");
  }
  if (hasFromRun && isNonEmptyString(args.text)) {
    throw new Error("scenario does not allow --text together with --from-run.");
  }
  if (args["dry-run"]) {
    try {
      emitJsonStdout(await validateScenarioDryRun(args));
    } catch (error) {
      emitJsonStdout(buildDryRunFailure({
        command: "scenario",
        runId: args["run-id"] || "",
        outDir: resolvePath(args["out-dir"]),
        error,
      }));
    }
    return;
  }

  const runId = args["run-id"] || fromRunId || makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultRunDir(runId);
  const runOutDir = join(outDir, "run");
  const inspectOutDir = join(outDir, "inspect");
  let llmPlanResult = null;
  let llmPlanSummary = null;
  let sourceArtifactPaths = null;
  let runArgs;

  if (hasFromRun) {
    const resolvedFromRun = await resolveFromRunArtifactPaths(fromRunId);
    runArgs = {
      "sim-config": resolvedFromRun.simConfigPath,
      "initial-state": resolvedFromRun.initialStatePath,
      ticks: args.ticks,
      seed: args.seed,
      "run-id": runId,
      "out-dir": runOutDir,
    };
    sourceArtifactPaths = {
      source_sim_config: resolvedFromRun.simConfigPath,
      source_initial_state: resolvedFromRun.initialStatePath,
    };
  } else {
    const llmPlanOutDir = join(outDir, "llm-plan");
    const llmPlanArgs = {
      text: args.text,
      catalog: args.catalog,
      model: args.model,
      goal: args.goal,
      "budget-tokens": args["budget-tokens"],
      "base-url": args["base-url"],
      fixture: args.fixture,
      "budget-loop": args["budget-loop"],
      "budget-pool": args["budget-pool"],
      "budget-reserve": args["budget-reserve"],
      "run-id": runId,
      "created-at": args["created-at"],
      "emit-intermediates": args["emit-intermediates"],
      "out-dir": llmPlanOutDir,
    };
    llmPlanResult = await commandKernel.llmPlan(llmPlanArgs);

    const simConfigPath = join(llmPlanResult.outDir, "sim-config.json");
    const initialStatePath = join(llmPlanResult.outDir, "initial-state.json");
    if (!existsSync(simConfigPath) || !existsSync(initialStatePath)) {
      throw new Error("scenario requires llm-plan to produce sim-config.json and initial-state.json.");
    }

    runArgs = {
      "sim-config": simConfigPath,
      "initial-state": initialStatePath,
      ticks: args.ticks,
      seed: args.seed,
      "run-id": runId,
      "out-dir": runOutDir,
    };
  }
  const runResult = await commandKernel.run(runArgs);

  const inspectResult = await commandKernel.inspect({
    "tick-frames": join(runResult.outDir, "tick-frames.json"),
    "effects-log": join(runResult.outDir, "effects-log.json"),
    "out-dir": inspectOutDir,
  });

  const [runSummary, inspectSummary] = await Promise.all([
    summarizeRunOutput({
      outDir: runResult.outDir,
      args: runArgs,
    }),
    summarizeInspectOutput({
      outDir: inspectResult.outDir,
    }),
  ]);
  if (llmPlanResult) {
    llmPlanSummary = await summarizeBuildLikeOutput({
      command: "llm-plan",
      outDir: llmPlanResult.outDir,
    });
  }

  emitJsonStdout(buildScenarioSummary({
    runId,
    outDir,
    llmPlanSummary,
    sourceArtifactPaths,
    runSummary,
    inspectSummary,
  }));
}

async function showCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!isNonEmptyString(args["run-id"])) {
    throw new Error("show requires --run-id <id>.");
  }
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help" || key === "run-id") {
      continue;
    }
    unknown.push(`--${key}`);
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`show only accepts --run-id. Unknown: ${unknown.join(", ")}`);
  }
  emitJsonStdout(await summarizeRunShow({ runId: args["run-id"] }));
}

async function diffCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!isNonEmptyString(args["run-a"]) || !isNonEmptyString(args["run-b"])) {
    throw new Error("diff requires --run-a <id> and --run-b <id>.");
  }
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help" || key === "run-a" || key === "run-b") {
      continue;
    }
    unknown.push(`--${key}`);
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`diff only accepts --run-a and --run-b. Unknown: ${unknown.join(", ")}`);
  }
  emitJsonStdout(await summarizeRunDiff({ runA: args["run-a"], runB: args["run-b"] }));
}

async function tickCommand(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(usage());
    return;
  }

  const validSubcommands = ["forward", "backward", "state"];
  if (!validSubcommands.includes(subcommand)) {
    throw new Error(`Unknown tick subcommand: ${subcommand}. Expected: forward, backward, state`);
  }

  const args = parseArgs(rest);
  const runId = args["run-id"];
  if (!runId) {
    throw new Error("tick requires --run-id <id>");
  }

  const vizMode = args["visualization"];
  if (vizMode !== undefined) {
    const check = validateVisualizationMode(vizMode);
    if (!check.ok) {
      emitJsonStdout({ ok: false, command: "tick", action: subcommand, runId, error: check.error });
      process.exit(1);
    }
  }

  const runDir = resolveTickRunDir(runId);
  if (!existsSync(runDir)) {
    throw new Error(`run directory not found: ${runDir}`);
  }

  const maxTick = await readMaxTick(runDir);
  if (maxTick === null) {
    throw new Error(`run directory not found or missing tick-frames.json for run: ${runId}`);
  }

  const stored = await readCursor(runDir);
  const currentTick = stored !== null ? stored.tick : 0;

  if (subcommand === "forward") {
    if (currentTick >= maxTick) {
      emitJsonStdout({
        ok: false,
        command: "tick",
        action: "forward",
        runId,
        tick: currentTick,
        maxTick,
        error: `cannot advance past max tick ${maxTick}`,
      });
      process.exit(1);
    }
    const newTick = currentTick + 1;
    await writeCursor(runDir, runId, newTick, maxTick);
    const result = {
      ok: true,
      command: "tick",
      action: "forward",
      runId,
      previousTick: currentTick,
      tick: newTick,
      maxTick,
    };
    if (vizMode) {
      const tickFrame = await readTickFrame(runDir, newTick);
      result.visualization = await buildVisualizationSnapshot(runDir, runId, newTick, tickFrame, vizMode);
    }
    emitJsonStdout(result);
    return;
  }

  if (subcommand === "backward") {
    if (currentTick <= 0) {
      emitJsonStdout({
        ok: false,
        command: "tick",
        action: "backward",
        runId,
        tick: 0,
        maxTick,
        error: "cannot rewind past tick 0",
      });
      process.exit(1);
    }
    const newTick = currentTick - 1;
    await writeCursor(runDir, runId, newTick, maxTick);
    const result = {
      ok: true,
      command: "tick",
      action: "backward",
      runId,
      previousTick: currentTick,
      tick: newTick,
      maxTick,
    };
    if (vizMode) {
      const tickFrame = await readTickFrame(runDir, newTick);
      result.visualization = await buildVisualizationSnapshot(runDir, runId, newTick, tickFrame, vizMode);
    }
    emitJsonStdout(result);
    return;
  }

  // subcommand === "state"
  const [ascii, tickFrame] = await Promise.all([renderAscii(runDir), readTickFrame(runDir, currentTick)]);
  const stateResult = {
    ok: true,
    command: "tick",
    action: "state",
    runId,
    tick: currentTick,
    maxTick,
    ascii,
    tickFrame,
  };
  if (vizMode) {
    stateResult.visualization = await buildVisualizationSnapshot(runDir, runId, currentTick, tickFrame, vizMode);
  }
  emitJsonStdout(stateResult);
}

async function runsCommand(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(usage());
    return;
  }
  if (subcommand !== "list") {
    throw new Error(`Unknown runs subcommand: ${subcommand}`);
  }
  if (rest.length > 0) {
    const args = parseArgs(rest);
    if (!args.help && args._.length > 0) {
      throw new Error("runs list does not accept positional arguments.");
    }
    if (Object.keys(args).some((key) => key !== "_" && key !== "help")) {
      throw new Error("runs list does not accept options.");
    }
  }
  const rootDir = resolve(process.cwd(), DEFAULT_ARTIFACTS_DIR, DEFAULT_RUNS_DIR);
  emitJsonStdout(await summarizeRunsIndex({ rootDir }));
}

async function sandboxCreateCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const budgetReceiptPath = resolvePath(args["budget-receipt"]);
  const budgetPath = resolvePath(args.budget);

  if (!budgetReceiptPath && !budgetPath) {
    emitJsonStdout({
      ok: false,
      command: "sandbox-create",
      error: "sandbox-create requires --budget-receipt or --budget.",
      budgetRequired: true,
    });
    return;
  }

  const runId = isNonEmptyString(args["run-id"]) ? args["run-id"].trim() : makeId("sandbox_run");
  const createdAt = isNonEmptyString(args["created-at"])
    ? args["created-at"].trim()
    : new Date().toISOString();

  let budgetReceiptRef;

  if (budgetReceiptPath) {
    const receipt = await readJson(budgetReceiptPath);
    assertSchema(receipt, SCHEMAS.budgetReceiptArtifact);
    if (
      receipt.status === "denied" ||
      (typeof receipt.remaining === "number" && receipt.remaining < 0)
    ) {
      emitJsonStdout({
        ok: false,
        command: "sandbox-create",
        error: `Budget insufficient: status=${receipt.status}, remaining=${receipt.remaining}`,
        budgetInsufficient: true,
      });
      return;
    }
    budgetReceiptRef = toRef(receipt);
  } else {
    const budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
    const tokens = budgetArtifact.budget?.tokens;
    if (!Number.isInteger(tokens) || tokens <= 0) {
      emitJsonStdout({
        ok: false,
        command: "sandbox-create",
        error: `Budget insufficient: tokens=${tokens}`,
        budgetInsufficient: true,
      });
      return;
    }
    budgetReceiptRef = {
      id: `budget_receipt_${runId}`,
      schema: "agent-kernel/BudgetReceiptArtifact",
      schemaVersion: 1,
    };
  }

  const width = args.width !== undefined ? Number(args.width) : 10;
  const height = args.height !== undefined ? Number(args.height) : 10;
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error("sandbox-create: --width must be a positive integer.");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("sandbox-create: --height must be a positive integer.");
  }

  const entityCategories = [];
  if (isNonEmptyString(args["entity-categories"])) {
    for (const cat of args["entity-categories"].split(",")) {
      const trimmed = cat.trim();
      if (trimmed) entityCategories.push(trimmed);
    }
  }

  const sandboxId = `sandbox_session_${runId}`;
  const outDir =
    resolvePath(args["out-dir"]) ||
    resolve(process.cwd(), DEFAULT_ARTIFACTS_DIR, "sandbox", runId);
  await mkdir(outDir, { recursive: true });

  const session = {
    schema: SANDBOX_SESSION_SCHEMA,
    schemaVersion: 1,
    meta: { id: sandboxId, runId, createdAt, producedBy: "sandbox-create" },
    rooms: [{ id: "room_default", width, height }],
    artifacts: { budgetReceiptRef },
    ...(entityCategories.length > 0 ? { entityCategories } : {}),
  };

  await writeJson(join(outDir, "sandbox-session.json"), session);

  emitJsonStdout({
    ok: true,
    command: "sandbox-create",
    sandboxId,
    runId,
    outDir,
    rooms: session.rooms,
    artifacts: session.artifacts,
    ...(entityCategories.length > 0 ? { entityCategories } : {}),
  });
}

async function sandboxPlaceCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const sessionPath = resolvePath(args.session);
  const entityType = args["entity-type"];
  const spec = args.spec;

  if (!sessionPath) {
    throw new Error("sandbox-place requires --session <path>");
  }
  if (!isNonEmptyString(entityType)) {
    throw new Error("sandbox-place requires --entity-type <type>");
  }
  if (!isNonEmptyString(spec)) {
    throw new Error("sandbox-place requires --spec <spec-string>");
  }

  const result = await executeSandboxPlace({ session: sessionPath, entityType, spec });
  emitJsonStdout(result);
  if (!result.ok) {
    process.exit(1);
  }
}

async function sandboxMoveCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const sessionPath = resolvePath(args.session);
  const actorId = args["actor-id"];
  const direction = args.direction;
  const actionsOut = resolvePath(args["actions-out"]);

  if (!sessionPath) {
    throw new Error("sandbox-move requires --session <path>");
  }
  if (!isNonEmptyString(actorId)) {
    throw new Error("sandbox-move requires --actor-id <id>");
  }
  if (!isNonEmptyString(direction)) {
    throw new Error(
      "sandbox-move requires --direction <north|northeast|east|southeast|south|southwest|west|northwest>",
    );
  }
  if (!actionsOut) {
    throw new Error("sandbox-move requires --actions-out <path>");
  }

  const result = await executeSandboxMove({
    session: sessionPath,
    actorId,
    direction,
    actionsOut,
  });
  emitJsonStdout(result);
  if (!result.ok) {
    process.exit(1);
  }
}

export const COMMANDS = {
  build: buildCommand,
  schemas: schemasCommand,
  solve: solveCommand,
  run: runCommand,
  create: createCommand,
  configure: configureAuthoringCommand,
  configurator: configuratorCommand,
  budget: budgetCommand,
  replay: replayCommand,
  inspect: inspectCommand,
  narrate: narrateCommand,
  ipfs: ipfsCommand,
  "ipfs-publish": ipfsPublishCommand,
  "ipfs-load": ipfsLoadCommand,
  blockchain: blockchainCommand,
  "blockchain-mint": blockchainMintCommand,
  "blockchain-load": blockchainLoadCommand,
  llm: llmCommand,
  ollama: llmCommand,
  "room-plan": roomPlanCommand,
  "hazard-plan": hazardPlanCommand,
  "resource-plan": resourcePlanCommand,
  "delver-plan": delverPlanCommand,
  "warden-plan": wardenPlanCommand,
  "llm-plan": llmPlanCommand,
  scenario: scenarioCommand,
  show: showCommand,
  diff: diffCommand,
  runs: runsCommand,
  tick: tickCommand,
  "sandbox-create": sandboxCreateCommand,
  "sandbox-place": sandboxPlaceCommand,
  "sandbox-move": sandboxMoveCommand,
};

/**
 * Compile a BuildSpec into a gameplay bundle suitable for the browser UI.
 *
 * Returns { spec, artifacts } where artifacts is the canonical artifact array
 * produced by buildBuildArtifacts (SimConfigArtifact, InitialStateArtifact,
 * ResourceBundleArtifact, AffinitySummary, etc.).
 *
 * @param {object} buildSpec  BuildSpec object (agent-kernel/BuildSpec)
 * @returns {Promise<{ spec: object, artifacts: object[] }>}
 */
export async function compileBuildSpecToGameplayBundle(buildSpec) {
  if (!buildSpec || typeof buildSpec !== "object") {
    throw new Error("compileBuildSpecToGameplayBundle requires a BuildSpec object.");
  }
  const buildResult = await orchestrateBuild({ spec: buildSpec, producedBy: "sandbox-bridge" });
  const artifacts = buildBuildArtifacts(buildResult, { includeAffinitySummary: true });
  return { spec: buildSpec, artifacts };
}

export async function executeCommand(command, rest = []) {
  const handler = COMMANDS[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}`);
  }
  await handler(rest);
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (!COMMANDS[command]) {
    console.error(`Unknown command: ${command}`);
    console.log(usage());
    process.exit(1);
  }
  try {
    await executeCommand(command, rest);
  } catch (error) {
    const message = error?.message || String(error);
    if (STRUCTURED_STDOUT_COMMANDS.has(command)) {
      console.error(message);
      emitJsonStdout({
        ok: false,
        command,
        error: message,
      });
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

const isDirectExecution = (() => {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }
  return resolve(scriptPath) === fileURLToPath(import.meta.url);
})();

if (isDirectExecution) {
  await main();
}

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createIpfsAdapter } from "../adapters/ipfs/index.js";
import { createBlockchainAdapter } from "../adapters/blockchain/index.js";
import { createLlmAdapter } from "../adapters/llm/index.js";
import { createCommandKernel } from "../../../runtime/src/commands/kernel.js";
import { instantiateCommandRuntimeCoreFromBuffer } from "../../../runtime/src/commands/wasm-core.js";
import { orchestrateBuild } from "../../../runtime/src/build/orchestrate-build.js";
import { summarizeMixedRoomAssemblies, formatMixedRoomAssembliesCliLines } from "../../../runtime/src/build/mixed-room-summary.js";
import { buildBuildTelemetryRecord } from "../../../runtime/src/build/telemetry.js";
import { createSchemaCatalog, filterSchemaCatalogEntries } from "../../../runtime/src/contracts/schema-catalog.js";
import { buildBuildSpecFromSummary } from "../../../runtime/src/personas/director/buildspec-assembler.js";
import { ROOM_CARD_SIZE_IDS } from "../../../runtime/src/personas/configurator/card-model.js";
import {
  calculateActorConfigurationUnitCost,
  calculateRoomCardUnitCost,
} from "../../../runtime/src/personas/configurator/spend-proposal.js";
import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_DELVER_SETUP_MODES,
  ALLOWED_MOTIVATIONS,
} from "../../../runtime/src/personas/orchestrator/prompt-contract.js";
import { validateBuildSpec } from "../../../runtime/src/contracts/build-spec.js";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_ROOM_AFFINITY_EXPRESSION,
  DEFAULT_ROOM_AFFINITY_STACKS,
  DEFAULT_ROOM_CARD_AFFINITY,
  DEFAULT_VITALS,
  TRAP_VITAL_KEYS,
  VITAL_KEYS,
} from "../../../runtime/src/contracts/domain-constants.js";

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
  agentCommandRequest: "agent-kernel/AgentCommandRequestArtifact",
  affinityPreset: "agent-kernel/AffinityPresetArtifact",
  actorLoadout: "agent-kernel/ActorLoadoutArtifact",
  affinitySummary: "agent-kernel/AffinitySummary",
  capturedInput: "agent-kernel/CapturedInputArtifact",
});

const DEFAULT_WASM_PATH = "build/core-as.wasm";
const DEFAULT_ARTIFACTS_DIR = "artifacts";
const DEFAULT_RUNS_DIR = "runs";
const DEFAULT_TICKS = 1;
const AUTHORING_GOAL_PRIORITIES = new Set(["low", "medium", "high"]);

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
  node ${rel} ipfs-publish --artifact-map path [--path root] [--gateway url] [--fixture-cid cid] [--out path] [--out-dir dir]
  node ${rel} ipfs-load --cid cid [--path root] [--file name --file name] [--gateway url] [--fixture-map path] [--out path] [--out-dir dir]
  node ${rel} blockchain --rpc-url url [--address addr] [--fixture-chain-id path] [--fixture-balance path] [--out path] [--out-dir dir]
  node ${rel} blockchain-mint --rpc-url url --card path [--owner addr] [--contract addr] [--token-id id] [--fixture-chain-id path] [--fixture-mint path] [--out path] [--out-dir dir]
  node ${rel} blockchain-load --rpc-url url --token-id id [--owner addr] [--contract addr] [--fixture-chain-id path] [--fixture-load path] [--out path] [--out-dir dir]
  node ${rel} llm [--model model] --prompt text [--base-url url] [--fixture path] [--out path] [--out-dir dir]
  node ${rel} llm-plan [--scenario path | --prompt text --catalog path] [--model model] [--goal text] [--budget-tokens N] [--base-url url] [--fixture path] [--budget-loop] [--budget-pool id=weight --budget-reserve N] [--out-dir dir] [--run-id id] [--created-at iso]
  node ${rel} create [--text text] [--room "..."] [--floor-tile "..."] [--trap "..."] [--delver "..."] [--warden "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso]
  node ${rel} configure [--text text] [--room "..."] [--floor-tile "..."] [--trap "..."] [--delver "..."] [--warden "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso]
  node ${rel} room-plan --room "size=small;count=2;affinities=dark:emit:2,fire:push:1,water:draw:2" [--room "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso]
  node ${rel} delver-plan --delver "count=2;affinity=fire;motivation=attacking[;goals=max_mana:high,mana_regen:high]" [--delver "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso]
  node ${rel} warden-plan --warden "count=2;affinity=dark;motivation=defending" [--warden "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso]

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
  --text          Freeform agent authoring text captured in AgentCommandRequestArtifact
  --scenario      Scenario fixture path for llm-plan
  --catalog       Catalog path for prompt-only llm-plan runs
  --goal          Goal text override (llm-plan prompt-only)
  --dungeon-affinity Dungeon affinity for room/delver/warden summary defaults
  --budget-tokens Hard budget cap in tokens. If freeform text also states a budget, they must match.
  --floor-tile    Floor tile spec for create/configure (repeatable): count=<n>[;id=<id>]
  --trap          Trap spec for create/configure (repeatable): x=<n>;y=<n>;affinity=<kind>[;expression=<push|pull|emit|draw>][;stacks=<n>][;blocking=<true|false>][;id=<id>][;vitals=<vital>:<max>:<regen>|<vital>:<current>:<max>:<regen>,...]
  --room          Room spec for room-plan (repeatable): size=<small|medium|large>;count=<n>;affinities=<kind>:<expression>:<stacks>,...
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
  --created-at    Override createdAt timestamp (ISO-8601) for llm-plan/room-plan/delver-plan/warden-plan
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
    "trap",
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

function parseRoomAffinityTuple(value, roomIndex, affinityIndex) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`room[${roomIndex}] affinity[${affinityIndex}] is empty.`);
  }
  const parts = raw.split(":").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > 3) {
    throw new Error(`room[${roomIndex}] affinity[${affinityIndex}] must be kind[:expression[:stacks]].`);
  }

  const kind = parts[0].toLowerCase();
  if (!ALLOWED_AFFINITIES.includes(kind)) {
    throw new Error(`room[${roomIndex}] affinity[${affinityIndex}] has invalid affinity kind "${parts[0]}".`);
  }

  const expression = (parts[1] || DEFAULT_ROOM_AFFINITY_EXPRESSION).toLowerCase();
  if (!ALLOWED_AFFINITY_EXPRESSIONS.includes(expression)) {
    throw new Error(`room[${roomIndex}] affinity[${affinityIndex}] has invalid affinity expression "${parts[1]}".`);
  }

  const stacks = parts[2] === undefined
    ? DEFAULT_ROOM_AFFINITY_STACKS
    : parsePositiveIntStrict(parts[2], `room[${roomIndex}] affinity[${affinityIndex}] stacks`);

  return { kind, expression, stacks };
}

function parseRoomAffinities(value, roomIndex) {
  if (!isNonEmptyString(value)) {
    return [{
      kind: DEFAULT_ROOM_CARD_AFFINITY,
      expression: DEFAULT_ROOM_AFFINITY_EXPRESSION,
      stacks: DEFAULT_ROOM_AFFINITY_STACKS,
    }];
  }

  const entries = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return [{
      kind: DEFAULT_ROOM_CARD_AFFINITY,
      expression: DEFAULT_ROOM_AFFINITY_EXPRESSION,
      stacks: DEFAULT_ROOM_AFFINITY_STACKS,
    }];
  }

  const merged = new Map();
  entries.forEach((entry, index) => {
    const tuple = parseRoomAffinityTuple(entry, roomIndex, index + 1);
    const key = `${tuple.kind}:${tuple.expression}`;
    const existing = merged.get(key);
    if (!existing || tuple.stacks > existing.stacks) {
      merged.set(key, tuple);
    }
  });

  return Array.from(merged.values());
}

function parseRoomSpec(value, roomIndex) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`room[${roomIndex}] requires a non-empty spec.`);
  }

  const allowedFields = new Set(["size", "count", "affinity", "affinities"]);
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

  const affinities = parseRoomAffinities(fields.get("affinities") || fields.get("affinity"), roomIndex);
  return {
    value: {
      size,
      count,
      affinity: affinities[0]?.kind || DEFAULT_ROOM_CARD_AFFINITY,
      affinities,
    },
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

function parseTrapVitals(value, trapIndex) {
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
      throw new Error(`trap[${trapIndex}] vital[${index + 1}] must be vital:max:regen or vital:current:max:regen.`);
    }
    const vital = String(parts[0] || "").toLowerCase();
    if (!TRAP_VITAL_KEYS.includes(vital)) {
      throw new Error(`trap[${trapIndex}] vital[${index + 1}] has invalid vital kind "${parts[0]}".`);
    }

    let current;
    let max;
    let regen;
    if (parts.length === 3) {
      max = parseNonNegativeIntStrict(parts[1], `trap[${trapIndex}] vital[${index + 1}] max`);
      regen = parseNonNegativeIntStrict(parts[2], `trap[${trapIndex}] vital[${index + 1}] regen`);
      current = max;
    } else {
      current = parseNonNegativeIntStrict(parts[1], `trap[${trapIndex}] vital[${index + 1}] current`);
      max = parseNonNegativeIntStrict(parts[2], `trap[${trapIndex}] vital[${index + 1}] max`);
      regen = parseNonNegativeIntStrict(parts[3], `trap[${trapIndex}] vital[${index + 1}] regen`);
    }
    if (current > max) {
      throw new Error(`trap[${trapIndex}] vital[${index + 1}] current cannot exceed max.`);
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

function parseTrapSpec(value, trapIndex) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`trap[${trapIndex}] requires a non-empty spec.`);
  }

  const allowedFields = new Set(["id", "x", "y", "affinity", "expression", "stacks", "blocking", "vitals"]);
  const fields = new Map();
  const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`trap[${trapIndex}] requires at least one field.`);
  }

  segments.forEach((segment) => {
    if (!segment.includes("=")) {
      throw new Error(`trap[${trapIndex}] segment "${segment}" is invalid; expected key=value.`);
    }
    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator).trim().toLowerCase();
    const fieldValue = segment.slice(separator + 1).trim();
    if (!allowedFields.has(key)) {
      throw new Error(`trap[${trapIndex}] field "${key}" is not supported.`);
    }
    if (!fieldValue) {
      throw new Error(`trap[${trapIndex}] field "${key}" requires a value.`);
    }
    fields.set(key, fieldValue);
  });

  const affinity = String(fields.get("affinity") || "").trim().toLowerCase();
  if (!ALLOWED_AFFINITIES.includes(affinity)) {
    throw new Error(`trap[${trapIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }
  const expression = String(fields.get("expression") || "emit").trim().toLowerCase();
  if (!ALLOWED_AFFINITY_EXPRESSIONS.includes(expression)) {
    throw new Error(`trap[${trapIndex}] expression must be one of: ${ALLOWED_AFFINITY_EXPRESSIONS.join(", ")}.`);
  }

  return {
    id: isNonEmptyString(fields.get("id"))
      ? String(fields.get("id")).trim()
      : `trap_${trapIndex}`,
    x: parseNonNegativeIntStrict(fields.get("x"), `trap[${trapIndex}] x`),
    y: parseNonNegativeIntStrict(fields.get("y"), `trap[${trapIndex}] y`),
    blocking: fields.has("blocking")
      ? parseBooleanStrict(fields.get("blocking"), `trap[${trapIndex}] blocking`)
      : false,
    affinity: {
      kind: affinity,
      expression,
      stacks: fields.has("stacks")
        ? parsePositiveIntStrict(fields.get("stacks"), `trap[${trapIndex}] stacks`)
        : 1,
      targetType: "floor",
    },
    vitals: parseTrapVitals(fields.get("vitals"), trapIndex),
  };
}

function parseTrapSpecs(rawTraps) {
  const values = normalizeList(rawTraps)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    return [];
  }
  return values.map((value, index) => parseTrapSpec(value, index + 1));
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
    motivations: [motivation],
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

function buildPriceMap(priceListArtifact) {
  const items = Array.isArray(priceListArtifact?.items) ? priceListArtifact.items : [];
  return new Map(
    items
      .filter((item) => typeof item?.id === "string" && typeof item?.kind === "string" && Number.isFinite(item?.costTokens))
      .map((item) => [`${item.kind}:${item.id}`, item.costTokens]),
  );
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
  const stationary = motivations.includes("stationary");

  if (affinities.length > 0) {
    baseVitals.mana.max = Math.max(baseVitals.mana.max, 1);
    baseVitals.mana.current = baseVitals.mana.max;
    baseVitals.mana.regen = Math.max(baseVitals.mana.regen, 1);
  }
  if (!stationary) {
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
    throw new Error(`room-plan only accepts --room, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, and --created-at. Unknown: ${unknown.join(", ")}`);
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
    throw new Error(`delver-plan only accepts --delver, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, and --created-at. Unknown: ${unknown.join(", ")}`);
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
    throw new Error(`warden-plan only accepts --warden, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, and --created-at. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedAgentAuthoringArgs(command, args) {
  const allowed = new Set([
    "text",
    "room",
    "floor-tile",
    "trap",
    "delver",
    "warden",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
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
    throw new Error(`${command} only accepts --text, --room, --floor-tile, --trap, --delver, --warden, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, and --created-at. Unknown: ${unknown.join(", ")}`);
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
    case "trap":
      return [
        { target: "build_spec_configurator", path: "configurator.inputs.levelGen.traps", legacyFlow: "configurator" },
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

function ensureAuthoringLevelGenCapacity(levelGen, { walkableTilesTarget, traps }) {
  const blockingTrapCount = traps.reduce((sum, trap) => sum + (trap.blocking === true ? 1 : 0), 0);
  const walkableTarget = Number.isInteger(walkableTilesTarget) && walkableTilesTarget > 0 ? walkableTilesTarget : 0;
  const trapWidth = traps.reduce((max, trap) => Math.max(max, trap.x + 3), 5);
  const trapHeight = traps.reduce((max, trap) => Math.max(max, trap.y + 3), 5);
  const requestedWalkable = walkableTarget + blockingTrapCount;
  const walkableSide = requestedWalkable > 0
    ? Math.max(5, Math.ceil(Math.sqrt(Math.ceil(requestedWalkable / 0.5))) + 2)
    : 5;
  const width = Math.max(
    Number.isInteger(levelGen?.width) ? levelGen.width : 0,
    walkableSide,
    trapWidth,
  );
  const height = Math.max(
    Number.isInteger(levelGen?.height) ? levelGen.height : 0,
    walkableSide,
    trapHeight,
  );
  const shape = levelGen?.shape && typeof levelGen.shape === "object" && !Array.isArray(levelGen.shape)
    ? { ...levelGen.shape }
    : {};
  if (!Number.isInteger(shape.roomCount) || shape.roomCount <= 0) {
    shape.roomCount = 1;
  }
  if (!Number.isInteger(shape.roomMinSize) || shape.roomMinSize <= 0) {
    shape.roomMinSize = 3;
  }
  if (!Number.isInteger(shape.roomMaxSize) || shape.roomMaxSize <= 0) {
    shape.roomMaxSize = Math.max(shape.roomMinSize, 3);
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
  requestArtifact,
  commandName,
  producedBy,
} = {}) {
  await writeJson(join(outDir, "request.json"), requestArtifact);
  await writeJson(join(outDir, "spec.json"), spec);
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
  if (buildResult.spendProposal) {
    await writeJson(join(outDir, "spend-proposal.json"), buildResult.spendProposal);
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
  if (buildResult.affinitySummary) {
    await writeJson(join(outDir, "affinity-summary.json"), buildResult.affinitySummary);
  }
  if (buildResult.resourceBundle) {
    await writeJson(join(outDir, "resource-bundle.json"), buildResult.resourceBundle);
  }

  const capturedInputs = Array.isArray(buildResult.capturedInputs) ? buildResult.capturedInputs : [];
  const capturedArtifacts = capturedInputs.map((entry, index) => {
    const artifact = entry?.artifact || entry;
    return {
      artifact,
      path: entry?.path || buildCapturedInputPath(artifact?.source?.adapter || "llm", index, artifact?.meta?.id),
    };
  });
  for (const capture of capturedArtifacts) {
    await writeJson(join(outDir, capture.path), capture.artifact);
  }

  const bundleArtifacts = [requestArtifact];
  if (buildResult.intent) bundleArtifacts.push(buildResult.intent);
  if (buildResult.plan) bundleArtifacts.push(buildResult.plan);
  if (buildResult.budget?.budget) bundleArtifacts.push(buildResult.budget.budget);
  if (buildResult.budget?.priceList) bundleArtifacts.push(buildResult.budget.priceList);
  if (buildResult.budgetReceipt) bundleArtifacts.push(buildResult.budgetReceipt);
  if (buildResult.spendProposal) bundleArtifacts.push(buildResult.spendProposal);
  if (buildResult.solverRequest) bundleArtifacts.push(buildResult.solverRequest);
  if (buildResult.solverResult) bundleArtifacts.push(buildResult.solverResult);
  if (buildResult.simConfig) bundleArtifacts.push(buildResult.simConfig);
  if (buildResult.initialState) bundleArtifacts.push(buildResult.initialState);
  if (buildResult.affinitySummary) bundleArtifacts.push(buildResult.affinitySummary);
  if (buildResult.resourceBundle) bundleArtifacts.push(buildResult.resourceBundle);
  capturedArtifacts.forEach((capture) => bundleArtifacts.push(capture.artifact));

  bundleArtifacts.sort((a, b) => {
    if (a.schema === b.schema) {
      return a.meta.id.localeCompare(b.meta.id);
    }
    return a.schema.localeCompare(b.schema);
  });

  const manifestEntries = [];
  addManifestEntry(manifestEntries, requestArtifact, "request.json");
  addManifestEntry(manifestEntries, buildResult.intent, "intent.json");
  addManifestEntry(manifestEntries, buildResult.plan, "plan.json");
  addManifestEntry(manifestEntries, buildResult.budget?.budget, "budget.json");
  addManifestEntry(manifestEntries, buildResult.budget?.priceList, "price-list.json");
  addManifestEntry(manifestEntries, buildResult.budgetReceipt, "budget-receipt.json");
  addManifestEntry(manifestEntries, buildResult.spendProposal, "spend-proposal.json");
  addManifestEntry(manifestEntries, buildResult.solverRequest, "solver-request.json");
  addManifestEntry(manifestEntries, buildResult.solverResult, "solver-result.json");
  addManifestEntry(manifestEntries, buildResult.simConfig, "sim-config.json");
  addManifestEntry(manifestEntries, buildResult.initialState, "initial-state.json");
  addManifestEntry(manifestEntries, buildResult.affinitySummary, "affinity-summary.json");
  addManifestEntry(manifestEntries, buildResult.resourceBundle, "resource-bundle.json");
  capturedArtifacts.forEach((capture) => addManifestEntry(manifestEntries, capture.artifact, capture.path));

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

  console.log(`${commandName}: wrote ${outDir}`);
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
    console.log(line);
  });
}

async function loadCoreFromWasm(wasmPath) {
  const buffer = await readFile(wasmPath);
  return instantiateCommandRuntimeCoreFromBuffer(buffer);
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
  defaultWasmPath: () => resolvePath(DEFAULT_WASM_PATH),
  loadCore: async (wasmPath) => {
    if (!wasmPath || !existsSync(wasmPath)) {
      throw new Error(`WASM not found at ${wasmPath}`);
    }
    return loadCoreFromWasm(wasmPath);
  },
  nowIso: () => new Date().toISOString(),
  env: process.env,
  cwd: () => process.cwd(),
  log: (...parts) => console.log(...parts),
  warn: (...parts) => console.warn(...parts),
});



async function buildCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedBuildArgs(args);
  await commandKernel.build(args);
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
  await commandKernel.run(args);
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
  await commandKernel.budget(args);
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
  await commandKernel.inspect(args);
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

async function agentAuthoringCommand(argv, { commandName, action } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedAgentAuthoringArgs(commandName, args);

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
  const parsedTraps = normalizeList(args.trap)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((value, index) => ({ prompt: value, value: parseTrapSpec(value, index + 1) }));
  const parsedDelvers = normalizeList(args.delver)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((value, index) => ({ prompt: value, ...parseDelverSpec(value, index + 1, { defaultAffinity: dungeonAffinity }) }));
  const parsedWardens = normalizeList(args.warden)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((value, index) => ({ prompt: value, value: parseWardenSpec(value, index + 1, { defaultAffinity: dungeonAffinity }) }));

  if (
    parsedRooms.length === 0
    && parsedFloorTiles.length === 0
    && parsedTraps.length === 0
    && parsedDelvers.length === 0
    && parsedWardens.length === 0
  ) {
    throw new Error(`${commandName} requires at least one authored object via --room, --floor-tile, --trap, --delver, or --warden.`);
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
  const textDelverGoals = textVitalScope === "delver" ? textVitalGoals : [];
  const textWardenGoals = textVitalScope === "warden" ? textVitalGoals : [];
  const fulfilled = (
    parsedFloorTiles.length === 0
    && parsedTraps.length === 0
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

  const summary = {
    goal: deriveGoalForAgentCommand({
      action,
      goal: args.goal,
      objects: [
        ...parsedRooms.map((entry) => ({ kind: "room" })),
        ...parsedFloorTiles.map((entry) => ({ kind: "floor_tile" })),
        ...parsedTraps.map((entry) => ({ kind: "trap" })),
        ...parsedDelvers.map((entry) => ({ kind: "delver" })),
        ...parsedWardens.map((entry) => ({ kind: "warden" })),
      ],
    }),
    dungeonAffinity,
    rooms: fulfilled.rooms.map((entry) => entry.value),
    actors: [...fulfilled.delvers.map((entry) => entry.value), ...parsedWardens.map((entry) => entry.value)],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
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
  const traps = parsedTraps.map((entry) => entry.value);
  const levelGen = ensureAuthoringLevelGenCapacity(
    built.spec.configurator?.inputs?.levelGen || {},
    { walkableTilesTarget, traps },
  );
  if (walkableTilesTarget > 0) {
    levelGen.walkableTilesTarget = walkableTilesTarget;
  }
  if (traps.length > 0) {
    levelGen.traps = traps.map((entry) => ({
      id: entry.id,
      x: entry.x,
      y: entry.y,
      blocking: entry.blocking,
      affinity: { ...entry.affinity },
      vitals: entry.vitals ? { ...entry.vitals } : undefined,
    }));
  }
  built.spec.configurator.inputs.levelGen = levelGen;

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
    ...parsedTraps.map((entry) => ({
      kind: "trap",
      prompt: entry.prompt,
      id: entry.value.id,
      attributes: {
        x: entry.value.x,
        y: entry.value.y,
        blocking: entry.value.blocking,
        affinity: entry.value.affinity,
        vitals: entry.value.vitals,
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

  await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    requestArtifact,
    commandName,
    producedBy: `cli-${commandName}`,
  });
}

async function createCommand(argv) {
  await agentAuthoringCommand(argv, { commandName: "create", action: "author" });
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

  const bundleArtifacts = [];
  if (buildResult.intent) bundleArtifacts.push(buildResult.intent);
  if (buildResult.plan) bundleArtifacts.push(buildResult.plan);
  if (buildResult.budget?.budget) bundleArtifacts.push(buildResult.budget.budget);
  if (buildResult.budget?.priceList) bundleArtifacts.push(buildResult.budget.priceList);
  if (buildResult.budgetReceipt) bundleArtifacts.push(buildResult.budgetReceipt);
  if (buildResult.solverRequest) bundleArtifacts.push(buildResult.solverRequest);
  if (buildResult.solverResult) bundleArtifacts.push(buildResult.solverResult);
  if (buildResult.simConfig) bundleArtifacts.push(buildResult.simConfig);
  if (buildResult.initialState) bundleArtifacts.push(buildResult.initialState);

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
  addManifestEntry(manifestEntries, buildResult.solverRequest, "solver-request.json");
  addManifestEntry(manifestEntries, buildResult.solverResult, "solver-result.json");
  addManifestEntry(manifestEntries, buildResult.simConfig, "sim-config.json");
  addManifestEntry(manifestEntries, buildResult.initialState, "initial-state.json");

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
    producedBy: "cli-room-plan",
    clock: () => buildResult.spec.meta.createdAt,
  });
  await writeJson(join(outDir, "telemetry.json"), telemetry);

  console.log(`room-plan: wrote ${outDir}`);
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

  const bundleArtifacts = [];
  if (buildResult.intent) bundleArtifacts.push(buildResult.intent);
  if (buildResult.plan) bundleArtifacts.push(buildResult.plan);
  if (buildResult.budget?.budget) bundleArtifacts.push(buildResult.budget.budget);
  if (buildResult.budget?.priceList) bundleArtifacts.push(buildResult.budget.priceList);
  if (buildResult.budgetReceipt) bundleArtifacts.push(buildResult.budgetReceipt);
  if (buildResult.solverRequest) bundleArtifacts.push(buildResult.solverRequest);
  if (buildResult.solverResult) bundleArtifacts.push(buildResult.solverResult);
  if (buildResult.simConfig) bundleArtifacts.push(buildResult.simConfig);
  if (buildResult.initialState) bundleArtifacts.push(buildResult.initialState);

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
  addManifestEntry(manifestEntries, buildResult.solverRequest, "solver-request.json");
  addManifestEntry(manifestEntries, buildResult.solverResult, "solver-result.json");
  addManifestEntry(manifestEntries, buildResult.simConfig, "sim-config.json");
  addManifestEntry(manifestEntries, buildResult.initialState, "initial-state.json");

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
    producedBy: "cli-delver-plan",
    clock: () => buildResult.spec.meta.createdAt,
  });
  await writeJson(join(outDir, "telemetry.json"), telemetry);

  console.log(`delver-plan: wrote ${outDir}`);
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
  const summary = {
    goal,
    dungeonAffinity,
    cardSet: wardens,
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

  const bundleArtifacts = [];
  if (buildResult.intent) bundleArtifacts.push(buildResult.intent);
  if (buildResult.plan) bundleArtifacts.push(buildResult.plan);
  if (buildResult.budget?.budget) bundleArtifacts.push(buildResult.budget.budget);
  if (buildResult.budget?.priceList) bundleArtifacts.push(buildResult.budget.priceList);
  if (buildResult.budgetReceipt) bundleArtifacts.push(buildResult.budgetReceipt);
  if (buildResult.solverRequest) bundleArtifacts.push(buildResult.solverRequest);
  if (buildResult.solverResult) bundleArtifacts.push(buildResult.solverResult);
  if (buildResult.simConfig) bundleArtifacts.push(buildResult.simConfig);
  if (buildResult.initialState) bundleArtifacts.push(buildResult.initialState);

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
  addManifestEntry(manifestEntries, buildResult.solverRequest, "solver-request.json");
  addManifestEntry(manifestEntries, buildResult.solverResult, "solver-result.json");
  addManifestEntry(manifestEntries, buildResult.simConfig, "sim-config.json");
  addManifestEntry(manifestEntries, buildResult.initialState, "initial-state.json");

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
    producedBy: "cli-warden-plan",
    clock: () => buildResult.spec.meta.createdAt,
  });
  await writeJson(join(outDir, "telemetry.json"), telemetry);

  console.log(`warden-plan: wrote ${outDir}`);
}

async function llmPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  await commandKernel.llmPlan(args);
}

const COMMANDS = {
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
  ipfs: ipfsCommand,
  "ipfs-publish": ipfsPublishCommand,
  "ipfs-load": ipfsLoadCommand,
  blockchain: blockchainCommand,
  "blockchain-mint": blockchainMintCommand,
  "blockchain-load": blockchainLoadCommand,
  llm: llmCommand,
  ollama: llmCommand,
  "room-plan": roomPlanCommand,
  "delver-plan": delverPlanCommand,
  "warden-plan": wardenPlanCommand,
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

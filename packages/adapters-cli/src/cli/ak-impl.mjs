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
import { buildBuildTelemetryRecord } from "../../../runtime/src/build/telemetry.js";
import { createSchemaCatalog, filterSchemaCatalogEntries } from "../../../runtime/src/contracts/schema-catalog.js";
import { buildBuildSpecFromSummary } from "../../../runtime/src/personas/director/buildspec-assembler.js";
import { ROOM_CARD_SIZE_IDS } from "../../../runtime/src/personas/configurator/card-model.js";
import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_ATTACKER_SETUP_MODES,
  ALLOWED_MOTIVATIONS,
} from "../../../runtime/src/personas/orchestrator/prompt-contract.js";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_ROOM_AFFINITY_EXPRESSION,
  DEFAULT_ROOM_AFFINITY_STACKS,
  DEFAULT_ROOM_CARD_AFFINITY,
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
  affinityPreset: "agent-kernel/AffinityPresetArtifact",
  actorLoadout: "agent-kernel/ActorLoadoutArtifact",
  affinitySummary: "agent-kernel/AffinitySummary",
  capturedInput: "agent-kernel/CapturedInputArtifact",
});

const DEFAULT_WASM_PATH = "build/core-as.wasm";
const DEFAULT_ARTIFACTS_DIR = "artifacts";
const DEFAULT_RUNS_DIR = "runs";
const DEFAULT_TICKS = 1;

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
  node ${rel} room-plan --room "size=small;count=2;affinities=dark:emit:2,fire:push:1" [--room "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso]
  node ${rel} attacker-plan --attacker "count=2;affinity=fire;motivation=attacking" [--attacker "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso]
  node ${rel} defender-plan --defender "count=2;affinity=dark;motivation=defending" [--defender "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso]

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
  --dungeon-affinity Dungeon affinity for room/attacker/defender summary defaults
  --budget-tokens Budget token hint (llm-plan prompt-only, optional for room-plan/attacker-plan/defender-plan)
  --room          Room spec for room-plan (repeatable): size=<small|medium|large>;count=<n>;affinities=<kind>:<expression>:<stacks>,...
  --attacker      Attacker spec for attacker-plan (repeatable): count=<n>;affinity=<kind>;motivation=<kind>[;id=<id>][;affinities=<kind>[:<expression>[:<stacks>]],...][;vitals=<vital>:<max>:<regen>,...|<vital>:<current>:<max>:<regen>,...][;setup-mode=<auto|user|hybrid>]
  --defender      Defender spec for defender-plan (repeatable): count=<n>;affinity=<kind>;motivation=<kind>[;id=<id>][;affinities=<kind>[:<expression>[:<stacks>]],...][;vitals=<vital>:<max>:<regen>,...|<vital>:<current>:<max>:<regen>,...]
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
  --created-at    Override createdAt timestamp (ISO-8601) for llm-plan/room-plan/attacker-plan/defender-plan
  --help          Show this help
`;
}

function parseArgs(argv) {
  const args = { _: [] };
  const repeatable = new Set([
    "actor",
    "attacker",
    "defender",
    "vital",
    "vital-default",
    "tile-wall",
    "tile-barrier",
    "tile-floor",
    "budget-pool",
    "room",
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
    size,
    count,
    affinity: affinities[0]?.kind || DEFAULT_ROOM_CARD_AFFINITY,
    affinities,
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

function parseAttackerSpec(value, attackerIndex, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`attacker[${attackerIndex}] requires a non-empty spec.`);
  }

  const allowedFields = new Set(["id", "count", "affinity", "affinities", "motivation", "vitals", "setup-mode", "setupmode"]);
  const fields = new Map();
  const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`attacker[${attackerIndex}] requires at least one field.`);
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
          throw new Error(`attacker[${attackerIndex}] motivation may only be specified once.`);
        }
        fields.set("motivation", shorthand);
        return;
      }
      throw new Error(`attacker[${attackerIndex}] segment "${segment}" is invalid; expected key=value.`);
    }

    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator).trim().toLowerCase();
    const fieldValue = segment.slice(separator + 1).trim();
    if (!allowedFields.has(key)) {
      throw new Error(`attacker[${attackerIndex}] field "${key}" is not supported.`);
    }
    if (!fieldValue) {
      throw new Error(`attacker[${attackerIndex}] field "${key}" requires a value.`);
    }
    if (key === "motivation" && fields.has("motivation")) {
      throw new Error(`attacker[${attackerIndex}] motivation may only be specified once.`);
    }
    fields.set(key, fieldValue);
  });

  const affinity = String(fields.get("affinity") || defaultAffinity).trim().toLowerCase();
  if (!ALLOWED_AFFINITIES.includes(affinity)) {
    throw new Error(`attacker[${attackerIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const motivation = String(fields.get("motivation") || "attacking").trim().toLowerCase();
  if (!ALLOWED_MOTIVATIONS.includes(motivation)) {
    throw new Error(`attacker[${attackerIndex}] motivation must be one of: ${ALLOWED_MOTIVATIONS.join(", ")}.`);
  }

  const count = fields.has("count")
    ? parsePositiveIntStrict(fields.get("count"), `attacker[${attackerIndex}] count`)
    : 1;
  const id = isNonEmptyString(fields.get("id"))
    ? String(fields.get("id")).trim()
    : `card_attacker_${attackerIndex}`;
  const affinities = parseActorAffinities(fields.get("affinities"), "attacker", attackerIndex);
  const vitals = parseActorVitals(fields.get("vitals"), "attacker", attackerIndex);
  const setupModeRaw = fields.get("setup-mode") || fields.get("setupmode");
  let setupMode;
  if (isNonEmptyString(setupModeRaw)) {
    setupMode = String(setupModeRaw).trim().toLowerCase();
    if (!ALLOWED_ATTACKER_SETUP_MODES.includes(setupMode)) {
      throw new Error(`attacker[${attackerIndex}] setup-mode must be one of: ${ALLOWED_ATTACKER_SETUP_MODES.join(", ")}.`);
    }
  }

  const attacker = {
    id,
    type: "attacker",
    source: "actor",
    count,
    affinity,
    motivations: [motivation],
  };
  if (affinities && affinities.length > 0) {
    attacker.affinities = affinities;
  }
  if (vitals && Object.keys(vitals).length > 0) {
    attacker.vitals = vitals;
  }
  if (setupMode) {
    attacker.setupMode = setupMode;
  }
  return attacker;
}

function parseAttackerSpecs(rawAttackers, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const values = normalizeList(rawAttackers)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error("attacker-plan requires at least one --attacker entry.");
  }
  return values.map((value, index) => parseAttackerSpec(value, index + 1, { defaultAffinity }));
}

function parseDefenderSpec(value, defenderIndex, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`defender[${defenderIndex}] requires a non-empty spec.`);
  }

  const allowedFields = new Set(["id", "count", "affinity", "affinities", "motivation", "vitals"]);
  const fields = new Map();
  const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`defender[${defenderIndex}] requires at least one field.`);
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
          throw new Error(`defender[${defenderIndex}] motivation may only be specified once.`);
        }
        fields.set("motivation", shorthand);
        return;
      }
      throw new Error(`defender[${defenderIndex}] segment "${segment}" is invalid; expected key=value.`);
    }

    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator).trim().toLowerCase();
    const fieldValue = segment.slice(separator + 1).trim();
    if (!allowedFields.has(key)) {
      throw new Error(`defender[${defenderIndex}] field "${key}" is not supported.`);
    }
    if (!fieldValue) {
      throw new Error(`defender[${defenderIndex}] field "${key}" requires a value.`);
    }
    if (key === "motivation" && fields.has("motivation")) {
      throw new Error(`defender[${defenderIndex}] motivation may only be specified once.`);
    }
    fields.set(key, fieldValue);
  });

  const affinity = String(fields.get("affinity") || defaultAffinity).trim().toLowerCase();
  if (!ALLOWED_AFFINITIES.includes(affinity)) {
    throw new Error(`defender[${defenderIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const motivation = String(fields.get("motivation") || "defending").trim().toLowerCase();
  if (!ALLOWED_MOTIVATIONS.includes(motivation)) {
    throw new Error(`defender[${defenderIndex}] motivation must be one of: ${ALLOWED_MOTIVATIONS.join(", ")}.`);
  }

  const count = fields.has("count")
    ? parsePositiveIntStrict(fields.get("count"), `defender[${defenderIndex}] count`)
    : 1;
  const id = isNonEmptyString(fields.get("id"))
    ? String(fields.get("id")).trim()
    : `card_defender_${defenderIndex}`;
  const affinities = parseActorAffinities(fields.get("affinities"), "defender", defenderIndex);
  const vitals = parseActorVitals(fields.get("vitals"), "defender", defenderIndex);

  const defender = {
    id,
    type: "defender",
    source: "actor",
    count,
    affinity,
    motivations: [motivation],
  };
  if (affinities && affinities.length > 0) {
    defender.affinities = affinities;
  }
  if (vitals && Object.keys(vitals).length > 0) {
    defender.vitals = vitals;
  }
  return defender;
}

function parseDefenderSpecs(rawDefenders, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const values = normalizeList(rawDefenders)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error("defender-plan requires at least one --defender entry.");
  }
  return values.map((value, index) => parseDefenderSpec(value, index + 1, { defaultAffinity }));
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

function assertAllowedAttackerPlanArgs(args) {
  const allowed = new Set([
    "attacker",
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
    throw new Error(`attacker-plan only accepts --attacker, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, and --created-at. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedDefenderPlanArgs(args) {
  const allowed = new Set([
    "defender",
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
    throw new Error(`defender-plan only accepts --defender, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, and --created-at. Unknown: ${unknown.join(", ")}`);
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

async function roomPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedRoomPlanArgs(args);

  const rooms = parseRoomSpecs(args.room);
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

  let budgetTokens;
  if (args["budget-tokens"] !== undefined) {
    budgetTokens = parsePositiveIntStrict(args["budget-tokens"], "room-plan --budget-tokens");
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
    : `Author dungeon rooms (${rooms.length} configuration${rooms.length === 1 ? "" : "s"}).`;
  const summary = {
    goal,
    dungeonAffinity,
    rooms,
    actors: [],
  };
  if (budgetTokens !== undefined) {
    summary.budgetTokens = budgetTokens;
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

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: "cli-room-plan",
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

async function attackerPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedAttackerPlanArgs(args);

  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("attacker-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : DEFAULT_DUNGEON_AFFINITY;
  if (!ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`attacker-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const attackers = parseAttackerSpecs(args.attacker, { defaultAffinity: dungeonAffinity });

  let budgetTokens;
  if (args["budget-tokens"] !== undefined) {
    budgetTokens = parsePositiveIntStrict(args["budget-tokens"], "attacker-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("attacker-plan requires both --budget and --price-list.");
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
    : `Author attackers (${attackers.length} configuration${attackers.length === 1 ? "" : "s"}).`;
  const summary = {
    goal,
    dungeonAffinity,
    cardSet: attackers,
  };
  if (budgetTokens !== undefined) {
    summary.budgetTokens = budgetTokens;
  }

  const built = buildBuildSpecFromSummary({
    summary,
    runId,
    createdAt,
    source: "cli-attacker-plan",
    budgetArtifact: budgetArtifact || undefined,
    priceListArtifact: priceListArtifact || undefined,
  });
  if (!built.ok) {
    throw new Error(`attacker-plan build spec failed: ${built.errors.join("; ")}`);
  }

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: "cli-attacker-plan",
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
    producedBy: "cli-attacker-plan",
    clock: () => buildResult.spec.meta.createdAt,
  });
  await writeJson(join(outDir, "telemetry.json"), telemetry);

  console.log(`attacker-plan: wrote ${outDir}`);
}

async function defenderPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedDefenderPlanArgs(args);

  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("defender-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : DEFAULT_DUNGEON_AFFINITY;
  if (!ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`defender-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const defenders = parseDefenderSpecs(args.defender, { defaultAffinity: dungeonAffinity });

  let budgetTokens;
  if (args["budget-tokens"] !== undefined) {
    budgetTokens = parsePositiveIntStrict(args["budget-tokens"], "defender-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("defender-plan requires both --budget and --price-list.");
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
    : `Author defenders (${defenders.length} configuration${defenders.length === 1 ? "" : "s"}).`;
  const summary = {
    goal,
    dungeonAffinity,
    cardSet: defenders,
  };
  if (budgetTokens !== undefined) {
    summary.budgetTokens = budgetTokens;
  }

  const built = buildBuildSpecFromSummary({
    summary,
    runId,
    createdAt,
    source: "cli-defender-plan",
    budgetArtifact: budgetArtifact || undefined,
    priceListArtifact: priceListArtifact || undefined,
  });
  if (!built.ok) {
    throw new Error(`defender-plan build spec failed: ${built.errors.join("; ")}`);
  }

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: "cli-defender-plan",
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
    producedBy: "cli-defender-plan",
    clock: () => buildResult.spec.meta.createdAt,
  });
  await writeJson(join(outDir, "telemetry.json"), telemetry);

  console.log(`defender-plan: wrote ${outDir}`);
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
  "attacker-plan": attackerPlanCommand,
  "defender-plan": defenderPlanCommand,
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

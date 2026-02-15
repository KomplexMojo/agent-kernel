import { createLlmAdapter } from "../../adapters-web/src/adapters/llm/index.js";
import { runLlmBudgetLoop } from "../../runtime/src/personas/orchestrator/llm-budget-loop.js";
import { runLlmSession } from "../../runtime/src/personas/orchestrator/llm-session.js";
import { buildBuildSpecFromSummary } from "../../runtime/src/personas/director/buildspec-assembler.js";
import { generateGridLayoutFromInput } from "../../runtime/src/personas/configurator/level-layout.js";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  AFFINITY_EXPRESSION_SET,
  AFFINITY_KIND_SET,
  ATTACKER_SETUP_MODES,
  DEFAULT_ATTACKER_SETUP_MODE,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_LAYOUT_TILE_COSTS,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_VITALS,
  DOMAIN_CONSTRAINTS,
  VITAL_KEYS,
  buildLlmActorConfigPromptTemplate,
  buildLlmLevelPromptTemplate,
  buildLlmRepairPromptTemplate,
  normalizeVitals as normalizeDomainVitals,
} from "../../runtime/src/contracts/domain-constants.js";
import { MOTIVATION_KINDS } from "../../runtime/src/personas/configurator/motivation-loadouts.js";
import {
  buildDesignSpendLedger,
  calculateActorConfigurationUnitCost,
} from "../../runtime/src/personas/configurator/spend-proposal.js";

const DEFAULT_LLM_FIXTURE = "/tests/fixtures/adapters/llm-generate-summary-budget-loop.json";
const DEFAULT_CATALOG_FIXTURE = "/tests/fixtures/pool/catalog-basic.json";
const CONTEXT_WINDOW_TOKENS = DOMAIN_CONSTRAINTS?.llm?.contextWindowTokens;
const MODEL_CONTEXT_TOKENS = DOMAIN_CONSTRAINTS?.llm?.modelContextTokens;
const LLM_OUTPUT_FORMAT = DOMAIN_CONSTRAINTS?.llm?.outputFormat || "json";
const DEFAULT_GUIDANCE_BUDGET_TOKENS = 1000;
const DEFAULT_UI_MAX_ACTOR_ROUNDS = 1;
const DEFAULT_BENCHMARK_MAX_TOKEN_BUDGET = 2000000;
const DEFAULT_BENCHMARK_SAMPLE_RUNS = 1;
const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 60000;
const BENCHMARK_STOP_AFTER_MS = 30000;
const BENCHMARK_PRACTICAL_MS = 10000;
const BENCHMARK_MAX_POINTS = 9;
const DEFAULT_POOL_ALLOCATION_PERCENTAGES = Object.freeze({
  layout: 55,
  defenders: 25,
  attacker: 20,
});
const POOL_WEIGHT_ORDER = Object.freeze(["layout", "defenders", "attacker"]);
const LAYOUT_PROFILE_OPTIONS = Object.freeze([
  "auto",
  "rectangular",
  "rooms",
  "sparse_islands",
  "clustered_islands",
]);
const INTENT_HEADER = "Intent and constraints:";
const LEVEL_TEMPLATE_HEADER = "=== Level Prompt Template ===";
const ATTACKER_TEMPLATE_HEADER = "=== Attacker Prompt Template ===";
const DEFENDER_TEMPLATE_HEADER = "=== Defender Prompt Template ===";
const LEGACY_ACTOR_TEMPLATE_HEADER = "=== Actor Prompt Template ===";
const AFFINITY_ICON_MAP = Object.freeze({
  fire: "🔥",
  water: "💧",
  wind: "🌪️",
  earth: "🪨",
  lightning: "⚡",
  ice: "❄️",
  void: "🕳️",
  light: "🌟",
  dark: "🌑",
  shadow: "🌘",
  poison: "☠️",
  life: "🌿",
  decay: "☠️",
  nature: "🌿",
  metal: "⛓️",
  blood: "🩸",
  spirit: "🕯️",
  arcane: "🔮",
  corruption: "🧪",
  corrode: "🧪",
});
const AFFINITY_EXPRESSION_ICON_MAP = Object.freeze({
  push: "⬆️",
  pull: "⬇️",
  emit: "📡",
});
const VITAL_ICON_MAP = Object.freeze({
  health: "❤️",
  mana: "🔮",
  stamina: "⚡",
  durability: "🛡️",
});
const MOTIVATION_ICON_MAP = Object.freeze({
  random: "🎲",
  stationary: "🗿",
  exploring: "🧭",
  attacking: "⚔️",
  defending: "🛡️",
  patrolling: "🚶",
  reflexive: "⚡",
  goal_oriented: "🎯",
  strategy_focused: "🧠",
});
const LEVEL_PREVIEW_EMPTY_TEXT = "No level preview yet.";
const LEVEL_PREVIEW_UNAVAILABLE_TEXT = "Preview unavailable for this level.";
const ATTACKER_HUD_EMPTY_TEXT = "No attacker configuration yet.";
const ACTOR_HUD_EMPTY_TEXT = "No actors proposed.";
const LEVEL_PREVIEW_MAX_DIMENSION = 220;
const LEVEL_PREVIEW_MAX_TILE_SIZE = 6;
const LEVEL_PREVIEW_TILE_COLORS = Object.freeze({
  "#": "#0a0f0d",
  ".": "#d8f6c4",
  S: "#4cc9f0",
  E: "#f4a261",
  B: "#9ca3af",
});

function setStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "red" : "inherit";
}

function normalizeFixtureResponses(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.responses)) return payload.responses;
  return payload ? [payload] : [];
}

function parseBudgetNumber(value) {
  if (typeof value !== "string") return NaN;
  const cleaned = value.replace(/,/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.floor(num) : NaN;
}

function readOptionalInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const floored = Math.floor(num);
  return floored >= 0 ? floored : null;
}

function readOptionalPositiveInt(value) {
  const parsed = readOptionalInt(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseAffinityCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function normalizeAllocationPercent(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function allocateTokensByWeights(totalTokens, weights = {}) {
  const total = Number.isInteger(totalTokens) && totalTokens > 0 ? totalTokens : 0;
  if (total === 0) {
    return { layout: 0, defenders: 0, attacker: 0 };
  }
  const entries = POOL_WEIGHT_ORDER.map((id) => ({
    id,
    weight: Number(weights?.[id]) > 0 ? Number(weights[id]) : 0,
  }));
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return { layout: 0, defenders: 0, attacker: 0 };
  }
  const working = entries.map((entry) => {
    const raw = (total * entry.weight) / totalWeight;
    const tokens = Math.floor(raw);
    return { ...entry, tokens, remainder: raw - tokens };
  });
  let remaining = total - working.reduce((sum, entry) => sum + entry.tokens, 0);
  if (remaining > 0) {
    const order = working
      .slice()
      .sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
    for (let i = 0; i < order.length && remaining > 0; i += 1) {
      order[i].tokens += 1;
      remaining -= 1;
    }
    const tokenMap = new Map(order.map((entry) => [entry.id, entry.tokens]));
    return POOL_WEIGHT_ORDER.reduce((acc, id) => {
      acc[id] = tokenMap.get(id) || 0;
      return acc;
    }, {});
  }
  return working.reduce((acc, entry) => {
    acc[entry.id] = entry.tokens;
    return acc;
  }, {});
}

function resolveBudgetAllocation({
  tokenBudget,
  maxTokenBudget,
  layoutPercent,
  defendersPercent,
  attackerPercent,
} = {}) {
  const requestedBudgetTokens = Number.isInteger(tokenBudget) && tokenBudget > 0
    ? tokenBudget
    : DEFAULT_GUIDANCE_BUDGET_TOKENS;
  const normalizedMaxBudget = Number.isInteger(maxTokenBudget) && maxTokenBudget > 0
    ? maxTokenBudget
    : null;
  const resolvedBudgetTokens = normalizedMaxBudget
    ? Math.min(requestedBudgetTokens, normalizedMaxBudget)
    : requestedBudgetTokens;

  const rawWeights = {
    layout: normalizeAllocationPercent(layoutPercent, DEFAULT_POOL_ALLOCATION_PERCENTAGES.layout),
    defenders: normalizeAllocationPercent(defendersPercent, DEFAULT_POOL_ALLOCATION_PERCENTAGES.defenders),
    attacker: normalizeAllocationPercent(attackerPercent, DEFAULT_POOL_ALLOCATION_PERCENTAGES.attacker),
  };
  const poolBudgets = allocateTokensByWeights(resolvedBudgetTokens, rawWeights);

  const allocationPercentages = POOL_WEIGHT_ORDER.reduce((acc, key) => {
    const tokens = poolBudgets[key] || 0;
    acc[key] = resolvedBudgetTokens > 0
      ? Number(((tokens / resolvedBudgetTokens) * 100).toFixed(2))
      : 0;
    return acc;
  }, {});

  const poolWeights = [
    { id: "layout", weight: poolBudgets.layout || 0 },
    { id: "defenders", weight: poolBudgets.defenders || 0 },
    { id: "player", weight: poolBudgets.attacker || 0 },
    { id: "loot", weight: 0 },
  ];

  return {
    requestedBudgetTokens,
    maxTokenBudget: normalizedMaxBudget,
    budgetTokens: resolvedBudgetTokens,
    poolBudgets,
    poolWeights,
    allocationPercentages,
    adjustments: [],
    minLayoutTokens: null,
    minDefenderTokens: null,
  };
}

function extractBudgetTokens(guidanceText, fallback = DEFAULT_GUIDANCE_BUDGET_TOKENS) {
  const text = typeof guidanceText === "string" ? guidanceText : "";
  const patterns = [
    /totalBudgetTokens\s*:\s*([\d,]+)/i,
    /budgetTokens\s*:\s*([\d,]+)/i,
    /([\d,]+)\s+token(?:s)?\b/i,
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const match = text.match(patterns[i]);
    if (!match) continue;
    const parsed = parseBudgetNumber(match[1]);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function findCaseInsensitiveIndex(text, pattern) {
  if (typeof text !== "string" || typeof pattern !== "string") return -1;
  return text.toLowerCase().indexOf(pattern.toLowerCase());
}

function extractGuidanceGoal(inputText) {
  const text = typeof inputText === "string" ? inputText : "";
  const markerIndex = findCaseInsensitiveIndex(text, INTENT_HEADER);
  if (markerIndex >= 0) {
    const afterMarker = text.slice(markerIndex + INTENT_HEADER.length);
    const endPatterns = [
      `\n${LEVEL_TEMPLATE_HEADER}`,
      `\n${ATTACKER_TEMPLATE_HEADER}`,
      `\n${DEFENDER_TEMPLATE_HEADER}`,
      `\n${LEGACY_ACTOR_TEMPLATE_HEADER}`,
    ];
    let endIndex = afterMarker.length;
    endPatterns.forEach((pattern) => {
      const idx = findCaseInsensitiveIndex(afterMarker, pattern);
      if (idx >= 0) {
        endIndex = Math.min(endIndex, idx);
      }
    });
    return afterMarker.slice(0, endIndex).trim();
  }
  const goalMatch = text.match(/^\s*Goal:\s*(.+)\s*$/m);
  if (goalMatch && goalMatch[1]) {
    return goalMatch[1].trim();
  }
  const looksLikeTemplate = text.includes(LEVEL_TEMPLATE_HEADER)
    || text.includes(ATTACKER_TEMPLATE_HEADER)
    || text.includes(DEFENDER_TEMPLATE_HEADER)
    || text.includes(LEGACY_ACTOR_TEMPLATE_HEADER)
    || text.includes("Phase: layout_only")
    || text.includes("Phase: actors_only");
  return looksLikeTemplate ? "" : text.trim();
}

async function fetchJson(path, fetchImpl = fetch) {
  const response = await fetchImpl(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function buildSyntheticCatalog() {
  const entries = [];
  MOTIVATION_KINDS.forEach((motivation) => {
    AFFINITY_KINDS.forEach((affinity) => {
      entries.push({
        id: `actor_${motivation}_${affinity}`,
        type: "actor",
        subType: "dynamic",
        motivation,
        affinity,
        cost: 1,
        tags: ["synthetic"],
      });
    });
  });
  return {
    schema: "agent-kernel/PoolCatalog",
    schemaVersion: 1,
    entries,
  };
}

async function resolveCatalog(llmConfig = {}, statusEl) {
  if (llmConfig.catalog && typeof llmConfig.catalog === "object") {
    return llmConfig.catalog;
  }
  const catalogPath = llmConfig.catalogPath || DEFAULT_CATALOG_FIXTURE;
  const catalogFetch = typeof llmConfig.catalogFetchFn === "function" ? llmConfig.catalogFetchFn : fetch;
  try {
    return await fetchJson(catalogPath, catalogFetch);
  } catch (error) {
    setStatus(statusEl, `Catalog unavailable (${error.message}); using synthetic catalog.`, true);
    return buildSyntheticCatalog();
  }
}

function deriveAllowedPairs(catalog = {}) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : Array.isArray(catalog) ? catalog : [];
  const seen = new Set();
  const pairs = [];
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const motivation = typeof entry.motivation === "string" ? entry.motivation.trim() : "";
    const affinity = typeof entry.affinity === "string" ? entry.affinity.trim() : "";
    if (!motivation || !affinity) return;
    const key = `${motivation}|${affinity}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ motivation, affinity });
  });
  pairs.sort((a, b) => a.motivation.localeCompare(b.motivation) || a.affinity.localeCompare(b.affinity));
  return pairs;
}

function formatAllowedPairs(pairs = []) {
  if (!Array.isArray(pairs) || pairs.length === 0) return "";
  return pairs.map((pair) => `(${pair.motivation}, ${pair.affinity})`).join(", ");
}

async function resolvePriceList(llmConfig = {}) {
  if (llmConfig.priceList && typeof llmConfig.priceList === "object") {
    return llmConfig.priceList;
  }
  const priceListPath = typeof llmConfig.priceListPath === "string" ? llmConfig.priceListPath.trim() : "";
  if (!priceListPath) {
    return null;
  }
  const priceListFetch = typeof llmConfig.priceListFetchFn === "function"
    ? llmConfig.priceListFetchFn
    : fetch;
  try {
    return await fetchJson(priceListPath, priceListFetch);
  } catch {
    return null;
  }
}

async function resolveLlmFetch({ mode, llmConfig = {} } = {}) {
  if (typeof llmConfig.fetchFn === "function") {
    return llmConfig.fetchFn;
  }
  if (mode === "live") {
    return undefined;
  }

  const payload = llmConfig.fixtureResponse
    || (await fetchJson(llmConfig.fixturePath || DEFAULT_LLM_FIXTURE));
  const responses = normalizeFixtureResponses(payload);
  let index = 0;

  return async () => {
    if (responses.length === 0) {
      return { ok: false, status: 500, statusText: "Missing fixture response" };
    }
    const selected = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return { ok: true, json: async () => selected };
  };
}

function resolveLlmRequestTimeoutMs({ llmConfig = {}, promptParams } = {}) {
  const configured = readOptionalPositiveInt(llmConfig.requestTimeoutMs);
  if (configured) return configured;
  const thinkTimeSeconds = readOptionalPositiveInt(promptParams?.thinkTimeSeconds);
  if (thinkTimeSeconds) {
    return Math.max(DEFAULT_LLM_REQUEST_TIMEOUT_MS, (thinkTimeSeconds + 15) * 1000);
  }
  return DEFAULT_LLM_REQUEST_TIMEOUT_MS;
}

function resolveSessionLlmOptions({ phase, optionsByPhase, baseOptions } = {}) {
  const defaultOptions = DOMAIN_CONSTRAINTS?.llm?.options && typeof DOMAIN_CONSTRAINTS.llm.options === "object"
    ? { ...DOMAIN_CONSTRAINTS.llm.options }
    : {};
  if (baseOptions && typeof baseOptions === "object") {
    Object.assign(defaultOptions, baseOptions);
  }
  const responseTokenBudget = DOMAIN_CONSTRAINTS?.llm?.responseTokenBudget || {};
  if (phase === "layout_only") {
    if (Number.isInteger(responseTokenBudget.layoutPhase) && responseTokenBudget.layoutPhase > 0) {
      defaultOptions.num_predict = responseTokenBudget.layoutPhase;
    }
  } else if (phase === "actors_only") {
    if (Number.isInteger(responseTokenBudget.actorsPhase) && responseTokenBudget.actorsPhase > 0) {
      defaultOptions.num_predict = responseTokenBudget.actorsPhase;
    }
  } else if (phase === "attacker") {
    if (Number.isInteger(responseTokenBudget.designSummary) && responseTokenBudget.designSummary > 0) {
      defaultOptions.num_predict = responseTokenBudget.designSummary;
    }
  }

  const phaseOverrides = optionsByPhase && typeof optionsByPhase === "object"
    ? optionsByPhase[phase]
    : null;
  if (phaseOverrides && typeof phaseOverrides === "object") {
    return { ...defaultOptions, ...phaseOverrides };
  }
  return defaultOptions;
}

function normalizeAffinity(value) {
  if (typeof value !== "string") return "";
  const compact = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!compact) return "";
  const candidates = [
    compact,
    compact.replace(/\s+based$/, "").trim(),
    compact.replace(/\s+affinity$/, "").trim(),
    compact.split(" ")[0] || "",
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    if (AFFINITY_KIND_SET.has(candidates[i])) {
      return candidates[i];
    }
  }
  return "";
}

function normalizeExpression(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return AFFINITY_EXPRESSION_SET.has(normalized) ? normalized : "";
}

function resolveAffinityIcon(affinity) {
  const normalized = normalizeAffinity(affinity);
  return AFFINITY_ICON_MAP[normalized] || "✨";
}

function resolveAffinityExpressionIcon(expression) {
  const normalized = normalizeExpression(expression);
  return AFFINITY_EXPRESSION_ICON_MAP[normalized] || "◦";
}

function resolveLayoutProfile(value) {
  if (typeof value !== "string") return "auto";
  const normalized = value.trim();
  return LAYOUT_PROFILE_OPTIONS.includes(normalized) ? normalized : "auto";
}

function normalizeAffinityList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values
    .map((value) => normalizeAffinity(value))
    .filter((value) => value && !seen.has(value) && seen.add(value));
}

function formatAffinityList(values) {
  const normalized = normalizeAffinityList(values);
  return normalized.length > 0 ? normalized.join(", ") : "";
}

function formatAffinityPhrase(values, fallbackAffinity) {
  const normalized = normalizeAffinityList(values);
  const list = normalized.length > 0
    ? normalized
    : fallbackAffinity
      ? [normalizeAffinity(fallbackAffinity)].filter(Boolean)
      : [];
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function formatAttackerAffinityConfig(config = {}) {
  const entries = Object.entries(config)
    .map(([affinity, expressions]) => {
      const kind = normalizeAffinity(affinity);
      if (!kind) return null;
      const expressionList = Array.isArray(expressions)
        ? expressions.map((expr) => normalizeExpression(expr)).filter(Boolean)
        : [];
      if (expressionList.length === 0) return kind;
      return `${kind}(${expressionList.join(", ")})`;
    })
    .filter(Boolean);
  return entries.length > 0 ? entries.join(", ") : "";
}

function formatVitalsConfig(vitals = {}) {
  const lines = VITAL_KEYS.map((key) => {
    const value = vitals[key];
    if (!Number.isFinite(value)) return null;
    return `${key} ${value}`;
  }).filter(Boolean);
  return lines.length > 0 ? lines.join(", ") : "";
}

function resolveAllowedLayoutProfiles(layoutProfile = "auto") {
  const preferred = resolveLayoutProfile(layoutProfile);
  if (preferred === "auto") {
    return LAYOUT_PROFILE_OPTIONS.filter((profile) => profile !== "auto");
  }
  return [preferred];
}

function normalizeAttackerSetupModeValue(value) {
  if (typeof value !== "string") return DEFAULT_ATTACKER_SETUP_MODE;
  const normalized = value.trim();
  return ATTACKER_SETUP_MODES.includes(normalized) ? normalized : DEFAULT_ATTACKER_SETUP_MODE;
}

function resolveAttackerPromptScope(params = {}) {
  const mode = normalizeAttackerSetupModeValue(params?.attackerSetupMode);
  const affinityMap = params?.attackerAffinities && typeof params.attackerAffinities === "object"
    ? params.attackerAffinities
    : {};
  const scopedAffinities = [];
  const scopedExpressions = [];

  Object.entries(affinityMap).forEach(([rawAffinity, rawExpressions]) => {
    const affinity = normalizeAffinity(rawAffinity);
    if (!affinity) return;
    if (!scopedAffinities.includes(affinity)) {
      scopedAffinities.push(affinity);
    }
    const expressions = Array.isArray(rawExpressions) ? rawExpressions : [];
    expressions.forEach((expression) => {
      const normalized = normalizeExpression(expression);
      if (!normalized || scopedExpressions.includes(normalized)) return;
      scopedExpressions.push(normalized);
    });
  });

  if (scopedAffinities.length === 0) {
    const levelAffinities = normalizeAffinityList(params?.levelAffinities);
    if (levelAffinities.length > 0) {
      scopedAffinities.push(...levelAffinities);
    } else {
      scopedAffinities.push(DEFAULT_DUNGEON_AFFINITY);
    }
  }

  if (scopedExpressions.length === 0) {
    scopedExpressions.push(...AFFINITY_EXPRESSIONS);
  }

  return {
    setupMode: mode,
    setupModes: [mode],
    affinities: scopedAffinities,
    affinityExpressions: scopedExpressions,
  };
}

function resolveDefenderAffinityScope(params = {}) {
  const defenderAffinities = normalizeAffinityList(params?.defenderAffinities);
  if (defenderAffinities.length > 0) {
    return defenderAffinities;
  }
  const levelAffinities = normalizeAffinityList(params?.levelAffinities);
  if (levelAffinities.length > 0) {
    return levelAffinities;
  }
  return [DEFAULT_DUNGEON_AFFINITY];
}

function buildPromptContext({ params, phase } = {}) {
  const lines = [];
  if (!params || typeof params !== "object") return "";
  if (Number.isInteger(params.thinkTimeSeconds)) {
    lines.push(`Think time: ${params.thinkTimeSeconds}s`);
  }
  if (Number.isInteger(params.llmTokens)) {
    lines.push(`LLM response tokens: ${params.llmTokens}`);
  }
  if (phase === "level") {
    const affinities = formatAffinityList(params.levelAffinities);
    if (affinities) {
      lines.push(`Level affinities: ${affinities}`);
    }
    const preferredLayoutProfile = resolveLayoutProfile(params.layoutProfile);
    if (preferredLayoutProfile !== "auto") {
      lines.push(`Layout profile preference: ${preferredLayoutProfile}`);
      if (preferredLayoutProfile === "rooms") {
        lines.push("Profile scope: room graph + hallway connectivity only.");
      } else if (preferredLayoutProfile === "sparse_islands") {
        lines.push("Profile scope: sparse islands only with density control.");
      } else if (preferredLayoutProfile === "clustered_islands") {
        lines.push("Profile scope: clustered islands only with cluster size control.");
      } else if (preferredLayoutProfile === "rectangular") {
        lines.push("Profile scope: rectangular layout only.");
      }
    }
  }
  if (phase === "defender") {
    const defenderAffinities = formatAffinityList(resolveDefenderAffinityScope(params));
    if (defenderAffinities) {
      lines.push(`Defender affinities: ${defenderAffinities}`);
    }
  }
  if (phase === "attacker") {
    const setupMode = typeof params.attackerSetupMode === "string" && params.attackerSetupMode.trim()
      ? params.attackerSetupMode.trim()
      : DEFAULT_ATTACKER_SETUP_MODE;
    lines.push(`Default setup mode: ${setupMode}`);
    const affinityConfig = formatAttackerAffinityConfig(params.attackerAffinities);
    if (affinityConfig) {
      lines.push(`Requested attacker affinities: ${affinityConfig}`);
    }
    const vitalsMax = formatVitalsConfig(params.attackerVitalsMax);
    if (vitalsMax) {
      lines.push(`Requested attacker vitals max: ${vitalsMax}`);
    }
    const vitalsRegen = formatVitalsConfig(params.attackerVitalsRegen);
    if (vitalsRegen) {
      lines.push(`Requested attacker vitals regen: ${vitalsRegen}`);
    }
  }
  return lines.join(" | ");
}

function buildLlmAttackerConfigPromptTemplate({
  goal,
  notes,
  budgetTokens,
  remainingBudgetTokens,
  context,
  requiredAffinityConfig,
  affinities = AFFINITY_KINDS,
  affinityExpressions = AFFINITY_EXPRESSIONS,
  setupModes = ATTACKER_SETUP_MODES,
  modelContextTokens = DOMAIN_CONSTRAINTS?.llm?.modelContextTokens || DOMAIN_CONSTRAINTS?.llm?.contextWindowTokens,
} = {}) {
  const affinityMenu = normalizeAffinityList(affinities).join(", ") || AFFINITY_KINDS.join(", ");
  const expressionMenu = Array.isArray(affinityExpressions) && affinityExpressions.length > 0
    ? affinityExpressions.join(", ")
    : AFFINITY_EXPRESSIONS.join(", ");
  const setupModeMenu = Array.isArray(setupModes) && setupModes.length > 0
    ? setupModes.join(", ")
    : ATTACKER_SETUP_MODES.join(", ");
  const lines = [];
  if (typeof goal === "string" && goal.trim()) lines.push(`Goal: ${goal.trim()}`);
  if (typeof notes === "string" && notes.trim()) lines.push(`Notes: ${notes.trim()}`);
  if (Number.isInteger(budgetTokens) && budgetTokens > 0) lines.push(`Total budget tokens: ${budgetTokens}`);
  if (Number.isInteger(remainingBudgetTokens) && remainingBudgetTokens >= 0) {
    lines.push(`Attacker phase budget tokens: ${remainingBudgetTokens}`);
  }
  if (Number.isInteger(modelContextTokens) && modelContextTokens > 0) {
    lines.push(`Model context window token limit: ${modelContextTokens}`);
  }
  lines.push("You are an attacker loadout planner.");
  lines.push("Configure the attacker setup only.");
  lines.push("Do not return layout or defender actors.");
  lines.push(`Allowed setup modes: ${setupModeMenu}`);
  lines.push(`Allowed affinities: ${affinityMenu}`);
  lines.push(`Allowed affinity expressions: ${expressionMenu}`);
  if (typeof requiredAffinityConfig === "string" && requiredAffinityConfig.trim()) {
    lines.push(`Required attacker affinities: ${requiredAffinityConfig.trim()}`);
    lines.push("Guardrails: include every required attacker affinity entry in attackerConfig.affinities.");
  }
  lines.push("Guardrails: attackerConfig.affinities must include at least one affinity with at least one expression.");
  lines.push("Guardrails: when affinities are present, attackerConfig.vitalsMax.mana must be an integer greater than 0.");
  lines.push("Guardrails: when affinities are present, attackerConfig.vitalsRegen.mana must be an integer greater than 0.");
  if (typeof context === "string" && context.trim()) {
    lines.push(`Context: ${context.trim()}`);
  }
  lines.push("");
  lines.push("Response shape:");
  lines.push("{ \"dungeonAffinity\": <affinity>, \"attackerConfig\": {\"setupMode\": \"auto\"|\"user\"|\"hybrid\", \"vitalsMax\": {\"health\": <int?>, \"mana\": <int?>, \"stamina\": <int?>, \"durability\": <int?>}, \"vitalsRegen\": {\"health\": <int?>, \"mana\": <int?>, \"stamina\": <int?>, \"durability\": <int?>}, \"affinities\": {\"<affinity>\": [\"push\"|\"pull\"|\"emit\"]}}, \"rooms\": [], \"actors\": [] }");
  lines.push("");
  lines.push("Respond with valid JSON only.");
  return lines.join("\n");
}

function normalizeStacks(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.floor(num));
}

function normalizeAffinityEntries(entries, fallbackAffinity) {
  const normalized = Array.isArray(entries)
    ? entries
      .map((entry) => {
        const kind = normalizeAffinity(entry?.kind);
        const expression = normalizeExpression(entry?.expression);
        if (!kind || !expression) return null;
        return {
          kind,
          expression,
          stacks: normalizeStacks(entry?.stacks),
        };
      })
      .filter(Boolean)
    : [];
  if (normalized.length > 0) {
    return normalized;
  }
  if (fallbackAffinity) {
    return [{ kind: fallbackAffinity, expression: DEFAULT_AFFINITY_EXPRESSION, stacks: 1 }];
  }
  return [];
}

function normalizeVitals(vitals) {
  return normalizeDomainVitals(vitals, DEFAULT_VITALS);
}

function inferAffinityFromSummary(summary) {
  if (!summary || typeof summary !== "object") return "";
  const direct = normalizeAffinity(summary.dungeonAffinity);
  if (direct) return direct;

  const actorAffinity = Array.isArray(summary.actors)
    ? summary.actors.map((entry) => normalizeAffinity(entry?.affinity)).find(Boolean) || ""
    : "";
  if (actorAffinity) return actorAffinity;

  const roomAffinity = Array.isArray(summary.rooms)
    ? summary.rooms.map((entry) => normalizeAffinity(entry?.affinity)).find(Boolean) || ""
    : "";
  if (roomAffinity) return roomAffinity;

  return "";
}

function inferAffinityFromGuidance(guidanceText) {
  const text = typeof guidanceText === "string" ? guidanceText : "";
  const direct = normalizeAffinity(text);
  if (direct) return direct;

  const normalized = text.toLowerCase();
  for (let i = 0; i < AFFINITY_KINDS.length; i += 1) {
    if (normalized.includes(AFFINITY_KINDS[i])) {
      return AFFINITY_KINDS[i];
    }
  }
  return "";
}

function normalizeSummary(summary, guidanceText = "") {
  if (!summary || typeof summary !== "object") {
    return summary;
  }
  const normalized = { ...summary };
  const affinity = inferAffinityFromSummary(normalized)
    || inferAffinityFromGuidance(guidanceText)
    || DEFAULT_DUNGEON_AFFINITY;
  normalized.dungeonAffinity = affinity;
  return normalized;
}

function applyLayoutProfilePreference(summary, layoutProfile = "auto") {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return summary;
  }
  const preferredProfile = resolveLayoutProfile(layoutProfile);
  if (preferredProfile === "auto") {
    return summary;
  }
  const nextSummary = { ...summary };
  const roomDesign = nextSummary.roomDesign && typeof nextSummary.roomDesign === "object" && !Array.isArray(nextSummary.roomDesign)
    ? { ...nextSummary.roomDesign }
    : {};
  roomDesign.profile = preferredProfile;
  nextSummary.roomDesign = roomDesign;
  return nextSummary;
}

function asTokenOrNull(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const normalized = Math.floor(num);
  return normalized >= 0 ? normalized : null;
}

function deriveBudgetBreakdown(loopResult = {}) {
  const trace = Array.isArray(loopResult.trace) ? loopResult.trace : [];
  const layoutPhase = trace.find((entry) => entry?.phase === "layout_only") || null;
  const actorPhases = trace.filter((entry) => entry?.phase === "actors_only");
  const actorSpentTokens = actorPhases.reduce((sum, entry) => {
    const spent = asTokenOrNull(entry?.spentTokens);
    return sum + (spent || 0);
  }, 0);

  const poolBudgets = loopResult?.poolBudgets && typeof loopResult.poolBudgets === "object"
    ? loopResult.poolBudgets
    : {};

  return {
    levelBudgetTokens: asTokenOrNull(poolBudgets.layout),
    levelSpendTokens: asTokenOrNull(layoutPhase?.spentTokens),
    actorBudgetTokens: asTokenOrNull(layoutPhase?.remainingBudgetTokens) ?? asTokenOrNull(poolBudgets.defenders),
    actorSpendTokens: actorSpentTokens,
    actorRemainingTokens: asTokenOrNull(loopResult?.remainingBudgetTokens),
    playerBudgetTokens: asTokenOrNull(poolBudgets.player),
    lootBudgetTokens: asTokenOrNull(poolBudgets.loot),
  };
}

function formatTokenLine(label, spent, budget, remaining) {
  if (!Number.isInteger(spent) && !Number.isInteger(budget) && !Number.isInteger(remaining)) {
    return null;
  }
  const spentText = Number.isInteger(spent) ? String(spent) : "n/a";
  const budgetText = Number.isInteger(budget) ? String(budget) : "n/a";
  const remainingText = Number.isInteger(remaining) ? String(remaining) : "n/a";
  return `${label}: spent ${spentText} / budget ${budgetText} (remaining ${remainingText})`;
}

function formatLevelSpendLine({ levelSpend, levelBudget, totalBudget, actorPoolBudget } = {}) {
  if (!Number.isInteger(levelSpend) && !Number.isInteger(levelBudget) && !Number.isInteger(totalBudget)) {
    return null;
  }
  const spentText = Number.isInteger(levelSpend) ? String(levelSpend) : "n/a";
  const poolText = Number.isInteger(levelBudget) ? String(levelBudget) : "n/a";
  const totalRemaining = Number.isInteger(totalBudget) && Number.isInteger(levelSpend)
    ? Math.max(0, totalBudget - levelSpend)
    : null;
  const totalRemainingText = Number.isInteger(totalRemaining) ? String(totalRemaining) : "n/a";
  const actorPoolText = Number.isInteger(actorPoolBudget) ? String(actorPoolBudget) : "n/a";
  const reservedText = Number.isInteger(totalRemaining) && Number.isInteger(actorPoolBudget)
    ? `, reserved outside actor pool ${Math.max(0, totalRemaining - actorPoolBudget)}`
    : "";
  return `Level Spend: spent ${spentText} / level pool ${poolText} (total remaining ${totalRemainingText}, actor pool ${actorPoolText}${reservedText})`;
}

function summarizeLoopErrors(errors = []) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "unknown error";
  }
  return errors
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return String(entry);
      const code = entry.code || "error";
      const field = entry.field ? `${entry.field}: ` : "";
      return `${field}${code}`;
    })
    .join(", ");
}

function nowMs() {
  if (typeof globalThis.performance?.now === "function") {
    return globalThis.performance.now();
  }
  return Date.now();
}

function formatMs(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index];
}

function summarizeMs(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { avg: null, p50: null, p95: null, min: null, max: null };
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    avg: formatMs(sum / values.length),
    p50: formatMs(percentile(values, 50)),
    p95: formatMs(percentile(values, 95)),
    min: formatMs(Math.min(...values)),
    max: formatMs(Math.max(...values)),
  };
}

function buildLevelBenchmarkSweep({ targetBudgetTokens, maxBudgetTokens } = {}) {
  const target = Number.isInteger(targetBudgetTokens) && targetBudgetTokens > 0
    ? targetBudgetTokens
    : DEFAULT_GUIDANCE_BUDGET_TOKENS;
  const maxBudget = Number.isInteger(maxBudgetTokens) && maxBudgetTokens > 0
    ? maxBudgetTokens
    : Math.max(target, DEFAULT_BENCHMARK_MAX_TOKEN_BUDGET);
  if (maxBudget <= target) {
    return [target];
  }
  const lowerSeed = Math.max(10000, Math.floor(target / 4));
  const budgets = new Set([target, maxBudget, lowerSeed]);
  let cursor = lowerSeed;
  while (cursor < maxBudget && budgets.size < BENCHMARK_MAX_POINTS) {
    cursor = Math.max(cursor + 1, Math.floor(cursor * 2));
    budgets.add(Math.min(cursor, maxBudget));
    if (cursor >= maxBudget) break;
  }
  return Array.from(budgets)
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

export function buildDefaultStrategicGuidancePrompt({
  budgetTokens = DEFAULT_GUIDANCE_BUDGET_TOKENS,
  tileCosts = DEFAULT_LAYOUT_TILE_COSTS,
  promptParams,
} = {}) {
  const normalizedBudget = Number.isInteger(budgetTokens) && budgetTokens > 0
    ? budgetTokens
    : DEFAULT_GUIDANCE_BUDGET_TOKENS;
  const selectedLevelAffinities = normalizeAffinityList(promptParams?.levelAffinities);
  const affinityPhrase = formatAffinityPhrase(selectedLevelAffinities, DEFAULT_DUNGEON_AFFINITY);
  const defaultIntent = `Design a ${affinityPhrase} affinity dungeon layout.`;
  const defenderAffinities = resolveDefenderAffinityScope(promptParams);
  const defenderAffinityPhrase = formatAffinityPhrase(
    defenderAffinities.length > 0 ? defenderAffinities : selectedLevelAffinities,
    DEFAULT_DUNGEON_AFFINITY,
  );
  const defenderAffinityChoices = defenderAffinities.length > 0 ? defenderAffinities : [DEFAULT_DUNGEON_AFFINITY];
  const attackerScope = resolveAttackerPromptScope(promptParams);
  const attackerAffinityPhrase = formatAffinityPhrase(attackerScope.affinities, DEFAULT_DUNGEON_AFFINITY);
  const requiredAttackerAffinityConfig = formatAttackerAffinityConfig(promptParams?.attackerAffinities);
  const allowedLayoutProfiles = resolveAllowedLayoutProfiles(promptParams?.layoutProfile);
  const actorGoal = `Create dungeon defenders for a ${defenderAffinityPhrase} themed dungeon.`;
  const poolBudgets = promptParams?.poolBudgets && typeof promptParams.poolBudgets === "object"
    ? promptParams.poolBudgets
    : null;
  const levelPoolBudget = asTokenOrNull(poolBudgets?.layout);
  const defenderPoolBudget = asTokenOrNull(poolBudgets?.defenders);
  const attackerPoolBudget = asTokenOrNull(poolBudgets?.attacker);
  const hasLevelBudget = Number.isInteger(promptParams?.levelBudget);
  const hasAttackerBudget = Number.isInteger(promptParams?.attackerBudget);
  const levelBudgetTokens = Number.isInteger(levelPoolBudget)
    ? levelPoolBudget
    : hasLevelBudget
    ? promptParams.levelBudget
    : hasAttackerBudget
      ? Math.max(0, normalizedBudget - promptParams.attackerBudget)
      : normalizedBudget;
  const defenderBudgetTokens = Number.isInteger(defenderPoolBudget)
    ? defenderPoolBudget
    : hasAttackerBudget
    ? promptParams.attackerBudget
    : hasLevelBudget
      ? Math.max(0, normalizedBudget - promptParams.levelBudget)
      : normalizedBudget;
  const attackerBudgetTokens = Number.isInteger(attackerPoolBudget)
    ? attackerPoolBudget
    : normalizedBudget;
  const levelContext = buildPromptContext({ params: promptParams, phase: "level" });
  const attackerContext = buildPromptContext({ params: promptParams, phase: "attacker" });
  const actorContext = buildPromptContext({ params: promptParams, phase: "defender" });
  const levelTemplate = buildLlmLevelPromptTemplate({
    goal: defaultIntent,
    notes: "Phase 1 of 2. Generate layout only.",
    budgetTokens: normalizedBudget,
    remainingBudgetTokens: levelBudgetTokens,
    layoutCosts: tileCosts,
    allowedProfiles: allowedLayoutProfiles,
    context: levelContext,
    modelContextTokens: MODEL_CONTEXT_TOKENS || CONTEXT_WINDOW_TOKENS,
    layoutLatencyMs: DOMAIN_CONSTRAINTS?.llm?.targetLatencyMs?.layoutPhase,
  });
  const actorTemplate = buildLlmActorConfigPromptTemplate({
    goal: actorGoal,
    notes: "Phase 2 of 2. Generate defenders and defender configurations only.",
    budgetTokens: normalizedBudget,
    remainingBudgetTokens: defenderBudgetTokens,
    allowedPairsText: "<runtime populates catalog-constrained profiles>",
    context: actorContext || "Use the selected defender affinities (if any) and remaining budget from layout phase.",
    affinities: defenderAffinityChoices,
    affinityExpressions: AFFINITY_EXPRESSIONS,
    motivations: MOTIVATION_KINDS,
    modelContextTokens: MODEL_CONTEXT_TOKENS || CONTEXT_WINDOW_TOKENS,
  });
  const attackerTemplate = buildLlmAttackerConfigPromptTemplate({
    goal: `Configure attacker setup for a ${attackerAffinityPhrase} themed dungeon.`,
    notes: "Phase 2 of 3. Configure attacker setup only.",
    budgetTokens: normalizedBudget,
    remainingBudgetTokens: attackerBudgetTokens,
    context: attackerContext || "Use the attacker controls as defaults when available.",
    requiredAffinityConfig: requiredAttackerAffinityConfig,
    affinities: attackerScope.affinities,
    affinityExpressions: attackerScope.affinityExpressions,
    setupModes: attackerScope.setupModes,
    modelContextTokens: MODEL_CONTEXT_TOKENS || CONTEXT_WINDOW_TOKENS,
  });
  return [
    LEVEL_TEMPLATE_HEADER,
    levelTemplate,
    "",
    ATTACKER_TEMPLATE_HEADER,
    attackerTemplate,
    "",
    DEFENDER_TEMPLATE_HEADER,
    actorTemplate,
  ].join("\n");
}

export const buildDefaultPromptTemplate = buildDefaultStrategicGuidancePrompt;

function formatCategoryLine(label, category) {
  if (!category || typeof category !== "object") return null;
  const spent = Number.isInteger(category.spentTokens) ? category.spentTokens : null;
  const budget = Number.isInteger(category.budgetTokens) ? category.budgetTokens : null;
  const remaining = Number.isInteger(category.remainingTokens) ? category.remainingTokens : null;
  if (spent === null && budget === null && remaining === null) return null;
  return formatTokenLine(label, spent, budget, remaining);
}

function formatSpendLedger(spendLedger) {
  if (!spendLedger || typeof spendLedger !== "object") return [];
  const lines = [];
  if (Number.isInteger(spendLedger.totalSpentTokens)) {
    const remaining = Number.isInteger(spendLedger.remainingTokens) ? spendLedger.remainingTokens : null;
    const totalBudget = Number.isInteger(spendLedger.budgetTokens) ? spendLedger.budgetTokens : null;
    lines.push(formatTokenLine("Total Spend", spendLedger.totalSpentTokens, totalBudget, remaining));
  }
  const levelLine = formatCategoryLine("Level Config Spend", spendLedger.categories?.levelConfig);
  if (levelLine) lines.push(levelLine);
  const actorLine = formatCategoryLine("Actor Base Spend", spendLedger.categories?.actorBase);
  if (actorLine) lines.push(actorLine);
  const configLine = formatCategoryLine("Actor Config Spend", spendLedger.categories?.actorConfiguration);
  if (configLine) lines.push(configLine);
  if (spendLedger.overBudget) {
    const overBy = Number.isInteger(spendLedger.totalOverBudgetBy) ? spendLedger.totalOverBudgetBy : "unknown";
    lines.push(`Budget Status: over budget by ${overBy} tokens.`);
  } else if (Number.isInteger(spendLedger.remainingTokens)) {
    lines.push(`Budget Status: within budget (${spendLedger.remainingTokens} tokens remaining).`);
  }
  return lines.filter(Boolean);
}

export function buildDesignBrief(summary, guidanceText = "", { budgeting, spendLedger, promptParams } = {}) {
  if (!summary) return "No summary available.";
  const summaryAffinity = normalizeAffinity(summary.dungeonAffinity);
  const guidanceLevelAffinities = (() => {
    if (typeof guidanceText !== "string") return [];
    const match = guidanceText.match(/design\s+a\s+(.+?)\s+affinity\s+dungeon\s+layout/i);
    if (!match || !match[1]) return [];
    const seen = new Set();
    const tokens = match[1].toLowerCase().match(/[a-z_]+/g) || [];
    return tokens
      .map((token) => normalizeAffinity(token))
      .filter((token) => token && !seen.has(token) && seen.add(token));
  })();
  const levelAffinities = normalizeAffinityList(promptParams?.levelAffinities);
  const resolvedAffinities = levelAffinities.length > 0
    ? levelAffinities
    : guidanceLevelAffinities.length > 0
      ? guidanceLevelAffinities
      : summaryAffinity
        ? [summaryAffinity]
        : [];
  const dungeonAffinity = formatAffinityPhrase(
    resolvedAffinities,
    summaryAffinity || DEFAULT_DUNGEON_AFFINITY,
  ) || "unknown";
  const budget = Number.isFinite(summary.budgetTokens) ? `${summary.budgetTokens} tokens` : "unspecified";
  const totalBudgetTokens = Number.isInteger(summary.budgetTokens) ? summary.budgetTokens : null;
  const actorGroups = Array.isArray(summary.actors) ? summary.actors.length : 0;
  const actorCount = Array.isArray(summary.actors)
    ? summary.actors.reduce((sum, actor) => sum + (Number.isFinite(actor?.count) ? actor.count : 1), 0)
    : 0;
  const layout = summary.layout && typeof summary.layout === "object" ? summary.layout : null;

  const layoutLine = layout
    ? `Layout Tiles: floor ${layout.floorTiles || 0}, hallway ${layout.hallwayTiles || 0}`
    : "Layout Tiles: unknown.";

  const levelSpendLine = formatLevelSpendLine({
    levelSpend: budgeting?.levelSpendTokens,
    levelBudget: budgeting?.levelBudgetTokens,
    totalBudget: totalBudgetTokens,
    actorPoolBudget: budgeting?.actorBudgetTokens,
  });
  const actorSpendLine = formatTokenLine(
    "Actor Spend",
    budgeting?.actorSpendTokens,
    budgeting?.actorBudgetTokens,
    budgeting?.actorRemainingTokens,
  );

  const spendLines = formatSpendLedger(spendLedger);
  const missing = Array.isArray(summary.missing) && summary.missing.length
    ? `Missing: ${summary.missing.join(", ")}.`
    : "Missing: none.";
  const guidanceLine = guidanceText ? `Guidance: ${guidanceText}` : "Guidance: (none)";

  return [
    `Dungeon Affinity: ${dungeonAffinity}`,
    `Budget: ${budget}`,
    layoutLine,
    levelSpendLine,
    actorSpendLine,
    `Actors Total: ${actorCount}`,
    `Actor Profiles: ${actorGroups}`,
    ...spendLines,
    missing,
    guidanceLine,
  ]
    .filter(Boolean)
    .join("\n");
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function inferLayoutProfile(summary) {
  const raw = typeof summary?.roomDesign?.profile === "string"
    ? summary.roomDesign.profile.trim()
    : "";
  if (LAYOUT_PROFILE_OPTIONS.includes(raw) && raw !== "auto") return raw;
  const hasRooms = Array.isArray(summary?.roomDesign?.rooms) && summary.roomDesign.rooms.length > 0;
  return hasRooms ? "rooms" : "rectangular";
}

function deriveFallbackLevelGenFromSummary(summary) {
  const floorTiles = isPositiveInt(summary?.layout?.floorTiles) ? summary.layout.floorTiles : 0;
  const hallwayTiles = isPositiveInt(summary?.layout?.hallwayTiles) ? summary.layout.hallwayTiles : 0;
  const walkableTilesTarget = floorTiles + hallwayTiles;
  if (!isPositiveInt(walkableTilesTarget)) return null;
  const profile = inferLayoutProfile(summary);
  const densityByProfile = {
    rectangular: 0.7,
    rooms: 0.55,
    clustered_islands: 0.45,
    sparse_islands: 0.35,
  };
  const density = densityByProfile[profile] || densityByProfile.rectangular;
  const interiorArea = Math.ceil(walkableTilesTarget / density);
  const interiorSide = Math.max(3, Math.ceil(Math.sqrt(interiorArea)));
  const size = Math.max(5, interiorSide + 2);

  return {
    width: size,
    height: size,
    shape: { profile },
    walkableTilesTarget,
  };
}

function resolveLevelGenFromSummary(summary) {
  const built = buildBuildSpecFromSummary({
    summary,
    source: "design-level-preview",
    runId: `design_level_preview_${Date.now()}`,
  });
  if (built?.ok) {
    const levelGen = built.spec?.configurator?.inputs?.levelGen;
    if (levelGen && typeof levelGen === "object") {
      return levelGen;
    }
  }
  return deriveFallbackLevelGenFromSummary(summary);
}

function generatePreviewTiles(summary) {
  if (!summary || typeof summary !== "object") {
    return { ok: false, reason: "missing_summary" };
  }
  const levelGen = resolveLevelGenFromSummary(summary);
  if (!levelGen) {
    return { ok: false, reason: "missing_level_gen" };
  }
  const generated = generateGridLayoutFromInput(levelGen);
  if (!generated?.ok) {
    return {
      ok: false,
      reason: "layout_generation_failed",
      errors: Array.isArray(generated.errors) ? generated.errors : [],
    };
  }
  const tiles = generated.value?.tiles;
  if (!Array.isArray(tiles) || tiles.length === 0) {
    return { ok: false, reason: "missing_tiles" };
  }
  const width = String(tiles[0] || "").length;
  const height = tiles.length;
  if (!isPositiveInt(width) || !isPositiveInt(height)) {
    return { ok: false, reason: "invalid_dimensions" };
  }
  return { ok: true, tiles, width, height };
}

function formatPreviewGenerationError(preview = {}) {
  const errors = Array.isArray(preview?.errors) ? preview.errors : [];
  if (errors.length === 0) return LEVEL_PREVIEW_UNAVAILABLE_TEXT;
  const parts = errors
    .slice(0, 3)
    .map((entry) => {
      const field = typeof entry?.field === "string" ? entry.field : "layout";
      const code = typeof entry?.code === "string" ? entry.code : "generation_failed";
      if (code === "target_mismatch") {
        return "walkable target could not be reconciled";
      }
      if (code === "exceeds_walkable_capacity") {
        return "walkable target exceeds map capacity";
      }
      return `${field}: ${code}`;
    });
  return `Level preview failed: ${parts.join("; ")}.`;
}

function countWalkableTiles(tiles = []) {
  if (!Array.isArray(tiles)) return 0;
  let count = 0;
  tiles.forEach((rawRow) => {
    const row = String(rawRow || "");
    for (let i = 0; i < row.length; i += 1) {
      if (row[i] !== "#") count += 1;
    }
  });
  return count;
}

function resolveTileSize(width, height) {
  const longestEdge = Math.max(1, width, height);
  return Math.max(1, Math.min(LEVEL_PREVIEW_MAX_TILE_SIZE, Math.floor(LEVEL_PREVIEW_MAX_DIMENSION / longestEdge)));
}

function setLevelDesignTextOutput(levelDesignOutput, message) {
  if (!levelDesignOutput) return;
  levelDesignOutput.textContent = message;
}

function canRenderLevelPreview(levelDesignOutput, doc) {
  return Boolean(
    levelDesignOutput
      && doc
      && typeof doc.createElement === "function"
      && typeof levelDesignOutput.replaceChildren === "function",
  );
}

function createLevelPreviewCanvas(doc, tiles, width, height, tileSize) {
  const canvas = doc.createElement("canvas");
  if (!canvas || typeof canvas.getContext !== "function") return null;
  canvas.className = "level-preview-canvas";
  canvas.width = width * tileSize;
  canvas.height = height * tileSize;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Generated level preview ${width} by ${height}`);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  tiles.forEach((rawRow, y) => {
    const row = String(rawRow || "");
    for (let x = 0; x < width; x += 1) {
      const char = row[x] || "#";
      const color = LEVEL_PREVIEW_TILE_COLORS[char] || (char === "#" ? LEVEL_PREVIEW_TILE_COLORS["#"] : LEVEL_PREVIEW_TILE_COLORS["."]);
      ctx.fillStyle = color;
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  });
  return canvas;
}

function renderLevelDesignOutput(levelDesignOutput, summary) {
  if (!levelDesignOutput) return;
  const preview = generatePreviewTiles(summary);
  if (!preview.ok) {
    if (summary && preview.reason === "layout_generation_failed") {
      setLevelDesignTextOutput(levelDesignOutput, formatPreviewGenerationError(preview));
    } else {
      setLevelDesignTextOutput(levelDesignOutput, summary ? LEVEL_PREVIEW_UNAVAILABLE_TEXT : LEVEL_PREVIEW_EMPTY_TEXT);
    }
    return;
  }

  const walkableTiles = countWalkableTiles(preview.tiles);
  const fallbackText = `Level preview ready: ${preview.width}x${preview.height}, walkable ${walkableTiles}.`;
  const doc = levelDesignOutput.ownerDocument || (typeof document === "object" ? document : null);
  if (!canRenderLevelPreview(levelDesignOutput, doc)) {
    setLevelDesignTextOutput(levelDesignOutput, fallbackText);
    return;
  }

  const tileSize = resolveTileSize(preview.width, preview.height);
  const canvas = createLevelPreviewCanvas(doc, preview.tiles, preview.width, preview.height, tileSize);
  if (!canvas) {
    setLevelDesignTextOutput(levelDesignOutput, fallbackText);
    return;
  }

  const wrapper = doc.createElement("div");
  wrapper.className = "level-preview-shell";
  const meta = doc.createElement("div");
  meta.className = "level-preview-meta";
  meta.textContent = `${preview.width}x${preview.height} | walkable ${walkableTiles} | ${tileSize}px tiles`;
  wrapper.append(meta, canvas);

  levelDesignOutput.replaceChildren(wrapper);
}

export function buildActorSet(summary) {
  if (!summary) return [];
  const actorSet = [];
  const actors = Array.isArray(summary.actors) ? summary.actors : [];
  const rooms = Array.isArray(summary.rooms) ? summary.rooms : [];
  const dungeonAffinity = normalizeAffinity(summary.dungeonAffinity) || DEFAULT_DUNGEON_AFFINITY;
  const setupMode = typeof summary?.attackerConfig?.setupMode === "string"
    ? summary.attackerConfig.setupMode
    : DEFAULT_ATTACKER_SETUP_MODE;

  actors.forEach((entry, index) => {
    const role = typeof entry?.motivation === "string" && entry.motivation.trim()
      ? entry.motivation.trim()
      : "stationary";
    const affinity = normalizeAffinity(entry?.affinity) || dungeonAffinity;
    actorSet.push({
      id: `actor_${role}_${index + 1}`,
      source: "actor",
      role,
      affinity,
      count: Number.isFinite(entry?.count) ? entry.count : 1,
      tokenHint: Number.isFinite(entry?.tokenHint) ? entry.tokenHint : null,
      affinities: normalizeAffinityEntries(entry?.affinities, affinity),
      vitals: normalizeVitals(entry?.vitals),
      setupMode: typeof entry?.setupMode === "string" ? entry.setupMode : setupMode,
    });
  });

  rooms.forEach((entry, index) => {
    const role = typeof entry?.motivation === "string" && entry.motivation.trim()
      ? entry.motivation.trim()
      : "stationary";
    const affinity = normalizeAffinity(entry?.affinity) || dungeonAffinity;
    actorSet.push({
      id: `room_${role}_${index + 1}`,
      source: "room",
      role,
      affinity,
      count: Number.isFinite(entry?.count) ? entry.count : 1,
      tokenHint: Number.isFinite(entry?.tokenHint) ? entry.tokenHint : null,
      affinities: normalizeAffinityEntries(entry?.affinities, affinity),
    });
  });

  return actorSet;
}

export function formatActorSet(actorSet = []) {
  if (!Array.isArray(actorSet) || actorSet.length === 0) {
    return "No actors proposed.";
  }
  return actorSet
    .map((actor, index) => {
      const count = Number.isFinite(actor?.count) ? actor.count : 1;
      const role = actor?.role || "role";
      const affinity = actor?.affinity || "affinity";
      const affinities = Array.isArray(actor?.affinities) ? actor.affinities : [];
      const affinityText = affinities.length > 0
        ? affinities
          .map((entry) => {
            const kind = entry?.kind || affinity;
            const expression = entry?.expression || DEFAULT_AFFINITY_EXPRESSION;
            const stacks = Number.isInteger(entry?.stacks) && entry.stacks > 0 ? entry.stacks : 1;
            return `${kind}:${expression}x${stacks}`;
          })
          .join(", ")
        : `${affinity}:${DEFAULT_AFFINITY_EXPRESSION}x1`;
      return `${index + 1}. ${actor?.id || "actor"} (${role}) x${count} | affinities ${affinityText}`;
    })
    .join("\n");
}

export function wireDesignGuidance({ elements = {}, llmConfig = {}, onSummary, onLlmCapture } = {}) {
  const {
    guidanceInput,
    levelPromptInput,
    attackerPromptInput,
    defenderPromptInput,
    modeSelect,
    modelInput,
    baseUrlInput,
    generateButton,
    fixtureButton,
    statusEl,
    briefOutput,
    spendLedgerOutput,
    levelDesignOutput,
    attackerConfigOutput,
    levelTokenIndicator,
    attackerTokenIndicator,
    defenderTokenIndicator,
    simulationTokenIndicator,
    actorSetInput,
    actorSetPreview,
    applyActorSetButton,
    tokenBudgetInput,
    maxTokenBudgetInput,
    thinkTimeInput,
    llmTokensInput,
    layoutProfileInput,
    layoutAllocationPercentInput,
    defenderAllocationPercentInput,
    attackerAllocationPercentInput,
    budgetAllocationSummary,
    levelBenchmarkButton,
    levelBenchmarkOutput,
    benchmarkMaxTokenBudgetInput,
    benchmarkSampleRunsInput,
    levelAffinitiesContainer,
    attackerSetupModeInput,
    attackerAffinitiesContainer,
    defenderAffinitiesContainer,
    attackerVitalsInputs,
    attackerVitalsRegenInputs,
  } = elements;

  const state = {
    summary: null,
    actorSet: [],
    budgeting: null,
    priceList: null,
    spendLedger: null,
    traceRunId: `design_guidance_${Date.now()}`,
  };

  if (modelInput && (!modelInput.value || !modelInput.value.trim())) {
    modelInput.value = DEFAULT_LLM_MODEL;
  }
  if (baseUrlInput && (!baseUrlInput.value || !baseUrlInput.value.trim())) {
    baseUrlInput.value = DEFAULT_LLM_BASE_URL;
  }
  if (benchmarkMaxTokenBudgetInput && (!benchmarkMaxTokenBudgetInput.value || !benchmarkMaxTokenBudgetInput.value.trim())) {
    benchmarkMaxTokenBudgetInput.value = String(DEFAULT_BENCHMARK_MAX_TOKEN_BUDGET);
  }
  if (benchmarkSampleRunsInput && (!benchmarkSampleRunsInput.value || !benchmarkSampleRunsInput.value.trim())) {
    benchmarkSampleRunsInput.value = String(DEFAULT_BENCHMARK_SAMPLE_RUNS);
  }
  if (levelBenchmarkOutput && !levelBenchmarkOutput.textContent) {
    levelBenchmarkOutput.textContent = "No benchmark yet.";
  }
  const hasTemplateInput = Boolean(guidanceInput || levelPromptInput || attackerPromptInput || defenderPromptInput);
  if (hasTemplateInput) {
    const defaultPrompt = buildDefaultStrategicGuidancePrompt();
    if (guidanceInput && (!guidanceInput.value || !guidanceInput.value.trim())) {
      guidanceInput.value = defaultPrompt;
    }
    if (levelPromptInput && (!levelPromptInput.value || !levelPromptInput.value.trim())) {
      levelPromptInput.value = defaultPrompt;
    }
    if (attackerPromptInput && (!attackerPromptInput.value || !attackerPromptInput.value.trim())) {
      attackerPromptInput.value = defaultPrompt;
    }
    if (defenderPromptInput && (!defenderPromptInput.value || !defenderPromptInput.value.trim())) {
      defenderPromptInput.value = defaultPrompt;
    }
  }
  if (levelDesignOutput) {
    renderLevelDesignOutput(levelDesignOutput, null);
  }
  if (attackerConfigOutput && !attackerConfigOutput.textContent) {
    attackerConfigOutput.textContent = "No attacker configuration yet.";
  }

  const hasPromptParamsUI = Boolean(
    tokenBudgetInput
      || maxTokenBudgetInput
      || thinkTimeInput
      || llmTokensInput
      || layoutProfileInput
      || layoutAllocationPercentInput
      || defenderAllocationPercentInput
      || attackerAllocationPercentInput
      || budgetAllocationSummary
      || levelAffinitiesContainer
      || attackerSetupModeInput
      || attackerAffinitiesContainer
      || defenderAffinitiesContainer
      || attackerVitalsInputs
      || attackerVitalsRegenInputs,
  );
  const defenderAffinitySyncState = {
    lastSyncedCounts: AFFINITY_KINDS.reduce((acc, affinity) => {
      acc[affinity] = 0;
      return acc;
    }, {}),
  };

  function resolveAttackerSetupMode(value) {
    return normalizeAttackerSetupModeValue(value);
  }

  function hydrateLayoutProfileOptions() {
    if (!layoutProfileInput) return;
    if (layoutProfileInput.options && layoutProfileInput.options.length > 0) {
      layoutProfileInput.value = resolveLayoutProfile(layoutProfileInput.value);
      return;
    }
    if (
      typeof layoutProfileInput.appendChild !== "function"
      || typeof globalThis.document?.createElement !== "function"
    ) {
      layoutProfileInput.value = resolveLayoutProfile(layoutProfileInput.value);
      return;
    }
    LAYOUT_PROFILE_OPTIONS.forEach((profile) => {
      const option = globalThis.document.createElement("option");
      option.value = profile;
      option.textContent = profile;
      layoutProfileInput.appendChild(option);
    });
    layoutProfileInput.value = "auto";
  }

  function hydrateAttackerSetupOptions() {
    if (!attackerSetupModeInput) return;
    if (attackerSetupModeInput.options && attackerSetupModeInput.options.length > 0) {
      attackerSetupModeInput.value = resolveAttackerSetupMode(attackerSetupModeInput.value);
      return;
    }
    if (
      typeof attackerSetupModeInput.appendChild !== "function"
      || typeof globalThis.document?.createElement !== "function"
    ) {
      attackerSetupModeInput.value = resolveAttackerSetupMode(attackerSetupModeInput.value);
      return;
    }
    ATTACKER_SETUP_MODES.forEach((mode) => {
      const option = globalThis.document.createElement("option");
      option.value = mode;
      option.textContent = mode;
      attackerSetupModeInput.appendChild(option);
    });
    attackerSetupModeInput.value = DEFAULT_ATTACKER_SETUP_MODE;
  }

  function renderAffinityOptions(container, { includeExpressions = false } = {}) {
    if (
      !container
      || typeof container.appendChild !== "function"
      || typeof globalThis.document?.createElement !== "function"
    ) {
      return;
    }
    container.textContent = "";
    const doc = globalThis.document;
    AFFINITY_KINDS.forEach((affinity) => {
      const row = doc.createElement("div");
      row.className = "affinity-row";
      const control = doc.createElement("div");
      control.className = "affinity-control";
      const label = doc.createElement("span");
      label.className = "affinity-kind-label icon-label";
      label.textContent = `${resolveAffinityIcon(affinity)} ${affinity}`;
      const countInput = doc.createElement("input");
      countInput.type = "number";
      countInput.min = "0";
      countInput.step = "1";
      countInput.value = "0";
      countInput.dataset.affinity = affinity;
      countInput.className = "affinity-count";
      control.appendChild(label);
      control.appendChild(countInput);
      row.appendChild(control);

      if (includeExpressions) {
        const exprWrap = doc.createElement("div");
        exprWrap.className = "affinity-expressions";
        AFFINITY_EXPRESSIONS.forEach((expression) => {
          const exprLabel = doc.createElement("label");
          const exprInput = doc.createElement("input");
          exprInput.type = "checkbox";
          exprInput.dataset.affinity = affinity;
          exprInput.dataset.expression = expression;
          exprInput.className = "affinity-expression";
          exprInput.disabled = true;
          exprLabel.appendChild(exprInput);
          const exprText = doc.createElement("span");
          exprText.className = "icon-label";
          exprText.textContent = `${resolveAffinityExpressionIcon(expression)} ${expression}`;
          exprLabel.appendChild(exprText);
          exprWrap.appendChild(exprLabel);
        });
        row.appendChild(exprWrap);

        const syncExpressions = () => {
          const enabled = parseAffinityCount(countInput.value) > 0;
          const expressionInputs = Array.from(exprWrap.querySelectorAll("input.affinity-expression"));
          expressionInputs.forEach((input) => {
            input.disabled = !enabled;
            if (!enabled) input.checked = false;
          });
          if (enabled && expressionInputs.length > 0 && expressionInputs.every((input) => !input.checked)) {
            expressionInputs.forEach((input) => {
              input.checked = true;
            });
          }
        };

        countInput.addEventListener("input", syncExpressions);
        countInput.addEventListener("change", () => {
          countInput.value = String(parseAffinityCount(countInput.value));
          syncExpressions();
        });
        syncExpressions();
      } else {
        countInput.addEventListener("change", () => {
          countInput.value = String(parseAffinityCount(countInput.value));
        });
      }

      container.appendChild(row);
    });
  }

  function collectSelectedAffinities(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll("input.affinity-count"))
      .filter((input) => parseAffinityCount(input.value) > 0)
      .map((input) => input.dataset.affinity)
      .filter(Boolean);
  }

  function readAffinityCounts(container) {
    if (!container || typeof container.querySelector !== "function") {
      return {};
    }
    return AFFINITY_KINDS.reduce((acc, affinity) => {
      const input = container.querySelector(`input.affinity-count[data-affinity="${affinity}"]`);
      acc[affinity] = parseAffinityCount(input?.value);
      return acc;
    }, {});
  }

  function syncDefenderAffinitiesFromLevel({ force = false } = {}) {
    if (
      !levelAffinitiesContainer
      || !defenderAffinitiesContainer
      || typeof defenderAffinitiesContainer.querySelector !== "function"
    ) {
      return;
    }
    const levelCounts = readAffinityCounts(levelAffinitiesContainer);
    const defenderCounts = readAffinityCounts(defenderAffinitiesContainer);
    AFFINITY_KINDS.forEach((affinity) => {
      const levelCount = parseAffinityCount(levelCounts[affinity]);
      const defenderCount = parseAffinityCount(defenderCounts[affinity]);
      const lastSynced = parseAffinityCount(defenderAffinitySyncState.lastSyncedCounts[affinity]);
      const canSync = force || defenderCount === lastSynced;
      if (!canSync) {
        return;
      }
      if (defenderCount !== levelCount) {
        const defenderInput = defenderAffinitiesContainer.querySelector(
          `input.affinity-count[data-affinity="${affinity}"]`,
        );
        if (defenderInput) {
          defenderInput.value = String(levelCount);
        }
      }
      defenderAffinitySyncState.lastSyncedCounts[affinity] = levelCount;
    });
  }

  function resolveRandomValue(randomFn) {
    const raw = Number(randomFn?.());
    if (!Number.isFinite(raw)) return Math.random();
    if (raw <= 0) return 0;
    if (raw >= 1) return 0.999999;
    return raw;
  }

  function pickRandomLevelAffinities() {
    const randomFn = typeof llmConfig?.randomFn === "function" ? llmConfig.randomFn : Math.random;
    const maxCount = AFFINITY_KINDS.length;
    if (maxCount <= 0) return [];
    const selectedCount = Math.max(1, Math.min(maxCount, Math.floor(resolveRandomValue(randomFn) * maxCount) + 1));
    const pool = AFFINITY_KINDS.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(resolveRandomValue(randomFn) * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, selectedCount);
  }

  function applyAffinitySelection(container, selectedAffinities = []) {
    if (!container || typeof container.querySelector !== "function") return;
    const selected = new Set(normalizeAffinityList(selectedAffinities));
    AFFINITY_KINDS.forEach((affinity) => {
      const input = container.querySelector(`input.affinity-count[data-affinity="${affinity}"]`);
      if (!input) return;
      input.value = selected.has(affinity) ? "1" : "0";
    });
  }

  function ensureRandomLevelAndDefenderAffinities(promptParams = null) {
    if (!levelAffinitiesContainer || !defenderAffinitiesContainer) {
      return promptParams && typeof promptParams === "object" ? promptParams : null;
    }
    const currentParams = promptParams && typeof promptParams === "object"
      ? promptParams
      : readPromptParams();
    const existingLevelAffinities = normalizeAffinityList(currentParams?.levelAffinities);
    if (existingLevelAffinities.length > 0) {
      return currentParams;
    }
    const randomLevelAffinities = pickRandomLevelAffinities();
    if (randomLevelAffinities.length === 0) {
      return currentParams;
    }
    applyAffinitySelection(levelAffinitiesContainer, randomLevelAffinities);
    syncDefenderAffinitiesFromLevel({ force: true });
    const nextParams = readPromptParams();
    refreshPromptTemplate();
    return nextParams;
  }

  function collectAttackerAffinities(container) {
    if (!container) return {};
    const result = {};
    const counts = Array.from(container.querySelectorAll("input.affinity-count"));
    counts.forEach((countInput) => {
      if (parseAffinityCount(countInput.value) <= 0) return;
      const affinity = countInput.dataset.affinity;
      if (!affinity) return;
      const expressions = Array.from(
        container.querySelectorAll(`input.affinity-expression[data-affinity="${affinity}"]`),
      )
        .filter((input) => input.checked)
        .map((input) => input.dataset.expression)
        .filter(Boolean);
      result[affinity] = expressions;
    });
    return result;
  }

  function collectVitalConfig(vitalInputs) {
    if (!vitalInputs) return {};
    const result = {};
    VITAL_KEYS.forEach((key) => {
      const input = vitalInputs[key];
      const value = readOptionalInt(input?.value);
      if (value === null) return;
      result[key] = value;
    });
    return result;
  }

  function readPromptParams() {
    const requestedTokenBudget = readOptionalPositiveInt(tokenBudgetInput?.value) || DEFAULT_GUIDANCE_BUDGET_TOKENS;
    const maxTokenBudget = readOptionalPositiveInt(maxTokenBudgetInput?.value);
    const allocation = resolveBudgetAllocation({
      tokenBudget: requestedTokenBudget,
      maxTokenBudget,
      layoutPercent: readOptionalInt(layoutAllocationPercentInput?.value),
      defendersPercent: readOptionalInt(defenderAllocationPercentInput?.value),
      attackerPercent: readOptionalInt(attackerAllocationPercentInput?.value),
    });
    const tokenBudget = allocation.budgetTokens;
    const thinkTimeSeconds = readOptionalInt(thinkTimeInput?.value);
    const llmTokens = readOptionalInt(llmTokensInput?.value);
    const layoutProfile = resolveLayoutProfile(layoutProfileInput?.value);
    const levelBudget = allocation.poolBudgets.layout;
    const attackerBudget = allocation.poolBudgets.defenders;
    const levelAffinities = collectSelectedAffinities(levelAffinitiesContainer);
    const defenderAffinities = collectSelectedAffinities(defenderAffinitiesContainer);
    const attackerAffinities = collectAttackerAffinities(attackerAffinitiesContainer);
    const attackerVitalsMax = collectVitalConfig(
      VITAL_KEYS.reduce((acc, key) => {
        acc[key] = attackerVitalsInputs?.[key]?.max || null;
        return acc;
      }, {}),
    );
    const attackerVitalsRegen = collectVitalConfig(attackerVitalsRegenInputs);
    const attackerSetupMode = resolveAttackerSetupMode(attackerSetupModeInput?.value);
    return {
      tokenBudget,
      requestedTokenBudget,
      maxTokenBudget,
      thinkTimeSeconds,
      llmTokens,
      layoutProfile,
      levelBudget,
      attackerBudget,
      poolBudgets: { ...allocation.poolBudgets },
      poolAllocationPercentages: { ...allocation.allocationPercentages },
      poolWeights: allocation.poolWeights.map((entry) => ({ ...entry })),
      allocationAdjustments: allocation.adjustments.slice(),
      attackerSetupMode,
      levelAffinities,
      defenderAffinities,
      attackerAffinities,
      attackerVitalsMax,
      attackerVitalsRegen,
    };
  }

  function buildIndicatorPriceMap(priceList) {
    const map = new Map();
    const items = Array.isArray(priceList?.items) ? priceList.items : [];
    items.forEach((item) => {
      if (typeof item?.kind !== "string" || typeof item?.id !== "string") return;
      if (!Number.isFinite(item?.costTokens) || item.costTokens < 0) return;
      map.set(`${item.kind}:${item.id}`, item.costTokens);
    });
    return map;
  }

  function resolveMotivationIcon(motivation) {
    const key = typeof motivation === "string" ? motivation.trim() : "";
    return MOTIVATION_ICON_MAP[key] || "👤";
  }

  function normalizeVitalsFromActorRecord(vitals = {}) {
    const max = {};
    const regen = {};
    VITAL_KEYS.forEach((key) => {
      const record = vitals?.[key];
      const maxValue = asTokenOrNull(record?.max);
      const regenValue = asTokenOrNull(record?.regen);
      if (Number.isInteger(maxValue)) {
        max[key] = maxValue;
      }
      if (Number.isInteger(regenValue)) {
        regen[key] = regenValue;
      }
    });
    return { max, regen };
  }

  function normalizeVitalsFromConfigMaps(vitalsMax = {}, vitalsRegen = {}) {
    const max = {};
    const regen = {};
    VITAL_KEYS.forEach((key) => {
      const maxValue = asTokenOrNull(vitalsMax?.[key]);
      const regenValue = asTokenOrNull(vitalsRegen?.[key]);
      if (Number.isInteger(maxValue)) {
        max[key] = maxValue;
      }
      if (Number.isInteger(regenValue)) {
        regen[key] = regenValue;
      }
    });
    return { max, regen };
  }

  function normalizeAffinitiesFromActorRecord(actor = {}) {
    const affinityEntries = Array.isArray(actor?.affinities) ? actor.affinities : [];
    const normalized = affinityEntries
      .map((entry) => {
        const kind = normalizeAffinity(entry?.kind) || normalizeAffinity(actor?.affinity) || DEFAULT_DUNGEON_AFFINITY;
        const expression = normalizeExpression(entry?.expression) || DEFAULT_AFFINITY_EXPRESSION;
        const stacks = Number.isInteger(entry?.stacks) && entry.stacks > 0 ? entry.stacks : 1;
        return { kind, expression, stacks };
      });
    if (normalized.length > 0) {
      return normalized;
    }
    const fallbackAffinity = normalizeAffinity(actor?.affinity);
    if (fallbackAffinity) {
      return [{ kind: fallbackAffinity, expression: DEFAULT_AFFINITY_EXPRESSION, stacks: 1 }];
    }
    return [];
  }

  function normalizeAffinitiesFromAttackerConfig(config = {}) {
    const affinityMap = config?.affinities && typeof config.affinities === "object"
      ? config.affinities
      : {};
    const entries = [];
    Object.entries(affinityMap).forEach(([affinity, expressions]) => {
      const kind = normalizeAffinity(affinity);
      if (!kind) return;
      const expressionList = Array.isArray(expressions) ? expressions : [];
      expressionList.forEach((expression) => {
        const normalized = normalizeExpression(expression);
        if (!normalized) return;
        entries.push({ kind, expression: normalized, stacks: 1 });
      });
    });
    return entries;
  }

  function calculateActorEntryConfigUnitTokens(entry, priceList) {
    if (!entry || typeof entry !== "object") return 0;
    try {
      const priceMap = buildIndicatorPriceMap(priceList);
      const cost = calculateActorConfigurationUnitCost({ entry, priceMap });
      return asTokenOrNull(cost?.cost) || 0;
    } catch {
      return 0;
    }
  }

  function parseActorCount(value, { fallback = 1, allowZero = false } = {}) {
    const count = asTokenOrNull(value);
    if (!Number.isInteger(count)) return fallback;
    if (allowZero) return count >= 0 ? count : fallback;
    return count > 0 ? count : fallback;
  }

  function cloneActorSetForBudget(actorSet = []) {
    if (!Array.isArray(actorSet)) return [];
    return actorSet
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const clone = {
          ...entry,
          count: parseActorCount(entry.count, { fallback: 1 }),
        };
        if (Array.isArray(entry.affinities)) {
          clone.affinities = entry.affinities
            .filter((affinity) => affinity && typeof affinity === "object")
            .map((affinity) => ({ ...affinity }));
        }
        if (entry.vitals && typeof entry.vitals === "object") {
          clone.vitals = VITAL_KEYS.reduce((acc, key) => {
            const vital = entry.vitals?.[key];
            if (vital && typeof vital === "object") {
              acc[key] = { ...vital };
            }
            return acc;
          }, {});
        }
        return clone;
      });
  }

  function calculateDefenderEntryUnitTokens(entry, priceList) {
    if (!entry || typeof entry !== "object") return 0;
    if (entry.source === "room") return 0;
    const tokenHint = asTokenOrNull(entry.tokenHint) || 0;
    const configUnitCost = calculateActorEntryConfigUnitTokens(entry, priceList);
    return tokenHint + configUnitCost;
  }

  function calculateDefenderActorSpendTokens(actorSet = [], priceList) {
    if (!Array.isArray(actorSet)) return 0;
    return actorSet.reduce((sum, entry) => {
      if (!entry || typeof entry !== "object" || entry.source === "room") return sum;
      const count = parseActorCount(entry.count, { fallback: 1 });
      const unit = calculateDefenderEntryUnitTokens(entry, priceList);
      return sum + (unit * count);
    }, 0);
  }

  function resolveDefenderSpendBudgetContext({
    summary,
    actorSet,
    promptParams = null,
  } = {}) {
    const safeSummary = summary && typeof summary === "object" ? summary : {};
    const provisionalLedger = buildDesignSpendLedger({
      summary: safeSummary,
      actorSet,
      budgeting: state.budgeting,
      priceList: state.priceList,
    });
    const totalBudgetTokens = asTokenOrNull(provisionalLedger?.budgetTokens)
      ?? asTokenOrNull(safeSummary?.budgetTokens)
      ?? asTokenOrNull(promptParams?.tokenBudget);
    const levelSpendTokens = asTokenOrNull(provisionalLedger?.categories?.levelConfig?.spentTokens) || 0;
    const attackerSpendTokens = calculateAttackerConfigSpendTokens(safeSummary?.attackerConfig, state.priceList);
    const remainingByTotalTokens = Number.isInteger(totalBudgetTokens)
      ? Math.max(0, totalBudgetTokens - levelSpendTokens - attackerSpendTokens)
      : null;
    const actorPoolBudgetTokens = asTokenOrNull(state.budgeting?.actorBudgetTokens)
      ?? asTokenOrNull(promptParams?.poolBudgets?.defenders);
    const capCandidates = [actorPoolBudgetTokens, remainingByTotalTokens].filter((value) => Number.isInteger(value));
    const budgetCapTokens = capCandidates.length > 0 ? Math.min(...capCandidates) : null;
    const defenderSpendTokens = calculateDefenderActorSpendTokens(actorSet, state.priceList);
    return {
      defenderSpendTokens,
      budgetCapTokens,
      actorPoolBudgetTokens,
      totalBudgetTokens,
      levelSpendTokens,
      attackerSpendTokens,
      remainingByTotalTokens,
      ledger: provisionalLedger,
    };
  }

  function enforceDefenderActorSetBudget(actorSet = [], { summary, promptParams = null } = {}) {
    const working = cloneActorSetForBudget(actorSet);
    const initial = resolveDefenderSpendBudgetContext({
      summary,
      actorSet: working,
      promptParams,
    });
    if (!Number.isInteger(initial.budgetCapTokens) || initial.defenderSpendTokens <= initial.budgetCapTokens) {
      return {
        actorSet: working,
        spendTokens: initial.defenderSpendTokens,
        initialSpendTokens: initial.defenderSpendTokens,
        budgetCapTokens: initial.budgetCapTokens,
        wasClamped: false,
      };
    }

    const actorUnits = working
      .map((entry, index) => ({
        index,
        source: entry?.source === "room" ? "room" : "actor",
        unitCost: calculateDefenderEntryUnitTokens(entry, state.priceList),
      }))
      .filter((entry) => entry.source === "actor" && entry.unitCost > 0);

    let currentSpendTokens = initial.defenderSpendTokens;
    const budgetCapTokens = initial.budgetCapTokens;
    let overspendTokens = currentSpendTokens - budgetCapTokens;
    const reductionOrder = actorUnits
      .map((unit) => ({
        ...unit,
        count: parseActorCount(working[unit.index]?.count, { fallback: 0, allowZero: true }),
      }))
      .filter((unit) => unit.count > 0)
      .sort((a, b) => b.unitCost - a.unitCost || b.count - a.count || a.index - b.index);

    reductionOrder.forEach((unit) => {
      if (overspendTokens <= 0) return;
      const currentCount = parseActorCount(working[unit.index]?.count, { fallback: 0, allowZero: true });
      if (currentCount <= 0) return;
      const reductionsNeeded = Math.ceil(overspendTokens / unit.unitCost);
      const reductionCount = Math.min(currentCount, reductionsNeeded);
      if (reductionCount <= 0) return;
      working[unit.index].count = currentCount - reductionCount;
      currentSpendTokens = Math.max(0, currentSpendTokens - (reductionCount * unit.unitCost));
      overspendTokens = currentSpendTokens - budgetCapTokens;
    });

    const clamped = working
      .filter((entry) => entry?.source === "room" || parseActorCount(entry?.count, { fallback: 0, allowZero: true }) > 0)
      .map((entry) => {
        if (entry?.source === "room") return entry;
        return {
          ...entry,
          count: parseActorCount(entry?.count, { fallback: 1 }),
        };
      });
    const final = resolveDefenderSpendBudgetContext({
      summary,
      actorSet: clamped,
      promptParams,
    });
    return {
      actorSet: clamped,
      spendTokens: final.defenderSpendTokens,
      initialSpendTokens: initial.defenderSpendTokens,
      budgetCapTokens: final.budgetCapTokens,
      wasClamped: final.defenderSpendTokens < initial.defenderSpendTokens,
    };
  }

  function applyActorSetToSummary(summary, actorSet = []) {
    if (!summary || typeof summary !== "object") return summary;
    const entries = Array.isArray(actorSet) ? actorSet : [];
    const dungeonAffinity = normalizeAffinity(summary.dungeonAffinity) || DEFAULT_DUNGEON_AFFINITY;
    const actors = [];
    const rooms = [];

    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const source = entry.source === "room" ? "room" : "actor";
      const role = typeof entry.role === "string" && entry.role.trim()
        ? entry.role.trim()
        : typeof entry.motivation === "string" && entry.motivation.trim()
          ? entry.motivation.trim()
          : "stationary";
      const affinity = normalizeAffinity(entry.affinity) || dungeonAffinity;
      const count = parseActorCount(entry.count, { fallback: 1 });
      const tokenHint = asTokenOrNull(entry.tokenHint);
      const affinities = normalizeAffinityEntries(entry.affinities, affinity);

      if (source === "room") {
        const roomEntry = {
          id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `room_${role}_${rooms.length + 1}`,
          motivation: role,
          affinity,
          count,
          affinities,
        };
        if (Number.isInteger(tokenHint) && tokenHint > 0) {
          roomEntry.tokenHint = tokenHint;
        }
        rooms.push(roomEntry);
        return;
      }

      const actorEntry = {
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `actor_${role}_${actors.length + 1}`,
        motivation: role,
        affinity,
        count,
        setupMode: resolveAttackerSetupMode(entry.setupMode),
        vitals: normalizeVitals(entry.vitals),
        affinities,
      };
      if (Number.isInteger(tokenHint) && tokenHint > 0) {
        actorEntry.tokenHint = tokenHint;
      }
      actors.push(actorEntry);
    });

    return {
      ...summary,
      actors,
      rooms,
    };
  }

  function buildActorHudModel(entry, priceList) {
    const count = Number.isInteger(entry?.count) && entry.count > 0 ? entry.count : 1;
    const tokenHint = asTokenOrNull(entry?.tokenHint) || 0;
    const configUnitCost = calculateActorEntryConfigUnitTokens(entry, priceList);
    const tokenUnitCost = tokenHint + configUnitCost;
    const tokenTotalCost = tokenUnitCost * count;
    const vitals = normalizeVitalsFromActorRecord(entry?.vitals || {});
    const affinities = normalizeAffinitiesFromActorRecord(entry);
    const motivation = typeof entry?.role === "string" && entry.role.trim()
      ? entry.role.trim()
      : typeof entry?.motivation === "string" && entry.motivation.trim()
        ? entry.motivation.trim()
        : "stationary";
    return {
      id: entry?.id || "actor",
      label: entry?.id || "actor",
      count,
      source: entry?.source === "room" ? "room" : "actor",
      setupMode: typeof entry?.setupMode === "string" && entry.setupMode.trim()
        ? entry.setupMode.trim()
        : null,
      motivation,
      motivationIcon: resolveMotivationIcon(motivation),
      tokenHint,
      configUnitCost,
      tokenUnitCost,
      tokenTotalCost,
      vitalsMax: vitals.max,
      vitalsRegen: vitals.regen,
      affinities,
    };
  }

  function buildAttackerHudModel(
    attackerConfig = {},
    { attackerBudgetTokens, priceList, fallbackAffinity = DEFAULT_DUNGEON_AFFINITY } = {},
  ) {
    const normalized = normalizeAttackerConfig(attackerConfig, { fallbackAffinity });
    const spendTokens = calculateAttackerConfigSpendTokens(normalized, priceList);
    const vitals = normalizeVitalsFromConfigMaps(normalized?.vitalsMax, normalized?.vitalsRegen);
    const setupMode = typeof normalized?.setupMode === "string" && normalized.setupMode.trim()
      ? normalized.setupMode.trim()
      : DEFAULT_ATTACKER_SETUP_MODE;
    return {
      id: "attacker_config",
      label: "Attacker",
      count: 1,
      source: "attacker",
      setupMode,
      motivation: null,
      motivationIcon: null,
      tokenHint: 0,
      configUnitCost: spendTokens,
      tokenUnitCost: spendTokens,
      tokenTotalCost: spendTokens,
      budgetTokens: asTokenOrNull(attackerBudgetTokens),
      vitalsMax: vitals.max,
      vitalsRegen: vitals.regen,
      affinities: normalizeAffinitiesFromAttackerConfig(normalized),
    };
  }

  function formatVitalsHudLine(vitalsMax = {}, vitalsRegen = {}) {
    return VITAL_KEYS
      .map((key) => {
        const max = asTokenOrNull(vitalsMax?.[key]);
        const regen = asTokenOrNull(vitalsRegen?.[key]);
        if (!Number.isInteger(max) && !Number.isInteger(regen)) return null;
        const icon = VITAL_ICON_MAP[key] || "•";
        return `${icon} ${key} ${max || 0}/${regen || 0}`;
      })
      .filter(Boolean)
      .join(" | ");
  }

  function formatAffinitiesHudLine(affinities = []) {
    if (!Array.isArray(affinities) || affinities.length === 0) return "none";
    return affinities
      .map((entry) => {
        const kind = normalizeAffinity(entry?.kind) || DEFAULT_DUNGEON_AFFINITY;
        const expression = normalizeExpression(entry?.expression) || DEFAULT_AFFINITY_EXPRESSION;
        const stacks = Number.isInteger(entry?.stacks) && entry.stacks > 0 ? entry.stacks : 1;
        return `${kind}:${expression}x${stacks}`;
      })
      .join(", ");
  }

  function formatActorHudFallback(models = [], { showMotivation = false, includeAttackerBudget = false } = {}) {
    if (!Array.isArray(models) || models.length === 0) {
      return showMotivation ? ACTOR_HUD_EMPTY_TEXT : ATTACKER_HUD_EMPTY_TEXT;
    }
    return models
      .map((model) => {
        const parts = [];
        parts.push(`${model.label} x${model.count}`);
        parts.push(`🪙 ${model.tokenTotalCost}`);
        if (includeAttackerBudget && Number.isInteger(model.budgetTokens)) {
          parts.push(`budget ${model.budgetTokens}`);
        }
        if (showMotivation && model.motivation) {
          parts.push(`${model.motivationIcon || "👤"} ${model.motivation}`);
        }
        if (model.setupMode) {
          parts.push(`mode ${model.setupMode}`);
        }
        const vitalLine = formatVitalsHudLine(model.vitalsMax, model.vitalsRegen);
        if (vitalLine) {
          parts.push(vitalLine);
        }
        parts.push(`affinities ${formatAffinitiesHudLine(model.affinities)}`);
        return parts.join(" | ");
      })
      .join("\n");
  }

  function createHudChip(doc, className, text) {
    const chip = doc.createElement("span");
    chip.className = className;
    chip.textContent = text;
    return chip;
  }

  function createActorHudCard(doc, model, { showMotivation = false, includeAttackerBudget = false } = {}) {
    const card = doc.createElement("article");
    card.className = "actor-hud-card";

    const titleRow = doc.createElement("div");
    titleRow.className = "actor-hud-title-row";
    const title = doc.createElement("div");
    title.className = "actor-hud-title";
    title.textContent = model.label;
    const tokenText = includeAttackerBudget && Number.isInteger(model.budgetTokens)
      ? `🪙 ${model.tokenTotalCost}/${model.budgetTokens}`
      : `🪙 ${model.tokenTotalCost}`;
    titleRow.append(title, createHudChip(doc, "actor-hud-token", tokenText));
    card.appendChild(titleRow);

    const metaRow = doc.createElement("div");
    metaRow.className = "actor-hud-meta-row";
    metaRow.append(createHudChip(doc, "actor-hud-chip", `x${model.count}`));
    if (showMotivation && model.motivation) {
      metaRow.append(createHudChip(doc, "actor-hud-chip", `${model.motivationIcon || "👤"} ${model.motivation}`));
    }
    if (model.setupMode) {
      metaRow.append(createHudChip(doc, "actor-hud-chip", `⚙️ ${model.setupMode}`));
    }
    card.appendChild(metaRow);

    const vitalsRow = doc.createElement("div");
    vitalsRow.className = "actor-hud-vitals";
    const vitalText = formatVitalsHudLine(model.vitalsMax, model.vitalsRegen);
    vitalsRow.textContent = vitalText || "Vitals: none";
    card.appendChild(vitalsRow);

    const affinitiesRow = doc.createElement("div");
    affinitiesRow.className = "actor-hud-affinities";
    if (!Array.isArray(model.affinities) || model.affinities.length === 0) {
      affinitiesRow.append(createHudChip(doc, "actor-hud-chip", "Affinities none"));
    } else {
      model.affinities.forEach((entry) => {
        const kind = normalizeAffinity(entry?.kind) || DEFAULT_DUNGEON_AFFINITY;
        const expression = normalizeExpression(entry?.expression) || DEFAULT_AFFINITY_EXPRESSION;
        const stacks = Number.isInteger(entry?.stacks) && entry.stacks > 0 ? entry.stacks : 1;
        const affinityIcon = resolveAffinityIcon(kind);
        const expressionIcon = resolveAffinityExpressionIcon(expression);
        affinitiesRow.append(
          createHudChip(
            doc,
            "actor-hud-chip",
            `${affinityIcon} ${kind} ${expressionIcon} x${stacks}`,
          ),
        );
      });
    }
    card.appendChild(affinitiesRow);

    return card;
  }

  function canRenderActorHud(outputEl, doc) {
    return Boolean(
      outputEl
      && doc
      && typeof doc.createElement === "function"
      && typeof outputEl.replaceChildren === "function",
    );
  }

  function renderActorHud(outputEl, models = [], options = {}) {
    const { emptyText, showMotivation = false, includeAttackerBudget = false } = options;
    if (!outputEl) return;
    if (!Array.isArray(models) || models.length === 0) {
      outputEl.textContent = emptyText || ACTOR_HUD_EMPTY_TEXT;
      return;
    }
    const doc = outputEl.ownerDocument || (typeof document === "object" ? document : null);
    if (!canRenderActorHud(outputEl, doc)) {
      outputEl.textContent = formatActorHudFallback(models, { showMotivation, includeAttackerBudget });
      return;
    }

    const grid = doc.createElement("div");
    grid.className = "actor-hud-grid";
    models.forEach((model) => {
      grid.appendChild(createActorHudCard(doc, model, { showMotivation, includeAttackerBudget }));
    });
    outputEl.replaceChildren(grid);
  }

  function buildAttackerConfigCostEntry(attackerConfig = {}) {
    if (!attackerConfig || typeof attackerConfig !== "object") return null;
    const vitalsMax = attackerConfig.vitalsMax && typeof attackerConfig.vitalsMax === "object"
      ? attackerConfig.vitalsMax
      : {};
    const vitalsRegen = attackerConfig.vitalsRegen && typeof attackerConfig.vitalsRegen === "object"
      ? attackerConfig.vitalsRegen
      : {};
    const vitals = {};
    let vitalPoints = 0;
    let regenPoints = 0;
    VITAL_KEYS.forEach((key) => {
      const max = asTokenOrNull(vitalsMax[key]) || 0;
      const regen = asTokenOrNull(vitalsRegen[key]) || 0;
      vitalPoints += max;
      regenPoints += regen;
      vitals[key] = { max, regen };
    });

    const affinityEntries = [];
    const affinityMap = attackerConfig.affinities && typeof attackerConfig.affinities === "object"
      ? attackerConfig.affinities
      : {};
    Object.values(affinityMap).forEach((expressions) => {
      const expressionList = Array.isArray(expressions) ? expressions : [];
      expressionList.forEach((expression) => {
        const normalized = normalizeExpression(expression);
        if (!normalized) return;
        affinityEntries.push({ expression: normalized, stacks: 1 });
      });
    });
    if (vitalPoints <= 0 && regenPoints <= 0 && affinityEntries.length === 0) {
      return null;
    }
    return { vitals, affinities: affinityEntries };
  }

  function calculateAttackerConfigSpendTokens(attackerConfig, priceList) {
    const entry = buildAttackerConfigCostEntry(attackerConfig);
    if (!entry) return 0;
    try {
      const priceMap = buildIndicatorPriceMap(priceList);
      const cost = calculateActorConfigurationUnitCost({ entry, priceMap });
      return asTokenOrNull(cost?.cost) || 0;
    } catch {
      return 0;
    }
  }

  function cloneAttackerAffinitiesMap(affinities) {
    if (!affinities || typeof affinities !== "object") return undefined;
    const clone = Object.entries(affinities).reduce((acc, [affinity, expressions]) => {
      acc[affinity] = Array.isArray(expressions) ? expressions.slice() : [];
      return acc;
    }, {});
    return Object.keys(clone).length > 0 ? clone : undefined;
  }

  function cloneAttackerConfig(config = {}) {
    const clone = {
      setupMode: resolveAttackerSetupMode(config?.setupMode),
    };
    if (config?.vitalsMax && typeof config.vitalsMax === "object") {
      clone.vitalsMax = { ...config.vitalsMax };
    }
    if (config?.vitalsRegen && typeof config.vitalsRegen === "object") {
      clone.vitalsRegen = { ...config.vitalsRegen };
    }
    const affinities = cloneAttackerAffinitiesMap(config?.affinities);
    if (affinities) {
      clone.affinities = affinities;
    }
    return clone;
  }

  function countAttackerAffinityExpressions(affinities = {}) {
    if (!affinities || typeof affinities !== "object" || Array.isArray(affinities)) return 0;
    return Object.values(affinities).reduce((sum, expressions) => {
      if (!Array.isArray(expressions)) return sum;
      return sum + expressions.length;
    }, 0);
  }

  function buildAttackerReductionCandidates(config = {}) {
    const candidates = [];
    const setupMode = resolveAttackerSetupMode(config?.setupMode);
    const vitalsMax = config?.vitalsMax && typeof config.vitalsMax === "object"
      ? config.vitalsMax
      : {};
    const vitalsRegen = config?.vitalsRegen && typeof config.vitalsRegen === "object"
      ? config.vitalsRegen
      : {};
    const affinityMap = config?.affinities && typeof config.affinities === "object"
      ? config.affinities
      : {};
    const affinityExpressionCount = countAttackerAffinityExpressions(affinityMap);
    const enforceManaGuardrail = affinityExpressionCount > 0;

    VITAL_KEYS.forEach((key) => {
      const max = asTokenOrNull(vitalsMax[key]) || 0;
      const minMax = enforceManaGuardrail && key === "mana" ? 1 : 0;
      if (max > minMax) {
        candidates.push({ type: "vital_max", key, value: max, priority: 1 });
      }
      if (setupMode !== "auto") {
        const regen = asTokenOrNull(vitalsRegen[key]) || 0;
        const minRegen = enforceManaGuardrail && key === "mana" ? 1 : 0;
        if (regen > minRegen) {
          candidates.push({ type: "vital_regen", key, value: regen, priority: 2 });
        }
      }
    });

    Object.entries(affinityMap).forEach(([affinity, expressions]) => {
      const expressionList = Array.isArray(expressions) ? expressions : [];
      if (expressionList.length <= 0) return;
      if (affinityExpressionCount <= 1) return;
      candidates.push({
        type: "affinity_expression",
        affinity,
        index: expressionList.length - 1,
        value: expressionList.length,
        priority: 3,
      });
    });

    return candidates;
  }

  function applyAttackerReductionCandidate(config = {}, candidate = {}, { fallbackAffinity } = {}) {
    const next = cloneAttackerConfig(config);
    const mode = resolveAttackerSetupMode(next.setupMode);

    if (candidate.type === "vital_max") {
      const key = candidate.key;
      const currentMax = asTokenOrNull(next?.vitalsMax?.[key]) || 0;
      if (currentMax > 0) {
        const reducedMax = currentMax - 1;
        next.vitalsMax = { ...(next.vitalsMax || {}), [key]: reducedMax };
        if (mode === "auto") {
          next.vitalsRegen = { ...(next.vitalsRegen || {}), [key]: reducedMax };
        } else {
          const currentRegen = asTokenOrNull(next?.vitalsRegen?.[key]) || 0;
          if (currentRegen > reducedMax) {
            next.vitalsRegen = { ...(next.vitalsRegen || {}), [key]: reducedMax };
          }
        }
      }
      return normalizeAttackerConfig(next, { fallbackAffinity });
    }

    if (candidate.type === "vital_regen") {
      const key = candidate.key;
      const currentRegen = asTokenOrNull(next?.vitalsRegen?.[key]) || 0;
      if (currentRegen > 0) {
        next.vitalsRegen = { ...(next.vitalsRegen || {}), [key]: currentRegen - 1 };
      }
      return normalizeAttackerConfig(next, { fallbackAffinity });
    }

    if (candidate.type === "affinity_expression") {
      const affinity = candidate.affinity;
      const expressionList = Array.isArray(next?.affinities?.[affinity])
        ? next.affinities[affinity].slice()
        : [];
      if (expressionList.length > 0) {
        expressionList.splice(Math.min(candidate.index, expressionList.length - 1), 1);
        if (expressionList.length > 0) {
          next.affinities = { ...(next.affinities || {}), [affinity]: expressionList };
        } else if (next.affinities && typeof next.affinities === "object") {
          const reduced = { ...next.affinities };
          delete reduced[affinity];
          if (Object.keys(reduced).length > 0) {
            next.affinities = reduced;
          } else {
            delete next.affinities;
          }
        }
      }
      return normalizeAttackerConfig(next, { fallbackAffinity });
    }

    return normalizeAttackerConfig(next, { fallbackAffinity });
  }

  function enforceAttackerConfigBudget(
    attackerConfig,
    budgetTokens,
    priceList,
    { fallbackAffinity = DEFAULT_DUNGEON_AFFINITY } = {},
  ) {
    const normalized = normalizeAttackerConfig(attackerConfig, { fallbackAffinity });
    const budget = asTokenOrNull(budgetTokens);
    const initialSpendTokens = calculateAttackerConfigSpendTokens(normalized, priceList);
    if (!Number.isInteger(budget)) {
      return {
        config: normalized,
        spendTokens: initialSpendTokens,
        initialSpendTokens,
        budgetTokens: budget,
        wasClamped: false,
      };
    }
    if (initialSpendTokens <= budget) {
      return {
        config: normalized,
        spendTokens: initialSpendTokens,
        initialSpendTokens,
        budgetTokens: budget,
        wasClamped: false,
      };
    }

    let workingConfig = normalizeAttackerConfig(cloneAttackerConfig(normalized), { fallbackAffinity });
    let workingSpendTokens = initialSpendTokens;
    const maxIterations = 10000;
    let iterations = 0;

    while (workingSpendTokens > budget && iterations < maxIterations) {
      const candidates = buildAttackerReductionCandidates(workingConfig);
      if (candidates.length === 0) break;

      let best = null;
      candidates.forEach((candidate) => {
        const reduced = applyAttackerReductionCandidate(workingConfig, candidate, { fallbackAffinity });
        const reducedSpendTokens = calculateAttackerConfigSpendTokens(reduced, priceList);
        const savings = workingSpendTokens - reducedSpendTokens;
        if (savings <= 0) return;
        if (!best) {
          best = { config: reduced, spendTokens: reducedSpendTokens, savings, candidate };
          return;
        }
        if (savings > best.savings) {
          best = { config: reduced, spendTokens: reducedSpendTokens, savings, candidate };
          return;
        }
        if (savings < best.savings) return;
        if ((candidate.priority || 0) > (best.candidate.priority || 0)) {
          best = { config: reduced, spendTokens: reducedSpendTokens, savings, candidate };
          return;
        }
        if ((candidate.priority || 0) < (best.candidate.priority || 0)) return;
        if ((candidate.value || 0) > (best.candidate.value || 0)) {
          best = { config: reduced, spendTokens: reducedSpendTokens, savings, candidate };
          return;
        }
        if ((candidate.value || 0) < (best.candidate.value || 0)) return;
        const candidateKey = `${candidate.type}:${candidate.key || candidate.affinity || ""}`;
        const bestKey = `${best.candidate.type}:${best.candidate.key || best.candidate.affinity || ""}`;
        if (candidateKey < bestKey) {
          best = { config: reduced, spendTokens: reducedSpendTokens, savings, candidate };
        }
      });

      if (!best) break;
      workingConfig = best.config;
      workingSpendTokens = best.spendTokens;
      iterations += 1;
    }

    return {
      config: workingConfig,
      spendTokens: workingSpendTokens,
      initialSpendTokens,
      budgetTokens: budget,
      wasClamped: workingSpendTokens < initialSpendTokens,
    };
  }

  function formatTokenIndicatorText(usedTokens, totalTokens) {
    const used = Number.isInteger(usedTokens) && usedTokens >= 0 ? usedTokens : 0;
    const total = Number.isInteger(totalTokens) && totalTokens >= 0 ? totalTokens : 0;
    const percent = total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0;
    return `Used ${used} / ${total} (${percent}%)`;
  }

  function setTokenIndicator(indicatorEl, usedTokens, totalTokens) {
    if (!indicatorEl) return;
    indicatorEl.textContent = formatTokenIndicatorText(usedTokens, totalTokens);
  }

  function renderTokenIndicators(promptParams = null) {
    const resolvedPromptParams = promptParams && typeof promptParams === "object"
      ? promptParams
      : hasPromptParamsUI
        ? readPromptParams()
        : null;
    const totalBudgetTokens = asTokenOrNull(state.spendLedger?.budgetTokens)
      ?? asTokenOrNull(state.summary?.budgetTokens)
      ?? asTokenOrNull(resolvedPromptParams?.tokenBudget)
      ?? DEFAULT_GUIDANCE_BUDGET_TOKENS;

    const levelBudgetTokens = asTokenOrNull(state.budgeting?.levelBudgetTokens)
      ?? asTokenOrNull(resolvedPromptParams?.poolBudgets?.layout)
      ?? totalBudgetTokens;
    const levelSpendTokens = asTokenOrNull(state.spendLedger?.categories?.levelConfig?.spentTokens)
      ?? asTokenOrNull(state.budgeting?.levelSpendTokens)
      ?? 0;

    const attackerBudgetTokens = asTokenOrNull(state.budgeting?.playerBudgetTokens)
      ?? asTokenOrNull(resolvedPromptParams?.poolBudgets?.attacker)
      ?? 0;
    const attackerSpendTokens = calculateAttackerConfigSpendTokens(state.summary?.attackerConfig, state.priceList);

    const defenderBudgetTokens = asTokenOrNull(state.budgeting?.actorBudgetTokens)
      ?? asTokenOrNull(resolvedPromptParams?.poolBudgets?.defenders)
      ?? 0;
    const defenderSpendFromLedger = (() => {
      const baseSpend = asTokenOrNull(state.spendLedger?.categories?.actorBase?.spentTokens);
      const configSpend = asTokenOrNull(state.spendLedger?.categories?.actorConfiguration?.spentTokens);
      if (baseSpend === null && configSpend === null) return null;
      return (baseSpend || 0) + (configSpend || 0);
    })();
    const defenderSpendTokens = defenderSpendFromLedger
      ?? asTokenOrNull(state.budgeting?.actorSpendTokens)
      ?? 0;

    const totalSpendTokens = asTokenOrNull(state.spendLedger?.totalSpentTokens)
      ?? (levelSpendTokens + attackerSpendTokens + defenderSpendTokens);

    setTokenIndicator(levelTokenIndicator, levelSpendTokens, levelBudgetTokens);
    setTokenIndicator(attackerTokenIndicator, attackerSpendTokens, attackerBudgetTokens);
    setTokenIndicator(defenderTokenIndicator, defenderSpendTokens, defenderBudgetTokens);
    setTokenIndicator(simulationTokenIndicator, totalSpendTokens, totalBudgetTokens);
  }

  function renderBudgetAllocationSummary(params = {}) {
    if (!budgetAllocationSummary) return;
    const tokenBudget = asTokenOrNull(params.tokenBudget);
    const poolBudgets = params.poolBudgets && typeof params.poolBudgets === "object"
      ? params.poolBudgets
      : null;
    if (!Number.isInteger(tokenBudget) || !poolBudgets) {
      budgetAllocationSummary.textContent = "";
      return;
    }
    const layoutTokens = asTokenOrNull(poolBudgets.layout) || 0;
    const defendersTokens = asTokenOrNull(poolBudgets.defenders) || 0;
    const attackerTokens = asTokenOrNull(poolBudgets.attacker) || 0;
    const layoutPct = Number.isFinite(params.poolAllocationPercentages?.layout)
      ? params.poolAllocationPercentages.layout
      : 0;
    const defendersPct = Number.isFinite(params.poolAllocationPercentages?.defenders)
      ? params.poolAllocationPercentages.defenders
      : 0;
    const attackerPct = Number.isFinite(params.poolAllocationPercentages?.attacker)
      ? params.poolAllocationPercentages.attacker
      : 0;
    const capApplied = Number.isInteger(params.requestedTokenBudget)
      && Number.isInteger(params.tokenBudget)
      && params.requestedTokenBudget !== params.tokenBudget;
    const adjustments = Array.isArray(params.allocationAdjustments) ? params.allocationAdjustments : [];
    const adjustmentSuffix = adjustments.length > 0 ? " | constraints applied" : "";
    budgetAllocationSummary.textContent = [
      `Layout ${layoutTokens} (${layoutPct}%)`,
      `Defenders ${defendersTokens} (${defendersPct}%)`,
      `Attacker ${attackerTokens} (${attackerPct}%)`,
      `budget ${tokenBudget}`,
      capApplied ? `(capped from ${params.requestedTokenBudget})` : "",
    ].filter(Boolean).join(" | ") + adjustmentSuffix;
  }

  function setContainerInputsDisabled(container, disabled) {
    if (!container || typeof container.querySelectorAll !== "function") return;
    container.querySelectorAll("input").forEach((input) => {
      const isExpression = input.className.includes("affinity-expression");
      if (disabled) {
        input.disabled = true;
        if (isExpression) input.checked = false;
        return;
      }
      if (!isExpression) {
        input.disabled = false;
        return;
      }
      const affinity = input.dataset.affinity;
      const parentCount = affinity
        ? container.querySelector(`input.affinity-count[data-affinity="${affinity}"]`)
        : null;
      const enabled = parseAffinityCount(parentCount?.value) > 0;
      input.disabled = !enabled;
      if (!enabled) input.checked = false;
    });

    if (disabled) return;
    AFFINITY_KINDS.forEach((affinity) => {
      const countInput = container.querySelector(`input.affinity-count[data-affinity="${affinity}"]`);
      if (parseAffinityCount(countInput?.value) <= 0) return;
      const expressionInputs = Array.from(
        container.querySelectorAll(`input.affinity-expression[data-affinity="${affinity}"]`),
      );
      if (expressionInputs.length > 0 && expressionInputs.every((input) => !input.checked)) {
        expressionInputs.forEach((input) => {
          input.checked = true;
        });
      }
    });
  }

  function syncAttackerSetupModeUI() {
    const mode = resolveAttackerSetupMode(attackerSetupModeInput?.value);
    const manualLocked = mode === "auto";
    setContainerInputsDisabled(attackerAffinitiesContainer, manualLocked);
    VITAL_KEYS.forEach((key) => {
      const maxInput = attackerVitalsInputs?.[key]?.max;
      if (maxInput) maxInput.disabled = manualLocked;
      const regenInput = attackerVitalsRegenInputs?.[key];
      if (regenInput) regenInput.disabled = manualLocked;
    });
  }

  function buildPromptTemplates(params = {}) {
    const normalizedBudget = Number.isInteger(params.tokenBudget) && params.tokenBudget > 0
      ? params.tokenBudget
      : DEFAULT_GUIDANCE_BUDGET_TOKENS;
    const levelContext = buildPromptContext({ params, phase: "level" });
    const attackerContext = buildPromptContext({ params, phase: "attacker" });
    const defenderContext = buildPromptContext({ params, phase: "defender" });
    const levelAffinities = normalizeAffinityList(params.levelAffinities);
    const defenderAffinities = resolveDefenderAffinityScope(params);
    const attackerScope = resolveAttackerPromptScope(params);
    const attackerAffinityPhrase = formatAffinityPhrase(attackerScope.affinities, DEFAULT_DUNGEON_AFFINITY);
    const requiredAttackerAffinityConfig = formatAttackerAffinityConfig(params.attackerAffinities);
    const allowedLayoutProfiles = resolveAllowedLayoutProfiles(params.layoutProfile);
    const affinityPhrase = formatAffinityPhrase(levelAffinities, DEFAULT_DUNGEON_AFFINITY);
    const defenderPhrase = formatAffinityPhrase(
      defenderAffinities.length > 0 ? defenderAffinities : levelAffinities,
      DEFAULT_DUNGEON_AFFINITY,
    );
    const levelBudgetTokens = asTokenOrNull(params.poolBudgets?.layout) ?? normalizedBudget;
    const defenderBudgetTokens = asTokenOrNull(params.poolBudgets?.defenders) ?? normalizedBudget;
    const attackerBudgetTokens = asTokenOrNull(params.poolBudgets?.attacker) ?? normalizedBudget;
    const defenderAffinityChoices = defenderAffinities.length > 0 ? defenderAffinities : [DEFAULT_DUNGEON_AFFINITY];
    const level = buildLlmLevelPromptTemplate({
      goal: `Design a ${affinityPhrase} affinity dungeon layout.`,
      notes: "Phase 1 of 3. Generate layout only.",
      budgetTokens: normalizedBudget,
      remainingBudgetTokens: levelBudgetTokens,
      layoutCosts: DEFAULT_LAYOUT_TILE_COSTS,
      allowedProfiles: allowedLayoutProfiles,
      context: levelContext,
      modelContextTokens: MODEL_CONTEXT_TOKENS || CONTEXT_WINDOW_TOKENS,
      layoutLatencyMs: DOMAIN_CONSTRAINTS?.llm?.targetLatencyMs?.layoutPhase,
    });
    const attacker = buildLlmAttackerConfigPromptTemplate({
      goal: `Configure attacker setup for a ${attackerAffinityPhrase} themed dungeon.`,
      notes: "Phase 2 of 3. Configure attacker setup only.",
      budgetTokens: normalizedBudget,
      remainingBudgetTokens: attackerBudgetTokens,
      context: attackerContext,
      requiredAffinityConfig: requiredAttackerAffinityConfig,
      affinities: attackerScope.affinities,
      affinityExpressions: attackerScope.affinityExpressions,
      setupModes: attackerScope.setupModes,
      modelContextTokens: MODEL_CONTEXT_TOKENS || CONTEXT_WINDOW_TOKENS,
    });
    const defender = buildLlmActorConfigPromptTemplate({
      goal: `Create dungeon defenders for a ${defenderPhrase} themed dungeon.`,
      notes: "Phase 3 of 3. Generate defenders and defender configurations only.",
      budgetTokens: normalizedBudget,
      remainingBudgetTokens: defenderBudgetTokens,
      allowedPairsText: "<runtime populates catalog-constrained profiles>",
      context: defenderContext || "Use the selected defender affinities and remaining budget.",
      affinities: defenderAffinityChoices,
      affinityExpressions: AFFINITY_EXPRESSIONS,
      motivations: MOTIVATION_KINDS,
      modelContextTokens: MODEL_CONTEXT_TOKENS || CONTEXT_WINDOW_TOKENS,
    });
    const combined = [
      LEVEL_TEMPLATE_HEADER,
      level,
      "",
      ATTACKER_TEMPLATE_HEADER,
      attacker,
      "",
      DEFENDER_TEMPLATE_HEADER,
      defender,
    ].join("\n");
    return { level, attacker, defender, combined };
  }

  function normalizeAttackerVitalMap(vitals) {
    if (!vitals || typeof vitals !== "object") return {};
    return VITAL_KEYS.reduce((acc, key) => {
      const value = asTokenOrNull(vitals[key]);
      if (Number.isInteger(value)) {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  function normalizeAttackerAffinitiesMap(affinities, fallbackAffinity = DEFAULT_DUNGEON_AFFINITY) {
    const normalized = {};
    if (affinities && typeof affinities === "object" && !Array.isArray(affinities)) {
      Object.entries(affinities).forEach(([rawAffinity, expressions]) => {
        const affinity = normalizeAffinity(rawAffinity);
        if (!affinity) return;
        const normalizedExpressions = Array.isArray(expressions)
          ? expressions
            .map((expression) => normalizeExpression(expression))
            .filter(Boolean)
          : [];
        const uniqueExpressions = Array.from(new Set(normalizedExpressions));
        const next = Array.isArray(normalized[affinity]) ? normalized[affinity].slice() : [];
        uniqueExpressions.forEach((expression) => {
          if (!next.includes(expression)) {
            next.push(expression);
          }
        });
        if (next.length === 0) {
          next.push(DEFAULT_AFFINITY_EXPRESSION);
        }
        normalized[affinity] = next;
      });
    }

    if (Object.keys(normalized).length === 0) {
      const fallback = normalizeAffinity(fallbackAffinity) || DEFAULT_DUNGEON_AFFINITY;
      normalized[fallback] = [DEFAULT_AFFINITY_EXPRESSION];
    }
    return normalized;
  }

  function normalizeAttackerConfig(config = {}, { fallbackAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
    if (!config || typeof config !== "object") {
      const defaultAffinity = normalizeAffinity(fallbackAffinity) || DEFAULT_DUNGEON_AFFINITY;
      return {
        setupMode: DEFAULT_ATTACKER_SETUP_MODE,
        affinities: { [defaultAffinity]: [DEFAULT_AFFINITY_EXPRESSION] },
        vitalsMax: { mana: 1 },
        vitalsRegen: { mana: 1 },
      };
    }
    const setupMode = resolveAttackerSetupMode(config.setupMode);
    const normalized = { setupMode };
    const vitalsMax = normalizeAttackerVitalMap(config.vitalsMax);
    const vitalsRegen = normalizeAttackerVitalMap(config.vitalsRegen);
    const affinities = normalizeAttackerAffinitiesMap(config.affinities, fallbackAffinity);
    const requiresManaGuardrail = countAttackerAffinityExpressions(affinities) > 0;

    if (requiresManaGuardrail) {
      const manaMax = asTokenOrNull(vitalsMax.mana) || 0;
      if (manaMax <= 0) {
        vitalsMax.mana = 1;
      }
    }

    if (setupMode === "auto") {
      VITAL_KEYS.forEach((key) => {
        const max = asTokenOrNull(vitalsMax[key]);
        if (Number.isInteger(max)) {
          vitalsRegen[key] = max;
        }
      });
    }

    if (requiresManaGuardrail) {
      const manaRegen = asTokenOrNull(vitalsRegen.mana) || 0;
      if (manaRegen <= 0) {
        const manaMax = asTokenOrNull(vitalsMax.mana) || 1;
        vitalsRegen.mana = setupMode === "auto" ? Math.max(1, manaMax) : 1;
      }
    }

    if (Object.keys(vitalsMax).length > 0) {
      normalized.vitalsMax = vitalsMax;
    }
    if (Object.keys(vitalsRegen).length > 0) {
      normalized.vitalsRegen = vitalsRegen;
    }
    normalized.affinities = affinities;
    return normalized;
  }

  function refreshPromptTemplate() {
    syncAttackerSetupModeUI();
    const params = readPromptParams();
    renderBudgetAllocationSummary(params);
    renderTokenIndicators(params);
    const templates = buildPromptTemplates(params);
    if (levelPromptInput) {
      levelPromptInput.value = templates.level;
    }
    if (attackerPromptInput) {
      attackerPromptInput.value = templates.attacker;
    }
    if (defenderPromptInput) {
      defenderPromptInput.value = templates.defender;
    }
    if (guidanceInput) {
      guidanceInput.value = templates.combined;
    }
  }

  function buildAttackerConfigFromPromptParams(params = {}, { budgetTokens = null, priceList = state.priceList } = {}) {
    const setupMode = resolveAttackerSetupMode(params.attackerSetupMode);
    const config = { setupMode };
    if (params.attackerVitalsMax && Object.keys(params.attackerVitalsMax).length > 0) {
      config.vitalsMax = { ...params.attackerVitalsMax };
    }
    if (params.attackerVitalsRegen && Object.keys(params.attackerVitalsRegen).length > 0) {
      config.vitalsRegen = { ...params.attackerVitalsRegen };
    }
    if (params.attackerAffinities && Object.keys(params.attackerAffinities).length > 0) {
      config.affinities = { ...params.attackerAffinities };
    }
    const fallbackAffinity = normalizeAffinity(params?.levelAffinities?.[0]) || DEFAULT_DUNGEON_AFFINITY;
    return enforceAttackerConfigBudget(config, budgetTokens, priceList, { fallbackAffinity }).config;
  }

  function renderSpendLedger() {
    if (!spendLedgerOutput) return;
    if (!state.spendLedger) {
      spendLedgerOutput.textContent = "No spend ledger yet.";
      return;
    }
    spendLedgerOutput.textContent = JSON.stringify(state.spendLedger, null, 2);
  }

  function renderAttackerConfig() {
    if (!attackerConfigOutput) return;
    const attackerConfig = state.summary?.attackerConfig;
    if (!attackerConfig || typeof attackerConfig !== "object") {
      renderActorHud(attackerConfigOutput, [], { emptyText: ATTACKER_HUD_EMPTY_TEXT });
      return;
    }
    const promptParams = hasPromptParamsUI ? readPromptParams() : null;
    const attackerBudgetTokens = asTokenOrNull(state.budgeting?.playerBudgetTokens)
      ?? asTokenOrNull(promptParams?.poolBudgets?.attacker);
    const model = buildAttackerHudModel(attackerConfig, {
      attackerBudgetTokens,
      priceList: state.priceList,
      fallbackAffinity: normalizeAffinity(state.summary?.dungeonAffinity) || DEFAULT_DUNGEON_AFFINITY,
    });
    renderActorHud(attackerConfigOutput, [model], {
      emptyText: ATTACKER_HUD_EMPTY_TEXT,
      includeAttackerBudget: true,
      showMotivation: false,
    });
  }

  function refreshSpendLedger() {
    if (!state.summary) {
      state.spendLedger = null;
      renderSpendLedger();
      renderTokenIndicators();
      return;
    }
    state.spendLedger = buildDesignSpendLedger({
      summary: state.summary,
      actorSet: state.actorSet,
      budgeting: state.budgeting,
      priceList: state.priceList,
    });
    renderSpendLedger();
    renderAttackerConfig();
    renderTokenIndicators();
  }

  function validateActorSetMobilityConstraints(actorSet = []) {
    if (!Array.isArray(actorSet)) return ["actor set must be an array"];
    const errors = [];
    actorSet.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      if (entry.source === "room") return;
      const role = typeof entry.role === "string" && entry.role.trim()
        ? entry.role.trim()
        : typeof entry.motivation === "string" && entry.motivation.trim()
          ? entry.motivation.trim()
          : "stationary";
      if (role === "stationary") return;
      const staminaRegen = entry?.vitals?.stamina?.regen;
      if (!Number.isInteger(staminaRegen) || staminaRegen <= 0) {
        errors.push(`actors[${index}].vitals.stamina.regen must be > 0 for ambulatory actors`);
      }
    });
    return errors;
  }

  if (hasPromptParamsUI) {
    hydrateAttackerSetupOptions();
    hydrateLayoutProfileOptions();
    renderAffinityOptions(levelAffinitiesContainer);
    renderAffinityOptions(defenderAffinitiesContainer);
    renderAffinityOptions(attackerAffinitiesContainer, { includeExpressions: true });
    syncDefenderAffinitiesFromLevel({ force: true });
    syncAttackerSetupModeUI();
  }

  const paramInputs = [
    tokenBudgetInput,
    maxTokenBudgetInput,
    thinkTimeInput,
    llmTokensInput,
    layoutProfileInput,
    layoutAllocationPercentInput,
    defenderAllocationPercentInput,
    attackerAllocationPercentInput,
    attackerSetupModeInput,
  ].filter(Boolean);
  if (hasPromptParamsUI) {
    paramInputs.forEach((input) => {
      input.addEventListener?.("input", refreshPromptTemplate);
      input.addEventListener?.("change", refreshPromptTemplate);
    });
    if (levelAffinitiesContainer?.addEventListener) {
      const onLevelAffinityChange = () => {
        syncDefenderAffinitiesFromLevel();
        refreshPromptTemplate();
      };
      levelAffinitiesContainer.addEventListener("input", onLevelAffinityChange);
      levelAffinitiesContainer.addEventListener("change", onLevelAffinityChange);
    }
    [attackerAffinitiesContainer, defenderAffinitiesContainer].forEach((container) => {
      container?.addEventListener?.("input", refreshPromptTemplate);
      container?.addEventListener?.("change", refreshPromptTemplate);
    });
    if (attackerVitalsInputs) {
      Object.values(attackerVitalsInputs).forEach((group) => {
        if (!group) return;
        group.max?.addEventListener?.("input", refreshPromptTemplate);
      });
    }
    if (attackerVitalsRegenInputs) {
      Object.values(attackerVitalsRegenInputs).forEach((input) => {
        input?.addEventListener?.("input", refreshPromptTemplate);
        input?.addEventListener?.("change", refreshPromptTemplate);
      });
    }
    attackerSetupModeInput?.addEventListener?.("change", () => {
      syncAttackerSetupModeUI();
      refreshPromptTemplate();
    });

    refreshPromptTemplate();
  }

  function renderActorSet() {
    if (!actorSetPreview) return;
    const models = Array.isArray(state.actorSet)
      ? state.actorSet.map((entry) => buildActorHudModel(entry, state.priceList))
      : [];
    renderActorHud(actorSetPreview, models, {
      emptyText: ACTOR_HUD_EMPTY_TEXT,
      showMotivation: true,
      includeAttackerBudget: false,
    });
  }

  function updateActorSetFromJson(text) {
    try {
      const parsed = JSON.parse(text || "[]");
      if (!Array.isArray(parsed)) {
        throw new Error("Actor set must be a JSON array.");
      }
      const mobilityErrors = validateActorSetMobilityConstraints(parsed);
      if (mobilityErrors.length > 0) {
        throw new Error(mobilityErrors[0]);
      }
      const promptParams = hasPromptParamsUI ? readPromptParams() : null;
      const defenderBudgetResult = enforceDefenderActorSetBudget(parsed, {
        summary: state.summary,
        promptParams,
      });
      state.actorSet = defenderBudgetResult.actorSet;
      if (state.summary && typeof state.summary === "object") {
        state.summary = applyActorSetToSummary(state.summary, state.actorSet);
      }
      if (actorSetInput && defenderBudgetResult.wasClamped) {
        actorSetInput.value = JSON.stringify(state.actorSet, null, 2);
      }
      renderActorSet();
      refreshSpendLedger();
      const overBudget = Boolean(state.spendLedger?.overBudget);
      if (overBudget) {
        const overBy = Number.isInteger(state.spendLedger?.totalOverBudgetBy)
          ? state.spendLedger.totalOverBudgetBy
          : "unknown";
        setStatus(statusEl, `Actor set updated. Over budget by ${overBy} tokens.`, true);
      } else if (defenderBudgetResult.wasClamped && Number.isInteger(defenderBudgetResult.budgetCapTokens)) {
        setStatus(
          statusEl,
          `Actor set updated (defenders clamped to ${defenderBudgetResult.spendTokens}/${defenderBudgetResult.budgetCapTokens} tokens).`,
          false,
        );
      } else {
        setStatus(statusEl, "Actor set updated.");
      }
      return true;
    } catch (error) {
      setStatus(statusEl, `Actor set error: ${error.message}`, true);
      return false;
    }
  }

  function getPromptTemplateText() {
    if (guidanceInput?.value?.trim()) return guidanceInput.value.trim();
    const sections = [
      levelPromptInput?.value?.trim(),
      attackerPromptInput?.value?.trim(),
      defenderPromptInput?.value?.trim(),
    ].filter(Boolean);
    return sections.join("\n\n");
  }

  function renderSummaryOutputs({ summary, guidanceText, promptParams, captures = [], trace = [] } = {}) {
    const brief = buildDesignBrief(summary, guidanceText, {
      budgeting: state.budgeting,
      spendLedger: state.spendLedger,
      promptParams,
    });
    if (briefOutput) {
      briefOutput.textContent = brief;
    }
    renderLevelDesignOutput(levelDesignOutput, summary);
    if (Array.isArray(captures) && captures.length > 0 && typeof onLlmCapture === "function") {
      onLlmCapture({
        capture: captures[captures.length - 1],
        captures,
        parsedOk: true,
        trace,
      });
    }
    if (typeof onSummary === "function") {
      onSummary({
        summary,
        brief,
        actorSet: state.actorSet,
        budgeting: state.budgeting,
        spendLedger: state.spendLedger,
        loopTrace: trace,
      });
    }
  }

  async function benchmarkLevelGeneration() {
    const promptParams = hasPromptParamsUI ? readPromptParams() : null;
    if (promptParams) {
      renderBudgetAllocationSummary(promptParams);
    }
    const layoutPercent = Number.isFinite(promptParams?.poolAllocationPercentages?.layout)
      ? promptParams.poolAllocationPercentages.layout
      : DEFAULT_POOL_ALLOCATION_PERCENTAGES.layout;
    const targetBudgetTokens = Number.isInteger(promptParams?.tokenBudget) && promptParams.tokenBudget > 0
      ? promptParams.tokenBudget
      : DEFAULT_GUIDANCE_BUDGET_TOKENS;
    const benchmarkMaxBudget = readOptionalPositiveInt(benchmarkMaxTokenBudgetInput?.value);
    const runsInput = readOptionalPositiveInt(benchmarkSampleRunsInput?.value);
    const sampleRuns = Number.isInteger(runsInput) && runsInput > 0
      ? Math.min(runsInput, 10)
      : DEFAULT_BENCHMARK_SAMPLE_RUNS;
    const budgets = buildLevelBenchmarkSweep({
      targetBudgetTokens,
      maxBudgetTokens: benchmarkMaxBudget,
    });

    if (budgets.length === 0) {
      if (levelBenchmarkOutput) {
        levelBenchmarkOutput.textContent = "No benchmark budgets resolved.";
      }
      setStatus(statusEl, "Benchmark failed: no budgets resolved.", true);
      return { ok: false, error: "no_budgets" };
    }

    if (levelBenchmarkButton) {
      levelBenchmarkButton.disabled = true;
    }
    setStatus(statusEl, "Benchmarking level generation...");

    try {
      const [catalog, resolvedPriceList] = await Promise.all([
        resolveCatalog(llmConfig, statusEl),
        resolvePriceList(llmConfig),
      ]);
      if (resolvedPriceList) {
        state.priceList = resolvedPriceList;
      }

      const rows = [];
      let truncatedByTime = false;
      for (let budgetIndex = 0; budgetIndex < budgets.length; budgetIndex += 1) {
        const totalBudgetTokens = budgets[budgetIndex];
        const walkabilityBudgetTokens = Math.floor((totalBudgetTokens * layoutPercent) / 100);
        const durations = [];
        const errors = [];
        for (let runIndex = 0; runIndex < sampleRuns; runIndex += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          const adapter = {
            async generate() {
              return {
                response: JSON.stringify({
                  phase: "layout_only",
                  remainingBudgetTokens: walkabilityBudgetTokens,
                  layout: {
                    floorTiles: walkabilityBudgetTokens,
                    hallwayTiles: 0,
                  },
                  missing: [],
                  stop: "done",
                }),
                done: true,
              };
            },
          };
          const started = nowMs();
          const result = await runLlmBudgetLoop({
            adapter,
            model: "fixture",
            catalog,
            goal: "Benchmark level generation throughput",
            notes: "Benchmark workflow: level generation only.",
            budgetTokens: totalBudgetTokens,
            strict: false,
            format: LLM_OUTPUT_FORMAT,
            runId: `design_level_benchmark_${Date.now()}_${budgetIndex}_${runIndex}`,
            producedBy: "orchestrator",
            maxActorRounds: 0,
            layoutProfiles: resolveAllowedLayoutProfiles(promptParams?.layoutProfile),
            layoutPhaseContext: buildPromptContext({ params: promptParams, phase: "level" }),
            poolWeights:
              Array.isArray(promptParams?.poolWeights) && promptParams.poolWeights.length > 0
                ? promptParams.poolWeights
                : Array.isArray(llmConfig.poolWeights)
                  ? llmConfig.poolWeights
                  : undefined,
            poolPolicy:
              llmConfig.poolPolicy && typeof llmConfig.poolPolicy === "object"
                ? llmConfig.poolPolicy
                : undefined,
            priceList:
              resolvedPriceList || undefined,
          });
          const elapsedMs = nowMs() - started;
          if (!result.ok) {
            errors.push(summarizeLoopErrors(result.errors || []));
            break;
          }
          durations.push(elapsedMs);
        }

        const latencyMs = summarizeMs(durations);
        rows.push({
          totalBudgetTokens,
          walkabilityBudgetTokens,
          runs: sampleRuns,
          successRuns: durations.length,
          failureRuns: Math.max(0, sampleRuns - durations.length),
          latencyMs,
          errors: errors.length > 0 ? errors : undefined,
        });

        if (Number.isFinite(latencyMs.avg) && latencyMs.avg >= BENCHMARK_STOP_AFTER_MS) {
          truncatedByTime = true;
          break;
        }
        if (errors.length > 0) {
          break;
        }
      }

      const successfulRows = rows
        .filter((row) => row.successRuns > 0 && Number.isFinite(row.latencyMs.avg));
      const nearestRow = successfulRows.length > 0
        ? successfulRows.reduce((best, row) => {
          if (!best) return row;
          const bestDistance = Math.abs(best.totalBudgetTokens - targetBudgetTokens);
          const rowDistance = Math.abs(row.totalBudgetTokens - targetBudgetTokens);
          return rowDistance < bestDistance ? row : best;
        }, null)
        : null;
      const practicalRow = successfulRows
        .filter((row) => Number.isFinite(row.latencyMs.avg) && row.latencyMs.avg <= BENCHMARK_PRACTICAL_MS)
        .reduce((best, row) => (!best || row.totalBudgetTokens > best.totalBudgetTokens ? row : best), null);
      const maxRow = successfulRows
        .reduce((best, row) => (!best || row.totalBudgetTokens > best.totalBudgetTokens ? row : best), null);

      if (levelBenchmarkOutput) {
        const lines = [];
        lines.push("Level Generation Benchmark");
        lines.push(`Layout allocation: ${layoutPercent}%`);
        lines.push(`Runs per level size: ${sampleRuns}`);
        lines.push(`Current level size: total ${targetBudgetTokens.toLocaleString()} | walkable ${Math.floor((targetBudgetTokens * layoutPercent) / 100).toLocaleString()}`);
        lines.push("");
        lines.push("total | walkable | avg ms | p95 ms | status");
        rows.forEach((row) => {
          const avgText = Number.isFinite(row.latencyMs.avg) ? row.latencyMs.avg : "n/a";
          const p95Text = Number.isFinite(row.latencyMs.p95) ? row.latencyMs.p95 : "n/a";
          const status = row.failureRuns > 0
            ? `failed (${(row.errors || ["unknown"]).join("; ")})`
            : "ok";
          lines.push(`${row.totalBudgetTokens.toLocaleString()} | ${row.walkabilityBudgetTokens.toLocaleString()} | ${avgText} | ${p95Text} | ${status}`);
        });
        lines.push("");
        lines.push(nearestRow
          ? `Expected generation time at current size: ~${nearestRow.latencyMs.avg} ms (nearest benchmark).`
          : "Expected generation time at current size: unavailable.");
        if (practicalRow) {
          lines.push(
            `Recommended practical size (<=${BENCHMARK_PRACTICAL_MS} ms): total ${practicalRow.totalBudgetTokens.toLocaleString()} | walkable ${practicalRow.walkabilityBudgetTokens.toLocaleString()} (~${practicalRow.latencyMs.avg} ms).`,
          );
        }
        if (maxRow) {
          lines.push(
            `Largest successful benchmarked size: total ${maxRow.totalBudgetTokens.toLocaleString()} | walkable ${maxRow.walkabilityBudgetTokens.toLocaleString()}.`,
          );
        }
        if (truncatedByTime) {
          lines.push(
            `Benchmark stopped early after a run exceeded ${BENCHMARK_STOP_AFTER_MS} ms.`,
          );
        }
        levelBenchmarkOutput.textContent = lines.join("\n");
      }

      setStatus(statusEl, "Level benchmark complete.", false);
      return {
        ok: true,
        rows,
        expectedMs: nearestRow?.latencyMs?.avg ?? null,
        practicalRecommendation: practicalRow
          ? {
            totalBudgetTokens: practicalRow.totalBudgetTokens,
            walkabilityBudgetTokens: practicalRow.walkabilityBudgetTokens,
            avgMs: practicalRow.latencyMs.avg,
          }
          : null,
      };
    } catch (error) {
      if (levelBenchmarkOutput) {
        levelBenchmarkOutput.textContent = `Benchmark failed: ${error?.message || String(error)}`;
      }
      setStatus(statusEl, `Benchmark failed: ${error?.message || String(error)}`, true);
      return { ok: false, error };
    } finally {
      if (levelBenchmarkButton) {
        levelBenchmarkButton.disabled = false;
      }
    }
  }

  async function generateLevelBrief({ useFixture = false } = {}) {
    let promptParams = hasPromptParamsUI ? readPromptParams() : null;
    promptParams = ensureRandomLevelAndDefenderAffinities(promptParams);
    const promptTemplateText = getPromptTemplateText();
    const guidanceText = extractGuidanceGoal(promptTemplateText);
    const mode = useFixture ? "fixture" : modeSelect?.value === "fixture" ? "fixture" : "live";
    const model = modelInput?.value || DEFAULT_LLM_MODEL;
    const baseUrl = baseUrlInput?.value || DEFAULT_LLM_BASE_URL;
    const budgetTokensFromPrompt = extractBudgetTokens(promptTemplateText || guidanceText, DEFAULT_GUIDANCE_BUDGET_TOKENS);
    const budgetTokens = Number.isInteger(promptParams?.tokenBudget) ? promptParams.tokenBudget : budgetTokensFromPrompt;
    const allowedLayoutProfiles = resolveAllowedLayoutProfiles(promptParams?.layoutProfile);
    const levelPhaseContext = buildPromptContext({ params: promptParams, phase: "level" });
    if (promptParams) {
      renderBudgetAllocationSummary(promptParams);
    }

    state.traceRunId = `design_guidance_${Date.now()}`;
    setStatus(statusEl, "Generating level layout...");

    try {
      const [catalog, resolvedFetch, resolvedPriceList] = await Promise.all([
        resolveCatalog(llmConfig, statusEl),
        resolveLlmFetch({ mode, llmConfig }),
        resolvePriceList(llmConfig),
      ]);
      state.priceList = resolvedPriceList;
      const baseAdapter = createLlmAdapter({
        baseUrl,
        fetchFn: resolvedFetch,
        requestTimeoutMs: resolveLlmRequestTimeoutMs({ llmConfig, promptParams }),
      });
      const phaseAttempts = { layout: 0 };
      const adapter = {
        async generate(request = {}) {
          const promptText = typeof request.prompt === "string" ? request.prompt : "";
          if (promptText.includes("Phase: layout_only")) {
            phaseAttempts.layout += 1;
            setStatus(statusEl, phaseAttempts.layout === 1 ? "Generating level layout..." : "Repairing level layout...");
          }
          return baseAdapter.generate(request);
        },
      };

      const result = await runLlmBudgetLoop({
        adapter,
        model,
        baseUrl,
        catalog,
        goal: guidanceText || "Design dungeon strategy",
        notes: "Design workflow: generate level layout only.",
        budgetTokens,
        strict: false,
        format: LLM_OUTPUT_FORMAT,
        runId: state.traceRunId,
        producedBy: "orchestrator",
        maxActorRounds: 0,
        layoutProfiles: allowedLayoutProfiles,
        layoutPhaseContext: levelPhaseContext,
        poolWeights:
          Array.isArray(promptParams?.poolWeights) && promptParams.poolWeights.length > 0
            ? promptParams.poolWeights
            : Array.isArray(llmConfig.poolWeights)
              ? llmConfig.poolWeights
              : undefined,
        poolPolicy:
          llmConfig.poolPolicy && typeof llmConfig.poolPolicy === "object"
            ? llmConfig.poolPolicy
            : undefined,
        priceList:
          resolvedPriceList || undefined,
        optionsByPhase:
          llmConfig.optionsByPhase && typeof llmConfig.optionsByPhase === "object"
            ? llmConfig.optionsByPhase
            : undefined,
      });

      if (!result.ok) {
        throw new Error(`Level generation failed: ${summarizeLoopErrors(result.errors)}`);
      }

      let summary = normalizeSummary(result.summary || {}, guidanceText);
      if (!Number.isInteger(summary.budgetTokens) || summary.budgetTokens <= 0) {
        summary.budgetTokens = budgetTokens;
      }
      summary = applyLayoutProfilePreference(summary, promptParams?.layoutProfile);
      if (promptParams) {
        summary.attackerConfig = buildAttackerConfigFromPromptParams(promptParams, {
          budgetTokens: asTokenOrNull(promptParams?.poolBudgets?.attacker),
          priceList: state.priceList,
        });
      }

      state.summary = summary;
      state.budgeting = deriveBudgetBreakdown(result);
      state.actorSet = buildActorSet(summary);
      if (actorSetInput) {
        actorSetInput.value = JSON.stringify(state.actorSet, null, 2);
      }
      renderActorSet();
      refreshSpendLedger();

      renderSummaryOutputs({
        summary,
        guidanceText,
        promptParams,
        captures: Array.isArray(result.captures) ? result.captures : [],
        trace: Array.isArray(result.trace) ? result.trace : [],
      });
      setStatus(statusEl, "Level layout ready.", false);
      return { ok: true, summary };
    } catch (error) {
      setStatus(statusEl, `Level generation failed: ${error.message || error}`, true);
      return { ok: false, error };
    }
  }

  async function generateAttackerBrief({ useFixture = false } = {}) {
    let promptParams = hasPromptParamsUI ? readPromptParams() : null;
    promptParams = ensureRandomLevelAndDefenderAffinities(promptParams);
    const promptTemplateText = getPromptTemplateText();
    const guidanceText = extractGuidanceGoal(promptTemplateText);
    const mode = useFixture ? "fixture" : modeSelect?.value === "fixture" ? "fixture" : "live";
    const model = modelInput?.value || DEFAULT_LLM_MODEL;
    const baseUrl = baseUrlInput?.value || DEFAULT_LLM_BASE_URL;
    const budgetTokensFromPrompt = extractBudgetTokens(promptTemplateText || guidanceText, DEFAULT_GUIDANCE_BUDGET_TOKENS);
    const budgetTokens = Number.isInteger(promptParams?.tokenBudget) ? promptParams.tokenBudget : budgetTokensFromPrompt;
    const attackerBudgetTokens = asTokenOrNull(promptParams?.poolBudgets?.attacker)
      ?? state.budgeting?.playerBudgetTokens
      ?? 0;
    const fallbackConfig = buildAttackerConfigFromPromptParams(promptParams || {}, {
      budgetTokens: attackerBudgetTokens,
      priceList: state.priceList,
    });
    const attackerScope = resolveAttackerPromptScope(promptParams || {});
    const attackerAffinityPhrase = formatAffinityPhrase(attackerScope.affinities, DEFAULT_DUNGEON_AFFINITY);
    const requiredAttackerAffinityConfig = formatAttackerAffinityConfig(promptParams?.attackerAffinities);
    const fallbackAffinity = normalizeAffinity(state.summary?.dungeonAffinity)
      || normalizeAffinity(promptParams?.levelAffinities?.[0])
      || DEFAULT_DUNGEON_AFFINITY;
    const attackerPrompt = buildLlmAttackerConfigPromptTemplate({
      goal: `Configure attacker setup for a ${attackerAffinityPhrase} themed dungeon.`,
      notes: "Design workflow: attacker setup only.",
      budgetTokens,
      remainingBudgetTokens: attackerBudgetTokens,
      context: buildPromptContext({ params: promptParams, phase: "attacker" }),
      requiredAffinityConfig: requiredAttackerAffinityConfig,
      affinities: attackerScope.affinities,
      affinityExpressions: attackerScope.affinityExpressions,
      setupModes: attackerScope.setupModes,
      modelContextTokens: MODEL_CONTEXT_TOKENS || CONTEXT_WINDOW_TOKENS,
    });

    state.traceRunId = `design_guidance_${Date.now()}`;
    setStatus(statusEl, "Generating attacker configuration...");

    try {
      const resolvedPriceList = await resolvePriceList(llmConfig);
      if (resolvedPriceList) {
        state.priceList = resolvedPriceList;
      }
      const resolvedFetch = await resolveLlmFetch({ mode, llmConfig });
      const adapter = createLlmAdapter({
        baseUrl,
        fetchFn: resolvedFetch,
        requestTimeoutMs: resolveLlmRequestTimeoutMs({ llmConfig, promptParams }),
      });
      const session = await runLlmSession({
        adapter,
        model,
        baseUrl,
        prompt: attackerPrompt,
        strict: false,
        format: LLM_OUTPUT_FORMAT,
        options: resolveSessionLlmOptions({
          phase: "attacker",
          optionsByPhase: llmConfig.optionsByPhase,
          baseOptions: llmConfig.options,
        }),
        runId: state.traceRunId,
        producedBy: "orchestrator",
        clock: () => new Date().toISOString(),
      });
      if (!session.ok) {
        throw new Error(summarizeLoopErrors(session.errors || []));
      }
      const attackerConfigResult = enforceAttackerConfigBudget(
        session.summary?.attackerConfig && typeof session.summary.attackerConfig === "object"
          ? { ...session.summary.attackerConfig }
          : fallbackConfig,
        attackerBudgetTokens,
        state.priceList,
        { fallbackAffinity },
      );
      const attackerConfig = attackerConfigResult.config;
      const baseSummary = state.summary && typeof state.summary === "object"
        ? { ...state.summary }
        : {};
      baseSummary.dungeonAffinity = normalizeAffinity(baseSummary.dungeonAffinity) || fallbackAffinity;
      baseSummary.budgetTokens = Number.isInteger(baseSummary.budgetTokens) && baseSummary.budgetTokens > 0
        ? baseSummary.budgetTokens
        : budgetTokens;
      baseSummary.attackerConfig = attackerConfig;
      state.summary = baseSummary;
      if (Array.isArray(state.summary.actors) && state.summary.actors.length > 0) {
        state.actorSet = buildActorSet(state.summary);
        if (actorSetInput) {
          actorSetInput.value = JSON.stringify(state.actorSet, null, 2);
        }
        renderActorSet();
      }
      refreshSpendLedger();
      renderSummaryOutputs({
        summary: state.summary,
        guidanceText,
        promptParams,
        captures: session.capture ? [session.capture] : [],
        trace: [],
      });
      if (attackerConfigResult.wasClamped && Number.isInteger(attackerConfigResult.budgetTokens)) {
        setStatus(
          statusEl,
          `Attacker configuration ready (clamped to ${attackerConfigResult.spendTokens}/${attackerConfigResult.budgetTokens} tokens).`,
          false,
        );
      } else {
        setStatus(statusEl, "Attacker configuration ready.", false);
      }
      return { ok: true, summary: state.summary };
    } catch (error) {
      setStatus(statusEl, `Attacker generation failed: ${error.message || error}`, true);
      return { ok: false, error };
    }
  }

  async function generateDefenderBrief({ useFixture = false } = {}) {
    let promptParams = hasPromptParamsUI ? readPromptParams() : null;
    promptParams = ensureRandomLevelAndDefenderAffinities(promptParams);
    const promptTemplateText = getPromptTemplateText();
    const guidanceText = extractGuidanceGoal(promptTemplateText);
    const mode = useFixture ? "fixture" : modeSelect?.value === "fixture" ? "fixture" : "live";
    const model = modelInput?.value || DEFAULT_LLM_MODEL;
    const baseUrl = baseUrlInput?.value || DEFAULT_LLM_BASE_URL;
    const budgetTokensFromPrompt = extractBudgetTokens(promptTemplateText || guidanceText, DEFAULT_GUIDANCE_BUDGET_TOKENS);
    const budgetTokens = Number.isInteger(promptParams?.tokenBudget) ? promptParams.tokenBudget : budgetTokensFromPrompt;
    const actorBudgetTokens = asTokenOrNull(state.budgeting?.actorBudgetTokens)
      ?? asTokenOrNull(promptParams?.poolBudgets?.defenders)
      ?? 0;
    const defenderAffinities = normalizeAffinityList(promptParams?.defenderAffinities);
    const levelAffinities = normalizeAffinityList(promptParams?.levelAffinities);
    const defenderAffinityChoices = defenderAffinities.length > 0
      ? defenderAffinities
      : levelAffinities.length > 0
        ? levelAffinities
        : [DEFAULT_DUNGEON_AFFINITY];
    state.traceRunId = `design_guidance_${Date.now()}`;
    setStatus(statusEl, "Generating defender configuration...");

    try {
      const catalog = await resolveCatalog(llmConfig, statusEl);
      const allowedPairsText = formatAllowedPairs(deriveAllowedPairs(catalog));
      const layout = state.summary?.layout;
      const layoutContext = layout
        ? `Layout tiles: floor ${layout.floorTiles || 0}, hallway ${layout.hallwayTiles || 0}`
        : "";
      const defenderPrompt = buildLlmActorConfigPromptTemplate({
        goal: `Create dungeon defenders for a ${formatAffinityPhrase(defenderAffinityChoices, DEFAULT_DUNGEON_AFFINITY)} themed dungeon.`,
        notes: "Design workflow: defenders only.",
        budgetTokens,
        remainingBudgetTokens: actorBudgetTokens,
        allowedPairsText,
        context: [layoutContext, buildPromptContext({ params: promptParams, phase: "defender" })]
          .filter(Boolean)
          .join(" | "),
        affinities: defenderAffinityChoices,
        affinityExpressions: AFFINITY_EXPRESSIONS,
        motivations: MOTIVATION_KINDS,
        modelContextTokens: MODEL_CONTEXT_TOKENS || CONTEXT_WINDOW_TOKENS,
      });
      const resolvedFetch = await resolveLlmFetch({ mode, llmConfig });
      const adapter = createLlmAdapter({
        baseUrl,
        fetchFn: resolvedFetch,
        requestTimeoutMs: resolveLlmRequestTimeoutMs({ llmConfig, promptParams }),
      });
      const session = await runLlmSession({
        adapter,
        model,
        baseUrl,
        prompt: defenderPrompt,
        strict: false,
        phase: "actors_only",
        format: LLM_OUTPUT_FORMAT,
        options: resolveSessionLlmOptions({
          phase: "actors_only",
          optionsByPhase: llmConfig.optionsByPhase,
          baseOptions: llmConfig.options,
        }),
        runId: state.traceRunId,
        producedBy: "orchestrator",
        clock: () => new Date().toISOString(),
        requireSummary: { minActors: 1 },
        repairPromptBuilder: ({ errors, responseText }) => buildLlmRepairPromptTemplate({
          basePrompt: defenderPrompt,
          errors,
          responseText,
          affinities: defenderAffinityChoices,
          affinityExpressions: AFFINITY_EXPRESSIONS,
          motivations: MOTIVATION_KINDS,
          allowedPairsText,
          phaseRequirement: "Return phase actors_only with at least one defender actor.",
          extraLines: [
            "Return defenders only; omit rooms and layout.",
            "Use valid JSON with double quotes and no trailing commas.",
            "If tokenHint is provided, it must be an integer greater than 0; otherwise omit tokenHint.",
            "For non-stationary defenders, set vitals.stamina.regen to an integer greater than 0.",
            "Return at least one actor entry with count >= 1.",
          ],
        }),
      });
      if (!session.ok) {
        throw new Error(summarizeLoopErrors(session.errors || []));
      }
      const actorSummary = session.summary || {};
      const mergedSummary = {
        ...(state.summary && typeof state.summary === "object" ? state.summary : {}),
        dungeonAffinity: normalizeAffinity(state.summary?.dungeonAffinity)
          || normalizeAffinity(actorSummary.dungeonAffinity)
          || DEFAULT_DUNGEON_AFFINITY,
        budgetTokens,
        actors: Array.isArray(actorSummary.actors) ? actorSummary.actors : [],
        missing: Array.isArray(actorSummary.missing) ? actorSummary.missing : [],
      };
      if (actorSummary.stop) {
        mergedSummary.stop = actorSummary.stop;
      }
      if (state.summary?.layout) mergedSummary.layout = { ...state.summary.layout };
      if (state.summary?.roomDesign) mergedSummary.roomDesign = { ...state.summary.roomDesign };
      if (state.summary?.attackerConfig) {
        const attackerBudgetTokens = asTokenOrNull(state.budgeting?.playerBudgetTokens)
          ?? asTokenOrNull(promptParams?.poolBudgets?.attacker);
        mergedSummary.attackerConfig = enforceAttackerConfigBudget(
          state.summary.attackerConfig,
          attackerBudgetTokens,
          state.priceList,
          { fallbackAffinity: normalizeAffinity(mergedSummary.dungeonAffinity) || DEFAULT_DUNGEON_AFFINITY },
        ).config;
      }

      state.summary = mergedSummary;
      const actorRemainingTokens = asTokenOrNull(actorSummary.remainingBudgetTokens);
      const actorSpendTokens = Number.isInteger(actorBudgetTokens) && Number.isInteger(actorRemainingTokens)
        ? Math.max(0, actorBudgetTokens - actorRemainingTokens)
        : null;
      state.budgeting = {
        ...(state.budgeting || {}),
        actorBudgetTokens,
        actorRemainingTokens,
        actorSpendTokens,
      };
      state.actorSet = buildActorSet(state.summary);
      const actorSetErrors = validateActorSetMobilityConstraints(state.actorSet);
      if (actorSetErrors.length > 0) {
        throw new Error(actorSetErrors[0]);
      }
      const defenderBudgetResult = enforceDefenderActorSetBudget(state.actorSet, {
        summary: state.summary,
        promptParams,
      });
      state.actorSet = defenderBudgetResult.actorSet;
      state.summary = applyActorSetToSummary(state.summary, state.actorSet);
      if (actorSetInput) {
        actorSetInput.value = JSON.stringify(state.actorSet, null, 2);
      }
      renderActorSet();
      refreshSpendLedger();
      renderSummaryOutputs({
        summary: state.summary,
        guidanceText,
        promptParams,
        captures: session.capture ? [session.capture] : [],
        trace: [],
      });
      if (defenderBudgetResult.wasClamped && Number.isInteger(defenderBudgetResult.budgetCapTokens)) {
        setStatus(
          statusEl,
          `Defender configuration ready (clamped to ${defenderBudgetResult.spendTokens}/${defenderBudgetResult.budgetCapTokens} tokens).`,
          false,
        );
      } else {
        setStatus(statusEl, "Defender configuration ready.", false);
      }
      return { ok: true, summary: state.summary };
    } catch (error) {
      setStatus(statusEl, `Defender generation failed: ${error.message || error}`, true);
      return { ok: false, error };
    }
  }

  async function generateBrief({ useFixture = false } = {}) {
    let promptParams = hasPromptParamsUI ? readPromptParams() : null;
    promptParams = ensureRandomLevelAndDefenderAffinities(promptParams);
    const promptTemplateText = getPromptTemplateText();
    const guidanceText = extractGuidanceGoal(promptTemplateText);
    const mode = useFixture ? "fixture" : modeSelect?.value === "fixture" ? "fixture" : "live";
    const model = modelInput?.value || DEFAULT_LLM_MODEL;
    const baseUrl = baseUrlInput?.value || DEFAULT_LLM_BASE_URL;
    const budgetTokensFromPrompt = extractBudgetTokens(promptTemplateText || guidanceText, DEFAULT_GUIDANCE_BUDGET_TOKENS);
    const budgetTokens = Number.isInteger(promptParams?.tokenBudget) ? promptParams.tokenBudget : budgetTokensFromPrompt;
    const allowedLayoutProfiles = resolveAllowedLayoutProfiles(promptParams?.layoutProfile);
    const levelPhaseContext = buildPromptContext({ params: promptParams, phase: "level" });
    if (promptParams) {
      renderBudgetAllocationSummary(promptParams);
    }

    state.traceRunId = `design_guidance_${Date.now()}`;
    setStatus(statusEl, "Generating level layout...");

    try {
      const [catalog, resolvedFetch, resolvedPriceList] = await Promise.all([
        resolveCatalog(llmConfig, statusEl),
        resolveLlmFetch({ mode, llmConfig }),
        resolvePriceList(llmConfig),
      ]);
      state.priceList = resolvedPriceList;
      const baseAdapter = createLlmAdapter({
        baseUrl,
        fetchFn: resolvedFetch,
        requestTimeoutMs: resolveLlmRequestTimeoutMs({ llmConfig, promptParams }),
      });
      const phaseAttempts = { layout: 0, actors: 0 };
      const defenderAffinities = normalizeAffinityList(promptParams?.defenderAffinities);
      const levelAffinities = normalizeAffinityList(promptParams?.levelAffinities);
      const defenderAffinityChoices = defenderAffinities.length > 0
        ? defenderAffinities
        : levelAffinities.length > 0
          ? levelAffinities
          : [DEFAULT_DUNGEON_AFFINITY];

      const adapter = {
        async generate(request = {}) {
          const promptText = typeof request.prompt === "string" ? request.prompt : "";
          if (promptText.includes("Phase: layout_only")) {
            phaseAttempts.layout += 1;
            setStatus(statusEl, phaseAttempts.layout === 1 ? "Generating level layout..." : "Repairing level layout...");
          } else if (promptText.includes("Phase: actors_only")) {
            phaseAttempts.actors += 1;
            setStatus(statusEl, phaseAttempts.actors === 1 ? "Generating defender configuration..." : "Repairing defender configuration...");
          }
          return baseAdapter.generate(request);
        },
      };

      const result = await runLlmBudgetLoop({
        adapter,
        model,
        baseUrl,
        catalog,
        goal: guidanceText || "Design dungeon strategy",
        notes: "Design workflow: generate level layout first, then defender configuration.",
        budgetTokens,
        defenderAffinities: defenderAffinityChoices,
        strict: false,
        format: LLM_OUTPUT_FORMAT,
        runId: state.traceRunId,
        producedBy: "orchestrator",
        maxActorRounds:
          Number.isInteger(llmConfig.maxActorRounds) && llmConfig.maxActorRounds > 0
            ? llmConfig.maxActorRounds
            : DEFAULT_UI_MAX_ACTOR_ROUNDS,
        layoutProfiles: allowedLayoutProfiles,
        layoutPhaseContext: levelPhaseContext,
        poolWeights:
          Array.isArray(promptParams?.poolWeights) && promptParams.poolWeights.length > 0
            ? promptParams.poolWeights
            : Array.isArray(llmConfig.poolWeights)
              ? llmConfig.poolWeights
              : undefined,
        poolPolicy:
          llmConfig.poolPolicy && typeof llmConfig.poolPolicy === "object"
            ? llmConfig.poolPolicy
            : undefined,
        priceList:
          resolvedPriceList || undefined,
        optionsByPhase:
          llmConfig.optionsByPhase && typeof llmConfig.optionsByPhase === "object"
            ? llmConfig.optionsByPhase
            : undefined,
      });

      if (!result.ok) {
        throw new Error(`Budget loop failed: ${summarizeLoopErrors(result.errors)}`);
      }

      let summary = normalizeSummary(result.summary || {}, guidanceText);
      if (!Number.isInteger(summary.budgetTokens) || summary.budgetTokens <= 0) {
        summary.budgetTokens = budgetTokens;
      }
      summary = applyLayoutProfilePreference(summary, promptParams?.layoutProfile);
      if (promptParams) {
        summary.attackerConfig = buildAttackerConfigFromPromptParams(promptParams, {
          budgetTokens: asTokenOrNull(promptParams?.poolBudgets?.attacker),
          priceList: state.priceList,
        });
      }

      state.summary = summary;
      state.budgeting = deriveBudgetBreakdown(result);

      state.actorSet = buildActorSet(summary);
      const actorSetErrors = validateActorSetMobilityConstraints(state.actorSet);
      if (actorSetErrors.length > 0) {
        throw new Error(actorSetErrors[0]);
      }
      const defenderBudgetResult = enforceDefenderActorSetBudget(state.actorSet, {
        summary: state.summary,
        promptParams,
      });
      state.actorSet = defenderBudgetResult.actorSet;
      state.summary = applyActorSetToSummary(state.summary, state.actorSet);
      if (actorSetInput) {
        actorSetInput.value = JSON.stringify(state.actorSet, null, 2);
      }
      renderActorSet();
      refreshSpendLedger();

      const brief = buildDesignBrief(summary, guidanceText, {
        budgeting: state.budgeting,
        spendLedger: state.spendLedger,
        promptParams,
      });
      if (briefOutput) {
        briefOutput.textContent = brief;
      }
      renderLevelDesignOutput(levelDesignOutput, summary);

      const captures = Array.isArray(result.captures) ? result.captures : [];
      if (captures.length > 0 && typeof onLlmCapture === "function") {
        onLlmCapture({
          capture: captures[captures.length - 1],
          captures,
          parsedOk: true,
          trace: result.trace,
        });
      }

      if (defenderBudgetResult.wasClamped && Number.isInteger(defenderBudgetResult.budgetCapTokens)) {
        setStatus(
          statusEl,
          `Design brief ready (layout + defender configuration, defenders clamped to ${defenderBudgetResult.spendTokens}/${defenderBudgetResult.budgetCapTokens} tokens).`,
          false,
        );
      } else {
        setStatus(statusEl, "Design brief ready (layout + defender configuration).", false);
      }
      if (typeof onSummary === "function") {
        onSummary({
          summary,
          brief,
          actorSet: state.actorSet,
          budgeting: state.budgeting,
          spendLedger: state.spendLedger,
          loopTrace: result.trace,
        });
      }
    } catch (error) {
      setStatus(statusEl, `Generation failed: ${error.message || error}`, true);
    }
  }

  if (generateButton?.addEventListener) {
    generateButton.addEventListener("click", () => {
      generateLevelBrief({ useFixture: false });
    });
  }

  if (fixtureButton?.addEventListener) {
    fixtureButton.addEventListener("click", () => {
      generateLevelBrief({ useFixture: true });
    });
  }

  if (levelBenchmarkButton?.addEventListener) {
    levelBenchmarkButton.addEventListener("click", () => {
      benchmarkLevelGeneration();
    });
  }

  if (applyActorSetButton?.addEventListener) {
    applyActorSetButton.addEventListener("click", () => {
      updateActorSetFromJson(actorSetInput?.value || "[]");
    });
  }

  if (actorSetInput?.addEventListener) {
    actorSetInput.addEventListener("change", () => {
      updateActorSetFromJson(actorSetInput.value || "[]");
    });
  }

  renderActorSet();
  renderSpendLedger();
  renderAttackerConfig();
  renderTokenIndicators();

  return {
    benchmarkLevelGeneration,
    generateLevelBrief,
    generateAttackerBrief,
    generateDefenderBrief,
    generateBrief,
    updateActorSetFromJson,
    getActorSet: () => state.actorSet.slice(),
    getSummary: () => (state.summary ? { ...state.summary } : null),
    getBudgeting: () => (state.budgeting ? { ...state.budgeting } : null),
    getSpendLedger: () => (state.spendLedger ? { ...state.spendLedger } : null),
  };
}

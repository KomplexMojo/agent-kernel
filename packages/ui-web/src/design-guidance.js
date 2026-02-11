import { createLlmAdapter } from "../../adapters-web/src/adapters/llm/index.js";
import { runLlmBudgetLoop } from "../../runtime/src/personas/orchestrator/llm-budget-loop.js";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  AFFINITY_EXPRESSION_SET,
  AFFINITY_KIND_SET,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_VITALS,
  DOMAIN_CONSTRAINTS,
  VITAL_KEYS,
  buildLlmActorConfigPromptTemplate,
  buildLlmLevelPromptTemplate,
  normalizeVitals as normalizeDomainVitals,
} from "../../runtime/src/contracts/domain-constants.js";
import { MOTIVATION_KINDS } from "../../runtime/src/personas/configurator/motivation-loadouts.js";
import { DEFAULT_LAYOUT_TILE_COSTS } from "../../runtime/src/personas/allocator/layout-spend.js";

const DEFAULT_LLM_FIXTURE = "/tests/fixtures/adapters/llm-generate-summary-budget-loop.json";
const DEFAULT_CATALOG_FIXTURE = "/tests/fixtures/pool/catalog-basic.json";
const CONTEXT_WINDOW_TOKENS = DOMAIN_CONSTRAINTS?.llm?.contextWindowTokens;
const MODEL_CONTEXT_TOKENS = DOMAIN_CONSTRAINTS?.llm?.modelContextTokens;
const LLM_OUTPUT_FORMAT = DOMAIN_CONSTRAINTS?.llm?.outputFormat || "json";
const DEFAULT_GUIDANCE_BUDGET_TOKENS = 1000;
const DEFAULT_UI_MAX_ACTOR_ROUNDS = 1;
const INTENT_HEADER = "Intent and constraints:";
const LEVEL_TEMPLATE_HEADER = "=== Level Prompt Template ===";
const DEFENDER_TEMPLATE_HEADER = "=== Defender Prompt Template ===";
const LEGACY_ACTOR_TEMPLATE_HEADER = "=== Actor Prompt Template ===";

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

function formatVitalsMaxConfig(vitalsMax = {}) {
  const lines = VITAL_KEYS.map((key) => {
    const max = vitalsMax[key];
    if (!Number.isFinite(max)) return null;
    return `${key} ${max}`;
  }).filter(Boolean);
  return lines.length > 0 ? lines.join(", ") : "";
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
    if (Number.isInteger(params.levelBudget)) {
      lines.push(`Level budget tokens: ${params.levelBudget}`);
    }
    const affinities = formatAffinityList(params.levelAffinities);
    if (affinities) {
      lines.push(`Level affinities: ${affinities}`);
    }
  }
  if (phase === "defender") {
    const defenderAffinities = formatAffinityList(params.defenderAffinities);
    if (defenderAffinities) {
      lines.push(`Defender affinities: ${defenderAffinities}`);
    }
  }
  return lines.join(" | ");
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
  const defaultIntent = `A ${affinityPhrase} affinity dungeon with ${normalizedBudget} token budget.`;
  const defenderAffinities = normalizeAffinityList(promptParams?.defenderAffinities);
  const defenderAffinityPhrase = formatAffinityPhrase(
    defenderAffinities.length > 0 ? defenderAffinities : selectedLevelAffinities,
    DEFAULT_DUNGEON_AFFINITY,
  );
  const defenderAffinityChoices = defenderAffinities.length > 0
    ? defenderAffinities
    : selectedLevelAffinities.length > 0
      ? selectedLevelAffinities
      : [DEFAULT_DUNGEON_AFFINITY];
  const actorGoal = `Create dungeon defenders for a ${defenderAffinityPhrase} themed dungeon.`;
  const hasLevelBudget = Number.isInteger(promptParams?.levelBudget);
  const hasAttackerBudget = Number.isInteger(promptParams?.attackerBudget);
  const levelBudgetTokens = hasLevelBudget
    ? promptParams.levelBudget
    : hasAttackerBudget
      ? Math.max(0, normalizedBudget - promptParams.attackerBudget)
      : normalizedBudget;
  const defenderBudgetTokens = hasAttackerBudget
    ? promptParams.attackerBudget
    : hasLevelBudget
      ? Math.max(0, normalizedBudget - promptParams.levelBudget)
      : normalizedBudget;
  const levelContext = buildPromptContext({ params: promptParams, phase: "level" });
  const actorContext = buildPromptContext({ params: promptParams, phase: "defender" });
  const levelTemplate = buildLlmLevelPromptTemplate({
    goal: defaultIntent,
    notes: "Phase 1 of 2. Generate layout only.",
    budgetTokens: normalizedBudget,
    remainingBudgetTokens: levelBudgetTokens,
    layoutCosts: tileCosts,
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
  return [
    LEVEL_TEMPLATE_HEADER,
    levelTemplate,
    "",
    DEFENDER_TEMPLATE_HEADER,
    actorTemplate,
  ].join("\n");
}

export const buildDefaultPromptTemplate = buildDefaultStrategicGuidancePrompt;

export function buildDesignBrief(summary, guidanceText = "", { budgeting } = {}) {
  if (!summary) return "No summary available.";
  const dungeonAffinity = summary.dungeonAffinity || "unknown";
  const budget = Number.isFinite(summary.budgetTokens) ? `${summary.budgetTokens} tokens` : "unspecified";
  const totalBudgetTokens = Number.isInteger(summary.budgetTokens) ? summary.budgetTokens : null;
  const actorGroups = Array.isArray(summary.actors) ? summary.actors.length : 0;
  const actorCount = Array.isArray(summary.actors)
    ? summary.actors.reduce((sum, actor) => sum + (Number.isFinite(actor?.count) ? actor.count : 1), 0)
    : 0;
  const layout = summary.layout && typeof summary.layout === "object" ? summary.layout : null;

  const layoutLine = layout
    ? `Layout Tiles: wall ${layout.wallTiles || 0}, floor ${layout.floorTiles || 0}, hallway ${layout.hallwayTiles || 0}`
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
    missing,
    guidanceLine,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatRoomDesign(roomDesign) {
  if (!roomDesign || typeof roomDesign !== "object") {
    return "Room Design: none.";
  }
  const rooms = Array.isArray(roomDesign.rooms) ? roomDesign.rooms : [];
  const roomParts = rooms.map((room) => {
    if (!room || typeof room !== "object") return null;
    const id = typeof room.id === "string" && room.id.trim() ? `${room.id.trim()} ` : "";
    const size = typeof room.size === "string" && room.size.trim() ? room.size.trim() : "room";
    const width = Number.isInteger(room.width) ? room.width : null;
    const height = Number.isInteger(room.height) ? room.height : null;
    const dims = width && height ? `${width}x${height}` : "size unknown";
    return `${id}${size} ${dims}`.trim();
  }).filter(Boolean);
  const roomsLine = roomParts.length > 0
    ? `Rooms: ${roomParts.length} (${roomParts.join(", ")})`
    : "Rooms: none.";
  const connections = Array.isArray(roomDesign.connections) ? roomDesign.connections : [];
  const connectionsLine = connections.length > 0
    ? `Connections: ${connections.map((connection) => {
      if (!connection || typeof connection !== "object") return null;
      const from = connection.from || "?";
      const to = connection.to || "?";
      const type = typeof connection.type === "string" && connection.type.trim()
        ? ` (${connection.type.trim()})`
        : "";
      return `${from}-${to}${type}`;
    }).filter(Boolean).join(", ")}`
    : "Connections: none.";
  const hallways = typeof roomDesign.hallways === "string" && roomDesign.hallways.trim()
    ? `Hallways: ${roomDesign.hallways.trim()}`
    : "Hallways: unspecified.";
  return [roomsLine, connectionsLine, hallways].join("\n");
}

function buildLevelDesignSummary(summary) {
  if (!summary) return "No room design yet.";
  return formatRoomDesign(summary.roomDesign);
}

export function buildActorSet(summary) {
  if (!summary) return [];
  const actorSet = [];
  const actors = Array.isArray(summary.actors) ? summary.actors : [];
  const rooms = Array.isArray(summary.rooms) ? summary.rooms : [];
  const dungeonAffinity = normalizeAffinity(summary.dungeonAffinity) || DEFAULT_DUNGEON_AFFINITY;

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
      return `${index + 1}. ${actor?.id || "actor"} (${role}, ${affinity}) x${count}`;
    })
    .join("\n");
}

export function wireDesignGuidance({ elements = {}, llmConfig = {}, onSummary, onLlmCapture } = {}) {
  const {
    guidanceInput,
    modeSelect,
    modelInput,
    baseUrlInput,
    generateButton,
    fixtureButton,
    statusEl,
    briefOutput,
    levelDesignOutput,
    actorSetInput,
    actorSetPreview,
    applyActorSetButton,
    tokenBudgetInput,
    thinkTimeInput,
    llmTokensInput,
    levelBudgetInput,
    levelAffinitiesContainer,
    attackerBudgetInput,
    attackerAffinitiesContainer,
    defenderAffinitiesContainer,
    attackerVitalsInputs,
  } = elements;

  const state = {
    summary: null,
    actorSet: [],
    budgeting: null,
    traceRunId: `design_guidance_${Date.now()}`,
  };

  if (modelInput && (!modelInput.value || !modelInput.value.trim())) {
    modelInput.value = DEFAULT_LLM_MODEL;
  }
  if (baseUrlInput && (!baseUrlInput.value || !baseUrlInput.value.trim())) {
    baseUrlInput.value = DEFAULT_LLM_BASE_URL;
  }
  if (guidanceInput && (!guidanceInput.value || !guidanceInput.value.trim())) {
    guidanceInput.value = buildDefaultStrategicGuidancePrompt();
  }
  if (levelDesignOutput && !levelDesignOutput.textContent) {
    levelDesignOutput.textContent = "No room design yet.";
  }

  const hasPromptParamsUI = Boolean(
    tokenBudgetInput
      || thinkTimeInput
      || llmTokensInput
      || levelBudgetInput
      || levelAffinitiesContainer
      || attackerBudgetInput
      || attackerAffinitiesContainer
      || defenderAffinitiesContainer
      || attackerVitalsInputs,
  );

  function renderAffinityOptions(container, { includeExpressions = false } = {}) {
    if (!container) return;
    container.textContent = "";
    AFFINITY_KINDS.forEach((affinity) => {
      const row = document.createElement("div");
      row.className = "affinity-row";
      const label = document.createElement("label");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.dataset.affinity = affinity;
      toggle.className = "affinity-toggle";
      label.appendChild(toggle);
      label.append(` ${affinity}`);
      row.appendChild(label);

      if (includeExpressions) {
        const exprWrap = document.createElement("div");
        exprWrap.className = "affinity-expressions";
        AFFINITY_EXPRESSIONS.forEach((expression) => {
          const exprLabel = document.createElement("label");
          const exprInput = document.createElement("input");
          exprInput.type = "checkbox";
          exprInput.dataset.affinity = affinity;
          exprInput.dataset.expression = expression;
          exprInput.className = "affinity-expression";
          exprInput.disabled = true;
          exprLabel.appendChild(exprInput);
          exprLabel.append(` ${expression}`);
          exprWrap.appendChild(exprLabel);
        });
        row.appendChild(exprWrap);

        toggle.addEventListener("change", () => {
          const enabled = toggle.checked;
          exprWrap.querySelectorAll("input").forEach((input) => {
            input.disabled = !enabled;
            if (!enabled) {
              input.checked = false;
            } else if (!input.checked) {
              input.checked = true;
            }
          });
        });
      }

      container.appendChild(row);
    });
  }

  function collectSelectedAffinities(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll("input.affinity-toggle"))
      .filter((input) => input.checked)
      .map((input) => input.dataset.affinity)
      .filter(Boolean);
  }

  function collectAttackerAffinities(container) {
    if (!container) return {};
    const result = {};
    const toggles = Array.from(container.querySelectorAll("input.affinity-toggle"));
    toggles.forEach((toggle) => {
      if (!toggle.checked) return;
      const affinity = toggle.dataset.affinity;
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

  function collectVitals() {
    if (!attackerVitalsInputs) return {};
    const result = {};
    VITAL_KEYS.forEach((key) => {
      const group = attackerVitalsInputs[key];
      if (!group) return;
      const max = readOptionalInt(group.max?.value);
      if (max === null) return;
      result[key] = max;
    });
    return result;
  }

  function readPromptParams() {
    const tokenBudget = readOptionalInt(tokenBudgetInput?.value) || DEFAULT_GUIDANCE_BUDGET_TOKENS;
    const thinkTimeSeconds = readOptionalInt(thinkTimeInput?.value);
    const llmTokens = readOptionalInt(llmTokensInput?.value);
    const levelBudget = readOptionalInt(levelBudgetInput?.value);
    const attackerBudget = readOptionalInt(attackerBudgetInput?.value);
    const levelAffinities = collectSelectedAffinities(levelAffinitiesContainer);
    const defenderAffinities = collectSelectedAffinities(defenderAffinitiesContainer);
    const attackerAffinities = collectAttackerAffinities(attackerAffinitiesContainer);
    const attackerVitalsMax = collectVitals();
    return {
      tokenBudget,
      thinkTimeSeconds,
      llmTokens,
      levelBudget,
      attackerBudget,
      levelAffinities,
      defenderAffinities,
      attackerAffinities,
      attackerVitalsMax,
    };
  }

  function refreshPromptTemplate() {
    if (!guidanceInput) return;
    const params = readPromptParams();
    guidanceInput.value = buildDefaultStrategicGuidancePrompt({
      budgetTokens: params.tokenBudget,
      promptParams: params,
    });
  }

  if (hasPromptParamsUI) {
    renderAffinityOptions(levelAffinitiesContainer);
    renderAffinityOptions(defenderAffinitiesContainer);
    renderAffinityOptions(attackerAffinitiesContainer, { includeExpressions: true });
  }

  const paramInputs = [
    tokenBudgetInput,
    thinkTimeInput,
    llmTokensInput,
    levelBudgetInput,
    attackerBudgetInput,
  ].filter(Boolean);
  if (hasPromptParamsUI) {
    paramInputs.forEach((input) => {
      input.addEventListener?.("input", refreshPromptTemplate);
      input.addEventListener?.("change", refreshPromptTemplate);
    });
    [levelAffinitiesContainer, attackerAffinitiesContainer, defenderAffinitiesContainer].forEach((container) => {
      container?.addEventListener?.("change", refreshPromptTemplate);
    });
    if (attackerVitalsInputs) {
      Object.values(attackerVitalsInputs).forEach((group) => {
        if (!group) return;
        group.max?.addEventListener?.("input", refreshPromptTemplate);
      });
    }

    refreshPromptTemplate();
  }

  function renderActorSet() {
    if (actorSetPreview) {
      actorSetPreview.textContent = formatActorSet(state.actorSet);
    }
  }

  function updateActorSetFromJson(text) {
    try {
      const parsed = JSON.parse(text || "[]");
      if (!Array.isArray(parsed)) {
        throw new Error("Actor set must be a JSON array.");
      }
      state.actorSet = parsed;
      renderActorSet();
      setStatus(statusEl, "Actor set updated.");
      return true;
    } catch (error) {
      setStatus(statusEl, `Actor set error: ${error.message}`, true);
      return false;
    }
  }

  async function generateBrief({ useFixture = false } = {}) {
    const promptTemplateText = guidanceInput?.value?.trim() || "";
    const guidanceText = extractGuidanceGoal(promptTemplateText);
    const mode = useFixture ? "fixture" : modeSelect?.value === "fixture" ? "fixture" : "live";
    const model = modelInput?.value || DEFAULT_LLM_MODEL;
    const baseUrl = baseUrlInput?.value || DEFAULT_LLM_BASE_URL;
    const budgetTokens = extractBudgetTokens(promptTemplateText || guidanceText, DEFAULT_GUIDANCE_BUDGET_TOKENS);

    state.traceRunId = `design_guidance_${Date.now()}`;
    setStatus(statusEl, "Generating level layout...");

    try {
      const catalog = await resolveCatalog(llmConfig, statusEl);
      const resolvedFetch = await resolveLlmFetch({ mode, llmConfig });
      const baseAdapter = createLlmAdapter({ baseUrl, fetchFn: resolvedFetch });
      const phaseAttempts = { layout: 0, actors: 0 };
      const promptParams = hasPromptParamsUI ? readPromptParams() : null;
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
        poolWeights: Array.isArray(llmConfig.poolWeights) ? llmConfig.poolWeights : undefined,
        poolPolicy:
          llmConfig.poolPolicy && typeof llmConfig.poolPolicy === "object"
            ? llmConfig.poolPolicy
            : undefined,
        priceList:
          llmConfig.priceList && typeof llmConfig.priceList === "object"
            ? llmConfig.priceList
            : undefined,
        optionsByPhase:
          llmConfig.optionsByPhase && typeof llmConfig.optionsByPhase === "object"
            ? llmConfig.optionsByPhase
            : undefined,
      });

      if (!result.ok) {
        throw new Error(`Budget loop failed: ${summarizeLoopErrors(result.errors)}`);
      }

      const summary = normalizeSummary(result.summary || {}, guidanceText);
      if (!Number.isInteger(summary.budgetTokens) || summary.budgetTokens <= 0) {
        summary.budgetTokens = budgetTokens;
      }

      state.summary = summary;
      state.budgeting = deriveBudgetBreakdown(result);

      const brief = buildDesignBrief(summary, guidanceText, { budgeting: state.budgeting });
      if (briefOutput) {
        briefOutput.textContent = brief;
      }
      if (levelDesignOutput) {
        levelDesignOutput.textContent = buildLevelDesignSummary(summary);
      }

      state.actorSet = buildActorSet(summary);
      if (actorSetInput) {
        actorSetInput.value = JSON.stringify(state.actorSet, null, 2);
      }
      renderActorSet();

      const captures = Array.isArray(result.captures) ? result.captures : [];
      if (captures.length > 0 && typeof onLlmCapture === "function") {
        onLlmCapture({
          capture: captures[captures.length - 1],
          captures,
          parsedOk: true,
          trace: result.trace,
        });
      }

      setStatus(statusEl, "Design brief ready (layout + defender configuration).", false);
      if (typeof onSummary === "function") {
        onSummary({
          summary,
          brief,
          actorSet: state.actorSet,
          budgeting: state.budgeting,
          loopTrace: result.trace,
        });
      }
    } catch (error) {
      setStatus(statusEl, `Generation failed: ${error.message || error}`, true);
    }
  }

  if (generateButton?.addEventListener) {
    generateButton.addEventListener("click", () => {
      generateBrief({ useFixture: false });
    });
  }

  if (fixtureButton?.addEventListener) {
    fixtureButton.addEventListener("click", () => {
      generateBrief({ useFixture: true });
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

  return {
    generateBrief,
    updateActorSetFromJson,
    getActorSet: () => state.actorSet.slice(),
    getSummary: () => (state.summary ? { ...state.summary } : null),
    getBudgeting: () => (state.budgeting ? { ...state.budgeting } : null),
  };
}

import { createLlmAdapter } from "../../adapters-web/src/adapters/llm/index.js";
import { runLlmBudgetLoop } from "../../runtime/src/personas/orchestrator/llm-budget-loop.js";
import { runLlmSession } from "../../runtime/src/personas/orchestrator/llm-session.js";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_EXPRESSION_SET,
  AFFINITY_KINDS,
  AFFINITY_KIND_SET,
  AFFINITY_OPPOSITES,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_ROOM_AFFINITY_EXPRESSION,
  DEFAULT_ROOM_AFFINITY_STACKS,
  DEFAULT_ROOM_CARD_AFFINITY,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_VITALS,
  VITAL_KEYS,
  normalizeVitals as normalizeDomainVitals,
} from "../../runtime/src/contracts/domain-constants.js";

// Removed from domain-constants in cost refactor (046f786); kept local to preserve display scale.
const ROOM_AFFINITY_STACK_COST_FACTOR = 0.1;
import { resolveIconHTML } from "./icon-resolver.js";
import { evaluateRoomCardLayoutSpend } from "../../runtime/src/personas/allocator/layout-spend.js";
import { normalizePriceItems } from "../../runtime/src/personas/allocator/validate-spend.js";
import {
  calculateActorConfigurationUnitCost,
  buildDesignSpendLedger,
} from "../../runtime/src/personas/configurator/spend-proposal.js";
import {
  getConflictingMotivationKinds,
  MOTIVATION_DISPLAY_GROUPS,
  MOTIVATION_KINDS,
  normalizeMotivationKindList,
} from "../../runtime/src/personas/configurator/motivation-loadouts.js";
import {
  buildCardSetFromSummary,
  extractSummaryFromCardSet,
  normalizeCardEntry,
} from "../../runtime/src/personas/director/summary-selections.js";
import {
  normalizeCardType,
  normalizeCardCount,
  normalizeRoomCardSize,
} from "../../runtime/src/personas/configurator/card-model.js";

const DEFAULT_LEVEL_BUDGET_TOKENS = 2500;
const DEFAULT_AI_PROMPT = "Generate a balanced room, delver, and warden card set for a stealth dungeon run.";
const FIXTURE_DEFAULT_RESPONSE = {
  response: JSON.stringify({
    dungeonAffinity: "fire",
    rooms: [{ affinity: "fire", size: "medium", count: 2 }],
    actors: [{ motivation: "defending", affinity: "earth", count: 2 }],
    delverConfigs: [{
      setupMode: "hybrid",
      vitalsMax: { health: 10, mana: 6, stamina: 5, durability: 4 },
      vitalsRegen: { health: 1, mana: 1, stamina: 1, durability: 0 },
      affinities: { fire: ["push"], wind: ["emit"] },
      affinityStacks: { fire: 2, wind: 1 },
    }],
  }),
};

export const CARD_TYPE_ORDER = Object.freeze(["room", "delver", "warden", "hazard", "resource"]);
export const CARD_PROPERTY_GROUP_ORDER = Object.freeze(["type", "affinities", "expressions", "motivations"]);
export const ROOM_SIZE_ORDER = Object.freeze(["small", "medium", "large"]);
const BUDGET_BUCKET_ORDER = Object.freeze(["room", "delver", "warden", "hazard", "resource"]);
const RESOURCE_VITAL_KEYS = Object.freeze(["health", "mana", "stamina"]);
const RESOURCE_VITAL_COST_PER_DELTA = 1;
const RESOURCE_VITAL_COST_PER_REGEN = 2;
const RESOURCE_PERMANENT_MULTIPLIER = 10;
const DEFAULT_BUDGET_SPLIT = Object.freeze({
  room: 44,
  delver: 20,
  warden: 16,
  hazard: 12,
  resource: 8,
});
const DEFAULT_DESIGN_HELP_TEXT = "Configure a card, then shelve it.";
const EXCLUSIVE_PAIR_NOTE = "Choose 1";

// Module-level resource bundle for icon resolution
let moduleResourceBundle = null;

const AFFINITY_DISPLAY_GROUPS = Object.freeze(
  (() => {
    const groups = [];
    const seen = new Set();
    AFFINITY_KINDS.forEach((kind) => {
      if (seen.has(kind)) return;
      const opposite = typeof AFFINITY_OPPOSITES?.[kind] === "string" ? AFFINITY_OPPOSITES[kind] : "";
      if (opposite && AFFINITY_KIND_SET.has(opposite) && !seen.has(opposite) && opposite !== kind) {
        groups.push(Object.freeze({ id: `${kind}_${opposite}`, kinds: Object.freeze([kind, opposite]) }));
        seen.add(kind);
        seen.add(opposite);
        return;
      }
      groups.push(Object.freeze({ id: kind, kinds: Object.freeze([kind]) }));
      seen.add(kind);
    });
    return groups;
  })(),
);

const EXPRESSION_DISPLAY_GROUPS = Object.freeze([
  Object.freeze({ id: "spatial", kinds: Object.freeze(["push", "pull"]) }),
  Object.freeze({ id: "field", kinds: Object.freeze(["emit", "draw"]) }),
]);

function formatDisplayLabel(value, fallback = "") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value
    .trim()
    .split("_")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
}

function iconForType(type) {
  const normalized = normalizeCardType(type);
  if (normalized === "hazard") {
    return resolveIconHTML(moduleResourceBundle, "items", "hazard");
  }
  if (normalized === "resource") {
    return resolveIconHTML(moduleResourceBundle, "items", "resource");
  }
  const key = normalized || "untyped";
  return resolveIconHTML(moduleResourceBundle, "types", key);
}

function iconForAffinity(affinity) {
  const normalized = normalizeAffinity(affinity, "");
  return normalized ? resolveIconHTML(moduleResourceBundle, "affinities", normalized) : "◈";
}

function iconForExpression(expression) {
  const normalized = normalizeExpression(expression, "");
  return normalized ? resolveIconHTML(moduleResourceBundle, "expressions", normalized) : "✦";
}

function iconForMotivation(motivation) {
  const normalized = typeof motivation === "string" ? motivation.trim().toLowerCase() : "";
  return normalized ? resolveIconHTML(moduleResourceBundle, "motivations", normalized) : "❖";
}

function iconForVital(vital) {
  const normalized = typeof vital === "string" ? vital.trim().toLowerCase() : "";
  return normalized ? resolveIconHTML(moduleResourceBundle, "vitals", normalized) : "◈";
}

export function setResourceBundle(bundle) {
  moduleResourceBundle = bundle || null;
}

function readPositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function readOptionalToken(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function readBoundedPercent(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(parsed)));
}

function normalizeBudgetSplit(values = {}) {
  return {
    room: readBoundedPercent(values.room, DEFAULT_BUDGET_SPLIT.room),
    delver: readBoundedPercent(values.delver, DEFAULT_BUDGET_SPLIT.delver),
    warden: readBoundedPercent(values.warden, DEFAULT_BUDGET_SPLIT.warden),
    hazard: readBoundedPercent(values.hazard, DEFAULT_BUDGET_SPLIT.hazard),
    resource: readBoundedPercent(values.resource, DEFAULT_BUDGET_SPLIT.resource),
  };
}

function setStatus(el, message, isError = false) {
  if (!el) return;
  const text = typeof message === "string" ? message.trim() : "";
  el.textContent = text;
  el.hidden = text.length === 0;
  if (el.dataset) {
    el.dataset.level = isError ? "error" : "info";
  }
  el.style.color = "";
}

function normalizeAffinity(value, fallback = DEFAULT_DUNGEON_AFFINITY) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (AFFINITY_KIND_SET.has(normalized)) return normalized;
  }
  return fallback;
}

function normalizeExpression(value, fallback = DEFAULT_AFFINITY_EXPRESSION) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (AFFINITY_EXPRESSION_SET.has(normalized)) return normalized;
  }
  return fallback;
}

function normalizeMotivationList(values, fallback = "defending") {
  return normalizeMotivationKindList(values, {
    fallback,
    fieldBase: "motivations",
  }).value;
}

function normalizeMotivationListAllowEmpty(values) {
  return normalizeMotivationKindList(values, {
    allowEmpty: true,
    fieldBase: "motivations",
  }).value;
}

function findMotivationConflict(currentMotivations = [], nextMotivation = "") {
  const normalizedCurrent = normalizeMotivationListAllowEmpty(currentMotivations);
  const conflicts = new Set(getConflictingMotivationKinds(nextMotivation));
  if (conflicts.size === 0) return "";
  return normalizedCurrent.find((entry) => conflicts.has(entry)) || "";
}

function normalizeExpressionList(values) {
  const list = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? [values]
      : [];
  const seen = new Set();
  const normalized = list
    .map((value) => normalizeExpression(value, ""))
    .filter((value) => value && !seen.has(value) && seen.add(value));
  return normalized.length > 0 ? normalized : [DEFAULT_AFFINITY_EXPRESSION];
}

function normalizeExpressionListAllowEmpty(values) {
  const list = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? [values]
      : [];
  const seen = new Set();
  return list
    .map((value) => normalizeExpression(value, ""))
    .filter((value) => value && !seen.has(value) && seen.add(value));
}

const NEW_CARD_VITAL_DEFAULT = Object.freeze({
  current: 10,
  max: 10,
  regen: 2,
});
const NEW_CARD_VITALS = Object.freeze(
  VITAL_KEYS.reduce((acc, key) => {
    acc[key] = NEW_CARD_VITAL_DEFAULT;
    return acc;
  }, {}),
);
const DEFAULT_ATTACKER_CARD_AFFINITY = "light";
const DEFAULT_DEFENDER_CARD_AFFINITY = "dark";
const DEFAULT_ACTOR_CARD_AFFINITY_EXPRESSION = "emit";
const DEFAULT_HAZARD_AFFINITY_EXPRESSION = "emit";
const DEFAULT_HAZARD_PROXIMITY_RADIUS = 1;

function defaultActorAffinityForType(type) {
  if (type === "delver") return DEFAULT_ATTACKER_CARD_AFFINITY;
  if (type === "warden") return DEFAULT_DEFENDER_CARD_AFFINITY;
  return DEFAULT_DUNGEON_AFFINITY;
}

function cloneVitals(vitals, defaults = DEFAULT_VITALS) {
  return normalizeDomainVitals(vitals, defaults);
}

function resolveActorCardVitals(vitals) {
  if (vitals === undefined) {
    return cloneVitals(undefined, NEW_CARD_VITALS);
  }
  return cloneVitals(vitals);
}

function normalizeHazardVital(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }
  const kind = typeof value.kind === "string" ? value.kind.trim().toLowerCase() : "";
  if (kind === "regen") {
    const current = readNonNegativeInt(value.current, fallback.current);
    const max = Math.max(1, readNonNegativeInt(value.max, fallback.max));
    const regen = readNonNegativeInt(value.regen, fallback.regen);
    return {
      kind: "regen",
      current: Math.min(current, max),
      max,
      regen,
    };
  }
  return {
    kind: "one-time",
    amount: Math.max(1, readNonNegativeInt(value.amount, fallback.amount)),
  };
}

function toggleHazardVital(value, fallback) {
  const normalized = normalizeHazardVital(value, fallback);
  if (normalized.kind === "regen") {
    return { kind: "one-time", amount: Math.max(1, normalized.current || normalized.max || fallback.amount) };
  }
  return {
    kind: "regen",
    current: fallback.current,
    max: fallback.max,
    regen: fallback.regen,
  };
}

const CARD_ID_SUFFIX_LENGTH = 6;
const CARD_ID_PATTERN = /^([A-Z])-([A-Z0-9]{6})$/;
const CARD_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const UUID_HEX_PATTERN = /^[0-9a-f]{32}$/i;
const CARD_ID_MAX_GENERATION_ATTEMPTS = 256;
const GLOBAL_ISSUED_CARD_IDS = new Set();
const CARD_ID_PREFIX_BY_TYPE = Object.freeze({
  room: "R",
  delver: "A",
  warden: "D",
  hazard: "H",
  resource: "G",
  untyped: "C",
});

function cardPrefixForType(type) {
  const normalized = normalizeCardType(type);
  if (normalized === "room") return CARD_ID_PREFIX_BY_TYPE.room;
  if (normalized === "delver") return CARD_ID_PREFIX_BY_TYPE.delver;
  if (normalized === "warden") return CARD_ID_PREFIX_BY_TYPE.warden;
  if (normalized === "hazard") return CARD_ID_PREFIX_BY_TYPE.hazard;
  if (normalized === "resource") return CARD_ID_PREFIX_BY_TYPE.resource;
  return CARD_ID_PREFIX_BY_TYPE.untyped;
}

function parseGeneratedCardId(cardId) {
  if (typeof cardId !== "string") return null;
  const trimmed = cardId.trim().toUpperCase();
  const match = trimmed.match(CARD_ID_PATTERN);
  if (!match) return null;
  return {
    prefix: match[1],
    suffix: match[2],
  };
}

function parseUuidBytes(uuidValue) {
  if (typeof uuidValue !== "string") return null;
  const hex = uuidValue.replace(/-/g, "");
  if (!UUID_HEX_PATTERN.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const start = index * 2;
    bytes[index] = Number.parseInt(hex.slice(start, start + 2), 16);
  }
  return bytes;
}

function fillRandomBytes(buffer) {
  if (!(buffer instanceof Uint8Array) || buffer.length === 0) {
    return false;
  }
  const cryptoApi = globalThis?.crypto;
  if (!cryptoApi) return false;

  if (typeof cryptoApi.randomUUID === "function") {
    let offset = 0;
    while (offset < buffer.length) {
      const uuidBytes = parseUuidBytes(cryptoApi.randomUUID());
      if (!uuidBytes) break;
      const chunkLength = Math.min(uuidBytes.length, buffer.length - offset);
      buffer.set(uuidBytes.subarray(0, chunkLength), offset);
      offset += chunkLength;
    }
    if (offset === buffer.length) return true;
  }

  if (typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(buffer);
    return true;
  }
  return false;
}

function generateRandomCardSuffix(length = CARD_ID_SUFFIX_LENGTH) {
  const targetLength = Math.max(1, Math.trunc(length));
  const alphabetLength = CARD_ID_ALPHABET.length;
  const acceptanceLimit = Math.floor(256 / alphabetLength) * alphabetLength;
  let suffix = "";

  while (suffix.length < targetLength) {
    const bytes = new Uint8Array(Math.max(16, targetLength - suffix.length));
    const secure = fillRandomBytes(bytes);
    if (!secure) return "";
    for (let i = 0; i < bytes.length && suffix.length < targetLength; i += 1) {
      const value = bytes[i];
      if (value >= acceptanceLimit) continue;
      suffix += CARD_ID_ALPHABET[value % alphabetLength];
    }
  }

  return suffix;
}

function buildCardId(type = "untyped") {
  const prefix = cardPrefixForType(type);
  for (let attempt = 0; attempt < CARD_ID_MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const suffix = generateRandomCardSuffix(CARD_ID_SUFFIX_LENGTH);
    if (suffix.length !== CARD_ID_SUFFIX_LENGTH) continue;
    const candidate = `${prefix}-${suffix}`;
    if (GLOBAL_ISSUED_CARD_IDS.has(candidate)) continue;
    GLOBAL_ISSUED_CARD_IDS.add(candidate);
    return candidate;
  }

  throw new Error("Unable to generate secure unique card identifier. Web Crypto API unavailable or exhausted.");
}

function buildAffinityEntries({ affinity, expressions, stacksByAffinity } = {}) {
  const normalizedAffinity = normalizeAffinity(affinity);
  const normalizedExpressions = normalizeExpressionList(expressions);
  const resolvedStacks = readPositiveInt(stacksByAffinity?.[normalizedAffinity], 1) || 1;
  return normalizedExpressions.map((expression) => ({
    kind: normalizedAffinity,
    expression,
    stacks: resolvedStacks,
  }));
}

function createBlankCard({ id, affinity, count, flipped, tokenHint } = {}) {
  return {
    id: typeof id === "string" && id.trim() ? id.trim() : buildCardId("untyped"),
    type: "",
    source: "manual",
    count: normalizeCardCount(count, 1),
    affinity: normalizeAffinity(affinity),
    affinities: [],
    expressions: [],
    motivations: [],
    setupMode: "hybrid",
    roomSize: undefined,
    tokenHint: readOptionalToken(tokenHint),
    vitals: undefined,
    mana: undefined,
    durability: undefined,
    flipped: flipped === true,
  };
}

function normalizeResourceVital(value) {
  if (!value || typeof value !== "object") return { delta: 0, regen: 0 };
  const delta = Math.max(0, readNonNegativeInt(value.delta, 0));
  const regen = Math.max(0, readNonNegativeInt(value.regen, 0));
  return { delta, regen };
}

function normalizeResourceVitals(vitals) {
  const result = {};
  RESOURCE_VITAL_KEYS.forEach((key) => {
    result[key] = normalizeResourceVital(vitals?.[key]);
  });
  return result;
}

function normalizeSignedInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function stableSortAffinities(entries = []) {
  if (!Array.isArray(entries)) return [];
  const merged = new Map();
  entries.forEach((entry) => {
      const kind = normalizeAffinity(entry?.kind, "");
      const expression = normalizeExpression(entry?.expression, "");
      if (!kind || !expression) return;
      const key = `${kind}:${expression}`;
      const stacks = normalizeCardCount(entry?.stacks, 1);
      const existing = merged.get(key);
      if (existing) {
        existing.stacks += stacks;
        return;
      }
      merged.set(key, { kind, expression, stacks, trapVitals: entry?.trapVitals });
    });
  return Array.from(merged.values())
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.expression.localeCompare(b.expression) || a.stacks - b.stacks);
}

function stableCardForSerialize(card) {
  const next = {
    id: card.id,
    type: card.type,
    count: card.count,
    affinity: card.affinity,
    roomSize: card.roomSize,
    setupMode: card.setupMode,
    affinities: stableSortAffinities(card.affinities),
    expressions: normalizeExpressionListAllowEmpty(card.expressions),
    motivations: Array.isArray(card.motivations) ? card.motivations.slice().sort() : [],
    vitals: card.vitals ? cloneVitals(card.vitals) : undefined,
    tokenHint: readOptionalToken(card.tokenHint),
    mana: card.mana ? normalizeHazardVital(card.mana, { kind: "one-time", amount: 3 }) : undefined,
    durability: card.durability ? normalizeHazardVital(card.durability, { kind: "one-time", amount: 1 }) : undefined,
    tier: card.tier,
    stat: card.stat,
    delta: Number.isFinite(card.delta) ? Math.trunc(card.delta) : undefined,
    dropRate: readOptionalToken(card.dropRate),
    budgetCeiling: readOptionalToken(card.budgetCeiling),
    source: card.source,
    flipped: card.flipped === true,
  };
  return next;
}

export function createDesignCard({
  id,
  type = "",
  affinity,
  roomSize = "medium",
  count = 1,
  expressions,
  motivations,
  affinities,
  vitals,
  source = "manual",
  setupMode = "hybrid",
  flipped = false,
  tokenHint,
  mana,
  durability,
  resourceVitals,
  permanent = false,
  budgetCeiling,
  tier,
  stat,
  delta,
  dropRate,
  preserveEmptyAffinities = false,
} = {}) {
  const normalizedType = normalizeCardType(type);
  const actorAffinityFallback = defaultActorAffinityForType(normalizedType);
  const affinityFallback = normalizedType === "room"
    ? DEFAULT_ROOM_CARD_AFFINITY
    : actorAffinityFallback;
  const normalizedAffinityInput = normalizeAffinity(affinity, affinityFallback);
  if (!normalizedType) {
    return createBlankCard({ id, affinity: normalizedAffinityInput, count, flipped, tokenHint });
  }
  if (normalizedType === "hazard") {
    const hazardAffinity = normalizeAffinity(normalizedAffinityInput, DEFAULT_DUNGEON_AFFINITY);
    const hazardExpression = normalizeExpression(
      Array.isArray(affinities) && affinities.length > 0
        ? affinities[0]?.expression
        : Array.isArray(expressions)
          ? expressions[0]
          : expressions,
      DEFAULT_HAZARD_AFFINITY_EXPRESSION,
    );
    return {
      id: typeof id === "string" && id.trim() ? id.trim() : buildCardId("hazard"),
      type: "hazard",
      source: "hazard",
      count: normalizeCardCount(count, 1),
      affinity: hazardAffinity,
      affinities: [{ kind: hazardAffinity, expression: hazardExpression, stacks: 1 }],
      expressions: [hazardExpression],
      motivations: [],
      setupMode: "hybrid",
      roomSize: undefined,
      tokenHint: readOptionalToken(tokenHint),
      vitals: undefined,
      mana: normalizeHazardVital(mana, { kind: "regen", current: 3, max: 3, regen: 1 }),
      durability: normalizeHazardVital(durability, { kind: "regen", current: 5, max: 5, regen: 0 }),
      flipped: flipped === true,
    };
  }
  if (normalizedType === "resource") {
    const resourceAffinity = normalizeAffinity(normalizedAffinityInput, DEFAULT_DUNGEON_AFFINITY);
    const resourceExpression = normalizeExpression(
      Array.isArray(affinities) && affinities.length > 0
        ? affinities[0]?.expression
        : Array.isArray(expressions)
          ? expressions[0]
          : expressions,
      DEFAULT_AFFINITY_EXPRESSION,
    );
    return {
      id: typeof id === "string" && id.trim() ? id.trim() : buildCardId("resource"),
      type: "resource",
      source: "resource",
      count: normalizeCardCount(count, 1),
      affinity: resourceAffinity,
      affinities: [{ kind: resourceAffinity, expression: resourceExpression, stacks: 1 }],
      expressions: [resourceExpression],
      motivations: [],
      setupMode: "hybrid",
      roomSize: undefined,
      tokenHint: readOptionalToken(tokenHint),
      vitals: undefined,
      resourceVitals: normalizeResourceVitals(resourceVitals),
      permanent: permanent === true,
      tier: tier !== undefined ? tier : undefined,
      stat: stat !== undefined ? stat : undefined,
      delta: delta !== undefined ? Number(delta) : undefined,
      dropRate: dropRate !== undefined ? Number(dropRate) : undefined,
      budgetCeiling: readOptionalToken(budgetCeiling),
      flipped: flipped === true,
    };
  }
  const hasExplicitAffinitiesInput = Array.isArray(affinities);
  const hasExplicitExpressionsInput = Array.isArray(expressions) || typeof expressions === "string";
  const normalizedInputAffinities = hasExplicitAffinitiesInput ? stableSortAffinities(affinities) : undefined;
  const normalizedInputMotivations = normalizeMotivationListAllowEmpty(motivations);
  const normalizedVitals = resolveActorCardVitals(vitals);
  const normalizedInputExpressions = hasExplicitExpressionsInput
    ? normalizeExpressionList(expressions)
    : normalizedType === "room"
      ? [DEFAULT_ROOM_AFFINITY_EXPRESSION]
      : [DEFAULT_ACTOR_CARD_AFFINITY_EXPRESSION];
  const injectedDefaultActorAffinities = normalizedType !== "room"
    && !hasExplicitAffinitiesInput
    && !hasExplicitExpressionsInput
    ? [{
      kind: normalizedAffinityInput,
      expression: DEFAULT_ACTOR_CARD_AFFINITY_EXPRESSION,
      stacks: 1,
    }]
    : undefined;
  const hasExplicitEmptyAffinities = preserveEmptyAffinities === true
    && Array.isArray(affinities)
    && normalizedInputAffinities.length === 0;
  const hasExplicitEmptyMotivations = Array.isArray(motivations) && normalizedInputMotivations.length === 0;
  const normalizedCard = normalizeCardEntry({
    id: typeof id === "string" && id.trim() ? id.trim() : buildCardId(normalizedType || "untyped"),
    type: normalizedType || "warden",
    source: normalizedType === "room" ? "room" : "actor",
    affinity: normalizedAffinityInput,
    roomSize: normalizeRoomCardSize(roomSize),
    count: normalizeCardCount(count, 1),
    expressions: normalizedInputExpressions,
    motivations: hasExplicitEmptyMotivations
      ? []
      : normalizeMotivationList(
        motivations,
        normalizedType === "delver" ? "attacking" : "defending",
      ),
    affinities: normalizedInputAffinities ?? injectedDefaultActorAffinities,
    vitals: normalizedVitals,
    setupMode,
    tokenHint,
    flipped: flipped === true,
  }, {
    dungeonAffinity: normalizedAffinityInput,
  });

  if (normalizedType === "room") {
    normalizedCard.type = "room";
    normalizedCard.source = "room";
    normalizedCard.roomSize = normalizeRoomCardSize(roomSize);
    normalizedCard.motivations = [];
    normalizedCard.vitals = undefined;
    normalizedCard.affinities = [];
    normalizedCard.expressions = [];
    return normalizedCard;
  }

  const fallbackMotivation = normalizedType === "delver" ? "attacking" : "defending";
  normalizedCard.type = normalizedType || "warden";
  normalizedCard.source = "actor";
  normalizedCard.roomSize = undefined;
  normalizedCard.vitals = resolveActorCardVitals(normalizedCard.vitals);
  normalizedCard.motivations = hasExplicitEmptyMotivations
    ? []
    : normalizeMotivationList(normalizedCard.motivations, fallbackMotivation);
  if (hasExplicitEmptyAffinities) {
    normalizedCard.affinities = [];
    normalizedCard.expressions = [];
    return normalizedCard;
  }

  if (!hasExplicitEmptyAffinities && (!Array.isArray(normalizedCard.affinities) || normalizedCard.affinities.length === 0)) {
    normalizedCard.affinities = buildAffinityEntries({
      affinity: normalizedCard.affinity,
      expressions: normalizedCard.expressions,
    });
  }
  normalizedCard.expressions = hasExplicitEmptyAffinities
    ? []
    : normalizeExpressionListAllowEmpty(
    normalizedCard.affinities.map((entry) => entry.expression),
    );
  return normalizedCard;
}

export function normalizeDesignCardSet(cards, { dungeonAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const rawCards = Array.isArray(cards) ? cards : [];
  const seen = new Set();
  return rawCards
    .map((entry, index) => {
      const normalizedType = normalizeCardType(entry?.type);
      if (!normalizedType) {
        return createBlankCard({
          id: entry?.id || buildCardId("untyped"),
          affinity: entry?.affinity || dungeonAffinity,
          count: entry?.count,
          flipped: entry?.flipped,
          tokenHint: entry?.tokenHint,
        });
      }
      return createDesignCard({
        ...normalizeCardEntry(entry, { dungeonAffinity, index }),
        id: entry?.id || buildCardId(normalizedType),
        type: normalizedType,
        count: normalizeCardCount(entry?.count, 1),
        affinity: entry?.affinity,
        roomSize: normalizeRoomCardSize(entry?.roomSize || entry?.size),
        expressions: entry?.expressions,
        motivations: entry?.motivations,
        affinities: entry?.affinities,
        vitals: entry?.vitals,
        resourceVitals: entry?.resourceVitals,
        permanent: entry?.permanent,
        source: entry?.source,
        setupMode: entry?.setupMode,
        flipped: entry?.flipped,
        tokenHint: entry?.tokenHint,
        mana: entry?.mana,
        durability: entry?.durability,
        tier: entry?.tier,
        stat: entry?.stat,
        delta: entry?.delta,
        dropRate: entry?.dropRate,
        budgetCeiling: entry?.budgetCeiling,
        preserveEmptyAffinities: Array.isArray(entry?.affinities) && entry.affinities.length === 0,
      });
    })
    .filter((card) => {
      if (!card || !card.id) return false;
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return true;
    });
}

export function serializeDesignCardSet(cards, options = {}) {
  const normalized = normalizeDesignCardSet(cards, options);
  const serialized = normalized
    .map((card) => stableCardForSerialize(card))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(serialized, null, 2);
}

export function buildCardsFromSummary(summary, { dungeonAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const cards = buildCardSetFromSummary(summary || {});
  return normalizeDesignCardSet(cards, { dungeonAffinity });
}

export function groupCardsByType(cards = []) {
  const grouped = {
    room: [],
    delver: [],
    warden: [],
    hazard: [],
    resource: [],
    untyped: [],
  };
  normalizeDesignCardSet(cards).forEach((card) => {
    const type = normalizeCardType(card?.type);
    if (!type) {
      grouped.untyped.push(card);
      return;
    }
    grouped[type].push(card);
  });
  return grouped;
}

function replaceCardType(card, typeValue) {
  const type = normalizeCardType(typeValue);
  if (!type) {
    return { ok: false, reason: "invalid_type", card };
  }
  const priorType = normalizeCardType(card?.type);
  const applyActorDefaults = (type === "delver" || type === "warden") && (!priorType || priorType === "room" || priorType === "hazard");
  const next = createDesignCard({
    ...card,
    type,
    source: type === "room" ? "room" : type === "hazard" ? "hazard" : type === "resource" ? "resource" : "actor",
    affinity: applyActorDefaults ? undefined : card?.affinity,
    affinities: type === "room" || applyActorDefaults ? undefined : card?.affinities,
    expressions: type === "room" || applyActorDefaults ? undefined : card?.expressions,
    motivations: type === "room" || type === "hazard" || type === "resource"
      ? []
      : normalizeMotivationList(card?.motivations, type === "delver" ? "attacking" : "defending"),
    vitals: type === "room" || type === "hazard" || type === "resource" ? undefined : card?.vitals,
    roomSize: type === "room" ? card?.roomSize || "medium" : undefined,
    mana: type === "hazard" ? card?.mana : undefined,
    durability: type === "hazard" ? card?.durability : undefined,
  });
  return { ok: true, card: next, reason: "type_updated" };
}

function applyAffinityDrop(card, affinityValue) {
  const type = normalizeCardType(card?.type);
  if (!type) {
    return { ok: false, reason: "missing_type", card };
  }
  const affinity = normalizeAffinity(affinityValue, "");
  if (!affinity) {
    return { ok: false, reason: "invalid_affinity", card };
  }

  const working = createDesignCard(card);
  if (type === "hazard") {
    const expression = normalizeExpression(working.expressions?.[0], DEFAULT_HAZARD_AFFINITY_EXPRESSION);
    return {
      ok: true,
      reason: "affinity_selected",
      card: createDesignCard({
        ...working,
        affinity,
        affinities: [{ kind: affinity, expression, stacks: 1 }],
        expressions: [expression],
      }),
    };
  }
  const matching = Array.isArray(working.affinities)
    ? working.affinities.filter((entry) => entry.kind === affinity)
    : [];

  if (matching.length > 0) {
    const filtered = working.affinities.filter((entry) => entry.kind !== affinity);
    working.affinities = stableSortAffinities(filtered);
    working.affinity = working.affinities[0]?.kind || normalizeAffinity(working.affinity, DEFAULT_DUNGEON_AFFINITY);
    working.expressions = normalizeExpressionListAllowEmpty(working.affinities.map((entry) => entry.expression));
    return {
      ok: true,
      reason: "affinity_removed",
      card: createDesignCard({ ...working, preserveEmptyAffinities: true }),
    };
  }

  const expression = normalizeExpression(working.expressions?.[0], DEFAULT_AFFINITY_EXPRESSION);
  const appended = [
    ...(Array.isArray(working.affinities) ? working.affinities : []),
    { kind: affinity, expression, stacks: 1 },
  ];
  working.affinities = stableSortAffinities(appended);
  working.affinity = affinity;
  working.expressions = normalizeExpressionListAllowEmpty(working.affinities.map((entry) => entry.expression));
  return { ok: true, reason: "affinity_added", card: createDesignCard(working) };
}

function resolveExpressionAffinityTarget(card, affinityKind) {
  const affinities = Array.isArray(card?.affinities) ? card.affinities : [];
  if (affinities.length === 0) return "";
  const explicit = normalizeAffinity(affinityKind, "");
  if (explicit && affinities.some((entry) => entry.kind === explicit)) {
    return explicit;
  }
  const active = normalizeAffinity(card?.affinity, "");
  if (active && affinities.some((entry) => entry.kind === active)) {
    return active;
  }
  return affinities[0]?.kind || "";
}

function applyExpressionDrop(card, expressionValue, { affinityKind, sourceExpression, mode = "add" } = {}) {
  const type = normalizeCardType(card?.type);
  if (!type) {
    return { ok: false, reason: "invalid_card_type", card };
  }
  const expression = normalizeExpression(expressionValue, "");
  if (!expression) {
    return { ok: false, reason: "invalid_expression", card };
  }

  const working = createDesignCard(card);
  if (!Array.isArray(working.affinities) || working.affinities.length === 0) {
    return { ok: false, reason: "missing_affinity", card: working };
  }
  const targetKind = resolveExpressionAffinityTarget(working, affinityKind);
  if (!targetKind) {
    return { ok: false, reason: "missing_affinity", card: working };
  }
  const affinityEntries = Array.isArray(working.affinities) ? working.affinities : [];
  if (type === "hazard") {
    working.affinities = [{ kind: targetKind, expression, stacks: 1 }];
    working.affinity = targetKind;
    working.expressions = [expression];
    return {
      ok: true,
      reason: "expression_updated",
      card: createDesignCard(working),
    };
  }

  if (mode === "replace") {
    const source = normalizeExpression(sourceExpression, "");
    if (!source) {
      return { ok: false, reason: "missing_expression_source", card: working };
    }
    const sourceIndex = affinityEntries.findIndex((entry) => entry.kind === targetKind && entry.expression === source);
    if (sourceIndex < 0) {
      return { ok: false, reason: "missing_affinity_expression", card: working };
    }
    if (source === expression) {
      return { ok: true, reason: "expression_unchanged", card: createDesignCard(working) };
    }
    const sourceEntry = affinityEntries[sourceIndex];
    const mergedEntries = affinityEntries
      .filter((_, idx) => idx !== sourceIndex)
      .concat({ ...sourceEntry, expression });
    working.affinities = stableSortAffinities(mergedEntries);
    working.affinity = targetKind;
    working.expressions = normalizeExpressionListAllowEmpty(working.affinities.map((entry) => entry.expression));
    return {
      ok: true,
      reason: "expression_updated",
      card: createDesignCard(working),
    };
  }

  const existing = affinityEntries.find((entry) => entry.kind === targetKind && entry.expression === expression);
  if (existing) {
    return { ok: true, reason: "expression_exists", card: createDesignCard(working) };
  }

  working.affinities = stableSortAffinities([
    ...affinityEntries,
    { kind: targetKind, expression, stacks: 1 },
  ]);
  working.affinity = targetKind;
  working.expressions = normalizeExpressionListAllowEmpty(working.affinities.map((entry) => entry.expression));

  return {
    ok: true,
    reason: "expression_added",
    card: createDesignCard(working),
  };
}

function applyMotivationDrop(card, motivationValue) {
  const type = normalizeCardType(card?.type);
  if (type !== "delver" && type !== "warden") {
    return { ok: false, reason: "invalid_card_type", card };
  }
  const motivation = normalizeMotivationList([motivationValue], "")[0];
  if (!motivation) {
    return { ok: false, reason: "invalid_motivation", card };
  }
  const working = createDesignCard(card);
  const current = normalizeMotivationListAllowEmpty(working.motivations);
  const exists = current.includes(motivation);
  const conflictsWith = exists ? "" : findMotivationConflict(current, motivation);
  if (conflictsWith) {
    return {
      ok: false,
      reason: "motivation_conflict",
      conflictsWith,
      attempted: motivation,
      card: working,
    };
  }
  const next = exists
    ? current.filter((value) => value !== motivation)
    : [...current, motivation];
  working.motivations = next;

  return {
    ok: true,
    reason: exists ? "motivation_removed" : "motivation_added",
    card: createDesignCard(working),
  };
}

export function dropPropertyOnCard(card, property) {
  const working = createDesignCard(card || {});
  const group = typeof property?.group === "string" ? property.group.trim().toLowerCase() : "";
  const value = typeof property?.value === "string" ? property.value.trim().toLowerCase() : "";

  if (!group || !value) {
    return { ok: false, reason: "invalid_property", card: working };
  }

  if (group === "type") {
    return replaceCardType(working, value);
  }
  if (group === "affinities") {
    return applyAffinityDrop(working, value);
  }
  if (group === "expressions") {
    return applyExpressionDrop(working, value, {
      affinityKind: property?.affinityKind || property?.targetAffinity,
    });
  }
  if (group === "motivations") {
    return applyMotivationDrop(working, value);
  }

  return { ok: false, reason: "unsupported_group", card: working };
}

export function adjustCardCount(card, delta = 0) {
  const working = createDesignCard(card || {});
  const nextCount = Math.max(1, normalizeCardCount(working.count, 1) + Math.trunc(delta));
  working.count = nextCount;
  return createDesignCard(working);
}

export function adjustAffinityStack(card, affinityKind, delta = 0, expressionValue = undefined) {
  const working = createDesignCard(card || {});
  if (!normalizeCardType(working.type)) return working;
  if (!Array.isArray(working.affinities) || working.affinities.length === 0) return working;
  const targetKind = resolveExpressionAffinityTarget(working, affinityKind);
  if (!targetKind) return working;
  const amount = Math.trunc(delta);
  if (amount === 0) return createDesignCard(working);

  let updated = false;
  const targetExpression = normalizeExpression(expressionValue, "");
  working.affinities = stableSortAffinities(
    working.affinities
      .map((entry) => {
        if (entry.kind !== targetKind) return entry;
        if (targetExpression && entry.expression !== targetExpression) return entry;
        updated = true;
        const nextStacks = normalizeCardCount(entry.stacks, 1) + amount;
        if (nextStacks <= 0) {
          return null;
        }
        return { ...entry, stacks: nextStacks };
      })
      .filter(Boolean),
  );
  if (!updated) return working;
  working.affinity = working.affinities.find((entry) => entry.kind === targetKind)?.kind
    || working.affinities[0]?.kind
    || normalizeAffinity(working.affinity, DEFAULT_DUNGEON_AFFINITY);
  working.expressions = normalizeExpressionListAllowEmpty(working.affinities.map((entry) => entry.expression));
  return createDesignCard({
    ...working,
    preserveEmptyAffinities: true,
  });
}

export function adjustCardVital(card, vitalKey, field, delta = 0) {
  const working = createDesignCard(card || {});
  const type = normalizeCardType(working.type);
  if (type !== "delver" && type !== "warden") return working;
  if (!VITAL_KEYS.includes(vitalKey)) return working;
  if (field !== "max" && field !== "regen") return working;
  const amount = Math.trunc(delta);
  if (amount === 0) return createDesignCard(working);

  const vitals = cloneVitals(working.vitals);
  const currentValue = readNonNegativeInt(vitals?.[vitalKey]?.[field], 0);
  const nextValue = Math.max(0, currentValue + amount);
  const currentVital = vitals[vitalKey] || { current: 0, max: 0, regen: 0 };
  vitals[vitalKey] = {
    ...currentVital,
    [field]: nextValue,
  };
  if (field === "max") {
    const nextCurrent = readNonNegativeInt(vitals[vitalKey].current, 0);
    if (nextCurrent > nextValue) {
      vitals[vitalKey].current = nextValue;
    }
  }

  return createDesignCard({
    ...working,
    vitals,
  });
}

export function adjustTrapManaVital(card, affinityKind, field, delta = 0) {
  const working = createDesignCard(card || {});
  if (working.type !== "room") return working;
  if (field !== "max" && field !== "regen") return working;
  const amount = Math.trunc(delta);
  if (amount === 0) return createDesignCard(working);
  const affinities = Array.isArray(working.affinities) ? working.affinities : [];
  const index = affinities.findIndex((e) => e.kind === affinityKind);
  if (index < 0) return createDesignCard(working);
  const entry = { ...affinities[index] };
  const tv = entry.trapVitals && typeof entry.trapVitals === "object"
    ? { ...entry.trapVitals }
    : {};
  const mana = tv.mana && typeof tv.mana === "object"
    ? { ...tv.mana }
    : { current: 0, max: 0, regen: 0 };
  const current = Number.isFinite(mana[field]) ? Math.floor(mana[field]) : 0;
  mana[field] = Math.max(0, current + amount);
  if (field === "max") {
    mana.current = Math.min(mana.current, mana.max);
  }
  tv.mana = mana;
  entry.trapVitals = tv;
  const nextAffinities = affinities.slice();
  nextAffinities[index] = entry;
  return createDesignCard({ ...working, affinities: nextAffinities });
}

export function cycleRoomCardSize(card, direction = 1) {
  const working = createDesignCard(card || {});
  if (working.type !== "room") return working;
  const currentSize = normalizeRoomCardSize(working.roomSize);
  const index = ROOM_SIZE_ORDER.indexOf(currentSize);
  const nextIndex = (index + Math.trunc(direction) + ROOM_SIZE_ORDER.length) % ROOM_SIZE_ORDER.length;
  working.roomSize = ROOM_SIZE_ORDER[nextIndex];
  return createDesignCard(working);
}

function buildCardReceipt(card, { unitTokens, totalTokens, lineItems: inputLineItems } = {}) {
  const affinities = Array.isArray(card?.affinities)
    ? card.affinities.map((entry) => `${entry.kind}:${entry.expression}x${entry.stacks}`)
    : [];
  const vitals = card?.vitals && typeof card.vitals === "object"
    ? VITAL_KEYS.reduce((acc, key) => {
      const max = readPositiveInt(card.vitals?.[key]?.max, 0);
      const regen = readPositiveInt(card.vitals?.[key]?.regen, 0);
      if (max > 0 || regen > 0) {
        acc.push(`${key} max ${max} regen ${regen}`);
      }
      return acc;
    }, [])
    : [];
  const multiplier = normalizeCardCount(card?.count, 1);
  const rawLineItems = Array.isArray(inputLineItems) ? inputLineItems : [];
  const lineItems = rawLineItems
    .map((item, index) => {
      const label = typeof item?.label === "string" && item.label.trim()
        ? item.label.trim()
        : typeof item?.id === "string" && item.id.trim()
          ? item.id.trim()
          : `item_${index + 1}`;
      const unitCostTokens = readPositiveInt(
        item?.unitCostTokens,
        readPositiveInt(item?.spendTokens, 0),
      );
      const quantity = readPositiveInt(item?.quantity, 1) || 1;
      const unitLineTotal = readPositiveInt(
        item?.spendTokens,
        unitCostTokens * quantity,
      );
      return {
        id: typeof item?.id === "string" ? item.id : `item_${index + 1}`,
        label,
        quantity,
        unitCostTokens,
        unitTokens: unitLineTotal,
        totalTokens: unitLineTotal * multiplier,
      };
    })
    .filter((item) => item.totalTokens > 0);
  const lineUnitTotal = lineItems.reduce((sum, item) => sum + item.unitTokens, 0);
  const normalizedUnitTokens = readPositiveInt(unitTokens, 0);
  if (normalizedUnitTokens > lineUnitTotal) {
    const remainder = normalizedUnitTokens - lineUnitTotal;
    lineItems.push({
      id: "unitemized",
      label: "unitemized",
      quantity: 1,
      unitCostTokens: remainder,
      unitTokens: remainder,
      totalTokens: remainder * multiplier,
    });
  }

  return {
    cardId: card?.id,
    type: card?.type,
    count: card?.count,
    affinities,
    expressions: normalizeExpressionListAllowEmpty(card?.expressions),
    motivations: Array.isArray(card?.motivations) ? card.motivations.slice() : [],
    vitals,
    lineItems,
    tokenTotals: {
      unit: readPositiveInt(unitTokens, 0),
      total: readPositiveInt(totalTokens, 0),
    },
  };
}

function calculateRoomCardUnitValue(card, { tileCosts, priceList } = {}) {
  // Accept both canonical PriceListItemLegacyV1 (`unitCost`) and legacy PriceListItemTokenV1
  // (`costTokens`) shapes via normalizePriceItems (BUG-2 fix).
  const priceMap = new Map(
    Array.from(normalizePriceItems(priceList))
      .filter(([key]) => typeof key === "string" && key.includes(":") && !key.startsWith("legacy:"))
      .map(([key, entry]) => [key, entry.unitCost]),
  );
  const spend = evaluateRoomCardLayoutSpend({
    cardSet: [{ ...card, count: 1, type: "room" }],
    budgetTokens: undefined,
    priceList,
    tileCosts,
  });
  const layoutLineItems = Array.isArray(spend?.lineItems)
    ? spend.lineItems.map((item) => ({
      id: item.id,
      label: item.label || formatDisplayLabel(item.id, item.id),
      quantity: readPositiveInt(item.quantity, 1),
      unitCostTokens: readPositiveInt(item.unitCostTokens, 0),
      spendTokens: readPositiveInt(item.spendTokens, 0),
    }))
    : [];
  const affinityCost = calculateActorConfigurationUnitCost({
    entry: {
      affinities: card?.affinities,
    },
    priceMap,
    pricing: {
      affinityCostScale: ROOM_AFFINITY_STACK_COST_FACTOR,
    },
  });
  const affinityLineItems = Array.isArray(affinityCost?.detail?.lineItems)
    ? affinityCost.detail.lineItems.map((item, index) => ({
      id: typeof item?.id === "string" ? item.id : `room_affinity_${index + 1}`,
      label: typeof item?.label === "string" ? item.label : `room affinity ${index + 1}`,
      quantity: readPositiveInt(item?.quantity, 1),
      unitCostTokens: readPositiveInt(item?.unitCostTokens, 0),
      spendTokens: readPositiveInt(item?.spendTokens, 0),
    }))
    : [];
  return {
    unitTokens: readPositiveInt(spend?.spentTokens, 0) + readPositiveInt(affinityCost?.cost, 0),
    lineItems: [...layoutLineItems, ...affinityLineItems],
  };
}

function calculateActorCardUnitValue(card, { priceList } = {}) {
  // Accept both canonical PriceListItemLegacyV1 (`unitCost`) and legacy PriceListItemTokenV1
  // (`costTokens`) shapes via normalizePriceItems (BUG-2 fix).
  const priceMap = new Map(
    Array.from(normalizePriceItems(priceList))
      .filter(([key]) => typeof key === "string" && key.includes(":") && !key.startsWith("legacy:"))
      .map(([key, entry]) => [key, entry.unitCost]),
  );
  const cost = calculateActorConfigurationUnitCost({
    entry: {
      affinities: card?.affinities,
      vitals: card?.vitals,
    },
    priceMap,
  });
  const lineItems = Array.isArray(cost?.detail?.lineItems)
    ? cost.detail.lineItems.map((item, index) => ({
      id: typeof item?.id === "string" ? item.id : `actor_item_${index + 1}`,
      label: typeof item?.label === "string" ? item.label : `actor item ${index + 1}`,
      quantity: readPositiveInt(item?.quantity, 1),
      unitCostTokens: readPositiveInt(item?.unitCostTokens, 0),
      spendTokens: readPositiveInt(item?.spendTokens, 0),
    }))
    : [];
  const tokenHint = readPositiveInt(card?.tokenHint, 0);
  if (tokenHint > 0) {
    lineItems.push({
      id: "token_hint",
      label: "token hint",
      quantity: 1,
      unitCostTokens: tokenHint,
      spendTokens: tokenHint,
    });
  }
  return {
    unitTokens: readPositiveInt(cost?.cost, 0) + tokenHint,
    lineItems,
  };
}

export function calculateCardValue(card, { tileCosts, priceList } = {}) {
  const normalized = createDesignCard(card || {});
  const type = normalizeCardType(normalized.type);
  if (!type) {
    return { unitTokens: 0, totalTokens: 0, lineItems: [] };
  }
  if (type === "hazard") {
    const budgetCeiling = readPositiveInt(normalized.tokenHint, 0);
    const unitTokens = budgetCeiling;
    const totalTokens = unitTokens * normalizeCardCount(normalized.count, 1);
    const lineItems = budgetCeiling > 0
      ? [{
        id: "hazard_budget_ceiling",
        label: "budget ceiling",
        quantity: 1,
        unitCostTokens: budgetCeiling,
        spendTokens: budgetCeiling,
      }]
      : [];
    return { unitTokens, totalTokens, lineItems };
  }
  if (type === "resource") {
    const vitalsObj = normalized.resourceVitals || {};
    const multiplier = normalized.permanent ? RESOURCE_PERMANENT_MULTIPLIER : 1;
    const lineItems = [];
    let baseCost = 0;
    RESOURCE_VITAL_KEYS.forEach((k) => {
      const vd = vitalsObj[k] || { delta: 0, regen: 0 };
      if (vd.delta > 0) {
        const cost = vd.delta * RESOURCE_VITAL_COST_PER_DELTA * multiplier;
        baseCost += cost;
        lineItems.push({ id: `resource_${k}_delta`, label: `${k}:max`, quantity: 1, unitCostTokens: cost, spendTokens: cost });
      }
      if (vd.regen > 0) {
        const cost = vd.regen * RESOURCE_VITAL_COST_PER_REGEN * multiplier;
        baseCost += cost;
        lineItems.push({ id: `resource_${k}_regen`, label: `${k}:regen`, quantity: 1, unitCostTokens: cost, spendTokens: cost });
      }
    });
    const budgetCeiling = readPositiveInt(normalized.budgetCeiling, 0);
    if (budgetCeiling > 0) {
      lineItems.push({ id: "resource_budget_ceiling", label: "budget ceiling", quantity: 1, unitCostTokens: budgetCeiling, spendTokens: budgetCeiling });
    }
    const unitTokens = budgetCeiling > 0 ? budgetCeiling : baseCost;
    const totalTokens = unitTokens * normalizeCardCount(normalized.count, 1);
    return { unitTokens, totalTokens, lineItems };
  }
  const unitValue = type === "room"
    ? calculateRoomCardUnitValue(normalized, { tileCosts, priceList })
    : calculateActorCardUnitValue(normalized, { priceList });
  const unitTokens = readPositiveInt(unitValue?.unitTokens, 0);
  const totalTokens = unitTokens * normalizeCardCount(normalized.count, 1);
  return {
    unitTokens,
    totalTokens,
    lineItems: Array.isArray(unitValue?.lineItems) ? unitValue.lineItems : [],
  };
}

function enrichCardsWithBudget(cards, { budgetTokens, tileCosts, priceList } = {}) {
  const normalizedCards = normalizeDesignCardSet(cards);
  const roomBudget = evaluateRoomCardLayoutSpend({
    cardSet: normalizedCards,
    budgetTokens,
    priceList,
    tileCosts,
  });
  const sharedLevelBudget = {
    usedTokens: readPositiveInt(roomBudget?.spentTokens, 0),
    budgetTokens: readPositiveInt(budgetTokens, DEFAULT_LEVEL_BUDGET_TOKENS),
    remainingTokens: Number.isInteger(roomBudget?.remainingBudgetTokens)
      ? roomBudget.remainingBudgetTokens
      : Math.max(0, readPositiveInt(budgetTokens, DEFAULT_LEVEL_BUDGET_TOKENS) - readPositiveInt(roomBudget?.spentTokens, 0)),
  };

  return normalizedCards.map((card) => {
    const value = calculateCardValue(card, { tileCosts, priceList });
    return {
      ...card,
      cardValue: value,
      budget: {
        unitTokens: value.unitTokens,
        totalTokens: value.totalTokens,
        sharedLevelBudget,
      },
      tokenReceipt: buildCardReceipt(card, value),
    };
  });
}

export function buildSummaryFromCardSet({
  cards,
  dungeonAffinity = DEFAULT_DUNGEON_AFFINITY,
  budgetTokens = DEFAULT_LEVEL_BUDGET_TOKENS,
  budgetSplitPercent,
  priceList,
  tileCosts,
} = {}) {
  const normalizedCards = normalizeDesignCardSet(cards, { dungeonAffinity });
  const typedCards = normalizedCards.filter((card) => Boolean(normalizeCardType(card.type)));
  const summaryInput = {
    dungeonAffinity,
    budgetTokens: readPositiveInt(budgetTokens, DEFAULT_LEVEL_BUDGET_TOKENS),
    cardSet: typedCards,
  };
  if (budgetSplitPercent) {
    summaryInput.poolWeights = [
      { id: "rooms", weight: readBoundedPercent(budgetSplitPercent.room, DEFAULT_BUDGET_SPLIT.room) / 100 },
      { id: "delver", weight: readBoundedPercent(budgetSplitPercent.delver, DEFAULT_BUDGET_SPLIT.delver) / 100 },
      { id: "wardens", weight: readBoundedPercent(budgetSplitPercent.warden, DEFAULT_BUDGET_SPLIT.warden) / 100 },
      { id: "hazards", weight: readBoundedPercent(budgetSplitPercent.hazard, DEFAULT_BUDGET_SPLIT.hazard) / 100 },
      { id: "resources", weight: readBoundedPercent(budgetSplitPercent.resource, DEFAULT_BUDGET_SPLIT.resource) / 100 },
    ];
  }
  const summary = extractSummaryFromCardSet(summaryInput);
  const cardsWithBudget = enrichCardsWithBudget(normalizedCards, {
    budgetTokens: summaryInput.budgetTokens,
    tileCosts,
    priceList,
  });
  const typedCardsWithBudget = cardsWithBudget.filter((card) => Boolean(normalizeCardType(card.type)));
  const finalSummary = {
    ...summary,
    budgetTokens: summaryInput.budgetTokens,
    cardSet: cardsWithBudget,
  };
  const spendLedger = buildDesignSpendLedger({
    summary: {
      ...summary,
      budgetTokens: summaryInput.budgetTokens,
      cardSet: typedCardsWithBudget,
    },
    priceList,
    tileCosts,
  });
  return {
    summary: finalSummary,
    cards: cardsWithBudget,
    spendLedger,
  };
}

const AUTO_GENERATE_ROOM_BLUEPRINTS = Object.freeze([
  {
    key: "room_large_dark",
    preference: 3,
    card: {
      type: "room",
      affinity: "dark",
      roomSize: "large",
      count: 1,
      source: "auto-generated",
    },
  },
  {
    key: "room_medium_fire",
    preference: 2,
    card: {
      type: "room",
      affinity: "fire",
      roomSize: "medium",
      count: 1,
      source: "auto-generated",
    },
  },
  {
    key: "room_small_water",
    preference: 1,
    card: {
      type: "room",
      affinity: "water",
      roomSize: "small",
      count: 1,
      source: "auto-generated",
    },
  },
]);

const AUTO_GENERATE_ACTOR_BLUEPRINTS = Object.freeze({
  delver: Object.freeze([
    {
      key: "attacker_light",
      card: {
        type: "delver",
        affinity: "light",
        motivations: ["attacking", "user_controlled"],
        count: 1,
        source: "auto-generated",
      },
    },
    {
      key: "attacker_fire",
      card: {
        type: "delver",
        affinity: "fire",
        expressions: ["push"],
        motivations: ["attacking", "user_controlled"],
        count: 1,
        source: "auto-generated",
      },
    },
  ]),
  warden: Object.freeze([
    {
      key: "defender_dark",
      card: {
        type: "warden",
        affinity: "dark",
        motivations: ["defending"],
        count: 1,
        source: "auto-generated",
      },
    },
    {
      key: "defender_earth",
      card: {
        type: "warden",
        affinity: "earth",
        expressions: ["pull"],
        motivations: ["defending"],
        count: 1,
        source: "auto-generated",
      },
    },
  ]),
});

function resolveAutoGenerateVariants(blueprints = [], costContext = {}) {
  return blueprints
    .map((blueprint) => {
      const card = createDesignCard(blueprint.card);
      const unitTokens = readPositiveInt(calculateCardValue(card, costContext)?.unitTokens, 0);
      return {
        ...blueprint,
        card,
        unitTokens,
      };
    })
    .filter((variant) => variant.unitTokens > 0);
}

function buildAutoGeneratedRoomCards(availableTokens, costContext = {}) {
  const budget = readNonNegativeInt(availableTokens, 0);
  if (budget <= 0) return [];

  const variants = resolveAutoGenerateVariants(AUTO_GENERATE_ROOM_BLUEPRINTS, costContext);
  if (variants.length === 0) return [];

  const plans = Array.from({ length: budget + 1 }, () => null);
  plans[0] = {
    counts: Object.create(null),
    cardUnits: 0,
    preferenceScore: 0,
  };

  for (let spent = 1; spent <= budget; spent += 1) {
    let bestPlan = null;
    variants.forEach((variant) => {
      if (variant.unitTokens > spent) return;
      const priorPlan = plans[spent - variant.unitTokens];
      if (!priorPlan) return;
      const counts = {
        ...priorPlan.counts,
        [variant.key]: (priorPlan.counts[variant.key] || 0) + 1,
      };
      const candidate = {
        counts,
        cardUnits: priorPlan.cardUnits + 1,
        preferenceScore: priorPlan.preferenceScore + readNonNegativeInt(variant.preference, 0),
      };
      const better =
        !bestPlan
        || candidate.cardUnits < bestPlan.cardUnits
        || (
          candidate.cardUnits === bestPlan.cardUnits
          && candidate.preferenceScore > bestPlan.preferenceScore
        );
      if (better) {
        bestPlan = candidate;
      }
    });
    plans[spent] = bestPlan;
  }

  let bestSpent = budget;
  while (bestSpent > 0 && !plans[bestSpent]) {
    bestSpent -= 1;
  }
  if (bestSpent <= 0 || !plans[bestSpent]) {
    return [];
  }

  return variants
    .map((variant) => {
      const count = readPositiveInt(plans[bestSpent]?.counts?.[variant.key], 0);
      if (count <= 0) return null;
      return createDesignCard({
        ...variant.card,
        count,
        source: "auto-generated",
      });
    })
    .filter(Boolean);
}

function buildAutoGeneratedActorCards(type, availableTokens, costContext = {}) {
  const normalizedType = normalizeCardType(type);
  if (normalizedType !== "delver" && normalizedType !== "warden") {
    return [];
  }

  const budget = readNonNegativeInt(availableTokens, 0);
  if (budget <= 0) return [];

  const variants = resolveAutoGenerateVariants(AUTO_GENERATE_ACTOR_BLUEPRINTS[normalizedType], costContext);
  if (variants.length === 0) return [];

  const minUnitTokens = variants.reduce((min, variant) => Math.min(min, variant.unitTokens), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(minUnitTokens) || minUnitTokens <= 0) {
    return [];
  }

  const totalCount = Math.floor(budget / minUnitTokens);
  if (totalCount <= 0) return [];

  const cheapestVariants = variants.filter((variant) => variant.unitTokens === minUnitTokens);
  if (cheapestVariants.length <= 1 || totalCount === 1) {
    return [
      createDesignCard({
        ...cheapestVariants[0].card,
        count: totalCount,
        source: "auto-generated",
      }),
    ];
  }

  const primaryCount = Math.ceil(totalCount / 2);
  const secondaryCount = totalCount - primaryCount;
  return [
    primaryCount > 0
      ? createDesignCard({
        ...cheapestVariants[0].card,
        count: primaryCount,
        source: "auto-generated",
      })
      : null,
    secondaryCount > 0
      ? createDesignCard({
        ...cheapestVariants[1].card,
        count: secondaryCount,
        source: "auto-generated",
      })
      : null,
  ].filter(Boolean);
}

const AUTO_GENERATE_HAZARD_BLUEPRINTS = Object.freeze([
  {
    key: "hazard_fire",
    card: {
      type: "hazard",
      affinity: "fire",
      expression: "emit",
      mana: { kind: "regen", current: 3, max: 3, regen: 1 },
      durability: { kind: "regen", current: 5, max: 5, regen: 0 },
      tokenHint: 50,
      source: "auto-generated",
    },
  },
  {
    key: "hazard_dark",
    card: {
      type: "hazard",
      affinity: "dark",
      expression: "emit",
      mana: { kind: "regen", current: 3, max: 3, regen: 1 },
      durability: { kind: "regen", current: 5, max: 5, regen: 0 },
      tokenHint: 50,
      source: "auto-generated",
    },
  },
  {
    key: "hazard_water",
    card: {
      type: "hazard",
      affinity: "water",
      expression: "pull",
      mana: { kind: "regen", current: 3, max: 3, regen: 1 },
      durability: { kind: "regen", current: 5, max: 5, regen: 0 },
      tokenHint: 50,
      source: "auto-generated",
    },
  },
  {
    key: "hazard_earth",
    card: {
      type: "hazard",
      affinity: "earth",
      expression: "push",
      mana: { kind: "regen", current: 3, max: 3, regen: 1 },
      durability: { kind: "regen", current: 5, max: 5, regen: 0 },
      tokenHint: 50,
      source: "auto-generated",
    },
  },
]);

const AUTO_GENERATE_RESOURCE_BLUEPRINTS = Object.freeze([
  {
    key: "resource_common_health",
    card: {
      type: "resource",
      resourceVitals: { health: { delta: 5, regen: 0 } },
      permanent: false,
      budgetCeiling: 40,
      source: "auto-generated",
    },
  },
  {
    key: "resource_rare_vitals",
    card: {
      type: "resource",
      resourceVitals: { mana: { delta: 4, regen: 2 } },
      permanent: true,
      budgetCeiling: 100,
      source: "auto-generated",
    },
  },
]);

function buildAutoGeneratedHazardCards(availableTokens, dungeonAffinity, costContext = {}) {
  const budget = readNonNegativeInt(availableTokens, 0);
  if (budget <= 0) return [];

  // Prefer hazards matching the dungeon's affinity
  const affinity = typeof dungeonAffinity === "string" && dungeonAffinity ? dungeonAffinity : null;
  const ranked = AUTO_GENERATE_HAZARD_BLUEPRINTS.slice().sort((a, b) => {
    const aMatch = affinity && a.card.affinity === affinity ? 1 : 0;
    const bMatch = affinity && b.card.affinity === affinity ? 1 : 0;
    return bMatch - aMatch;
  });

  const variants = resolveAutoGenerateVariants(ranked, costContext);
  const preferredVariant = variants.length > 0 ? variants[0] : null;
  if (!preferredVariant) return [];

  const unitTokens = preferredVariant.unitTokens;
  if (unitTokens <= 0) return [];

  const totalCount = Math.floor(budget / unitTokens);
  if (totalCount <= 0) return [];

  return [createDesignCard({ ...preferredVariant.card, count: totalCount, source: "auto-generated" })];
}

function buildAutoGeneratedResourceCards(availableTokens, costContext = {}) {
  const budget = readNonNegativeInt(availableTokens, 0);
  if (budget <= 0) return [];

  const variants = resolveAutoGenerateVariants(AUTO_GENERATE_RESOURCE_BLUEPRINTS, costContext);
  if (variants.length === 0) return [];

  const cheapestVariant = variants.reduce((best, v) => v.unitTokens < best.unitTokens ? v : best, variants[0]);
  const minUnitTokens = cheapestVariant.unitTokens;
  if (minUnitTokens <= 0) return [];

  const totalCount = Math.floor(budget / minUnitTokens);
  if (totalCount <= 0) return [];

  return [createDesignCard({ ...cheapestVariant.card, count: totalCount, source: "auto-generated" })];
}

function formatAutoGenerateCount(type, count) {
  const normalizedType = normalizeCardType(type) || type;
  const safeCount = readNonNegativeInt(count, 0);
  if (normalizedType === "delver") {
    return `${safeCount} delver${safeCount === 1 ? "" : "s"}`;
  }
  if (normalizedType === "warden") {
    return `${safeCount} warden${safeCount === 1 ? "" : "s"}`;
  }
  if (normalizedType === "hazard") {
    return `${safeCount} hazard${safeCount === 1 ? "" : "s"}`;
  }
  if (normalizedType === "resource") {
    return `${safeCount} resource${safeCount === 1 ? "" : "s"}`;
  }
  return `${safeCount} room${safeCount === 1 ? "" : "s"}`;
}

function normalizeFixtureResponses(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.responses)) return payload.responses;
  return payload ? [payload] : [];
}

function createFixtureAdapter(fixturePayload = null) {
  const responses = normalizeFixtureResponses(fixturePayload || FIXTURE_DEFAULT_RESPONSE);
  let index = 0;
  return {
    async generate() {
      const selected = responses[Math.min(index, responses.length - 1)] || FIXTURE_DEFAULT_RESPONSE;
      index += 1;
      return selected;
    },
  };
}

function createDomElement(root, tagName) {
  const doc = root?.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createElement !== "function") return null;
  return doc.createElement(tagName);
}

function clearElement(el) {
  if (!el) return;
  if (typeof el.replaceChildren === "function") {
    el.replaceChildren();
    return;
  }
  el.textContent = "";
}

function replaceChildren(el, children) {
  if (!el) return;
  if (typeof el.replaceChildren === "function") {
    el.replaceChildren(...children);
    return;
  }
  el.textContent = "";
  if (typeof el.append === "function") {
    children.forEach((child) => el.append(child));
  }
}

function buildPropertyCatalog() {
  const affinityOptionMap = new Map(
    AFFINITY_KINDS.map((value) => [value, {
      value,
      label: formatDisplayLabel(value, value),
      icon: iconForAffinity(value),
    }]),
  );
  const motivationOptionMap = new Map(
    MOTIVATION_KINDS.map((value) => [value, {
      value,
      label: formatDisplayLabel(value, value),
      icon: iconForMotivation(value),
    }]),
  );
  return {
    type: CARD_TYPE_ORDER.map((value) => ({
      value,
      label: formatDisplayLabel(value, value),
      icon: iconForType(value),
    })),
    affinities: AFFINITY_DISPLAY_GROUPS.map((group) => ({
      id: group.id,
      kinds: group.kinds.slice(),
      options: group.kinds
        .map((value) => affinityOptionMap.get(value))
        .filter(Boolean),
    })),
    expressions: EXPRESSION_DISPLAY_GROUPS.map((group) => ({
      id: group.id,
      kinds: group.kinds.slice(),
      options: group.kinds.map((value) => ({
        value,
        label: formatDisplayLabel(value, value),
        icon: iconForExpression(value),
      })),
    })),
    motivations: MOTIVATION_DISPLAY_GROUPS.map((group) => ({
      id: group.id,
      kinds: group.kinds.slice(),
      options: group.kinds
        .map((value) => motivationOptionMap.get(value))
        .filter(Boolean),
    })),
  };
}

function bindChipDrag(chip, property) {
  if (!chip || typeof chip.addEventListener !== "function") return;
  chip.draggable = true;
  chip.addEventListener("dragstart", (event) => {
    try {
      event?.dataTransfer?.setData("application/json", JSON.stringify(property));
      event?.dataTransfer?.setData("text/plain", `${property.group}:${property.value}`);
    } catch {
      // Ignore dataTransfer failures in non-browser test stubs.
    }
  });
}

function parseDropProperty(event) {
  if (!event) return null;
  const json = event?.dataTransfer?.getData?.("application/json");
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Fall through to text parsing.
    }
  }
  const text = event?.dataTransfer?.getData?.("text/plain");
  if (!text || typeof text !== "string") return null;
  const [group, value] = text.split(":");
  if (!group || !value) return null;
  return { group, value };
}

const ACTIVE_CARD_DRAG_TYPE = "application/x-agent-kernel-active-card";
const SHELF_CARD_DRAG_TYPE = "application/x-agent-kernel-shelf-card-id";

export function wireDesignGuidance({
  elements = {},
  llmConfig = {},
  onSummary,
  onStatusUpdate,
  onLlmCapture,
  onMintCard,
} = {}) {
  const {
    statusEl,
    leftRailType,
    leftRailAffinities,
    leftRailExpressions,
    leftRailMotivations,
    cardGrid,
    roomGroup,
    attackerGroup,
    defenderGroup,
    hazardGroup,
    resourceGroup,
    roomGroupBudget,
    attackerGroupBudget,
    defenderGroupBudget,
    resourceGroupBudget,
    levelBudgetInput,
    budgetSplitRoomInput,
    budgetSplitAttackerInput,
    budgetSplitDefenderInput,
    budgetSplitHazardInput,
    budgetSplitResourceInput,
    budgetSplitRoomTokens,
    budgetSplitAttackerTokens,
    budgetSplitDefenderTokens,
    budgetOverviewEl,
  } = elements;

  const state = {
    cards: [],
    activeCard: createDesignCard({
      id: buildCardId("untyped"),
      type: "",
      affinity: DEFAULT_DUNGEON_AFFINITY,
      count: 1,
    }),
    summary: null,
    spendLedger: null,
    allocationLedger: null,
    budgetTokens: readPositiveInt(levelBudgetInput?.value, DEFAULT_LEVEL_BUDGET_TOKENS),
    budgetSplitPercent: normalizeBudgetSplit({
      room: budgetSplitRoomInput?.value,
      delver: budgetSplitAttackerInput?.value,
      warden: budgetSplitDefenderInput?.value,
      hazard: budgetSplitHazardInput?.value,
      resource: budgetSplitResourceInput?.value,
    }),
    dungeonAffinity: DEFAULT_DUNGEON_AFFINITY,
    runningAi: false,
    priceList: llmConfig.priceList || null,
    tileCosts: llmConfig.tileCosts || null,
  };

  function createEditorCard(overrides = {}) {
    return createDesignCard({
      id: buildCardId("untyped"),
      type: "",
      affinity: state.dungeonAffinity,
      count: 1,
      ...overrides,
    });
  }

  function assignCardIdentifier(card, usedIds = new Set()) {
    const type = normalizeCardType(card?.type);
    const targetPrefix = cardPrefixForType(type);
    const rawId = typeof card?.id === "string" ? card.id.trim().toUpperCase() : "";
    const parsed = parseGeneratedCardId(rawId);
    let candidate = rawId;

    if (!candidate) {
      candidate = buildCardId(type || "untyped");
    } else if (parsed) {
      candidate = `${targetPrefix}-${parsed.suffix}`;
    } else {
      candidate = buildCardId(type || "untyped");
    }

    while (usedIds.has(candidate)) {
      candidate = buildCardId(type || "untyped");
    }
    usedIds.add(candidate);
    GLOBAL_ISSUED_CARD_IDS.add(candidate);

    if (candidate === card?.id) return card;
    return {
      ...card,
      id: candidate,
    };
  }

  function normalizeCardIdentifiers(cards = [], activeCard = state.activeCard) {
    const usedIds = new Set();
    const normalizedCards = cards.map((card) => assignCardIdentifier(card, usedIds));
    const normalizedActiveCard = assignCardIdentifier(activeCard, usedIds);
    return {
      cards: normalizedCards,
      activeCard: normalizedActiveCard,
    };
  }

  function isCardConfigured(card) {
    return Boolean(normalizeCardType(card?.type));
  }

  function resolveSharedLevelBudget(cards = []) {
    const used = cards
      .filter((card) => card.type === "room")
      .reduce((sum, card) => sum + (card.cardValue?.totalTokens || 0), 0);
    const budget = readPositiveInt(state.budgetTokens, DEFAULT_LEVEL_BUDGET_TOKENS);
    return {
      usedTokens: used,
      budgetTokens: budget,
      remainingTokens: Math.max(0, budget - used),
    };
  }

  function resolveAllocatedTokensByType({
    budgetTokens = state.budgetTokens,
    budgetSplitPercent = state.budgetSplitPercent,
  } = {}) {
    const budget = readPositiveInt(budgetTokens, DEFAULT_LEVEL_BUDGET_TOKENS);
    return BUDGET_BUCKET_ORDER.reduce((acc, key) => {
      const percent = readBoundedPercent(budgetSplitPercent?.[key], DEFAULT_BUDGET_SPLIT[key]);
      acc[key] = {
        percent,
        tokens: Math.floor((budget * percent) / 100),
      };
      return acc;
    }, {});
  }

  function resolveUsedTokensByType(cards = []) {
    return cards.reduce((acc, card) => {
      const type = normalizeCardType(card?.type);
      if (!type) return acc;
      const totalTokens = Number.isFinite(card?.cardValue?.totalTokens)
        ? readNonNegativeInt(card.cardValue.totalTokens, 0)
        : readNonNegativeInt(calculateCardValue(card, {
          tileCosts: state.tileCosts,
          priceList: state.priceList,
        })?.totalTokens, 0);
      acc[type] += totalTokens;
      return acc;
    }, {
      room: 0,
      delver: 0,
      warden: 0,
      hazard: 0,
      resource: 0,
    });
  }

  function resolveAllocationLedger(cards = [], options = {}) {
    const usedByType = resolveUsedTokensByType(cards);
    const allocatedByType = resolveAllocatedTokensByType(options);
    const byType = BUDGET_BUCKET_ORDER.reduce((acc, type) => {
      const usedTokens = usedByType[type] || 0;
      const allocatedTokens = allocatedByType[type]?.tokens || 0;
      const overByTokens = Math.max(0, usedTokens - allocatedTokens);
      acc[type] = {
        usedTokens,
        allocatedTokens,
        remainingTokens: Math.max(0, allocatedTokens - usedTokens),
        overByTokens,
      };
      return acc;
    }, {});
    const totalOverBudgetBy = BUDGET_BUCKET_ORDER.reduce((sum, type) => sum + (byType[type]?.overByTokens || 0), 0);
    return {
      byType,
      overBudget: totalOverBudgetBy > 0,
      totalOverBudgetBy,
    };
  }

  function mergeSpendLedgerWithAllocation(spendLedger, allocationLedger) {
    const base = spendLedger && typeof spendLedger === "object" ? { ...spendLedger } : {};
    const baseOverBudget = base.overBudget === true;
    const baseOverBy = readNonNegativeInt(base.totalOverBudgetBy, 0);
    const allocationOverBy = readNonNegativeInt(allocationLedger?.totalOverBudgetBy, 0);
    return {
      ...base,
      allocations: allocationLedger?.byType || {},
      overBudget: baseOverBudget || allocationOverBy > 0,
      totalOverBudgetBy: Math.max(baseOverBy, allocationOverBy),
    };
  }

  function describeBudgetViolation(evaluation) {
    const allocationType = BUDGET_BUCKET_ORDER.find((type) => (evaluation?.allocationLedger?.byType?.[type]?.overByTokens || 0) > 0);
    if (allocationType) {
      const detail = evaluation.allocationLedger.byType[allocationType];
      return `${formatDisplayLabel(allocationType, allocationType)} allocation exceeded by ${detail.overByTokens} tokens (${detail.usedTokens}/${detail.allocatedTokens}).`;
    }
    const overBy = readNonNegativeInt(evaluation?.spendLedger?.totalOverBudgetBy, 0);
    if (overBy > 0) {
      return `Shared budget exceeded by ${overBy} tokens.`;
    }
    return "Budget exceeded.";
  }

  function evaluateShelvedCards(
    cards,
    {
      budgetTokens = state.budgetTokens,
      budgetSplitPercent = state.budgetSplitPercent,
      dungeonAffinity = state.dungeonAffinity,
    } = {},
  ) {
    const built = buildSummaryFromCardSet({
      cards,
      dungeonAffinity,
      budgetTokens,
      budgetSplitPercent,
      priceList: state.priceList,
      tileCosts: state.tileCosts,
    });
    const allocationLedger = resolveAllocationLedger(built.cards, { budgetTokens, budgetSplitPercent });
    const spendLedger = mergeSpendLedgerWithAllocation(built.spendLedger, allocationLedger);
    return {
      ...built,
      spendLedger,
      allocationLedger,
      overBudget: spendLedger.overBudget === true,
    };
  }

  function renderRailBudgetEquation(el, { totalTokens = 0, mintedTokens = 0, remainingTokens = 0 } = {}) {
    if (!el) return;
    const totalEl = createDomElement(el, "u");
    const minusEl = createDomElement(el, "span");
    const mintedEl = createDomElement(el, "span");
    const equalsEl = createDomElement(el, "span");
    const remainingEl = createDomElement(el, "strong");
    if (!totalEl || !minusEl || !mintedEl || !equalsEl || !remainingEl) {
      el.textContent = `${totalTokens} - [${mintedTokens}] = ${remainingTokens}`;
      return;
    }
    totalEl.textContent = String(totalTokens);
    minusEl.textContent = " - ";
    mintedEl.textContent = `[${mintedTokens}]`;
    equalsEl.textContent = " = ";
    remainingEl.textContent = String(remainingTokens);
    replaceChildren(el, [totalEl, minusEl, mintedEl, equalsEl, remainingEl]);
  }

  function updateGroupBudgetIndicators() {
    const allocation = state.allocationLedger || resolveAllocationLedger(state.cards);
    const setGroupValue = (el, type) => {
      if (!el) return;
      if (type === "resource") {
        const cards = groupCardsByType(state.cards).resource;
        const used = cards.reduce((sum, card) => sum + readNonNegativeInt(card?.cardValue?.totalTokens, 0), 0);
        const allocated = cards.reduce((sum, card) => sum + readNonNegativeInt(card?.budgetCeiling, 0), 0);
        const remaining = allocated - used;
        renderRailBudgetEquation(el, {
          totalTokens: allocated,
          mintedTokens: used,
          remainingTokens: remaining,
        });
        el.style.color = remaining < 0 ? "#cf3f5b" : "";
        el.classList?.toggle?.("is-negative", remaining < 0);
        return;
      }
      const detail = allocation?.byType?.[type] || { usedTokens: 0, allocatedTokens: 0, overByTokens: 0 };
      const used = readNonNegativeInt(detail.usedTokens, 0);
      const allocated = readNonNegativeInt(detail.allocatedTokens, 0);
      const remaining = allocated - used;
      renderRailBudgetEquation(el, {
        totalTokens: allocated,
        mintedTokens: used,
        remainingTokens: remaining,
      });
      el.style.color = remaining < 0 ? "#cf3f5b" : "";
      el.classList?.toggle?.("is-negative", remaining < 0);
    };
    setGroupValue(roomGroupBudget, "room");
    setGroupValue(attackerGroupBudget, "delver");
    setGroupValue(defenderGroupBudget, "warden");
    setGroupValue(resourceGroupBudget, "resource");
  }

  function updateBudgetOverviewIndicator() {
    if (!budgetOverviewEl) return;
    clearElement(budgetOverviewEl);
    budgetOverviewEl.style.color = "";
    budgetOverviewEl.classList?.toggle?.("is-negative", false);
  }

  function hydrateActiveCard(card, sharedLevelBudget) {
    const normalized = createDesignCard(card || createEditorCard());
    const value = calculateCardValue(normalized, {
      tileCosts: state.tileCosts,
      priceList: state.priceList,
    });
    return {
      ...normalized,
      cardValue: value,
      budget: {
        unitTokens: value.unitTokens,
        totalTokens: value.totalTokens,
        sharedLevelBudget,
      },
      tokenReceipt: buildCardReceipt(normalized, value),
    };
  }

  function syncOutputs() {
    const allocatedByType = resolveAllocatedTokensByType();
    if (budgetSplitRoomInput) {
      budgetSplitRoomInput.value = String(allocatedByType.room.percent);
    }
    if (budgetSplitAttackerInput) {
      budgetSplitAttackerInput.value = String(allocatedByType.delver.percent);
    }
    if (budgetSplitDefenderInput) {
      budgetSplitDefenderInput.value = String(allocatedByType.warden.percent);
    }
    if (budgetSplitHazardInput) {
      budgetSplitHazardInput.value = String(allocatedByType.hazard?.percent ?? DEFAULT_BUDGET_SPLIT.hazard);
    }
    if (budgetSplitResourceInput) {
      budgetSplitResourceInput.value = String(allocatedByType.resource?.percent ?? DEFAULT_BUDGET_SPLIT.resource);
    }
    if (budgetSplitRoomTokens) {
      budgetSplitRoomTokens.textContent = "";
    }
    if (budgetSplitAttackerTokens) {
      budgetSplitAttackerTokens.textContent = "";
    }
    if (budgetSplitDefenderTokens) {
      budgetSplitDefenderTokens.textContent = "";
    }
    updateGroupBudgetIndicators();
    updateBudgetOverviewIndicator();
    if (onStatusUpdate) {
      const budgetTokens = readPositiveInt(state.budgetTokens, DEFAULT_LEVEL_BUDGET_TOKENS);
      const totalSpentTokens = state.spendLedger?.totalSpentTokens ?? 0;
      onStatusUpdate({
        byType: state.allocationLedger?.byType ?? {},
        budgetTokens,
        totalSpentTokens,
        remainingTokens: Math.max(0, budgetTokens - totalSpentTokens),
      });
    }
  }

  function stashActiveCardToGroup(groupType = null) {
    const active = createDesignCard(state.activeCard || {});
    const activeType = normalizeCardType(active.type);
    const targetType = normalizeCardType(groupType || activeType);
    if (!targetType) {
      setStatus(statusEl, "Set card type before moving to grouped cards.", true);
      return false;
    }
    if (activeType && targetType && activeType !== targetType) {
      setStatus(statusEl, `Card type ${activeType} cannot be moved to ${targetType} group.`, true);
      return false;
    }
    const staged = activeType
      ? active
      : createDesignCard({
        ...active,
        type: targetType,
      });
    if (targetType === "hazard") {
      const hasAffinity = Array.isArray(staged.affinities) && staged.affinities.length > 0
        && staged.affinities[0]?.expression;
      const hasMana = staged.mana && typeof staged.mana === "object";
      if (!hasAffinity) {
        setStatus(statusEl, "Hazard cards require at least one affinity with an expression.", true);
        return false;
      }
      if (!hasMana) {
        setStatus(statusEl, "Hazard cards require a mana vital.", true);
        return false;
      }
    }
    if (targetType === "resource") {
      const hasAffinity = Array.isArray(staged.affinities) && staged.affinities.length > 0;
      if (!hasAffinity) {
        setStatus(statusEl, "Resource cards require at least one affinity.", true);
        return false;
      }
    }
    const existingCards = state.cards.filter((entry) => entry.id !== staged.id);
    const usedIds = new Set(
      existingCards
        .map((entry) => (typeof entry?.id === "string" ? entry.id.trim().toUpperCase() : ""))
        .filter(Boolean),
    );
    const identifiedStaged = assignCardIdentifier(staged, usedIds);
    const candidateCards = [...existingCards, identifiedStaged];
    const evaluation = evaluateShelvedCards(candidateCards);
    if (evaluation.overBudget) {
      setStatus(statusEl, `Cannot move card: ${describeBudgetViolation(evaluation)}`, true);
      return false;
    }
    state.cards = candidateCards;
    state.activeCard = createEditorCard({ flipped: false });
    recompute();
    setStatus(statusEl, `Moved card ${identifiedStaged.id} to ${targetType} group.`);
    return true;
  }

  async function mintActiveCardToGroup(groupType = null) {
    const active = createDesignCard(state.activeCard || {});
    const activeType = normalizeCardType(active.type);
    const targetType = normalizeCardType(groupType || activeType);
    if (!targetType) {
      setStatus(statusEl, "Set card type before minting.", true);
      return { ok: false, reason: "missing_type" };
    }
    if (activeType && targetType && activeType !== targetType) {
      setStatus(statusEl, `Card type ${activeType} cannot be minted to ${targetType} group.`, true);
      return { ok: false, reason: "type_mismatch" };
    }
    const staged = activeType
      ? active
      : createDesignCard({
        ...active,
        type: targetType,
      });
    if (typeof onMintCard === "function") {
      const mintResult = await onMintCard({ card: staged, targetType });
      if (!mintResult || mintResult.ok === false) {
        const message = mintResult?.error || mintResult?.message || "Mint failed.";
        setStatus(statusEl, message, true);
        return { ok: false, reason: "mint_failed", error: message };
      }
      const moved = stashActiveCardToGroup(targetType);
      if (!moved) {
        return { ok: false, reason: "stash_failed_after_mint" };
      }
      const tokenId = mintResult?.tokenId || mintResult?.result?.tokenId || "";
      setStatus(
        statusEl,
        tokenId
          ? `Minted ${staged.id} as ${tokenId} and moved to ${targetType} group.`
          : `Minted ${staged.id} and moved to ${targetType} group.`,
      );
      return { ok: true, tokenId };
    }

    const moved = stashActiveCardToGroup(targetType);
    if (!moved) {
      return { ok: false, reason: "stash_failed" };
    }
    return { ok: true, skippedMint: true };
  }

  function pullCardToEditor(cardId) {
    const index = state.cards.findIndex((card) => card.id === cardId);
    if (index < 0) return false;
    const active = createDesignCard(state.activeCard || {});
    const willAutoStash = isCardConfigured(active) && active.id !== cardId;

    // Budget preflight: build the candidate card set after the swap
    // (remove pulled card, add active card if it will be auto-stashed)
    // to ensure the swap doesn't push the total over budget.
    if (willAutoStash) {
      const candidateCards = state.cards.filter((c) => c.id !== cardId);
      candidateCards.push(createDesignCard({ ...active, flipped: false }));
      const evaluation = evaluateShelvedCards(candidateCards);
      if (evaluation.overBudget) {
        setStatus(statusEl, `Cannot pull: auto-stashing active card would exceed budget. ${describeBudgetViolation(evaluation)}`, true);
        return false;
      }
    }

    const [card] = state.cards.splice(index, 1);
    if (willAutoStash) {
      state.cards.push(createDesignCard({ ...active, flipped: false }));
    }
    state.activeCard = createDesignCard({ ...card, flipped: false });
    recompute();
    setStatus(statusEl, `Pulled ${card.id} back into the editor.`);
    return true;
  }

  function renderGroupList(container, cards, groupType) {
    if (!container) return;
    container.dataset.groupType = groupType;
    if (!container.dataset.dropBound) {
      container.dataset.dropBound = "true";
      container.addEventListener?.("dragover", (event) => {
        event.preventDefault?.();
      });
      container.addEventListener?.("drop", (event) => {
        event.preventDefault?.();
        const fromActive = event?.dataTransfer?.getData?.(ACTIVE_CARD_DRAG_TYPE);
        if (fromActive) {
          stashActiveCardToGroup(container.dataset.groupType);
        }
      });
    }

    const children = cards.map((card) => {
      const row = createDomElement(container, "div");
      if (!row) return null;
      row.className = "design-card-group-row design-card-group-card";
      row.dataset.cardId = card.id;
      row.draggable = true;
      row.addEventListener?.("dragstart", (event) => {
        try {
          event?.dataTransfer?.setData(SHELF_CARD_DRAG_TYPE, card.id);
          event?.dataTransfer?.setData("text/plain", card.id);
        } catch {
          // ignore non-browser stubs
        }
      });
      row.addEventListener?.("click", () => {
        pullCardToEditor(card.id);
      });
      const preview = createDomElement(row, "div");
      if (preview) {
        preview.className = "design-card-group-preview";
        renderCardIconChip(preview, {
          icon: iconForType(card.type),
          title: `Type: ${card.type || "blank"}`,
          className: "is-type",
        });
        const affinityKinds = Array.from(new Set(
          (Array.isArray(card.affinities) ? card.affinities : [])
            .map((entry) => entry?.kind)
            .filter((value) => typeof value === "string" && value.trim()),
        ));
        affinityKinds.slice(0, 2).forEach((kind) => {
          renderCardIconChip(preview, {
            icon: iconForAffinity(kind),
            title: `Affinity: ${kind}`,
            className: "is-affinity",
          });
        });
        (Array.isArray(card.motivations) ? card.motivations : []).slice(0, 2).forEach((motivation) => {
          renderCardIconChip(preview, {
            icon: iconForMotivation(motivation),
            title: `Motivation: ${motivation}`,
            className: "is-motivation",
          });
        });
        row.append(preview);
      }
      const name = createDomElement(row, "span");
      if (name) {
        name.className = "design-card-group-name";
        name.textContent = card.id;
        row.append(name);
      }
      const meta = createDomElement(row, "span");
      if (meta) {
        meta.className = "design-card-group-meta";
        meta.textContent = `x${card.count}`;
        row.append(meta);
      }
      return row;
    }).filter(Boolean);
    if (children.length === 0) {
      const empty = createDomElement(container, "div");
      if (empty) {
        empty.className = "design-card-group-empty";
        empty.textContent = "None";
        children.push(empty);
      }
    }
    replaceChildren(container, children);
  }

  function renderGroups() {
    const grouped = groupCardsByType(state.cards);
    renderGroupList(roomGroup, grouped.room, "room");
    renderGroupList(attackerGroup, grouped.delver, "delver");
    renderGroupList(defenderGroup, grouped.warden, "warden");
    renderGroupList(hazardGroup, grouped.hazard, "hazard");
    renderGroupList(resourceGroup, grouped.resource, "resource");
  }

  function updateCard(cardId, updater, { skipBudgetPreflight = false } = {}) {
    if (state.activeCard?.id === cardId) {
      const next = updater(state.activeCard);
      if (!next) return false;
      state.activeCard = createDesignCard(next);
      return true;
    }
    const index = state.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      const next = updater(state.cards[index]);
      if (!next) return false;
      const nextCard = createDesignCard(next);
      // Budget preflight: ensure the updated shelved card doesn't push total over budget.
      if (!skipBudgetPreflight) {
        const candidateCards = state.cards.map((c, i) => (i === index ? nextCard : c));
        const evaluation = evaluateShelvedCards(candidateCards);
        if (evaluation.overBudget) {
          setStatus(statusEl, `Update blocked: ${describeBudgetViolation(evaluation)}`, true);
          return false;
        }
      }
      state.cards[index] = nextCard;
      return true;
    }
    return false;
  }

  function recompute({ notify = true } = {}) {
    const normalized = normalizeCardIdentifiers(state.cards, state.activeCard);
    const built = evaluateShelvedCards(normalized.cards);
    const resolved = normalizeCardIdentifiers(built.cards, normalized.activeCard);
    state.cards = resolved.cards;
    const sharedLevelBudget = resolveSharedLevelBudget(state.cards);
    state.activeCard = hydrateActiveCard(resolved.activeCard, sharedLevelBudget);
    state.summary = built.summary;
    state.spendLedger = built.spendLedger;
    state.allocationLedger = built.allocationLedger;
    renderCards();
    renderGroups();
    renderLeftRail();
    syncOutputs();
    if (notify) {
      onSummary?.({
        summary: state.summary,
        spendLedger: state.spendLedger,
        cards: state.cards,
      });
    }
  }

  function setPrimaryAffinity(cardId, affinityKind) {
    const updated = updateCard(cardId, (card) => {
      const working = createDesignCard(card);
      if (!Array.isArray(working.affinities) || working.affinities.length === 0) {
        return working;
      }
      const targetKind = resolveExpressionAffinityTarget(working, affinityKind);
      if (!targetKind) return working;
      return createDesignCard({
        ...working,
        affinity: targetKind,
      });
    });
    if (!updated) return false;
    recompute({ notify: false });
    return true;
  }

  function adjustResourceVital(cardId, vitalKey, field, delta) {
    const updated = updateCard(cardId, (card) => {
      const working = createDesignCard(card);
      if (working.type !== "resource") return working;
      const currentVitals = working.resourceVitals || {};
      const currentVital = currentVitals[vitalKey] || { delta: 0, regen: 0 };
      const currentValue = readNonNegativeInt(currentVital[field], 0);
      const next = Math.max(0, currentValue + delta);
      return createDesignCard({
        ...working,
        resourceVitals: { ...currentVitals, [vitalKey]: { ...currentVital, [field]: next } },
      });
    });
    if (!updated) return false;
    recompute({ notify: false });
    return true;
  }

  function toggleResourcePermanent(cardId) {
    const updated = updateCard(cardId, (card) => {
      const working = createDesignCard(card);
      if (working.type !== "resource") return working;
      return createDesignCard({ ...working, permanent: !working.permanent });
    });
    if (!updated) return false;
    recompute({ notify: false });
    return true;
  }

  function cycleHazardVitalKind(cardId, field) {
    const updated = updateCard(cardId, (card) => {
      const working = createDesignCard(card);
      if (working.type !== "hazard") return working;
      const fallback = field === "mana"
        ? { kind: "one-time", amount: 3, current: 3, max: 3, regen: 1 }
        : { kind: "one-time", amount: 1, current: 1, max: 1, regen: 0 };
      return createDesignCard({
        ...working,
        [field]: toggleHazardVital(working[field], fallback),
      });
    });
    if (!updated) return false;
    recompute({ notify: false });
    return true;
  }

  function adjustHazardNumber(cardId, field, delta) {
    const updated = updateCard(cardId, (card) => {
      const working = createDesignCard(card);
      if (working.type !== "hazard") return working;
      const current = readPositiveInt(working.tokenHint, 0);
      const next = Math.max(0, current + delta);
      return createDesignCard({ ...working, tokenHint: next });
    });
    if (!updated) return false;
    recompute({ notify: false });
    return true;
  }

  function cycleCardAffinityExpression(cardId, affinityKind, currentExpression, direction = 1) {
    const updated = updateCard(cardId, (card) => {
      const working = createDesignCard(card);
      const targetKind = resolveExpressionAffinityTarget(working, affinityKind);
      if (!targetKind) return working;
      const targetExpression = normalizeExpression(currentExpression, "");
      const target = Array.isArray(working.affinities)
        ? working.affinities.find((entry) => (
          entry.kind === targetKind
          && (!targetExpression || entry.expression === targetExpression)
        ))
        : null;
      if (!target) return working;
      const normalizedCurrent = normalizeExpression(target.expression, DEFAULT_AFFINITY_EXPRESSION);
      const currentIndex = Math.max(0, AFFINITY_EXPRESSIONS.indexOf(normalizedCurrent));
      const nextIndex = (currentIndex + Math.trunc(direction) + AFFINITY_EXPRESSIONS.length) % AFFINITY_EXPRESSIONS.length;
      const result = applyExpressionDrop(working, AFFINITY_EXPRESSIONS[nextIndex], {
        affinityKind: targetKind,
        sourceExpression: normalizedCurrent,
        mode: "replace",
      });
      return result.ok ? result.card : working;
    });
    if (!updated) return false;
    recompute();
    return true;
  }

  function adjustCardAffinityStack(cardId, affinityKind, delta = 0, expressionValue = undefined) {
    const updated = updateCard(
      cardId,
      (card) => adjustAffinityStack(card, affinityKind, delta, expressionValue),
    );
    if (!updated) return false;
    recompute();
    return true;
  }

  function adjustVitalValue(cardId, vitalKey, field, delta = 0) {
    const updated = updateCard(cardId, (card) => adjustCardVital(card, vitalKey, field, delta));
    if (!updated) return false;
    recompute();
    return true;
  }

  function adjustTrapManaValue(cardId, affinityKind, field, delta = 0) {
    const updated = updateCard(cardId, (card) => adjustTrapManaVital(card, affinityKind, field, delta));
    if (!updated) return false;
    recompute();
    return true;
  }

  function renderCardIconChip(container, { icon, title, className = "" } = {}) {
    const chip = createDomElement(container, "span");
    if (!chip) return null;
    chip.className = `design-card-icon-chip ${className}`.trim();
    chip.innerHTML = icon || "◈";
    if (title) chip.title = title;
    container.append(chip);
    return chip;
  }

  function renderCards() {
    if (!cardGrid) return;
    if (!cardGrid.dataset.dropBound) {
      cardGrid.dataset.dropBound = "true";
      cardGrid.addEventListener?.("dragover", (event) => {
        event.preventDefault?.();
      });
      cardGrid.addEventListener?.("drop", (event) => {
        event.preventDefault?.();
        const pulledCardId = event?.dataTransfer?.getData?.(SHELF_CARD_DRAG_TYPE);
        if (pulledCardId) {
          pullCardToEditor(pulledCardId);
          return;
        }
        const property = parseDropProperty(event);
        if (!property) return;
        applyPropertyDrop(state.activeCard?.id, property);
      });
    }

    const activeCard = state.activeCard && typeof state.activeCard === "object"
      ? state.activeCard
      : createEditorCard();
    const normalizedCard = createDesignCard(activeCard);
    const resolvedCardValue = activeCard?.cardValue && typeof activeCard.cardValue === "object"
      ? {
        unitTokens: readNonNegativeInt(activeCard.cardValue.unitTokens, 0),
        totalTokens: readNonNegativeInt(activeCard.cardValue.totalTokens, 0),
        lineItems: Array.isArray(activeCard.cardValue.lineItems) ? activeCard.cardValue.lineItems : [],
      }
      : calculateCardValue(normalizedCard, {
        tileCosts: state.tileCosts,
        priceList: state.priceList,
      });
    const sharedLevelBudget = resolveSharedLevelBudget(state.cards);
    const card = {
      ...normalizedCard,
      cardValue: resolvedCardValue,
      budget: activeCard?.budget && typeof activeCard.budget === "object"
        ? activeCard.budget
        : {
          unitTokens: resolvedCardValue.unitTokens,
          totalTokens: resolvedCardValue.totalTokens,
          sharedLevelBudget,
        },
      tokenReceipt: activeCard?.tokenReceipt && typeof activeCard.tokenReceipt === "object"
        ? activeCard.tokenReceipt
        : buildCardReceipt(normalizedCard, resolvedCardValue),
    };
    const cardEl = createDomElement(cardGrid, "article");
    if (!cardEl) return;
    cardEl.className = "design-card";
    cardEl.dataset.cardId = card.id;
    cardEl.dataset.cardType = card.type || "untyped";
    cardEl.draggable = true;
    if (card.flipped) cardEl.classList.add("flipped");
    cardEl.addEventListener?.("dragstart", (event) => {
      try {
        event?.dataTransfer?.setData(ACTIVE_CARD_DRAG_TYPE, card.id);
        event?.dataTransfer?.setData("text/plain", card.id);
      } catch {
        // ignore non-browser stubs
      }
    });
    cardEl.addEventListener?.("dragover", (event) => {
      event.preventDefault?.();
    });
    cardEl.addEventListener?.("drop", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      const pulledCardId = event?.dataTransfer?.getData?.(SHELF_CARD_DRAG_TYPE);
      if (pulledCardId) {
        pullCardToEditor(pulledCardId);
        return;
      }
      const property = parseDropProperty(event);
      if (!property) return;
      applyPropertyDrop(card.id, property);
    });

    const header = createDomElement(cardEl, "header");
    if (header) {
      header.className = "design-card-header";
      const heading = createDomElement(header, "div");
      if (heading) {
        heading.className = "design-card-heading";
        renderCardIconChip(heading, {
          icon: iconForType(card.type),
          title: `Type: ${card.type || "blank"}`,
          className: "is-type",
        });
        const title = createDomElement(heading, "strong");
        if (title) {
          title.className = "design-card-title";
          title.textContent = card.id || "card";
          heading.append(title);
        }
        header.append(heading);
      }
      const countControls = createDomElement(header, "div");
      if (countControls) {
        countControls.className = "design-card-header-count-controls";
        const countValue = createDomElement(countControls, "span");
        if (countValue) {
          countValue.className = "design-card-header-count-value";
          countValue.textContent = `x${card.count || 1}`;
          countControls.append(countValue);
        }
        const minus = createDomElement(countControls, "button");
        if (minus) {
          minus.type = "button";
          minus.className = "design-card-count-minus";
          minus.textContent = "-";
          minus.addEventListener?.("click", (event) => {
            event.stopPropagation?.();
            adjustCount(card.id, -1);
          });
          countControls.append(minus);
        }
        const plus = createDomElement(countControls, "button");
        if (plus) {
          plus.type = "button";
          plus.className = "design-card-count-plus";
          plus.textContent = "+";
          plus.addEventListener?.("click", (event) => {
            event.stopPropagation?.();
            adjustCount(card.id, 1);
          });
          countControls.append(plus);
        }
        header.append(countControls);
      }
      cardEl.append(header);
    }

    const front = createDomElement(cardEl, "div");
    if (front) {
      front.className = "design-card-face design-card-front";
      const meta = createDomElement(front, "div");
      if (meta) {
        meta.className = "design-card-meta";
        const cardType = normalizeCardType(card.type);
        if (cardType === "room") {
          const roomSize = createDomElement(meta, "span");
          if (roomSize) {
            roomSize.className = "design-card-meta-chip";
            roomSize.textContent = `size:${card.roomSize || "medium"}`;
            meta.append(roomSize);
          }
        }
        if (cardType) {
          const configurationSpend = createDomElement(meta, "span");
          if (configurationSpend) {
            const allocation = state.allocationLedger?.byType?.[cardType];
            const spentTokens = readNonNegativeInt(card?.cardValue?.totalTokens, 0);
            const allocatedTokens = cardType === "resource"
              ? readNonNegativeInt(card?.budgetCeiling, state.budgetTokens)
              : cardType === "hazard"
                ? readNonNegativeInt(card?.tokenHint, state.budgetTokens)
              : readNonNegativeInt(allocation?.allocatedTokens, state.budgetTokens);
            configurationSpend.className = "design-card-meta-chip is-configuration-spend";
            configurationSpend.textContent = `${spentTokens}/${allocatedTokens}`;
            meta.append(configurationSpend);
          }
        }
        front.append(meta);
      }

      const affinityList = card.type === "resource" ? null : createDomElement(front, "div");
      if (affinityList) {
        affinityList.className = "design-card-affinity-list";
        const affinityEntries = Array.isArray(card.affinities) ? card.affinities : [];
        if (affinityEntries.length === 0) {
          const emptyAffinity = createDomElement(affinityList, "div");
          if (emptyAffinity) {
            emptyAffinity.className = "design-card-affinity-empty";
            emptyAffinity.textContent = "Drop an affinity chip";
            affinityList.append(emptyAffinity);
          }
        }
        affinityEntries.forEach((entry) => {
          const row = createDomElement(affinityList, "div");
          if (!row) return;
          row.className = "design-card-affinity-row";
          if (card.affinity === entry.kind) {
            row.classList?.add?.("active");
          }
          row.addEventListener?.("click", (event) => {
            event.stopPropagation?.();
            setPrimaryAffinity(card.id, entry.kind);
          });
          row.addEventListener?.("dragover", (event) => {
            event.preventDefault?.();
          });
          row.addEventListener?.("drop", (event) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            const property = parseDropProperty(event);
            if (!property) return;
            if (property.group === "expressions") {
              applyPropertyDrop(card.id, {
                ...property,
                affinityKind: entry.kind,
              });
              return;
            }
            applyPropertyDrop(card.id, property);
          });

          const affinityButton = createDomElement(row, "button");
          if (affinityButton) {
            affinityButton.type = "button";
            affinityButton.className = "design-card-affinity-kind";
            affinityButton.innerHTML = iconForAffinity(entry.kind);
            affinityButton.title = `Affinity: ${entry.kind}`;
            affinityButton.addEventListener?.("click", (event) => {
              event.stopPropagation?.();
              setPrimaryAffinity(card.id, entry.kind);
            });
            row.append(affinityButton);
          }

          const expressionButton = createDomElement(row, "button");
          if (expressionButton) {
            expressionButton.type = "button";
            expressionButton.className = "design-card-affinity-expression";
            expressionButton.innerHTML = iconForExpression(entry.expression);
            expressionButton.title = `Expression: ${entry.expression}`;
            expressionButton.addEventListener?.("click", (event) => {
              event.stopPropagation?.();
              cycleCardAffinityExpression(card.id, entry.kind, entry.expression, 1);
            });
            row.append(expressionButton);
          }

          const stackControls = createDomElement(row, "div");
          if (stackControls) {
            stackControls.className = "design-card-affinity-stack";
            const stackMinus = createDomElement(stackControls, "button");
            if (stackMinus) {
              stackMinus.type = "button";
              stackMinus.className = "design-card-affinity-stack-minus";
              stackMinus.textContent = "-";
              stackMinus.addEventListener?.("click", (event) => {
                event.stopPropagation?.();
                adjustCardAffinityStack(card.id, entry.kind, -1, entry.expression);
              });
              stackControls.append(stackMinus);
            }
            const stackValue = createDomElement(stackControls, "span");
            if (stackValue) {
              stackValue.className = "design-card-affinity-stack-value";
              stackValue.textContent = `x${normalizeCardCount(entry.stacks, 1)}`;
              stackControls.append(stackValue);
            }
            const stackPlus = createDomElement(stackControls, "button");
            if (stackPlus) {
              stackPlus.type = "button";
              stackPlus.className = "design-card-affinity-stack-plus";
              stackPlus.textContent = "+";
              stackPlus.addEventListener?.("click", (event) => {
                event.stopPropagation?.();
                adjustCardAffinityStack(card.id, entry.kind, 1, entry.expression);
              });
              stackControls.append(stackPlus);
            }
            row.append(stackControls);
          }

          if (card.type === "room") {
            const manaMax = readNonNegativeInt(entry.trapVitals?.mana?.max, 0);
            const manaRegen = readNonNegativeInt(entry.trapVitals?.mana?.regen, 0);

            const manaControls = createDomElement(row, "div");
            if (manaControls) {
              manaControls.className = "design-card-trap-mana-controls";

              const manaIcon = createDomElement(manaControls, "span");
              if (manaIcon) {
                manaIcon.className = "design-card-icon-chip is-vital";
                manaIcon.innerHTML = iconForVital("mana");
                manaControls.append(manaIcon);
              }

              const maxMinus = createDomElement(manaControls, "button");
              if (maxMinus) {
                maxMinus.type = "button";
                maxMinus.className = "design-card-vital-minus";
                maxMinus.textContent = "-";
                maxMinus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustTrapManaValue(card.id, entry.kind, "max", -5);
                });
                manaControls.append(maxMinus);
              }
              const maxValue = createDomElement(manaControls, "span");
              if (maxValue) {
                maxValue.className = "design-card-vital-value";
                maxValue.textContent = `M${manaMax}`;
                manaControls.append(maxValue);
              }
              const maxPlus = createDomElement(manaControls, "button");
              if (maxPlus) {
                maxPlus.type = "button";
                maxPlus.className = "design-card-vital-plus";
                maxPlus.textContent = "+";
                maxPlus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustTrapManaValue(card.id, entry.kind, "max", 5);
                });
                manaControls.append(maxPlus);
              }

              const regenMinus = createDomElement(manaControls, "button");
              if (regenMinus) {
                regenMinus.type = "button";
                regenMinus.className = "design-card-vital-minus";
                regenMinus.textContent = "-";
                regenMinus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustTrapManaValue(card.id, entry.kind, "regen", -1);
                });
                manaControls.append(regenMinus);
              }
              const regenValue = createDomElement(manaControls, "span");
              if (regenValue) {
                regenValue.className = "design-card-vital-value";
                regenValue.textContent = `R${manaRegen}`;
                manaControls.append(regenValue);
              }
              const regenPlus = createDomElement(manaControls, "button");
              if (regenPlus) {
                regenPlus.type = "button";
                regenPlus.className = "design-card-vital-plus";
                regenPlus.textContent = "+";
                regenPlus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustTrapManaValue(card.id, entry.kind, "regen", 1);
                });
                manaControls.append(regenPlus);
              }

              row.append(manaControls);
            }
          }

          affinityList.append(row);
        });
        front.append(affinityList);
      }

      if (card.type === "hazard") {
        const hazardControls = createDomElement(front, "section");
        if (hazardControls) {
          hazardControls.className = "design-card-vitals";
          const heading = createDomElement(hazardControls, "div");
          if (heading) {
            heading.className = "design-card-vitals-title";
            heading.textContent = "Hazard";
            hazardControls.append(heading);
          }
          [
            {
              label: "Mana",
              value: card.mana?.kind || "one-time",
              onClick: () => cycleHazardVitalKind(card.id, "mana"),
            },
            {
              label: "Durability",
              value: card.durability?.kind || "one-time",
              onClick: () => cycleHazardVitalKind(card.id, "durability"),
            },
          ].forEach((entry) => {
            const row = createDomElement(hazardControls, "div");
            if (!row) return;
            row.className = "design-card-vital-row";
            const label = createDomElement(row, "span");
            if (label) {
              label.className = "design-card-vital-label";
              label.textContent = entry.label;
              row.append(label);
            }
            const button = createDomElement(row, "button");
            if (button) {
              button.type = "button";
              button.className = "design-card-room-size";
              button.textContent = entry.value;
              button.addEventListener?.("click", (event) => {
                event.stopPropagation?.();
                entry.onClick();
              });
              row.append(button);
            }
            hazardControls.append(row);
          });
          front.append(hazardControls);
        }
      } else if (card.type === "resource") {
        const resourceControls = createDomElement(front, "section");
        if (resourceControls) {
          resourceControls.className = "design-card-vitals";
          const heading = createDomElement(resourceControls, "div");
          if (heading) {
            heading.className = "design-card-vitals-title";
            heading.textContent = "Resource Vitals";
            resourceControls.append(heading);
          }
          RESOURCE_VITAL_KEYS.forEach((key) => {
            const vitalData = card.resourceVitals?.[key] || { delta: 0, regen: 0 };
            const row = createDomElement(resourceControls, "div");
            if (!row) return;
            row.className = "design-card-vital-row";

            const label = createDomElement(row, "span");
            if (label) {
              label.className = "design-card-vital-label";
              const iconHtml = iconForVital(key);
              label.innerHTML = `<span class="design-card-vital-icon" aria-hidden="true">${iconHtml}</span><span class="design-card-vital-label-text">${formatDisplayLabel(key, key)}</span>`;
              row.append(label);
            }

            const deltaControls = createDomElement(row, "div");
            if (deltaControls) {
              deltaControls.className = "design-card-vital-controls";
              const minus = createDomElement(deltaControls, "button");
              if (minus) {
                minus.type = "button";
                minus.className = "design-card-vital-minus";
                minus.textContent = "-";
                minus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustResourceVital(card.id, key, "delta", -10);
                });
                deltaControls.append(minus);
              }
              const value = createDomElement(deltaControls, "span");
              if (value) {
                value.className = "design-card-vital-value";
                value.textContent = `+${readNonNegativeInt(vitalData.delta, 0)}`;
                deltaControls.append(value);
              }
              const plus = createDomElement(deltaControls, "button");
              if (plus) {
                plus.type = "button";
                plus.className = "design-card-vital-plus";
                plus.textContent = "+";
                plus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustResourceVital(card.id, key, "delta", 10);
                });
                deltaControls.append(plus);
              }
              row.append(deltaControls);
            }

            const regenControls = createDomElement(row, "div");
            if (regenControls) {
              regenControls.className = "design-card-vital-controls";
              const minus = createDomElement(regenControls, "button");
              if (minus) {
                minus.type = "button";
                minus.className = "design-card-vital-minus";
                minus.textContent = "-";
                minus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustResourceVital(card.id, key, "regen", -2);
                });
                regenControls.append(minus);
              }
              const value = createDomElement(regenControls, "span");
              if (value) {
                value.className = "design-card-vital-value";
                value.textContent = `R${readNonNegativeInt(vitalData.regen, 0)}`;
                regenControls.append(value);
              }
              const plus = createDomElement(regenControls, "button");
              if (plus) {
                plus.type = "button";
                plus.className = "design-card-vital-plus";
                plus.textContent = "+";
                plus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustResourceVital(card.id, key, "regen", 2);
                });
                regenControls.append(plus);
              }
              row.append(regenControls);
            }

            resourceControls.append(row);
          });

          // Permanent toggle
          const permanentRow = createDomElement(resourceControls, "div");
          if (permanentRow) {
            permanentRow.className = "design-card-vital-row";
            const permanentLabel = createDomElement(permanentRow, "span");
            if (permanentLabel) {
              permanentLabel.className = "design-card-vital-label";
              permanentLabel.textContent = "Permanent";
              permanentRow.append(permanentLabel);
            }
            const permanentBtn = createDomElement(permanentRow, "button");
            if (permanentBtn) {
              permanentBtn.type = "button";
              permanentBtn.className = "design-card-room-size";
              permanentBtn.textContent = card.permanent ? `×${RESOURCE_PERMANENT_MULTIPLIER} cost` : "level-scoped";
              permanentBtn.addEventListener?.("click", (event) => {
                event.stopPropagation?.();
                toggleResourcePermanent(card.id);
              });
              permanentRow.append(permanentBtn);
            }
            resourceControls.append(permanentRow);
          }

          front.append(resourceControls);
        }
      } else if (card.type === "delver" || card.type === "warden") {
        const motivations = createDomElement(front, "section");
        if (motivations) {
          motivations.className = "design-card-motivations";
          motivations.addEventListener?.("dragover", (event) => {
            event.preventDefault?.();
          });
          motivations.addEventListener?.("drop", (event) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            const property = parseDropProperty(event);
            if (!property || property.group !== "motivations") return;
            applyPropertyDrop(card.id, property);
          });
          const heading = createDomElement(motivations, "div");
          if (heading) {
            heading.className = "design-card-motivations-title";
            heading.textContent = "Motivations";
            motivations.append(heading);
          }
          const motivationEntries = Array.isArray(card.motivations) ? card.motivations : [];
          if (motivationEntries.length === 0) {
            const empty = createDomElement(motivations, "div");
            if (empty) {
              empty.className = "design-card-motivations-empty";
              empty.textContent = "Drop a motivation chip";
              motivations.append(empty);
            }
          }
          motivationEntries.forEach((motivation) => {
            const row = createDomElement(motivations, "div");
            if (!row) return;
            row.className = "design-card-motivation-row";
            row.title = formatDisplayLabel(motivation, motivation);

            const icon = createDomElement(row, "span");
            if (icon) {
              icon.className = "design-card-motivation-icon";
              icon.innerHTML = iconForMotivation(motivation);
              row.append(icon);
            }
            const remove = createDomElement(row, "button");
            if (remove) {
              remove.type = "button";
              remove.className = "design-card-motivation-remove";
              remove.dataset.motivationRemove = motivation;
              remove.textContent = "×";
              remove.title = `Remove ${formatDisplayLabel(motivation, motivation)}`;
              remove.addEventListener?.("click", (event) => {
                event.stopPropagation?.();
                applyPropertyDrop(card.id, {
                  group: "motivations",
                  value: motivation,
                });
              });
              row.append(remove);
            }
            motivations.append(row);
          });
          front.append(motivations);
        }

        const vitals = createDomElement(front, "section");
        if (vitals) {
          vitals.className = "design-card-vitals";
          const heading = createDomElement(vitals, "div");
          if (heading) {
            heading.className = "design-card-vitals-title";
            heading.textContent = "Vitals";
            vitals.append(heading);
          }
          VITAL_KEYS.forEach((key) => {
            const row = createDomElement(vitals, "div");
            if (!row) return;
            row.className = "design-card-vital-row";

            const label = createDomElement(row, "span");
            if (label) {
              label.className = "design-card-vital-label";
              const iconHtml = iconForVital(key);
              label.innerHTML = `<span class="design-card-vital-icon" aria-hidden="true">${iconHtml}</span><span class="design-card-vital-label-text">${formatDisplayLabel(key, key)}</span>`;
              row.append(label);
            }

            const maxControls = createDomElement(row, "div");
            if (maxControls) {
              maxControls.className = "design-card-vital-controls";
              const minus = createDomElement(maxControls, "button");
              if (minus) {
                minus.type = "button";
                minus.className = "design-card-vital-minus";
                minus.textContent = "-";
                minus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustVitalValue(card.id, key, "max", -10);
                });
                maxControls.append(minus);
              }
              const value = createDomElement(maxControls, "span");
              if (value) {
                value.className = "design-card-vital-value";
                value.textContent = `M${readNonNegativeInt(card.vitals?.[key]?.max, 0)}`;
                maxControls.append(value);
              }
              const plus = createDomElement(maxControls, "button");
              if (plus) {
                plus.type = "button";
                plus.className = "design-card-vital-plus";
                plus.textContent = "+";
                plus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustVitalValue(card.id, key, "max", 10);
                });
                maxControls.append(plus);
              }
              row.append(maxControls);
            }

            const regenControls = createDomElement(row, "div");
            if (regenControls) {
              regenControls.className = "design-card-vital-controls";
              const minus = createDomElement(regenControls, "button");
              if (minus) {
                minus.type = "button";
                minus.className = "design-card-vital-minus";
                minus.textContent = "-";
                minus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustVitalValue(card.id, key, "regen", -2);
                });
                regenControls.append(minus);
              }
              const value = createDomElement(regenControls, "span");
              if (value) {
                value.className = "design-card-vital-value";
                value.textContent = `R${readNonNegativeInt(card.vitals?.[key]?.regen, 0)}`;
                regenControls.append(value);
              }
              const plus = createDomElement(regenControls, "button");
              if (plus) {
                plus.type = "button";
                plus.className = "design-card-vital-plus";
                plus.textContent = "+";
                plus.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  adjustVitalValue(card.id, key, "regen", 2);
                });
                regenControls.append(plus);
              }
              row.append(regenControls);
            }

            vitals.append(row);
          });
          front.append(vitals);
        }
      }

      const controls = createDomElement(front, "div");
      if (controls) {
        controls.className = "design-card-controls";
        if (card.type === "room") {
          const sizeButton = createDomElement(controls, "button");
          if (sizeButton) {
            sizeButton.type = "button";
            sizeButton.className = "design-card-room-size";
            sizeButton.textContent = `Size ${card.roomSize}`;
            sizeButton.addEventListener?.("click", (event) => {
              event.stopPropagation?.();
              cycleRoomSize(card.id, 1);
            });
            controls.append(sizeButton);
          }
        }
        const stash = createDomElement(controls, "button");
        if (stash) {
          stash.type = "button";
          stash.className = "design-card-stash";
          const targetType = normalizeCardType(card.type);
          stash.textContent = targetType ? "Mint" : "Set Type";
          stash.disabled = !targetType;
          stash.addEventListener?.("click", (event) => {
            event.stopPropagation?.();
            void mintActiveCardToGroup(targetType);
          });
          controls.append(stash);
        }
        const flip = createDomElement(controls, "button");
        if (flip) {
          flip.type = "button";
          flip.className = "design-card-flip";
          flip.textContent = "Flip";
          flip.addEventListener?.("click", (event) => {
            event.stopPropagation?.();
            flipCard(card.id);
          });
          controls.append(flip);
        }
        front.append(controls);
      }
      cardEl.append(front);
    }

    const back = createDomElement(cardEl, "div");
    if (back) {
      back.className = "design-card-face design-card-back";
      const receipt = createDomElement(back, "div");
      if (receipt) {
        receipt.className = "design-card-receipt";
        const tokenReceipt = card.tokenReceipt || {};
        const heading = createDomElement(receipt, "div");
        if (heading) {
          heading.className = "design-card-receipt-heading";
          heading.textContent = `Receipt ${card.id}`;
          receipt.append(heading);
        }

        const lineItems = Array.isArray(tokenReceipt.lineItems) ? tokenReceipt.lineItems : [];
        if (lineItems.length === 0) {
          const empty = createDomElement(receipt, "div");
          if (empty) {
            empty.className = "design-card-receipt-empty";
            empty.textContent = "No cost items";
            receipt.append(empty);
          }
        } else {
          lineItems.forEach((entry) => {
            const row = createDomElement(receipt, "div");
            if (!row) return;
            row.className = "design-card-receipt-row";

            const label = createDomElement(row, "span");
            if (label) {
              label.className = "design-card-receipt-label";
              label.textContent = entry.label || entry.id || "item";
              row.append(label);
            }
            const value = createDomElement(row, "span");
            if (value) {
              value.className = "design-card-receipt-cost";
              value.textContent = `${entry.totalTokens || 0}`;
              row.append(value);
            }
            receipt.append(row);
          });
        }

        const totalRow = createDomElement(receipt, "div");
        if (totalRow) {
          totalRow.className = "design-card-receipt-row is-total";
          const label = createDomElement(totalRow, "span");
          if (label) {
            label.className = "design-card-receipt-label";
            label.textContent = "Total";
            totalRow.append(label);
          }
          const value = createDomElement(totalRow, "span");
          if (value) {
            value.className = "design-card-receipt-cost";
            value.textContent = `${tokenReceipt.tokenTotals?.total || 0}`;
            totalRow.append(value);
          }
          receipt.append(totalRow);
        }

        back.append(receipt);
      }

      const backControls = createDomElement(back, "div");
      if (backControls) {
        backControls.className = "design-card-back-controls";
        const flipBack = createDomElement(backControls, "button");
        if (flipBack) {
          flipBack.type = "button";
          flipBack.className = "design-card-flip-back";
          flipBack.textContent = "Flip";
          flipBack.addEventListener?.("click", (event) => {
            event.stopPropagation?.();
            flipCard(card.id);
          });
          backControls.append(flipBack);
        }
        back.append(backControls);
      }
      cardEl.append(back);
    }

    replaceChildren(cardGrid, [cardEl]);
  }

  function createPropertyChip(container, group, option, {
    disabled = false,
    dragEnabled = true,
    selected = false,
    groupId = "",
    title,
  } = {}) {
    const chip = createDomElement(container, "button");
    if (!chip) return null;
    chip.type = "button";
    chip.className = "design-property-chip";
    chip.dataset.propertyGroup = group;
    chip.dataset.propertyValue = option.value;
    if (groupId) {
      chip.dataset.motivationGroupId = groupId;
    }
    if (selected) {
      chip.classList?.add("is-selected");
    }
    chip.disabled = disabled;
    chip.title = title || `${option.label}`;
    const content = createDomElement(chip, "span");
    if (content) {
      content.className = "design-property-chip-content";
      const icon = createDomElement(content, "span");
      if (icon) {
        icon.className = "ui-icon design-property-chip-icon";
        icon.innerHTML = option.icon || "◈";
        content.append(icon);
      }
      const label = createDomElement(content, "span");
      if (label) {
        label.className = "design-property-chip-label";
        label.textContent = option.label;
        content.append(label);
      }
      chip.append(content);
    } else {
      chip.textContent = `${option.icon || "◈"} ${option.label}`;
    }
    const property = { group, value: option.value };
    if (dragEnabled && !disabled) {
      bindChipDrag(chip, property);
    }
    chip.addEventListener?.("click", () => {
      if (chip.disabled) return;
      if (!state.activeCard?.id) {
        setStatus(statusEl, "No active card in the configuration area.", true);
        return;
      }
      applyPropertyDrop(state.activeCard.id, property);
    });
    return chip;
  }

  function renderPropertyChips(container, group, options) {
    if (!container) return;
    const chips = options
      .map((option) => createPropertyChip(container, group, option))
      .filter(Boolean);
    replaceChildren(container, chips);
  }

  function renderPropertyChipPairs(container, group, groups, {
    activeValues = [],
    exclusive = false,
  } = {}) {
    if (!container) return;
    const active = new Set(activeValues);
    const wrappers = groups.map((groupEntry) => {
      const wrapper = createDomElement(container, "div");
      if (!wrapper) return null;
      wrapper.className = "design-property-chip-group";
      wrapper.dataset.propertyGroup = group;
      wrapper.dataset.propertyGroupId = groupEntry.id;
      if (exclusive && groupEntry.options.length > 1) {
        wrapper.dataset.exclusive = "true";
        const note = createDomElement(wrapper, "span");
        if (note) {
          note.className = "design-property-chip-group-note";
          note.textContent = EXCLUSIVE_PAIR_NOTE;
          wrapper.append(note);
        }
      }

      const row = createDomElement(wrapper, "div");
      if (!row) return wrapper;
      row.className = "design-property-chip-pair";
      row.dataset.propertyGroupId = groupEntry.id;
      if (groupEntry.options.length === 1) {
        row.classList?.add("is-single");
      }

      groupEntry.options.forEach((option) => {
        const chip = createPropertyChip(container, group, option, {
          selected: active.has(option.value),
        });
        if (chip) {
          row.append(chip);
        }
      });
      wrapper.append(row);
      return wrapper;
    }).filter(Boolean);
    replaceChildren(container, wrappers);
  }

  function renderMotivationPairChips(container, groups) {
    if (!container) return;
    const activeMotivationList = normalizeMotivationListAllowEmpty(state.activeCard?.motivations);
    const activeMotivations = new Set(activeMotivationList);
    const wrappers = groups.map((group) => {
      const wrapper = createDomElement(container, "div");
      if (!wrapper) return null;
      wrapper.className = "design-property-chip-group";
      wrapper.dataset.propertyGroup = "motivations";
      wrapper.dataset.propertyGroupId = group.id;
      if (group.options.length > 1) {
        wrapper.dataset.exclusive = "true";
        const note = createDomElement(wrapper, "span");
        if (note) {
          note.className = "design-property-chip-group-note";
          note.textContent = EXCLUSIVE_PAIR_NOTE;
          wrapper.append(note);
        }
      }
      const row = createDomElement(wrapper, "div");
      if (!row) return wrapper;
      row.className = "design-property-chip-pair";
      row.dataset.motivationGroupId = group.id;
      if (group.options.length === 1) {
        row.classList?.add("is-single");
      }
      group.options.forEach((option) => {
        const conflictsWith = findMotivationConflict(activeMotivationList, option.value);
        const chip = createPropertyChip(container, "motivations", option, {
          disabled: Boolean(conflictsWith && !activeMotivations.has(option.value)),
          dragEnabled: !conflictsWith || activeMotivations.has(option.value),
          selected: activeMotivations.has(option.value),
          groupId: group.id,
          title: conflictsWith && !activeMotivations.has(option.value)
            ? `${option.label} is unavailable while ${formatDisplayLabel(conflictsWith, conflictsWith)} is selected.`
            : option.label,
        });
        if (chip) {
          row.append(chip);
        }
      });
      wrapper.append(row);
      return wrapper;
    }).filter(Boolean);
    replaceChildren(container, wrappers);
  }

  function renderTypeChips(container, catalog) {
    if (!container) return;

    // Row 1 (C-14): Generation action chips — [Generate Level][Small Room] / [Medium Room][Large Room]
    function makeActionChip(parent, actionValue, label) {
      const chip = createDomElement(parent, "button");
      if (!chip) return null;
      chip.type = "button";
      chip.className = "design-property-chip design-property-chip-action";
      chip.dataset.actionValue = actionValue;
      chip.textContent = label;
      return chip;
    }

    const roomGenWrapper = createDomElement(container, "div");
    if (roomGenWrapper) {
      roomGenWrapper.className = "design-property-chip-group";

      // Pair 1: Generate Level + Small Room
      const genRow1 = createDomElement(roomGenWrapper, "div");
      if (genRow1) {
        genRow1.className = "design-property-chip-pair";
        const genLevelChip = makeActionChip(genRow1, "generate-rooms", "+ Generate Rooms");
        if (genLevelChip) {
          genLevelChip.addEventListener?.("click", () => {
            generateRoomCards();
          });
          genRow1.append(genLevelChip);
        }
        const smallRoomChip = makeActionChip(genRow1, "room-small", "+ Small Room");
        if (smallRoomChip) {
          smallRoomChip.addEventListener?.("click", () => {
            addCard({ type: "room", roomSize: "small" });
            stashActiveCardToGroup("room");
          });
          genRow1.append(smallRoomChip);
        }
        roomGenWrapper.append(genRow1);
      }

      // Pair 2: Medium Room + Large Room
      const genRow2 = createDomElement(roomGenWrapper, "div");
      if (genRow2) {
        genRow2.className = "design-property-chip-pair";
        const mediumRoomChip = makeActionChip(genRow2, "room-medium", "+ Medium Room");
        if (mediumRoomChip) {
          mediumRoomChip.addEventListener?.("click", () => {
            addCard({ type: "room", roomSize: "medium" });
            stashActiveCardToGroup("room");
          });
          genRow2.append(mediumRoomChip);
        }
        const largeRoomChip = makeActionChip(genRow2, "room-large", "+ Large Room");
        if (largeRoomChip) {
          largeRoomChip.addEventListener?.("click", () => {
            addCard({ type: "room", roomSize: "large" });
            stashActiveCardToGroup("room");
          });
          genRow2.append(largeRoomChip);
        }
        roomGenWrapper.append(genRow2);
      }
    }

    // Row 2: Delver + Warden paired
    const actorWrapper = createDomElement(container, "div");
    if (actorWrapper) {
      actorWrapper.className = "design-property-chip-group";
      const actorRow = createDomElement(actorWrapper, "div");
      if (actorRow) {
        actorRow.className = "design-property-chip-pair";
        ["delver", "warden"].forEach((typeVal) => {
          const option = catalog.type.find((o) => o.value === typeVal);
          if (!option) return;
          const chip = createPropertyChip(container, "type", option, {
            selected: state.activeCard?.type === typeVal,
          });
          if (chip) actorRow.append(chip);
        });
        actorWrapper.append(actorRow);
      }
    }

    // Row 3: Hazard + Resource paired
    const itemWrapper = createDomElement(container, "div");
    if (itemWrapper) {
      itemWrapper.className = "design-property-chip-group";
      const itemRow = createDomElement(itemWrapper, "div");
      if (itemRow) {
        itemRow.className = "design-property-chip-pair";
        ["hazard", "resource"].forEach((typeVal) => {
          const option = catalog.type.find((o) => o.value === typeVal);
          if (!option) return;
          const chip = createPropertyChip(container, "type", option, {
            selected: state.activeCard?.type === typeVal,
          });
          if (chip) itemRow.append(chip);
        });
        itemWrapper.append(itemRow);
      }
    }

    replaceChildren(container, [roomGenWrapper, actorWrapper, itemWrapper].filter(Boolean));
  }

  function renderLeftRail() {
    const catalog = buildPropertyCatalog();
    renderTypeChips(leftRailType, catalog);
    renderPropertyChipPairs(leftRailAffinities, "affinities", catalog.affinities);
    renderPropertyChipPairs(leftRailExpressions, "expressions", catalog.expressions);
    renderMotivationPairChips(leftRailMotivations, catalog.motivations);
  }

  function addCard(initial = {}) {
    const card = createDesignCard({
      id: initial.id || buildCardId(initial.type || "untyped"),
      type: initial.type || "",
      count: initial.count || 1,
      affinity: initial.affinity,
      roomSize: initial.roomSize || "medium",
      expressions: initial.expressions,
      motivations: initial.motivations,
      affinities: initial.affinities,
      vitals: initial.vitals,
      setupMode: initial.setupMode || "hybrid",
      tokenHint: initial.tokenHint,
      source: initial.source || "manual",
      flipped: initial.flipped === true,
    });
    state.activeCard = card;
    recompute();
    return card;
  }

  function setCards(cards) {
    const normalized = normalizeDesignCardSet(cards, { dungeonAffinity: state.dungeonAffinity });
    const identified = normalizeCardIdentifiers(normalized, state.activeCard);
    const evaluation = evaluateShelvedCards(identified.cards);
    if (evaluation.overBudget) {
      setStatus(statusEl, `Cannot apply card set: ${describeBudgetViolation(evaluation)}`, true);
      return false;
    }
    state.cards = identified.cards;
    state.activeCard = createEditorCard();
    recompute();
    return true;
  }

  function adjustCount(cardId, delta) {
    const amount = Math.trunc(delta);
    if (amount < 0 && state.activeCard?.id === cardId) {
      const active = createDesignCard(state.activeCard || {});
      const activeType = normalizeCardType(active.type);
      const activeCount = normalizeCardCount(active.count, 1);
      if (activeType && activeCount <= 1) {
        state.activeCard = createEditorCard();
        recompute();
        setStatus(statusEl, "Card reset to blank editor.");
        return true;
      }
    }
    const updated = updateCard(cardId, (card) => adjustCardCount(card, delta));
    if (!updated) return false;
    recompute();
    return true;
  }

  function flipCard(cardId) {
    const updated = updateCard(cardId, (card) => ({
      ...card,
      flipped: card.flipped !== true,
    }));
    if (!updated) return false;
    recompute({ notify: false });
    return true;
  }

  function cycleRoomSize(cardId, direction = 1) {
    const updated = updateCard(cardId, (card) => cycleRoomCardSize(card, direction));
    if (!updated) return false;
    recompute();
    return true;
  }

  function applyPropertyDrop(cardId, property) {
    const updated = updateCard(cardId, (card) => {
      const result = dropPropertyOnCard(card, property);
      if (!result.ok) {
        if (result.reason === "motivation_conflict") {
          const attempted = formatDisplayLabel(result.attempted, result.attempted || "motivation");
          const conflictsWith = formatDisplayLabel(result.conflictsWith, result.conflictsWith || "active motivation");
          setStatus(statusEl, `Drop blocked: ${attempted} conflicts with ${conflictsWith}.`, true);
          return card;
        }
        setStatus(statusEl, `Drop blocked: ${result.reason}.`, true);
        return card;
      }
      setStatus(statusEl, `Applied ${property.group}:${property.value}.`, false);
      return result.card;
    });
    if (!updated) return { ok: false, reason: "missing_card" };
    recompute();
    return { ok: true };
  }

  function setBudget(value) {
    const nextBudget = readPositiveInt(value, DEFAULT_LEVEL_BUDGET_TOKENS);
    const evaluation = evaluateShelvedCards(state.cards, { budgetTokens: nextBudget });
    if (evaluation.overBudget) {
      if (levelBudgetInput) {
        levelBudgetInput.value = String(state.budgetTokens);
      }
      setStatus(statusEl, `Cannot update budget: ${describeBudgetViolation(evaluation)}`, true);
      syncOutputs();
      return false;
    }
    state.budgetTokens = nextBudget;
    if (levelBudgetInput) {
      levelBudgetInput.value = String(state.budgetTokens);
    }
    recompute();
    return true;
  }

  function setBudgetSplit(type, value) {
    if (!BUDGET_BUCKET_ORDER.includes(type)) return false;
    const nextBudgetSplit = {
      ...state.budgetSplitPercent,
      [type]: readBoundedPercent(value, DEFAULT_BUDGET_SPLIT[type]),
    };
    const evaluation = evaluateShelvedCards(state.cards, { budgetSplitPercent: nextBudgetSplit });
    if (evaluation.overBudget) {
      setStatus(statusEl, `Cannot update allocation: ${describeBudgetViolation(evaluation)}`, true);
      syncOutputs();
      return false;
    }
    state.budgetSplitPercent = nextBudgetSplit;
    recompute({ notify: false });
    return true;
  }

  function autoGenerateCards() {
    const allocation = state.allocationLedger || resolveAllocationLedger(state.cards);
    const costContext = {
      tileCosts: state.tileCosts,
      priceList: state.priceList,
    };
    const generatedCards = [
      ...buildAutoGeneratedRoomCards(allocation?.byType?.room?.remainingTokens, costContext),
      ...buildAutoGeneratedActorCards("delver", allocation?.byType?.delver?.remainingTokens, costContext),
      ...buildAutoGeneratedActorCards("warden", allocation?.byType?.warden?.remainingTokens, costContext),
      ...buildAutoGeneratedHazardCards(allocation?.byType?.hazard?.remainingTokens, state.dungeonAffinity, costContext),
      ...buildAutoGeneratedResourceCards(allocation?.byType?.resource?.remainingTokens, costContext),
    ];

    if (generatedCards.length === 0) {
      setStatus(statusEl, "No remaining allocation available for auto-generation.");
      return { ok: false, reason: "no_remaining_allocation", cards: [] };
    }

    const identified = normalizeCardIdentifiers([...state.cards, ...generatedCards], state.activeCard);
    const evaluation = evaluateShelvedCards(identified.cards);
    if (evaluation.allocationLedger?.overBudget) {
      setStatus(statusEl, `Cannot auto-generate cards: ${describeBudgetViolation(evaluation)}`, true);
      return { ok: false, reason: "budget_overflow", cards: generatedCards };
    }

    state.cards = identified.cards;
    const counts = generatedCards.reduce((acc, card) => {
      const type = normalizeCardType(card?.type);
      if (!type) return acc;
      acc[type] = (acc[type] || 0) + normalizeCardCount(card?.count, 1);
      return acc;
    }, {
      room: 0,
      delver: 0,
      warden: 0,
      hazard: 0,
      resource: 0,
    });

    recompute();

    const description = BUDGET_BUCKET_ORDER
      .filter((type) => counts[type] > 0)
      .map((type) => formatAutoGenerateCount(type, counts[type]))
      .join(", ");
    setStatus(statusEl, `Auto-generated ${description} using the remaining allocation.`);

    return {
      ok: true,
      cards: generatedCards,
      counts,
    };
  }

  function generateRoomCards() {
    const allocation = state.allocationLedger || resolveAllocationLedger(state.cards);
    const costContext = {
      tileCosts: state.tileCosts,
      priceList: state.priceList,
    };
    const generatedCards = buildAutoGeneratedRoomCards(allocation?.byType?.room?.remainingTokens, costContext);

    if (generatedCards.length === 0) {
      setStatus(statusEl, "No remaining room allocation available.");
      return { ok: false, reason: "no_remaining_allocation", cards: [] };
    }

    const identified = normalizeCardIdentifiers([...state.cards, ...generatedCards], state.activeCard);
    const evaluation = evaluateShelvedCards(identified.cards);
    if (evaluation.allocationLedger?.overBudget) {
      setStatus(statusEl, `Cannot generate rooms: ${describeBudgetViolation(evaluation)}`, true);
      return { ok: false, reason: "budget_overflow", cards: generatedCards };
    }

    state.cards = identified.cards;
    const count = generatedCards.reduce((acc, card) => acc + normalizeCardCount(card?.count, 1), 0);

    recompute();
    setStatus(statusEl, `Generated ${formatAutoGenerateCount("room", count)} using the remaining room allocation.`);

    return { ok: true, cards: generatedCards, counts: { room: count } };
  }

  async function resolveAiSummary(prompt) {
    if (typeof llmConfig.aiSummary === "function") {
      return llmConfig.aiSummary({ prompt, budgetTokens: state.budgetTokens });
    }
    if (llmConfig.aiSummary && typeof llmConfig.aiSummary === "object") {
      return llmConfig.aiSummary;
    }

    const useFixture = llmConfig.mode === "fixture" || llmConfig.fixtureResponse;
    if (llmConfig.useBudgetLoop) {
      const adapter = useFixture
        ? createFixtureAdapter(llmConfig.fixtureResponse)
        : (llmConfig.adapter || createLlmAdapter({
          baseUrl: llmConfig.baseUrl || DEFAULT_LLM_BASE_URL,
          fetchFn: llmConfig.fetchFn || fetch,
        }));
      const result = await runLlmBudgetLoop({
        adapter,
        model: llmConfig.model || DEFAULT_LLM_MODEL,
        catalog: llmConfig.catalog || { schema: "agent-kernel/PoolCatalog", schemaVersion: 1, entries: [] },
        goal: prompt,
        notes: "Generate card-ready room, delver, and warden outputs.",
        budgetTokens: state.budgetTokens,
        priceList: llmConfig.priceList,
        maxActorRounds: 1,
        runId: `ui_card_ai_${Date.now()}`,
        clock: () => new Date().toISOString(),
      });
      if (!result.ok) {
        throw new Error(result.errors?.[0]?.code || "ai_loop_failed");
      }
      onLlmCapture?.({ captures: result.captures || [] });
      return result.summary;
    }

    const adapter = useFixture
      ? createFixtureAdapter(llmConfig.fixtureResponse)
      : (llmConfig.adapter || createLlmAdapter({
        baseUrl: llmConfig.baseUrl || DEFAULT_LLM_BASE_URL,
        fetchFn: llmConfig.fetchFn || fetch,
      }));

    const session = await runLlmSession({
      adapter,
      model: llmConfig.model || DEFAULT_LLM_MODEL,
      prompt,
      runId: `ui_card_session_${Date.now()}`,
      clock: () => new Date().toISOString(),
      strict: false,
    });
    if (!session.ok) {
      throw new Error(session.errors?.[0]?.code || "ai_session_failed");
    }
    if (session.capture) {
      onLlmCapture?.({ captures: [session.capture] });
    }
    return session.summary;
  }

  async function generateAiConfiguration({ prompt } = {}) {
    if (state.runningAi) {
      return { ok: false, reason: "ai_running" };
    }
    state.runningAi = true;
    const resolvedPrompt = typeof prompt === "string" && prompt.trim()
      ? prompt.trim()
      : DEFAULT_AI_PROMPT;

    setStatus(statusEl, "Generating AI card configuration...");

    try {
      const summary = await resolveAiSummary(resolvedPrompt);
      const nextDungeonAffinity = summary?.dungeonAffinity || state.dungeonAffinity;
      const cards = buildCardsFromSummary(summary, {
        dungeonAffinity: nextDungeonAffinity,
      });
      const identified = normalizeCardIdentifiers(cards, state.activeCard);
      const evaluation = evaluateShelvedCards(identified.cards, { dungeonAffinity: nextDungeonAffinity });
      if (evaluation.overBudget) {
        setStatus(statusEl, `AI configuration rejected: ${describeBudgetViolation(evaluation)}`, true);
        return { ok: false, reason: "budget_overflow", cards: identified.cards };
      }
      state.dungeonAffinity = nextDungeonAffinity;
      state.cards = identified.cards;
      state.activeCard = createEditorCard();
      recompute();
      setStatus(statusEl, "AI configuration applied.");
      return { ok: true, summary: state.summary, cards: state.cards };
    } catch (error) {
      setStatus(statusEl, `AI configuration failed: ${error?.message || String(error)}`, true);
      return { ok: false, reason: "ai_failed", error };
    } finally {
      state.runningAi = false;
    }
  }

  function initialize() {
    setStatus(statusEl, DEFAULT_DESIGN_HELP_TEXT);
    renderLeftRail();
    if (levelBudgetInput?.addEventListener) {
      levelBudgetInput.addEventListener("input", () => {
        setBudget(levelBudgetInput.value);
      });
      levelBudgetInput.value = String(state.budgetTokens);
    }
    if (budgetSplitRoomInput?.addEventListener) {
      budgetSplitRoomInput.addEventListener("input", () => {
        setBudgetSplit("room", budgetSplitRoomInput.value);
      });
      budgetSplitRoomInput.value = String(state.budgetSplitPercent.room);
    }
    if (budgetSplitAttackerInput?.addEventListener) {
      budgetSplitAttackerInput.addEventListener("input", () => {
        setBudgetSplit("delver", budgetSplitAttackerInput.value);
      });
      budgetSplitAttackerInput.value = String(state.budgetSplitPercent.delver);
    }
    if (budgetSplitDefenderInput?.addEventListener) {
      budgetSplitDefenderInput.addEventListener("input", () => {
        setBudgetSplit("warden", budgetSplitDefenderInput.value);
      });
      budgetSplitDefenderInput.value = String(state.budgetSplitPercent.warden);
    }
    if (budgetSplitHazardInput?.addEventListener) {
      budgetSplitHazardInput.addEventListener("input", () => {
        setBudgetSplit("hazard", budgetSplitHazardInput.value);
      });
      budgetSplitHazardInput.value = String(state.budgetSplitPercent.hazard);
    }
    if (budgetSplitResourceInput?.addEventListener) {
      budgetSplitResourceInput.addEventListener("input", () => {
        setBudgetSplit("resource", budgetSplitResourceInput.value);
      });
      budgetSplitResourceInput.value = String(state.budgetSplitPercent.resource);
    }
    recompute();
  }

  /**
   * Atomically load budget + split + cards without triggering intermediate
   * per-step gate checks.  Used by loadBuildSpec so a spec reload never
   * produces a transient over-budget flash from stale card state.
   *
   * @param {{ budgetTokens?: number, budgetSplitPercent?: object, cards?: object[] }} options
   * @returns {boolean} true on success
   */
  function loadState({ budgetTokens: newBudgetTokens, budgetSplitPercent: newSplitPercent, cards: newCards } = {}) {
    if (Number.isFinite(Number(newBudgetTokens))) {
      state.budgetTokens = readPositiveInt(newBudgetTokens, DEFAULT_LEVEL_BUDGET_TOKENS);
      if (levelBudgetInput) levelBudgetInput.value = String(state.budgetTokens);
    }
    if (newSplitPercent && typeof newSplitPercent === "object") {
      for (const key of BUDGET_BUCKET_ORDER) {
        if (newSplitPercent[key] !== undefined) {
          state.budgetSplitPercent[key] = readBoundedPercent(newSplitPercent[key], DEFAULT_BUDGET_SPLIT[key]);
        }
      }
    }
    if (Array.isArray(newCards)) {
      const normalized = normalizeDesignCardSet(newCards, { dungeonAffinity: state.dungeonAffinity });
      const identified = normalizeCardIdentifiers(normalized, state.activeCard);
      state.cards = identified.cards;
      state.activeCard = createEditorCard();
    }
    recompute();
    return true;
  }

  initialize();

  return {
    addCard,
    setCards,
    loadState,
    stashActiveCard: stashActiveCardToGroup,
    mintActiveCard: mintActiveCardToGroup,
    pullCardToEditor,
    applyPropertyDrop,
    adjustCardCount: adjustCount,
    adjustAffinityStack: adjustCardAffinityStack,
    adjustVital: adjustVitalValue,
    adjustTrapMana: adjustTrapManaValue,
    setPrimaryAffinity,
    cycleAffinityExpression: cycleCardAffinityExpression,
    flipCard,
    cycleRoomSize,
    setBudget,
    setBudgetSplit,
    autoGenerateCards,
    generateAiConfiguration,
    buildSummary: () => ({ summary: state.summary, spendLedger: state.spendLedger, cards: state.cards }),
    getActiveCard: () => ({ ...state.activeCard }),
    getCards: () => state.cards.slice(),
    getSummary: () => (state.summary ? { ...state.summary } : null),
    getSpendLedger: () => (state.spendLedger ? { ...state.spendLedger } : null),
    getAllocationLedger: () => (state.allocationLedger ? { ...state.allocationLedger } : null),
    getState: () => ({
      budgetTokens: state.budgetTokens,
      budgetSplitPercent: { ...state.budgetSplitPercent },
    }),
    getSplitSum: () => BUDGET_BUCKET_ORDER.reduce((sum, key) => sum + (state.budgetSplitPercent[key] || 0), 0),
    isSplitOverAllocated: () => BUDGET_BUCKET_ORDER.reduce((sum, key) => sum + (state.budgetSplitPercent[key] || 0), 0) > 100,
    serializeCards: () => serializeDesignCardSet(state.cards, { dungeonAffinity: state.dungeonAffinity }),
    refreshIcons: () => {
      renderLeftRail();
      renderCards();
      renderGroups();
    },
    buildCardsFromSummary,
  };
}

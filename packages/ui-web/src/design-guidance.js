import { createLlmAdapter } from "../../adapters-web/src/adapters/llm/index.js";
import { runLlmBudgetLoop } from "../../runtime/src/personas/orchestrator/llm-budget-loop.js";
import { runLlmSession } from "../../runtime/src/personas/orchestrator/llm-session.js";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_EXPRESSION_SET,
  AFFINITY_KINDS,
  AFFINITY_KIND_SET,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_ROOM_AFFINITY_EXPRESSION,
  DEFAULT_ROOM_AFFINITY_STACKS,
  DEFAULT_ROOM_CARD_AFFINITY,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  ROOM_AFFINITY_STACK_COST_FACTOR,
  DEFAULT_VITALS,
  VITAL_KEYS,
  normalizeVitals as normalizeDomainVitals,
} from "../../runtime/src/contracts/domain-constants.js";
import { evaluateRoomCardLayoutSpend } from "../../runtime/src/personas/allocator/layout-spend.js";
import {
  calculateActorConfigurationUnitCost,
  buildDesignSpendLedger,
} from "../../runtime/src/personas/configurator/spend-proposal.js";
import { MOTIVATION_KINDS } from "../../runtime/src/personas/configurator/motivation-loadouts.js";
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

const DEFAULT_LEVEL_BUDGET_TOKENS = 1000;
const DEFAULT_AI_PROMPT = "Generate a balanced room, attacker, and defender card set for a stealth dungeon run.";
const FIXTURE_DEFAULT_RESPONSE = {
  response: JSON.stringify({
    dungeonAffinity: "fire",
    rooms: [{ affinity: "fire", size: "medium", count: 2 }],
    actors: [{ motivation: "defending", affinity: "earth", count: 2 }],
    attackerConfigs: [{
      setupMode: "hybrid",
      vitalsMax: { health: 10, mana: 6, stamina: 5, durability: 4 },
      vitalsRegen: { health: 1, mana: 1, stamina: 1, durability: 0 },
      affinities: { fire: ["push"], wind: ["emit"] },
      affinityStacks: { fire: 2, wind: 1 },
    }],
  }),
};

export const CARD_TYPE_ORDER = Object.freeze(["room", "attacker", "defender"]);
export const CARD_PROPERTY_GROUP_ORDER = Object.freeze(["type", "affinities", "expressions", "motivations"]);
export const ROOM_SIZE_ORDER = Object.freeze(["small", "medium", "large"]);
const BUDGET_BUCKET_ORDER = Object.freeze(["room", "attacker", "defender"]);
const DEFAULT_BUDGET_SPLIT = Object.freeze({
  room: 55,
  attacker: 20,
  defender: 25,
});
const TYPE_ICON_MAP = Object.freeze({
  room: "🏛️",
  attacker: "⚔️",
  defender: "🛡️",
  untyped: "◻️",
});
const AFFINITY_ICON_MAP = Object.freeze({
  fire: "🔥",
  water: "💧",
  earth: "🪨",
  wind: "🌪️",
  life: "🌿",
  decay: "🧪",
  corrode: "🧫",
  fortify: "🧱",
  light: "🌟",
  dark: "🌑",
});
const EXPRESSION_ICON_MAP = Object.freeze({
  push: "⬆️",
  pull: "⬇️",
  emit: "📡",
});
const MOTIVATION_ICON_MAP = Object.freeze({
  random: "🎲",
  stationary: "🧱",
  exploring: "🧭",
  attacking: "⚔️",
  defending: "🛡️",
  patrolling: "👣",
  reflexive: "⚡",
  goal_oriented: "🎯",
  strategy_focused: "♟️",
});

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
  if (!normalized) return TYPE_ICON_MAP.untyped;
  return TYPE_ICON_MAP[normalized] || TYPE_ICON_MAP.untyped;
}

function iconForAffinity(affinity) {
  const normalized = normalizeAffinity(affinity, "");
  if (!normalized) return "◈";
  return AFFINITY_ICON_MAP[normalized] || "◈";
}

function iconForExpression(expression) {
  const normalized = normalizeExpression(expression, "");
  if (!normalized) return "✦";
  return EXPRESSION_ICON_MAP[normalized] || "✦";
}

function iconForMotivation(motivation) {
  const normalized = typeof motivation === "string" ? motivation.trim().toLowerCase() : "";
  if (!normalized) return "❖";
  return MOTIVATION_ICON_MAP[normalized] || "❖";
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
    attacker: readBoundedPercent(values.attacker, DEFAULT_BUDGET_SPLIT.attacker),
    defender: readBoundedPercent(values.defender, DEFAULT_BUDGET_SPLIT.defender),
  };
}

function setStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#cf3f5b" : "inherit";
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
  const list = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? [values]
      : [];
  const seen = new Set();
  const normalized = list
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter((value) => value && MOTIVATION_KINDS.includes(value) && !seen.has(value) && seen.add(value));
  if (normalized.length > 0) return normalized;
  if (fallback && MOTIVATION_KINDS.includes(fallback)) return [fallback];
  return [];
}

function normalizeMotivationListAllowEmpty(values) {
  const list = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? [values]
      : [];
  const seen = new Set();
  return list
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter((value) => value && MOTIVATION_KINDS.includes(value) && !seen.has(value) && seen.add(value));
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

function defaultActorAffinityForType(type) {
  if (type === "attacker") return DEFAULT_ATTACKER_CARD_AFFINITY;
  if (type === "defender") return DEFAULT_DEFENDER_CARD_AFFINITY;
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

const CARD_ID_SUFFIX_LENGTH = 6;
const CARD_ID_PATTERN = /^([A-Z])-([A-Z0-9]{6})$/;
const CARD_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const UUID_HEX_PATTERN = /^[0-9a-f]{32}$/i;
const CARD_ID_MAX_GENERATION_ATTEMPTS = 256;
const GLOBAL_ISSUED_CARD_IDS = new Set();
const CARD_ID_PREFIX_BY_TYPE = Object.freeze({
  room: "R",
  attacker: "A",
  defender: "D",
  untyped: "C",
});

function cardPrefixForType(type) {
  const normalized = normalizeCardType(type);
  if (normalized === "room") return CARD_ID_PREFIX_BY_TYPE.room;
  if (normalized === "attacker") return CARD_ID_PREFIX_BY_TYPE.attacker;
  if (normalized === "defender") return CARD_ID_PREFIX_BY_TYPE.defender;
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
    flipped: flipped === true,
  };
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
      merged.set(key, { kind, expression, stacks });
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
    type: normalizedType || "defender",
    source: normalizedType === "room" ? "room" : "actor",
    affinity: normalizedAffinityInput,
    roomSize: normalizeRoomCardSize(roomSize),
    count: normalizeCardCount(count, 1),
    expressions: normalizedInputExpressions,
    motivations: hasExplicitEmptyMotivations
      ? []
      : normalizeMotivationList(
        motivations,
        normalizedType === "attacker" ? "attacking" : "defending",
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
    if (hasExplicitEmptyAffinities) {
      normalizedCard.affinities = [];
      normalizedCard.expressions = [];
      return normalizedCard;
    }
    if (!hasExplicitEmptyAffinities && (!Array.isArray(normalizedCard.affinities) || normalizedCard.affinities.length === 0)) {
      const roomAffinity = normalizeAffinity(normalizedCard.affinity, DEFAULT_ROOM_CARD_AFFINITY);
      normalizedCard.affinity = roomAffinity;
      normalizedCard.affinities = buildAffinityEntries({
        affinity: roomAffinity,
        expressions: [DEFAULT_ROOM_AFFINITY_EXPRESSION],
        stacksByAffinity: { [roomAffinity]: DEFAULT_ROOM_AFFINITY_STACKS },
      });
    }
    normalizedCard.expressions = hasExplicitEmptyAffinities
      ? []
      : normalizeExpressionListAllowEmpty(
      normalizedCard.affinities.map((entry) => entry.expression),
      );
    return normalizedCard;
  }

  const fallbackMotivation = normalizedType === "attacker" ? "attacking" : "defending";
  normalizedCard.type = normalizedType || "defender";
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
        source: entry?.source,
        setupMode: entry?.setupMode,
        flipped: entry?.flipped,
        tokenHint: entry?.tokenHint,
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
    attacker: [],
    defender: [],
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
  const applyRoomDefaults = type === "room" && priorType !== "room";
  const applyActorDefaults = type !== "room" && (!priorType || priorType === "room");
  const next = createDesignCard({
    ...card,
    type,
    source: type === "room" ? "room" : "actor",
    affinity: applyRoomDefaults
      ? DEFAULT_ROOM_CARD_AFFINITY
      : applyActorDefaults
        ? undefined
        : card?.affinity,
    affinities: applyRoomDefaults || applyActorDefaults ? undefined : card?.affinities,
    expressions: applyRoomDefaults
      ? [DEFAULT_ROOM_AFFINITY_EXPRESSION]
      : applyActorDefaults
        ? undefined
        : card?.expressions,
    motivations: type === "room"
      ? []
      : normalizeMotivationList(card?.motivations, type === "attacker" ? "attacking" : "defending"),
    vitals: type === "room" ? undefined : card?.vitals,
    roomSize: type === "room" ? card?.roomSize || "medium" : undefined,
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
  if (type !== "attacker" && type !== "defender") {
    return { ok: false, reason: "invalid_card_type", card };
  }
  const motivation = normalizeMotivationList([motivationValue], "")[0];
  if (!motivation) {
    return { ok: false, reason: "invalid_motivation", card };
  }
  const working = createDesignCard(card);
  const current = normalizeMotivationListAllowEmpty(working.motivations);
  const exists = current.includes(motivation);
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
  if (type !== "attacker" && type !== "defender") return working;
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
  const priceMap = new Map(
    (Array.isArray(priceList?.items) ? priceList.items : [])
      .filter((item) => typeof item?.id === "string" && typeof item?.kind === "string" && Number.isFinite(item?.costTokens))
      .map((item) => [`${item.kind}:${item.id}`, item.costTokens]),
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
  const priceMap = new Map(
    (Array.isArray(priceList?.items) ? priceList.items : [])
      .filter((item) => typeof item?.id === "string" && typeof item?.kind === "string" && Number.isFinite(item?.costTokens))
      .map((item) => [`${item.kind}:${item.id}`, item.costTokens]),
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
  return {
    type: CARD_TYPE_ORDER.map((value) => ({
      value,
      label: formatDisplayLabel(value, value),
      icon: iconForType(value),
    })),
    affinities: AFFINITY_KINDS.map((value) => ({
      value,
      label: formatDisplayLabel(value, value),
      icon: iconForAffinity(value),
    })),
    expressions: AFFINITY_EXPRESSIONS.map((value) => ({
      value,
      label: formatDisplayLabel(value, value),
      icon: iconForExpression(value),
    })),
    motivations: MOTIVATION_KINDS.map((value) => ({
      value,
      label: formatDisplayLabel(value, value),
      icon: iconForMotivation(value),
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

export function wireDesignGuidance({ elements = {}, llmConfig = {}, onSummary, onLlmCapture } = {}) {
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
    roomGroupBudget,
    attackerGroupBudget,
    defenderGroupBudget,
    levelBudgetInput,
    budgetSplitRoomInput,
    budgetSplitAttackerInput,
    budgetSplitDefenderInput,
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
      attacker: budgetSplitAttackerInput?.value,
      defender: budgetSplitDefenderInput?.value,
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
      attacker: 0,
      defender: 0,
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
      totalOverBudgetBy: baseOverBy + allocationOverBy,
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
    setGroupValue(attackerGroupBudget, "attacker");
    setGroupValue(defenderGroupBudget, "defender");
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
      budgetSplitAttackerInput.value = String(allocatedByType.attacker.percent);
    }
    if (budgetSplitDefenderInput) {
      budgetSplitDefenderInput.value = String(allocatedByType.defender.percent);
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

  function pullCardToEditor(cardId) {
    const index = state.cards.findIndex((card) => card.id === cardId);
    if (index < 0) return false;
    const [card] = state.cards.splice(index, 1);
    const active = createDesignCard(state.activeCard || {});
    if (isCardConfigured(active) && active.id !== card.id) {
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
    renderGroupList(attackerGroup, grouped.attacker, "attacker");
    renderGroupList(defenderGroup, grouped.defender, "defender");
  }

  function updateCard(cardId, updater) {
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
      state.cards[index] = createDesignCard(next);
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

  function renderCardIconChip(container, { icon, title, className = "" } = {}) {
    const chip = createDomElement(container, "span");
    if (!chip) return null;
    chip.className = `design-card-icon-chip ${className}`.trim();
    chip.textContent = icon || "◈";
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
            const allocatedTokens = readNonNegativeInt(allocation?.allocatedTokens, state.budgetTokens);
            configurationSpend.className = "design-card-meta-chip is-configuration-spend";
            configurationSpend.textContent = `${spentTokens}/${allocatedTokens}`;
            meta.append(configurationSpend);
          }
        }
        front.append(meta);
      }

      const affinityList = createDomElement(front, "div");
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
            affinityButton.textContent = iconForAffinity(entry.kind);
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
            expressionButton.textContent = iconForExpression(entry.expression);
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

          affinityList.append(row);
        });
        front.append(affinityList);
      }

      if (card.type === "attacker" || card.type === "defender") {
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

            const icon = createDomElement(row, "span");
            if (icon) {
              icon.className = "design-card-motivation-icon";
              icon.textContent = iconForMotivation(motivation);
              row.append(icon);
            }
            const label = createDomElement(row, "span");
            if (label) {
              label.className = "design-card-motivation-label";
              label.textContent = formatDisplayLabel(motivation, motivation);
              row.append(label);
            }
            const remove = createDomElement(row, "button");
            if (remove) {
              remove.type = "button";
              remove.className = "design-card-motivation-remove";
              remove.dataset.motivationRemove = motivation;
              remove.textContent = "Remove";
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

          const addList = createDomElement(motivations, "div");
          if (addList) {
            addList.className = "design-card-motivation-add-list";
            const activeMotivations = new Set(motivationEntries);
            MOTIVATION_KINDS
              .filter((motivation) => !activeMotivations.has(motivation))
              .forEach((motivation) => {
                const add = createDomElement(addList, "button");
                if (!add) return;
                add.type = "button";
                add.className = "design-card-motivation-add";
                add.dataset.motivationAdd = motivation;
                add.textContent = `+ ${formatDisplayLabel(motivation, motivation)}`;
                add.addEventListener?.("click", (event) => {
                  event.stopPropagation?.();
                  applyPropertyDrop(card.id, {
                    group: "motivations",
                    value: motivation,
                  });
                });
                addList.append(add);
              });
            motivations.append(addList);
          }
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
              label.textContent = formatDisplayLabel(key, key);
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
            stashActiveCardToGroup(targetType);
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

  function renderPropertyChips(container, group, options) {
    if (!container) return;
    const chips = options.map((option) => {
      const chip = createDomElement(container, "button");
      if (!chip) return null;
      chip.type = "button";
      chip.className = "design-property-chip";
      chip.dataset.propertyGroup = group;
      chip.dataset.propertyValue = option.value;
      chip.title = `${option.label}`;
      const content = createDomElement(chip, "span");
      if (content) {
        content.className = "design-property-chip-content";
        const icon = createDomElement(content, "span");
        if (icon) {
          icon.className = "ui-icon design-property-chip-icon";
          icon.textContent = option.icon || "◈";
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
      bindChipDrag(chip, property);
      chip.addEventListener?.("click", () => {
        if (!state.activeCard?.id) {
          setStatus(statusEl, "No active card in the configuration area.", true);
          return;
        }
        applyPropertyDrop(state.activeCard.id, property);
      });
      return chip;
    }).filter(Boolean);
    replaceChildren(container, chips);
  }

  function renderLeftRail() {
    const catalog = buildPropertyCatalog();
    renderPropertyChips(leftRailType, "type", catalog.type);
    renderPropertyChips(leftRailAffinities, "affinities", catalog.affinities);
    renderPropertyChips(leftRailExpressions, "expressions", catalog.expressions);
    renderPropertyChips(leftRailMotivations, "motivations", catalog.motivations);
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
        notes: "Generate card-ready room, attacker, and defender outputs.",
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
        setBudgetSplit("attacker", budgetSplitAttackerInput.value);
      });
      budgetSplitAttackerInput.value = String(state.budgetSplitPercent.attacker);
    }
    if (budgetSplitDefenderInput?.addEventListener) {
      budgetSplitDefenderInput.addEventListener("input", () => {
        setBudgetSplit("defender", budgetSplitDefenderInput.value);
      });
      budgetSplitDefenderInput.value = String(state.budgetSplitPercent.defender);
    }
    recompute();
  }

  initialize();

  return {
    addCard,
    setCards,
    stashActiveCard: stashActiveCardToGroup,
    pullCardToEditor,
    applyPropertyDrop,
    adjustCardCount: adjustCount,
    adjustAffinityStack: adjustCardAffinityStack,
    adjustVital: adjustVitalValue,
    setPrimaryAffinity,
    cycleAffinityExpression: cycleCardAffinityExpression,
    flipCard,
    cycleRoomSize,
    setBudget,
    setBudgetSplit,
    generateAiConfiguration,
    buildSummary: () => ({ summary: state.summary, spendLedger: state.spendLedger, cards: state.cards }),
    getActiveCard: () => ({ ...state.activeCard }),
    getCards: () => state.cards.slice(),
    getSummary: () => (state.summary ? { ...state.summary } : null),
    getSpendLedger: () => (state.spendLedger ? { ...state.spendLedger } : null),
    serializeCards: () => serializeDesignCardSet(state.cards, { dungeonAffinity: state.dungeonAffinity }),
    buildCardsFromSummary,
  };
}

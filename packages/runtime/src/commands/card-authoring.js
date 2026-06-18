import {
  AFFINITY_EXPRESSION_SET,
  AFFINITY_KIND_SET,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_ROOM_AFFINITY_EXPRESSION,
  DEFAULT_ROOM_CARD_AFFINITY,
  DEFAULT_VITALS,
  VITAL_KEYS,
  normalizeVitals as normalizeDomainVitals,
} from "../contracts/domain-constants.js";
import { evaluateRoomCardLayoutSpend } from "../personas/allocator/layout-spend.js";
import { normalizePriceItems } from "../personas/allocator/validate-spend.js";
import {
  calculateActorConfigurationUnitCost,
  buildDesignSpendLedger,
} from "../personas/configurator/spend-proposal.js";
import {
  getConflictingMotivationKinds,
  normalizeMotivationKindList,
} from "../personas/configurator/motivation-loadouts.js";
import {
  buildCardSetFromSummary,
  extractSummaryFromCardSet,
  normalizeCardEntry,
} from "../personas/director/summary-selections.js";
import {
  normalizeCardType,
  normalizeCardCount,
  normalizeRoomCardSize,
} from "../personas/configurator/card-model.js";

// Removed from domain-constants in cost refactor (046f786); kept local to preserve display scale.
const ROOM_AFFINITY_STACK_COST_FACTOR = 0.1;

const DEFAULT_LEVEL_BUDGET_TOKENS = 2500;

const CARD_TYPE_ORDER = Object.freeze(["room", "delver", "warden", "hazard", "resource"]);

const CARD_PROPERTY_GROUP_ORDER = Object.freeze(["type", "affinities", "expressions", "motivations"]);

const ROOM_SIZE_ORDER = Object.freeze(["small", "medium", "large"]);

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

function formatDisplayLabel(value, fallback = "") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value
    .trim()
    .split("_")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
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

function createDesignCard({
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

function normalizeDesignCardSet(cards, { dungeonAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
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

function serializeDesignCardSet(cards, options = {}) {
  const normalized = normalizeDesignCardSet(cards, options);
  const serialized = normalized
    .map((card) => stableCardForSerialize(card))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(serialized, null, 2);
}

function buildCardsFromSummary(summary, { dungeonAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  const cards = buildCardSetFromSummary(summary || {});
  return normalizeDesignCardSet(cards, { dungeonAffinity });
}

function groupCardsByType(cards = []) {
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

function dropPropertyOnCard(card, property) {
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

function adjustCardCount(card, delta = 0) {
  const working = createDesignCard(card || {});
  const nextCount = Math.max(1, normalizeCardCount(working.count, 1) + Math.trunc(delta));
  working.count = nextCount;
  return createDesignCard(working);
}

function adjustAffinityStack(card, affinityKind, delta = 0, expressionValue = undefined) {
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

function adjustCardVital(card, vitalKey, field, delta = 0) {
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

function adjustTrapManaVital(card, affinityKind, field, delta = 0) {
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

function cycleRoomCardSize(card, direction = 1) {
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

function calculateCardValue(card, { tileCosts, priceList } = {}) {
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

function buildSummaryFromCardSet({
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

export {
  BUDGET_BUCKET_ORDER,
  CARD_PROPERTY_GROUP_ORDER,
  CARD_TYPE_ORDER,
  DEFAULT_BUDGET_SPLIT,
  DEFAULT_LEVEL_BUDGET_TOKENS,
  GLOBAL_ISSUED_CARD_IDS,
  RESOURCE_PERMANENT_MULTIPLIER,
  RESOURCE_VITAL_KEYS,
  ROOM_SIZE_ORDER,
  adjustAffinityStack,
  adjustCardCount,
  adjustCardVital,
  adjustTrapManaVital,
  applyExpressionDrop,
  buildAutoGeneratedActorCards,
  buildAutoGeneratedHazardCards,
  buildAutoGeneratedResourceCards,
  buildAutoGeneratedRoomCards,
  buildCardId,
  buildCardReceipt,
  buildCardsFromSummary,
  buildSummaryFromCardSet,
  calculateCardValue,
  cardPrefixForType,
  createDesignCard,
  cycleRoomCardSize,
  dropPropertyOnCard,
  formatDisplayLabel,
  groupCardsByType,
  findMotivationConflict,
  normalizeAffinity,
  normalizeBudgetSplit,
  normalizeDesignCardSet,
  normalizeExpression,
  normalizeMotivationListAllowEmpty,
  parseGeneratedCardId,
  readBoundedPercent,
  readNonNegativeInt,
  readPositiveInt,
  resolveExpressionAffinityTarget,
  serializeDesignCardSet,
  toggleHazardVital,
};

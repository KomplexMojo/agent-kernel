import {
  DELVER_SETUP_MODE_SET,
  DEFAULT_DELVER_SETUP_MODE,
  AFFINITY_EXPRESSION_SET,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_ROOM_CARD_AFFINITY,
  DEFAULT_VITALS,
  VITAL_KEYS,
  normalizeVitals as normalizeDomainVitals,
} from "../../contracts/domain-constants.js";
import {
  buildRoomDesignFromRoomCards,
  deriveLayoutFromRoomCards,
  normalizeCardCount,
  normalizeCardType,
  normalizeRoomCardSize,
} from "../configurator/card-model.js";
import { normalizeMotivationKindList } from "../configurator/motivation-loadouts.js";

function normalizePositiveInt(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.floor(num));
}

function normalizeTokenHint(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.floor(num);
}

function normalizeAffinityEntries(
  affinities,
  fallbackKind,
  { fallbackExpression = DEFAULT_AFFINITY_EXPRESSION, fallbackStacks = 1 } = {},
) {
  const normalized = Array.isArray(affinities)
    ? affinities
      .map((entry) => {
        const kind = typeof entry?.kind === "string" && entry.kind.trim() ? entry.kind.trim() : undefined;
        const expression = typeof entry?.expression === "string" && AFFINITY_EXPRESSION_SET.has(entry.expression.trim())
          ? entry.expression.trim()
          : undefined;
        if (!kind || !expression) return null;
        const normalized = {
          kind,
          expression,
          stacks: normalizePositiveInt(entry?.stacks, 1),
        };
        if (entry?.hazardVitals && typeof entry.hazardVitals === "object") {
          normalized.hazardVitals = entry.hazardVitals;
        }
        return normalized;
      })
      .filter(Boolean)
    : [];
  if (normalized.length > 0) return normalized;
  if (fallbackKind) {
    return [{
      kind: fallbackKind,
      expression: fallbackExpression,
      stacks: normalizePositiveInt(fallbackStacks, 1),
    }];
  }
  return [];
}

function normalizeVitals(vitals) {
  return normalizeDomainVitals(vitals, DEFAULT_VITALS);
}

function normalizeSetupMode(value) {
  if (typeof value !== "string") return DEFAULT_DELVER_SETUP_MODE;
  const normalized = value.trim();
  return DELVER_SETUP_MODE_SET.has(normalized) ? normalized : DEFAULT_DELVER_SETUP_MODE;
}

function normalizeHazardVital(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }
  const kind = typeof value.kind === "string" ? value.kind.trim().toLowerCase() : "";
  if (kind === "regen") {
    const current = normalizePositiveInt(value.current, fallback.current);
    const max = normalizePositiveInt(value.max, fallback.max);
    const regen = Math.max(0, Number.isFinite(Number(value.regen)) ? Math.floor(Number(value.regen)) : fallback.regen);
    return {
      kind: "regen",
      current: Math.min(current, max),
      max,
      regen,
    };
  }
  return {
    kind: "one-time",
    amount: Math.max(0, Number.isFinite(Number(value.amount)) ? Math.floor(Number(value.amount)) : fallback.amount),
  };
}

function normalizeVitalsConfigMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return VITAL_KEYS.reduce((acc, key) => {
    if (!Number.isInteger(value[key]) || value[key] < 0) return acc;
    acc[key] = value[key];
    return acc;
  }, {});
}

function applyVitalMaxOverrides(vitals, vitalsMax) {
  const overrides = normalizeVitalsConfigMap(vitalsMax);
  if (Object.keys(overrides).length === 0) return vitals;
  const next = { ...vitals };
  VITAL_KEYS.forEach((key) => {
    const nextMax = overrides[key];
    if (!Number.isInteger(nextMax)) return;
    next[key] = {
      ...next[key],
      current: nextMax,
      max: nextMax,
    };
  });
  return next;
}

function normalizeStringList(value, fallback) {
  const raw = Array.isArray(value)
    ? value
    : typeof fallback === "string" && fallback.trim()
      ? [fallback.trim()]
      : [];
  const seen = new Set();
  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry && !seen.has(entry) && seen.add(entry));
}

function normalizeMotivationKinds(value, fallback) {
  const raw = Array.isArray(value)
    ? value
    : typeof fallback === "string" && fallback.trim()
      ? [fallback.trim()]
      : [];
  return normalizeMotivationKindList(raw, {
    allowEmpty: true,
    fieldBase: "motivations",
  }).value;
}

function isAttackingMotivation(value) {
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase().includes("attack");
}

function normalizeActorType(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "delver" || normalized === "warden" ? normalized : fallback;
}

function pickHasAttackingMotivation(pick) {
  const motivations = normalizeMotivationKinds(
    pick?.motivations,
    pick?.motivation || pick?.role || "",
  );
  if (motivations.some((entry) => isAttackingMotivation(entry))) return true;
  return isAttackingMotivation(pick?.motivation || pick?.role || "");
}

function normalizeCardAffinity(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return DEFAULT_DUNGEON_AFFINITY;
}

function readCardSet(summary) {
  if (Array.isArray(summary?.cardSet)) return summary.cardSet;
  if (Array.isArray(summary?.cards)) return summary.cards;
  return null;
}

function buildAffinityMapForDelverConfig(affinities = []) {
  const config = {};
  const stacks = {};
  affinities.forEach((entry) => {
    const kind = typeof entry?.kind === "string" ? entry.kind.trim() : "";
    const expression = typeof entry?.expression === "string" ? entry.expression.trim() : "";
    if (!kind || !expression) return;
    if (!Array.isArray(config[kind])) config[kind] = [];
    if (!config[kind].includes(expression)) config[kind].push(expression);
    const count = normalizePositiveInt(entry?.stacks, 1);
    stacks[kind] = Math.max(stacks[kind] || 0, count);
  });
  return { affinities: config, affinityStacks: stacks };
}

function buildVitalsConfigForDelver(vitals) {
  const normalized = normalizeVitals(vitals);
  const vitalsMax = {};
  const vitalsRegen = {};
  VITAL_KEYS.forEach((key) => {
    const record = normalized[key];
    vitalsMax[key] = Number.isInteger(record?.max) ? record.max : 0;
    vitalsRegen[key] = Number.isInteger(record?.regen) ? record.regen : 0;
  });
  return { vitalsMax, vitalsRegen };
}

function expandDelverConfigsFromCards(cards = [], dungeonAffinity = DEFAULT_DUNGEON_AFFINITY) {
  const configs = [];
  cards.forEach((card) => {
    const count = normalizeCardCount(card?.count, 1);
    const affinityMap = buildAffinityMapForDelverConfig(card?.affinities || []);
    const vitalsConfig = buildVitalsConfigForDelver(card?.vitals);
    const config = {
      setupMode: normalizeSetupMode(card?.setupMode),
      affinities: affinityMap.affinities,
      affinityStacks: affinityMap.affinityStacks,
      ...vitalsConfig,
      dungeonAffinity,
    };
    for (let idx = 0; idx < count; idx += 1) {
      configs.push({ ...config });
    }
  });
  return configs;
}

function delverConfigToAffinityEntries(config, dungeonAffinity) {
  const affinityMap = config?.affinities && typeof config.affinities === "object"
    ? config.affinities
    : {};
  const stackMap = config?.affinityStacks && typeof config.affinityStacks === "object"
    ? config.affinityStacks
    : {};
  const entries = [];
  Object.entries(affinityMap).forEach(([kind, expressions]) => {
    const list = Array.isArray(expressions) ? expressions : [];
    const stacks = normalizePositiveInt(stackMap[kind], 1);
    if (list.length === 0) {
      entries.push({ kind, expression: DEFAULT_AFFINITY_EXPRESSION, stacks });
      return;
    }
    list.forEach((expression) => {
      if (!AFFINITY_EXPRESSION_SET.has(String(expression || "").trim())) return;
      entries.push({ kind, expression: String(expression).trim(), stacks });
    });
  });
  if (entries.length > 0) return entries;
  return [{ kind: dungeonAffinity, expression: DEFAULT_AFFINITY_EXPRESSION, stacks: 1 }];
}

function delverConfigToVitals(config) {
  const vitals = {};
  VITAL_KEYS.forEach((key) => {
    const max = Number.isInteger(config?.vitalsMax?.[key]) ? config.vitalsMax[key] : DEFAULT_VITALS[key].max;
    const regen = Number.isInteger(config?.vitalsRegen?.[key]) ? config.vitalsRegen[key] : DEFAULT_VITALS[key].regen;
    vitals[key] = {
      current: max,
      max,
      regen,
    };
  });
  return normalizeVitals(vitals);
}

export function normalizeSummaryPick(
  entry,
  {
    dungeonAffinity = DEFAULT_DUNGEON_AFFINITY,
    source = "actor",
    delverConfig,
  } = {},
) {
  const id = typeof entry?.id === "string" && entry.id.trim()
    ? entry.id.trim()
    : "";
  const defaultAffinity = source === "room"
    ? DEFAULT_ROOM_CARD_AFFINITY
    : (dungeonAffinity || DEFAULT_DUNGEON_AFFINITY);
  const motivation = normalizeMotivationKinds(
    entry?.motivations,
    entry?.role || entry?.motivation || "stationary",
  )[0] || "stationary";
  const affinity = typeof entry?.affinity === "string" && entry.affinity.trim()
    ? entry.affinity.trim()
    : defaultAffinity;
  const count = normalizePositiveInt(entry?.count, 1);
  const tokenHint = normalizeTokenHint(entry?.tokenHint);
  const affinities = source === "room"
    ? []
    : normalizeAffinityEntries(entry?.affinities, affinity);
  const setupMode = normalizeSetupMode(entry?.setupMode ?? entry?.mode ?? delverConfig?.setupMode);
  const actorType = source === "actor"
    ? normalizeActorType(entry?.actorType ?? entry?.type)
    : "";
  const pick = { motivation, affinity, count };
  if (id) pick.id = id;
  if (actorType) pick.actorType = actorType;
  if (tokenHint !== undefined) pick.tokenHint = tokenHint;
  if (affinities.length > 0) pick.affinities = affinities;
  if (source === "room") {
    const roomSize = normalizeRoomCardSize(entry?.size ?? entry?.roomSize);
    pick.size = roomSize;
    return pick;
  }
  pick.setupMode = setupMode;
  const withMaxOverrides = applyVitalMaxOverrides(
    normalizeVitals(entry?.vitals),
    delverConfig?.vitalsMax,
  );
  pick.vitals = withMaxOverrides;
  return pick;
}

export function normalizeCardEntry(entry, { dungeonAffinity = DEFAULT_DUNGEON_AFFINITY, index = 0 } = {}) {
  const fallbackType = entry?.source === "room"
    ? "room"
    : entry?.source === "hazard"
      ? "hazard"
    : entry?.source === "resource"
      ? "resource"
      : "warden";
  const type = normalizeCardType(entry?.type) || fallbackType;
  const affinity = normalizeCardAffinity(
    entry?.affinity,
    type === "room" ? DEFAULT_ROOM_CARD_AFFINITY : dungeonAffinity,
  );
  const count = normalizeCardCount(entry?.count, 1);
  const tokenHint = normalizeTokenHint(entry?.tokenHint);
  const normalizedAffinities = type === "room"
    ? []
    : type === "hazard"
      ? normalizeAffinityEntries(entry?.affinities, affinity).slice(0, 1).map((hazardAffinity) => ({
        ...hazardAffinity,
        stacks: 1,
      }))
    : type === "resource"
      ? []
      : normalizeAffinityEntries(entry?.affinities, affinity);
  const expressions = normalizeStringList(
    normalizedAffinities.map((affinityEntry) => affinityEntry.expression),
    DEFAULT_AFFINITY_EXPRESSION,
  );
  const motivations = type === "room" || type === "hazard" || type === "resource"
    ? []
    : normalizeMotivationKinds(
      entry?.motivations,
      entry?.motivation || entry?.role || (type === "delver" ? "attacking" : "defending"),
    );
  const id = typeof entry?.id === "string" && entry.id.trim()
    ? entry.id.trim()
    : `card_${type}_${index + 1}`;

  const card = {
    id,
    type,
    source: entry?.source === "room"
      ? "room"
      : type === "hazard"
        ? "hazard"
        : type === "resource"
          ? "resource"
          : "actor",
    count,
    affinity,
    affinities: normalizedAffinities,
    expressions,
    motivations,
    setupMode: normalizeSetupMode(entry?.setupMode),
    roomSize: type === "room" ? normalizeRoomCardSize(entry?.roomSize ?? entry?.size) : undefined,
    tokenHint,
    vitals: type === "resource"
      ? (Array.isArray(entry?.vitals) ? entry.vitals : undefined)
      : (type === "room" || type === "hazard" ? undefined : normalizeVitals(entry?.vitals)),
    resourceVitals: type === "resource" && entry?.resourceVitals && typeof entry.resourceVitals === "object"
      ? { ...entry.resourceVitals }
      : undefined,
    proximityRadius: type === "hazard" ? normalizePositiveInt(entry?.proximityRadius, 1) : undefined,
    mana: type === "hazard" ? normalizeHazardVital(entry?.mana, { kind: "one-time", amount: 3 }) : undefined,
    durability: type === "room" && entry?.durability ? normalizeHazardVital(entry.durability, { kind: "one-time", amount: 1 }) : undefined,
    tier: type === "resource" ? entry?.tier : undefined,
    stat: type === "resource" ? entry?.stat : undefined,
    delta: type === "resource" && Number.isFinite(Number(entry?.delta)) ? Number(entry.delta) : undefined,
    dropRate: type === "resource" && Number.isFinite(Number(entry?.dropRate)) ? Math.floor(Number(entry.dropRate)) : undefined,
    permanenceMode: type === "resource" ? entry?.permanenceMode : undefined,
    permanent: type === "resource" ? entry?.permanent === true : undefined,
    budgetCeiling: type === "resource" && Number.isFinite(Number(entry?.budgetCeiling))
      ? Math.max(0, Math.floor(Number(entry.budgetCeiling)))
      : undefined,
    flipped: entry?.flipped === true,
  };
  return card;
}

export function normalizeCardSet(cardSet, { dungeonAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
  if (!Array.isArray(cardSet)) return [];
  const seen = new Set();
  return cardSet
    .map((entry, index) => normalizeCardEntry(entry, { dungeonAffinity, index }))
    .filter((entry) => {
      if (!entry || !entry.id) return false;
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}

function cardEntryToRoomPick(card, dungeonAffinity) {
  return normalizeSummaryPick(
    {
      id: card.id,
      role: "stationary",
      affinity: card.affinity || dungeonAffinity,
      count: card.count,
      tokenHint: card.tokenHint,
      affinities: card.affinities,
      roomSize: card.roomSize,
      size: card.roomSize,
    },
    { dungeonAffinity, source: "room" },
  );
}

function cardEntryToWardenPick(card, dungeonAffinity) {
  return normalizeSummaryPick(
    {
      id: card.id,
      actorType: "warden",
      role: card.motivations?.[0] || "defending",
      affinity: card.affinity || dungeonAffinity,
      count: card.count,
      tokenHint: card.tokenHint,
      affinities: card.affinities,
      vitals: card.vitals,
      setupMode: card.setupMode,
    },
    { dungeonAffinity, source: "actor" },
  );
}

function cardEntryToDelverPick(card, dungeonAffinity) {
  return normalizeSummaryPick(
    {
      id: card.id,
      actorType: "delver",
      motivations: Array.isArray(card.motivations) && card.motivations.length > 0 ? card.motivations : ["attacking", "user_controlled"],
      role: card.motivations?.[0] || "attacking",
      affinity: card.affinity || dungeonAffinity,
      count: card.count,
      tokenHint: card.tokenHint,
      affinities: card.affinities,
      vitals: card.vitals,
      setupMode: card.setupMode,
    },
    { dungeonAffinity, source: "actor" },
  );
}

function cardEntryToDelverConfig(card, dungeonAffinity) {
  const affinityMap = buildAffinityMapForDelverConfig(card.affinities || []);
  const vitalsConfig = buildVitalsConfigForDelver(card.vitals);
  return {
    setupMode: normalizeSetupMode(card.setupMode),
    affinities: affinityMap.affinities,
    affinityStacks: affinityMap.affinityStacks,
    ...vitalsConfig,
    dungeonAffinity,
  };
}

function reduceDelverConfigsToCards(delverConfigs = [], dungeonAffinity = DEFAULT_DUNGEON_AFFINITY) {
  const grouped = new Map();
  delverConfigs.forEach((config) => {
    if (!config || typeof config !== "object" || Array.isArray(config)) return;
    const normalizedConfig = {
      setupMode: normalizeSetupMode(config.setupMode),
      affinities: config.affinities && typeof config.affinities === "object" ? config.affinities : {},
      affinityStacks: config.affinityStacks && typeof config.affinityStacks === "object" ? config.affinityStacks : {},
      vitalsMax: normalizeVitalsConfigMap(config.vitalsMax),
      vitalsRegen: normalizeVitalsConfigMap(config.vitalsRegen),
    };
    const signature = JSON.stringify(normalizedConfig);
    const existing = grouped.get(signature);
    if (existing) {
      existing.count += 1;
      return;
    }
    grouped.set(signature, {
      setupMode: normalizedConfig.setupMode,
      affinities: delverConfigToAffinityEntries(config, dungeonAffinity),
      vitals: delverConfigToVitals(config),
      count: 1,
    });
  });

  return Array.from(grouped.values()).map((entry, index) => ({
    id: `card_delver_${index + 1}`,
    type: "delver",
    source: "actor",
    count: entry.count,
    affinity: entry.affinities[0]?.kind || dungeonAffinity,
    affinities: entry.affinities,
    expressions: normalizeStringList(entry.affinities.map((affinityEntry) => affinityEntry.expression), DEFAULT_AFFINITY_EXPRESSION),
    motivations: ["attacking", "user_controlled"],
    setupMode: entry.setupMode,
    vitals: entry.vitals,
    flipped: false,
  }));
}

export function buildCardSetFromSummary(summary) {
  const dungeonAffinity = typeof summary?.dungeonAffinity === "string" && summary.dungeonAffinity.trim()
    ? summary.dungeonAffinity.trim()
    : DEFAULT_DUNGEON_AFFINITY;
  const existingCards = readCardSet(summary);
  if (Array.isArray(existingCards) && existingCards.length > 0) {
    return normalizeCardSet(existingCards, { dungeonAffinity });
  }

  const rooms = Array.isArray(summary?.rooms) ? summary.rooms : [];
  const hazards = Array.isArray(summary?.hazards) ? summary.hazards : [];
  const actors = Array.isArray(summary?.actors) ? summary.actors : [];
  const delverConfigs = Array.isArray(summary?.delverConfigs)
    ? summary.delverConfigs.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : summary?.delverConfig && typeof summary.delverConfig === "object"
      ? [summary.delverConfig]
      : [];

  const roomCards = rooms.map((entry, index) => normalizeCardEntry(
    {
      id: entry?.id || `card_room_${index + 1}`,
      type: "room",
      source: "room",
      count: entry?.count,
      affinity: entry?.affinity,
      roomSize: entry?.size,
      size: entry?.size,
      tokenHint: entry?.tokenHint,
      affinities: entry?.affinities,
      motivations: [],
    },
    { dungeonAffinity, index },
  ));

  const hazardCards = hazards.map((entry, index) => normalizeCardEntry(
    {
      id: entry?.id || `card_hazard_${index + 1}`,
      type: "hazard",
      source: "hazard",
      count: entry?.count,
      affinity: entry?.affinity,
      affinities: [{ kind: entry?.affinity, expression: entry?.expression, stacks: 1 }],
      expressions: [entry?.expression],
      proximityRadius: entry?.proximityRadius,
      mana: entry?.mana,
      durability: entry?.durability,
      tokenHint: entry?.tokenHint,
    },
    { dungeonAffinity, index },
  ));

  const actorCards = actors.map((entry, index) => {
    const motivations = normalizeMotivationKinds(
      entry?.motivations,
      entry?.motivation || entry?.role || "defending",
    );
    const explicitType = normalizeActorType(entry?.actorType ?? entry?.type);
    const delver = explicitType
      ? explicitType === "delver"
      : motivations.some((motivation) => isAttackingMotivation(motivation));
    const type = explicitType || (delver ? "delver" : "warden");
    return normalizeCardEntry(
    {
      id: entry?.id || `card_${type}_${index + 1}`,
      type,
      source: "actor",
      count: entry?.count,
      affinity: entry?.affinity,
      tokenHint: entry?.tokenHint,
      affinities: entry?.affinities,
      motivations,
      vitals: entry?.vitals,
      setupMode: entry?.setupMode,
    },
    { dungeonAffinity, index },
  );
  });

  const hasDelverCardsFromActors = actorCards.some((card) => card?.type === "delver");
  const delverCardsFromConfigs = hasDelverCardsFromActors
    ? []
    : reduceDelverConfigsToCards(delverConfigs, dungeonAffinity);
  return normalizeCardSet([...roomCards, ...hazardCards, ...delverCardsFromConfigs, ...actorCards], { dungeonAffinity });
}

export function extractSummaryFromCardSet(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return summary;
  }
  const dungeonAffinity = typeof summary.dungeonAffinity === "string" && summary.dungeonAffinity.trim()
    ? summary.dungeonAffinity.trim()
    : DEFAULT_DUNGEON_AFFINITY;
  const cardInput = readCardSet(summary);
  if (!Array.isArray(cardInput) || cardInput.length === 0) {
    return { ...summary };
  }

  const cardSet = normalizeCardSet(cardInput, { dungeonAffinity });
  const roomCards = cardSet.filter((card) => card.type === "room");
  const hazardCards = cardSet.filter((card) => card.type === "hazard");
  const resourceCards = cardSet.filter((card) => card.type === "resource");
  const delverCards = cardSet.filter((card) => card.type === "delver");
  const actorCards = cardSet.filter((card) => card.type === "delver" || card.type === "warden");

  const rooms = roomCards.map((card) => cardEntryToRoomPick(card, dungeonAffinity));
  const hazards = hazardCards.map((card) => ({
    id: card.id,
    affinity: card.affinity || dungeonAffinity,
    expression: card.affinities?.[0]?.expression || card.expressions?.[0] || DEFAULT_AFFINITY_EXPRESSION,
    proximityRadius: normalizePositiveInt(card.proximityRadius, 1),
    mana: normalizeHazardVital(card.mana, { kind: "one-time", amount: 3 }),
    tokenHint: normalizeTokenHint(card.tokenHint),
  }));
  const resources = resourceCards.map((card) => ({
    id: card.id,
    permanenceMode: card.permanenceMode,
    vitals: card.vitals,
    resourceVitals: card.resourceVitals,
    permanent: card.permanent,
    tier: card.tier,
    stat: card.stat,
    delta: card.delta,
    dropRate: card.dropRate,
    budgetCeiling: card.budgetCeiling,
  }));
  const actors = actorCards.map((card) => (
    card.type === "delver"
      ? cardEntryToDelverPick(card, dungeonAffinity)
      : cardEntryToWardenPick(card, dungeonAffinity)
  ));
  const delverConfigs = expandDelverConfigsFromCards(delverCards, dungeonAffinity);
  const layoutFromCards = deriveLayoutFromRoomCards(roomCards);
  const roomDesignFromCards = buildRoomDesignFromRoomCards(roomCards);

  const resolved = {
    ...summary,
    dungeonAffinity,
    cardSet,
    rooms,
    hazards,
    resources,
    actors,
  };

  if (layoutFromCards) {
    resolved.layout = layoutFromCards;
  }
  if (roomDesignFromCards) {
    resolved.roomDesign = {
      ...(summary.roomDesign && typeof summary.roomDesign === "object" && !Array.isArray(summary.roomDesign)
        ? summary.roomDesign
        : {}),
      ...roomDesignFromCards,
    };
  }

  if (delverConfigs.length > 0) {
    resolved.delverConfigs = delverConfigs;
    resolved.delverConfig = { ...delverConfigs[0] };
    resolved.delverCount = delverConfigs.length;
  } else {
    delete resolved.delverConfigs;
    delete resolved.delverConfig;
    delete resolved.delverCount;
  }

  return resolved;
}

function pickToSelection(pick, kind, index, dungeonAffinity) {
  const normalizedPick = normalizeSummaryPick(pick, {
    dungeonAffinity,
    source: kind === "room" ? "room" : "actor",
    delverConfig: pick?.delverConfig,
  });
  const cost = normalizedPick.tokenHint || 1;
  const subType = kind === "room" ? "static" : "dynamic";
  const fallbackBaseId = `${kind}_${normalizedPick.motivation}_${normalizedPick.affinity}_${index + 1}`;
  const requestedId = typeof normalizedPick?.id === "string" && normalizedPick.id.trim()
    ? normalizedPick.id.trim()
    : "";
  const baseId = requestedId || fallbackBaseId;
  const actorType = kind === "actor"
    ? normalizeActorType(
      normalizedPick.actorType,
      pickHasAttackingMotivation(normalizedPick) ? "delver" : "warden",
    )
    : "";

  return {
    kind,
    requested: normalizedPick,
    applied: {
      id: baseId,
      subType,
      motivation: normalizedPick.motivation,
      affinity: normalizedPick.affinity,
      cost,
    },
    receipt: {
      status: "approved",
      reason: "from_summary",
      count: normalizedPick.count,
    },
    instances: Array.from({ length: normalizedPick.count }, (_, itemIndex) => {
      const instance = {
        id: `${baseId}-${itemIndex + 1}`,
        baseId,
        subType,
        motivation: normalizedPick.motivation,
        affinity: normalizedPick.affinity,
        cost,
      };
      if (actorType) {
        instance.actorType = actorType;
      }
      if (Array.isArray(normalizedPick.affinities) && normalizedPick.affinities.length > 0) {
        instance.affinities = normalizedPick.affinities.map((entry) => ({ ...entry }));
      }
      if (normalizedPick.vitals) {
        instance.vitals = VITAL_KEYS.reduce((acc, vitalKey) => {
          const record = normalizedPick.vitals[vitalKey];
          if (record) acc[vitalKey] = { ...record };
          return acc;
        }, {});
      }
      if (kind !== "room") {
        instance.setupMode = normalizedPick.setupMode;
      }
      return instance;
    }),
  };
}

export function buildSelectionsFromSummary(summary) {
  const resolvedSummary = extractSummaryFromCardSet(summary);
  const dungeonAffinity = typeof resolvedSummary?.dungeonAffinity === "string"
    ? resolvedSummary.dungeonAffinity
    : DEFAULT_DUNGEON_AFFINITY;
  const delverConfigs = Array.isArray(resolvedSummary?.delverConfigs)
    ? resolvedSummary.delverConfigs
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : resolvedSummary?.delverConfig && typeof resolvedSummary.delverConfig === "object"
      ? [resolvedSummary.delverConfig]
      : [];
  const fallbackDelverConfig = delverConfigs[0];
  const rooms = Array.isArray(resolvedSummary?.rooms) ? resolvedSummary.rooms : [];
  const actors = Array.isArray(resolvedSummary?.actors) ? resolvedSummary.actors : [];
  const roomSelections = rooms.map((pick, index) => pickToSelection(pick, "room", index, dungeonAffinity));
  let delverConfigIndex = 0;
  const actorSelections = actors.map((pick, index) => pickToSelection(
    {
      ...pick,
      delverConfig: pickHasAttackingMotivation(pick)
        ? (
          delverConfigs[delverConfigIndex++ % Math.max(1, delverConfigs.length)]
          || fallbackDelverConfig
        )
        : undefined,
    },
    "actor",
    index,
    dungeonAffinity,
  ));
  return [...roomSelections, ...actorSelections];
}

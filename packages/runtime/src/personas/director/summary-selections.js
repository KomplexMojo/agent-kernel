import {
  ATTACKER_SETUP_MODE_SET,
  DEFAULT_ATTACKER_SETUP_MODE,
  AFFINITY_EXPRESSION_SET,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_ROOM_AFFINITY_EXPRESSION,
  DEFAULT_ROOM_AFFINITY_STACKS,
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
        return {
          kind,
          expression,
          stacks: normalizePositiveInt(entry?.stacks, 1),
        };
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
  if (typeof value !== "string") return DEFAULT_ATTACKER_SETUP_MODE;
  const normalized = value.trim();
  return ATTACKER_SETUP_MODE_SET.has(normalized) ? normalized : DEFAULT_ATTACKER_SETUP_MODE;
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

function normalizeMotivations(value, fallback) {
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

function isAttackingMotivation(value) {
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase().includes("attack");
}

function pickHasAttackingMotivation(pick) {
  const motivations = normalizeMotivations(
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

function buildAffinityMapForAttackerConfig(affinities = []) {
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

function buildVitalsConfigForAttacker(vitals) {
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

function expandAttackerConfigsFromCards(cards = [], dungeonAffinity = DEFAULT_DUNGEON_AFFINITY) {
  const configs = [];
  cards.forEach((card) => {
    const count = normalizeCardCount(card?.count, 1);
    const affinityMap = buildAffinityMapForAttackerConfig(card?.affinities || []);
    const vitalsConfig = buildVitalsConfigForAttacker(card?.vitals);
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

function attackerConfigToAffinityEntries(config, dungeonAffinity) {
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

function attackerConfigToVitals(config) {
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
    attackerConfig,
  } = {},
) {
  const id = typeof entry?.id === "string" && entry.id.trim()
    ? entry.id.trim()
    : "";
  const defaultAffinity = source === "room"
    ? DEFAULT_ROOM_CARD_AFFINITY
    : (dungeonAffinity || DEFAULT_DUNGEON_AFFINITY);
  const motivation = typeof entry?.role === "string" && entry.role.trim()
    ? entry.role.trim()
    : typeof entry?.motivation === "string" && entry.motivation.trim()
      ? entry.motivation.trim()
      : "stationary";
  const affinity = typeof entry?.affinity === "string" && entry.affinity.trim()
    ? entry.affinity.trim()
    : defaultAffinity;
  const count = normalizePositiveInt(entry?.count, 1);
  const tokenHint = normalizeTokenHint(entry?.tokenHint);
  const affinities = source === "room"
    ? normalizeAffinityEntries(entry?.affinities, affinity, {
      fallbackExpression: DEFAULT_ROOM_AFFINITY_EXPRESSION,
      fallbackStacks: DEFAULT_ROOM_AFFINITY_STACKS,
    })
    : normalizeAffinityEntries(entry?.affinities, affinity);
  const setupMode = normalizeSetupMode(entry?.setupMode ?? entry?.mode ?? attackerConfig?.setupMode);
  const pick = { motivation, affinity, count };
  if (id) pick.id = id;
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
    attackerConfig?.vitalsMax,
  );
  pick.vitals = withMaxOverrides;
  return pick;
}

export function normalizeCardEntry(entry, { dungeonAffinity = DEFAULT_DUNGEON_AFFINITY, index = 0 } = {}) {
  const fallbackType = entry?.source === "room" ? "room" : "defender";
  const type = normalizeCardType(entry?.type) || fallbackType;
  const affinity = normalizeCardAffinity(
    entry?.affinity,
    type === "room" ? DEFAULT_ROOM_CARD_AFFINITY : dungeonAffinity,
  );
  const count = normalizeCardCount(entry?.count, 1);
  const tokenHint = normalizeTokenHint(entry?.tokenHint);
  const normalizedAffinities = type === "room"
    ? normalizeAffinityEntries(entry?.affinities, affinity, {
      fallbackExpression: DEFAULT_ROOM_AFFINITY_EXPRESSION,
      fallbackStacks: DEFAULT_ROOM_AFFINITY_STACKS,
    })
    : normalizeAffinityEntries(entry?.affinities, affinity);
  const expressions = normalizeMotivations(
    normalizedAffinities.map((affinityEntry) => affinityEntry.expression),
    DEFAULT_AFFINITY_EXPRESSION,
  );
  const motivations = type === "room"
    ? []
    : normalizeMotivations(entry?.motivations, entry?.motivation || entry?.role || (type === "attacker" ? "attacking" : "defending"));
  const id = typeof entry?.id === "string" && entry.id.trim()
    ? entry.id.trim()
    : `card_${type}_${index + 1}`;

  const card = {
    id,
    type,
    source: entry?.source === "room" ? "room" : "actor",
    count,
    affinity,
    affinities: normalizedAffinities,
    expressions,
    motivations,
    setupMode: normalizeSetupMode(entry?.setupMode),
    roomSize: type === "room" ? normalizeRoomCardSize(entry?.roomSize ?? entry?.size) : undefined,
    tokenHint,
    vitals: type === "room" ? undefined : normalizeVitals(entry?.vitals),
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

function cardEntryToDefenderPick(card, dungeonAffinity) {
  return normalizeSummaryPick(
    {
      id: card.id,
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

function cardEntryToAttackerPick(card, dungeonAffinity) {
  return normalizeSummaryPick(
    {
      id: card.id,
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

function cardEntryToAttackerConfig(card, dungeonAffinity) {
  const affinityMap = buildAffinityMapForAttackerConfig(card.affinities || []);
  const vitalsConfig = buildVitalsConfigForAttacker(card.vitals);
  return {
    setupMode: normalizeSetupMode(card.setupMode),
    affinities: affinityMap.affinities,
    affinityStacks: affinityMap.affinityStacks,
    ...vitalsConfig,
    dungeonAffinity,
  };
}

function reduceAttackerConfigsToCards(attackerConfigs = [], dungeonAffinity = DEFAULT_DUNGEON_AFFINITY) {
  const grouped = new Map();
  attackerConfigs.forEach((config) => {
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
      affinities: attackerConfigToAffinityEntries(config, dungeonAffinity),
      vitals: attackerConfigToVitals(config),
      count: 1,
    });
  });

  return Array.from(grouped.values()).map((entry, index) => ({
    id: `card_attacker_${index + 1}`,
    type: "attacker",
    source: "actor",
    count: entry.count,
    affinity: entry.affinities[0]?.kind || dungeonAffinity,
    affinities: entry.affinities,
    expressions: normalizeMotivations(entry.affinities.map((affinityEntry) => affinityEntry.expression), DEFAULT_AFFINITY_EXPRESSION),
    motivations: ["attacking"],
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
  const actors = Array.isArray(summary?.actors) ? summary.actors : [];
  const attackerConfigs = Array.isArray(summary?.attackerConfigs)
    ? summary.attackerConfigs.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : summary?.attackerConfig && typeof summary.attackerConfig === "object"
      ? [summary.attackerConfig]
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

  const actorCards = actors.map((entry, index) => {
    const motivations = normalizeMotivations(
      entry?.motivations,
      entry?.motivation || entry?.role || "defending",
    );
    const attacker = motivations.some((motivation) => isAttackingMotivation(motivation));
    const type = attacker ? "attacker" : "defender";
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

  const hasAttackerCardsFromActors = actorCards.some((card) => card?.type === "attacker");
  const attackerCardsFromConfigs = hasAttackerCardsFromActors
    ? []
    : reduceAttackerConfigsToCards(attackerConfigs, dungeonAffinity);
  return normalizeCardSet([...roomCards, ...attackerCardsFromConfigs, ...actorCards], { dungeonAffinity });
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
  const attackerCards = cardSet.filter((card) => card.type === "attacker");
  const actorCards = cardSet.filter((card) => card.type === "attacker" || card.type === "defender");

  const rooms = roomCards.map((card) => cardEntryToRoomPick(card, dungeonAffinity));
  const actors = actorCards.map((card) => (
    card.type === "attacker"
      ? cardEntryToAttackerPick(card, dungeonAffinity)
      : cardEntryToDefenderPick(card, dungeonAffinity)
  ));
  const attackerConfigs = expandAttackerConfigsFromCards(attackerCards, dungeonAffinity);
  const layoutFromCards = deriveLayoutFromRoomCards(roomCards);
  const roomDesignFromCards = buildRoomDesignFromRoomCards(roomCards);

  const resolved = {
    ...summary,
    dungeonAffinity,
    cardSet,
    rooms,
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

  if (attackerConfigs.length > 0) {
    resolved.attackerConfigs = attackerConfigs;
    resolved.attackerConfig = { ...attackerConfigs[0] };
    resolved.attackerCount = attackerConfigs.length;
  } else {
    delete resolved.attackerConfigs;
    delete resolved.attackerConfig;
    delete resolved.attackerCount;
  }

  return resolved;
}

function pickToSelection(pick, kind, index, dungeonAffinity) {
  const normalizedPick = normalizeSummaryPick(pick, {
    dungeonAffinity,
    source: kind === "room" ? "room" : "actor",
    attackerConfig: pick?.attackerConfig,
  });
  const cost = normalizedPick.tokenHint || 1;
  const subType = kind === "room" ? "static" : "dynamic";
  const fallbackBaseId = `${kind}_${normalizedPick.motivation}_${normalizedPick.affinity}_${index + 1}`;
  const requestedId = typeof normalizedPick?.id === "string" && normalizedPick.id.trim()
    ? normalizedPick.id.trim()
    : "";
  const baseId = requestedId || fallbackBaseId;

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
  const attackerConfigs = Array.isArray(resolvedSummary?.attackerConfigs)
    ? resolvedSummary.attackerConfigs
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : resolvedSummary?.attackerConfig && typeof resolvedSummary.attackerConfig === "object"
      ? [resolvedSummary.attackerConfig]
      : [];
  const fallbackAttackerConfig = attackerConfigs[0];
  const rooms = Array.isArray(resolvedSummary?.rooms) ? resolvedSummary.rooms : [];
  const actors = Array.isArray(resolvedSummary?.actors) ? resolvedSummary.actors : [];
  const roomSelections = rooms.map((pick, index) => pickToSelection(pick, "room", index, dungeonAffinity));
  let attackerConfigIndex = 0;
  const actorSelections = actors.map((pick, index) => pickToSelection(
    {
      ...pick,
      attackerConfig: pickHasAttackingMotivation(pick)
        ? (
          attackerConfigs[attackerConfigIndex++ % Math.max(1, attackerConfigs.length)]
          || fallbackAttackerConfig
        )
        : undefined,
    },
    "actor",
    index,
    dungeonAffinity,
  ));
  return [...roomSelections, ...actorSelections];
}

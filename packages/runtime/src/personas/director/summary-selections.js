import {
  ATTACKER_SETUP_MODE_SET,
  DEFAULT_ATTACKER_SETUP_MODE,
  AFFINITY_EXPRESSION_SET,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_VITALS,
  VITAL_KEYS,
  normalizeVitals as normalizeDomainVitals,
} from "../../contracts/domain-constants.js";

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

function normalizeAffinityEntries(affinities, fallbackKind) {
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
  if (fallbackKind) return [{ kind: fallbackKind, expression: DEFAULT_AFFINITY_EXPRESSION, stacks: 1 }];
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

export function normalizeSummaryPick(
  entry,
  {
    dungeonAffinity = DEFAULT_DUNGEON_AFFINITY,
    source = "actor",
    attackerConfig,
  } = {},
) {
  const motivation = typeof entry?.role === "string" && entry.role.trim()
    ? entry.role.trim()
    : typeof entry?.motivation === "string" && entry.motivation.trim()
      ? entry.motivation.trim()
      : "stationary";
  const affinity = typeof entry?.affinity === "string" && entry.affinity.trim()
    ? entry.affinity.trim()
    : dungeonAffinity || DEFAULT_DUNGEON_AFFINITY;
  const count = normalizePositiveInt(entry?.count, 1);
  const tokenHint = normalizeTokenHint(entry?.tokenHint);
  const affinities = normalizeAffinityEntries(entry?.affinities, affinity);
  const setupMode = normalizeSetupMode(entry?.setupMode ?? entry?.mode ?? attackerConfig?.setupMode);
  const pick = { motivation, affinity, count };
  if (tokenHint !== undefined) pick.tokenHint = tokenHint;
  if (affinities.length > 0) pick.affinities = affinities;
  if (source !== "room") {
    pick.setupMode = setupMode;
  }
  if (source !== "room") {
    const withMaxOverrides = applyVitalMaxOverrides(
      normalizeVitals(entry?.vitals),
      attackerConfig?.vitalsMax,
    );
    pick.vitals = withMaxOverrides;
  }
  return pick;
}

function pickToSelection(pick, kind, index, dungeonAffinity) {
  const normalizedPick = normalizeSummaryPick(pick, {
    dungeonAffinity,
    source: kind === "room" ? "room" : "actor",
    attackerConfig: pick?.attackerConfig,
  });
  const cost = normalizedPick.tokenHint || 1;
  const subType = kind === "room" ? "static" : "dynamic";
  const baseId = `${kind}_${normalizedPick.motivation}_${normalizedPick.affinity}_${index + 1}`;

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
        id: `${baseId}_instance_${itemIndex + 1}`,
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
  const dungeonAffinity = typeof summary?.dungeonAffinity === "string" ? summary.dungeonAffinity : DEFAULT_DUNGEON_AFFINITY;
  const attackerConfig = summary?.attackerConfig && typeof summary.attackerConfig === "object"
    ? summary.attackerConfig
    : undefined;
  const rooms = Array.isArray(summary?.rooms) ? summary.rooms : [];
  const actors = Array.isArray(summary?.actors) ? summary.actors : [];
  const roomSelections = rooms.map((pick, index) => pickToSelection(pick, "room", index, dungeonAffinity));
  const actorSelections = actors.map((pick, index) => pickToSelection(
    { ...pick, attackerConfig },
    "actor",
    index,
    dungeonAffinity,
  ));
  return [...roomSelections, ...actorSelections];
}

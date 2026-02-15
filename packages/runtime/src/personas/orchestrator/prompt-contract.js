import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  ATTACKER_SETUP_MODES,
  ATTACKER_SETUP_MODE_SET,
  DEFAULT_ATTACKER_SETUP_MODE,
  LEGACY_LAYOUT_TILE_FIELDS as SHARED_LEGACY_LAYOUT_TILE_FIELDS,
  LAYOUT_TILE_FIELDS as SHARED_LAYOUT_TILE_FIELDS,
  DEFAULT_VITALS,
  VITAL_KEYS,
  normalizeVitals as normalizeDomainVitals,
} from "../../contracts/domain-constants.js";
import { MOTIVATION_KINDS } from "../configurator/motivation-loadouts.js";

export const ALLOWED_AFFINITIES = AFFINITY_KINDS;
export const ALLOWED_AFFINITY_EXPRESSIONS = AFFINITY_EXPRESSIONS;
export const ALLOWED_MOTIVATIONS = MOTIVATION_KINDS;
export const ALLOWED_ATTACKER_SETUP_MODES = ATTACKER_SETUP_MODES;
export const LLM_PHASES = Object.freeze(["layout_only", "actors_only"]);
export const LLM_STOP_REASONS = Object.freeze(["done", "missing", "no_viable_spend"]);
export const LAYOUT_TILE_FIELDS = SHARED_LAYOUT_TILE_FIELDS;
const LEGACY_LAYOUT_TILE_FIELDS = SHARED_LEGACY_LAYOUT_TILE_FIELDS;
export const LAYOUT_PROFILES = Object.freeze(["rectangular", "sparse_islands", "clustered_islands", "rooms"]);
export function deriveAllowedOptionsFromCatalog(catalog = {}) {
  const entries = Array.isArray(catalog.entries) ? catalog.entries : Array.isArray(catalog) ? catalog : [];
  const affinities = new Set(ALLOWED_AFFINITIES);
  const motivations = new Set(ALLOWED_MOTIVATIONS);
  const ids = new Set();

  entries.forEach((entry) => {
    if (entry?.affinity && typeof entry.affinity === "string") affinities.add(entry.affinity);
    if (entry?.motivation && typeof entry.motivation === "string") motivations.add(entry.motivation);
    if (entry?.id && typeof entry.id === "string") ids.add(entry.id);
  });

  const sorted = (set) => Array.from(set).sort();
  return {
    affinities: sorted(affinities),
    motivations: sorted(motivations),
    poolIds: sorted(ids),
  };
}

function addError(errors, field, code) {
  errors.push({ field, code });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addWarning(warnings, field, code, detail) {
  const entry = { field, code };
  if (detail !== undefined) entry.detail = detail;
  warnings.push(entry);
}

function normalizeAttackerSetupMode(mode, errors, fieldBase) {
  if (mode === undefined) return undefined;
  if (!isNonEmptyString(mode)) {
    addError(errors, fieldBase, "invalid_setup_mode");
    return undefined;
  }
  const normalized = mode.trim();
  if (!ATTACKER_SETUP_MODE_SET.has(normalized)) {
    addError(errors, fieldBase, "invalid_setup_mode");
    return undefined;
  }
  return normalized;
}

function normalizeVitalsConfigMap(input, errors, fieldBase) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    addError(errors, fieldBase, "invalid_vitals");
    return undefined;
  }
  const normalized = {};
  VITAL_KEYS.forEach((key) => {
    const raw = input[key];
    if (raw === undefined) return;
    if (!Number.isInteger(raw) || raw < 0) {
      addError(errors, `${fieldBase}.${key}`, "invalid_non_negative_int");
      return;
    }
    normalized[key] = raw;
  });
  return normalized;
}

function normalizeAttackerConfig(config, errors) {
  if (config === undefined) return undefined;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    addError(errors, "attackerConfig", "invalid_attacker_config");
    return undefined;
  }
  const setupMode = normalizeAttackerSetupMode(config.setupMode, errors, "attackerConfig.setupMode");
  const vitalsMax = normalizeVitalsConfigMap(config.vitalsMax, errors, "attackerConfig.vitalsMax");
  const vitalsRegen = normalizeVitalsConfigMap(config.vitalsRegen, errors, "attackerConfig.vitalsRegen");

  const normalized = {
    setupMode: setupMode || DEFAULT_ATTACKER_SETUP_MODE,
  };
  if (vitalsMax && Object.keys(vitalsMax).length > 0) normalized.vitalsMax = vitalsMax;
  if (vitalsRegen && Object.keys(vitalsRegen).length > 0) normalized.vitalsRegen = vitalsRegen;
  return normalized;
}

function isAmbulatoryMotivation(motivation) {
  return isNonEmptyString(motivation) && motivation !== "stationary";
}

function normalizeLayoutCounts(layout, errors) {
  if (layout === undefined) return undefined;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    addError(errors, "layout", "invalid_layout");
    return undefined;
  }
  const normalized = {};
  LAYOUT_TILE_FIELDS.forEach((field) => {
    if (layout[field] === undefined) return;
    if (!Number.isInteger(layout[field]) || layout[field] < 0) {
      addError(errors, `layout.${field}`, "invalid_tile_count");
      return;
    }
    normalized[field] = layout[field];
  });
  let legacyWallTiles = 0;
  LEGACY_LAYOUT_TILE_FIELDS.forEach((field) => {
    if (layout[field] === undefined) return;
    if (!Number.isInteger(layout[field]) || layout[field] < 0) {
      addError(errors, `layout.${field}`, "invalid_tile_count");
      return;
    }
    legacyWallTiles += layout[field];
  });
  if (legacyWallTiles > 0) {
    const floorTiles = normalized.floorTiles || 0;
    const hallwayTiles = normalized.hallwayTiles || 0;
    const walkableTiles = floorTiles + hallwayTiles;
    if (walkableTiles > 0) {
      const floorShare = Math.floor((legacyWallTiles * floorTiles) / walkableTiles);
      const hallwayShare = legacyWallTiles - floorShare;
      normalized.floorTiles = floorTiles + floorShare;
      normalized.hallwayTiles = hallwayTiles + hallwayShare;
    } else {
      const floorShare = Math.ceil(legacyWallTiles / 2);
      normalized.floorTiles = floorShare;
      normalized.hallwayTiles = legacyWallTiles - floorShare;
    }
  }
  return normalized;
}

function normalizeRoomDesign(roomDesign, warnings) {
  if (roomDesign === undefined) return undefined;
  if (!roomDesign || typeof roomDesign !== "object" || Array.isArray(roomDesign)) {
    addWarning(warnings, "roomDesign", "invalid_room_design");
    return undefined;
  }
  const normalized = {};
  const shapeInput = roomDesign.shape && typeof roomDesign.shape === "object" && !Array.isArray(roomDesign.shape)
    ? roomDesign.shape
    : null;
  const profile = isNonEmptyString(roomDesign.profile)
    ? roomDesign.profile.trim()
    : isNonEmptyString(shapeInput?.profile)
      ? shapeInput.profile.trim()
      : undefined;
  if (profile !== undefined) {
    if (!LAYOUT_PROFILES.includes(profile)) {
      addWarning(warnings, "roomDesign.profile", "invalid_profile");
    } else {
      normalized.profile = profile;
    }
  }
  const densityInput = roomDesign.density ?? shapeInput?.density;
  if (densityInput !== undefined) {
    if (typeof densityInput !== "number" || Number.isNaN(densityInput) || densityInput < 0 || densityInput > 1) {
      addWarning(warnings, "roomDesign.density", "invalid_density");
    } else {
      normalized.density = densityInput;
    }
  }
  const clusterSizeInput = roomDesign.clusterSize ?? shapeInput?.clusterSize;
  if (clusterSizeInput !== undefined) {
    if (!Number.isInteger(clusterSizeInput) || clusterSizeInput <= 0) {
      addWarning(warnings, "roomDesign.clusterSize", "invalid_cluster_size");
    } else {
      normalized.clusterSize = clusterSizeInput;
    }
  }
  if (Array.isArray(roomDesign.rooms)) {
    const rooms = roomDesign.rooms
      .map((room, index) => {
        if (!room || typeof room !== "object" || Array.isArray(room)) {
          addWarning(warnings, `roomDesign.rooms[${index}]`, "invalid_room");
          return null;
        }
        const entry = {};
        if (isNonEmptyString(room.id)) entry.id = room.id.trim();
        if (isNonEmptyString(room.size)) entry.size = room.size.trim();
        if (Number.isInteger(room.width) && room.width > 0) entry.width = room.width;
        if (Number.isInteger(room.height) && room.height > 0) entry.height = room.height;
        if (Object.keys(entry).length === 0) {
          addWarning(warnings, `roomDesign.rooms[${index}]`, "missing_room_dimensions");
          return null;
        }
        return entry;
      })
      .filter(Boolean);
    if (rooms.length > 0) {
      normalized.rooms = rooms;
    }
  }
  if (Array.isArray(roomDesign.connections)) {
    const connections = roomDesign.connections
      .map((connection, index) => {
        if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
          addWarning(warnings, `roomDesign.connections[${index}]`, "invalid_connection");
          return null;
        }
        const from = isNonEmptyString(connection.from) ? connection.from.trim() : "";
        const to = isNonEmptyString(connection.to) ? connection.to.trim() : "";
        if (!from || !to) {
          addWarning(warnings, `roomDesign.connections[${index}]`, "missing_connection_endpoints");
          return null;
        }
        const type = isNonEmptyString(connection.type) ? connection.type.trim() : undefined;
        return type ? { from, to, type } : { from, to };
      })
      .filter(Boolean);
    if (connections.length > 0) {
      normalized.connections = connections;
    }
  }
  if (isNonEmptyString(roomDesign.hallways)) {
    normalized.hallways = roomDesign.hallways.trim();
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}


function normalizePick(entry, base, errors, { source = "actor", enforceAmbulatoryStaminaRegen = false } = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    addError(errors, base, "invalid_pick");
    return null;
  }
  const { motivation, affinity, count, tokenHint } = entry;
  const expression = entry.expression ?? entry.affinityExpression;
  const stacks = entry.stacks ?? entry.affinityStacks;
  if (!isNonEmptyString(motivation) || !ALLOWED_MOTIVATIONS.includes(motivation)) {
    addError(errors, `${base}.motivation`, "invalid_motivation");
  }
  if (!isNonEmptyString(affinity) || !ALLOWED_AFFINITIES.includes(affinity)) {
    addError(errors, `${base}.affinity`, "invalid_affinity");
  }
  if (!Number.isInteger(count) || count <= 0) {
    addError(errors, `${base}.count`, "invalid_count");
  }
  let normalizedTokenHint;
  if (tokenHint !== undefined) {
    if (!Number.isInteger(tokenHint) || tokenHint <= 0) {
      addError(errors, `${base}.tokenHint`, "invalid_token_hint");
    } else {
      normalizedTokenHint = tokenHint;
    }
  }

  let normalizedExpression;
  if (expression !== undefined) {
    if (!isNonEmptyString(expression) || !ALLOWED_AFFINITY_EXPRESSIONS.includes(expression)) {
      addError(errors, `${base}.expression`, "invalid_expression");
    } else {
      normalizedExpression = expression;
    }
  }

  let normalizedStacks;
  if (stacks !== undefined) {
    if (!Number.isInteger(stacks) || stacks <= 0) {
      addError(errors, `${base}.stacks`, "invalid_stacks");
    } else {
      normalizedStacks = stacks;
    }
  }

  let normalizedAffinities;
  if (entry.affinities !== undefined) {
    if (!Array.isArray(entry.affinities)) {
      addError(errors, `${base}.affinities`, "invalid_affinities");
      normalizedAffinities = [];
    } else {
      normalizedAffinities = [];
      entry.affinities.forEach((entryAffinity, index) => {
        const affinityBase = `${base}.affinities[${index}]`;
        if (!entryAffinity || typeof entryAffinity !== "object" || Array.isArray(entryAffinity)) {
          addError(errors, affinityBase, "invalid_affinity");
          return;
        }
        const kind = entryAffinity.kind || entryAffinity.affinity;
        const affinityExpression = entryAffinity.expression ?? entryAffinity.affinityExpression;
        if (!isNonEmptyString(kind) || !ALLOWED_AFFINITIES.includes(kind)) {
          addError(errors, `${affinityBase}.kind`, "invalid_affinity");
        }
        if (!isNonEmptyString(affinityExpression) || !ALLOWED_AFFINITY_EXPRESSIONS.includes(affinityExpression)) {
          addError(errors, `${affinityBase}.expression`, "invalid_expression");
        }
        const stacksValue = entryAffinity.stacks ?? entryAffinity.affinityStacks;
        const stacksParsed = Number.isInteger(stacksValue) ? stacksValue : 1;
        if (!Number.isInteger(stacksValue) && stacksValue !== undefined) {
          addError(errors, `${affinityBase}.stacks`, "invalid_stacks");
        }
        if (Number.isInteger(stacksValue) && stacksValue <= 0) {
          addError(errors, `${affinityBase}.stacks`, "invalid_stacks");
        }
        normalizedAffinities.push({
          kind,
          expression: affinityExpression,
          stacks: Number.isInteger(stacksValue) && stacksValue > 0 ? stacksValue : stacksParsed,
        });
      });
    }
  } else if (normalizedExpression) {
    normalizedAffinities = [
      {
        kind: affinity,
        expression: normalizedExpression,
        stacks: normalizedStacks || 1,
      },
    ];
  } else if (normalizedStacks !== undefined) {
    addError(errors, `${base}.expression`, "missing_expression");
  }

  const setupMode = normalizeAttackerSetupMode(entry.setupMode ?? entry.mode, errors, `${base}.setupMode`);

  let normalizedVitals;
  if (entry.vitals !== undefined) {
    if (!entry.vitals || typeof entry.vitals !== "object" || Array.isArray(entry.vitals)) {
      addError(errors, `${base}.vitals`, "invalid_vitals");
    } else {
      normalizedVitals = normalizeDomainVitals(entry.vitals, DEFAULT_VITALS);
    }
  }
  if (enforceAmbulatoryStaminaRegen && source === "actor" && isAmbulatoryMotivation(motivation)) {
    const staminaRegen = normalizedVitals?.stamina?.regen;
    if (!Number.isInteger(staminaRegen) || staminaRegen <= 0) {
      addError(errors, `${base}.vitals.stamina.regen`, "missing_stamina_regen_for_ambulatory");
    }
  }

  const result = {
    motivation,
    affinity,
    count,
    tokenHint: normalizedTokenHint,
  };
  if (normalizedExpression) result.expression = normalizedExpression;
  if (normalizedStacks !== undefined) result.stacks = normalizedStacks;
  if (normalizedAffinities && normalizedAffinities.length > 0) {
    result.affinities = normalizedAffinities;
  }
  if (normalizedVitals) {
    result.vitals = normalizedVitals;
  }
  if (setupMode) result.setupMode = setupMode;
  return result;
}

export function normalizeSummary(summary) {
  return normalizeSummaryWithOptions(summary);
}

export function normalizeSummaryWithOptions(summary, { phase } = {}) {
  const errors = [];
  const warnings = [];
  const enforceActorMobility = phase === "actors_only" || summary?.phase === "actors_only";
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    addError(errors, "summary", "invalid_summary");
    return { ok: false, errors, warnings, value: null };
  }

  const value = {};
  if (summary.phase !== undefined) {
    if (!isNonEmptyString(summary.phase) || !LLM_PHASES.includes(summary.phase)) {
      addError(errors, "phase", "invalid_phase");
    } else {
      value.phase = summary.phase;
    }
  }
  if (phase && value.phase && value.phase !== phase) {
    addError(errors, "phase", "phase_mismatch");
  }
  if (phase && !value.phase) {
    addWarning(warnings, "phase", "missing_phase", phase);
  }
  if (summary.remainingBudgetTokens !== undefined) {
    if (!Number.isInteger(summary.remainingBudgetTokens) || summary.remainingBudgetTokens < 0) {
      addError(errors, "remainingBudgetTokens", "invalid_budget");
    } else {
      value.remainingBudgetTokens = summary.remainingBudgetTokens;
    }
  }
  const stopReason = summary.stop ?? summary.stopReason;
  if (stopReason !== undefined) {
    if (!isNonEmptyString(stopReason) || !LLM_STOP_REASONS.includes(stopReason)) {
      addError(errors, "stop", "invalid_stop_reason");
    } else {
      value.stop = stopReason;
    }
  }
  if (summary.dungeonAffinity !== undefined) {
    if (!isNonEmptyString(summary.dungeonAffinity) || !ALLOWED_AFFINITIES.includes(summary.dungeonAffinity)) {
      addError(errors, "dungeonAffinity", "invalid_affinity");
    } else {
      value.dungeonAffinity = summary.dungeonAffinity;
    }
  }
  const layout = normalizeLayoutCounts(summary.layout, errors);
  if (layout && Object.keys(layout).length > 0) {
    value.layout = layout;
  }
  const roomDesign = normalizeRoomDesign(summary.roomDesign, warnings);
  if (roomDesign) {
    value.roomDesign = roomDesign;
  }
  const attackerConfig = normalizeAttackerConfig(summary.attackerConfig, errors);
  if (attackerConfig) {
    value.attackerConfig = attackerConfig;
  }
  if (summary.budgetTokens !== undefined) {
    if (!Number.isInteger(summary.budgetTokens) || summary.budgetTokens <= 0) {
      addError(errors, "budgetTokens", "invalid_budget");
    } else {
      value.budgetTokens = summary.budgetTokens;
    }
  }

  const roomsInput = Array.isArray(summary.rooms) ? summary.rooms : [];
  const actorsInput = Array.isArray(summary.actors)
    ? summary.actors
    : Array.isArray(summary.defenders)
      ? summary.defenders
      : [];
  if (!Array.isArray(summary.actors) && Array.isArray(summary.defenders)) {
    addWarning(warnings, "actors", "aliased_from_defenders");
  }

  value.rooms = [];
  roomsInput.forEach((entry, index) => {
    const normalized = normalizePick(entry, `rooms[${index}]`, errors, {
      source: "room",
      enforceAmbulatoryStaminaRegen: false,
    });
    if (normalized) value.rooms.push(normalized);
  });

  value.actors = [];
  actorsInput.forEach((entry, index) => {
    const normalized = normalizePick(entry, `actors[${index}]`, errors, {
      source: "actor",
      enforceAmbulatoryStaminaRegen: enforceActorMobility,
    });
    if (normalized) value.actors.push(normalized);
  });

  if (Array.isArray(summary.missing)) {
    value.missing = summary.missing.filter(isNonEmptyString);
  }

  return { ok: errors.length === 0, errors, warnings, value };
}


export function capturePromptResponse({ prompt, responseText, phase } = {}) {
  const errors = [];
  let responseParsed = null;
  let summary = null;
  try {
    responseParsed = JSON.parse(responseText);
    const result = normalizeSummaryWithOptions(responseParsed, { phase });
    if (!result.ok) {
      errors.push(...result.errors);
    } else {
      summary = result.value;
    }
  } catch (err) {
    errors.push({ field: "response", code: "invalid_json", message: err.message });
  }

  return {
    prompt,
    responseRaw: responseText,
    responseParsed,
    summary,
    errors,
  };
}

import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  ATTACKER_SETUP_MODES,
  ATTACKER_SETUP_MODE_SET,
  DEFAULT_ATTACKER_SETUP_MODE,
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

const ROOM_DESIGN_PATTERN_TYPES = new Set(["none", "grid", "diagonal_grid", "concentric_circles"]);

function normalizeRoomDesignPattern(rawPattern) {
  if (!isNonEmptyString(rawPattern)) return "";
  const normalized = rawPattern.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "horizontal_vertical_grid" || normalized === "horizontal_verticle_grid") {
    return "grid";
  }
  if (normalized === "diagonal") {
    return "diagonal_grid";
  }
  if (normalized === "concentric") {
    return "concentric_circles";
  }
  return ROOM_DESIGN_PATTERN_TYPES.has(normalized) ? normalized : "";
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

function pushAffinityExpression(target, affinity, expression) {
  const next = Array.isArray(target[affinity]) ? target[affinity] : [];
  if (!next.includes(expression)) {
    next.push(expression);
  }
  target[affinity] = next;
}

function normalizeAttackerAffinitiesMap(input, errors, fieldBase) {
  if (input === undefined) return undefined;
  const normalized = {};
  const addAffinityExpression = (rawAffinity, rawExpression, expressionField) => {
    if (!isNonEmptyString(rawAffinity) || !ALLOWED_AFFINITIES.includes(rawAffinity.trim())) {
      addError(errors, expressionField.replace(/\.expression$/, ".kind"), "invalid_affinity");
      return;
    }
    if (!isNonEmptyString(rawExpression) || !ALLOWED_AFFINITY_EXPRESSIONS.includes(rawExpression.trim())) {
      addError(errors, expressionField, "invalid_affinity_expression");
      return;
    }
    pushAffinityExpression(normalized, rawAffinity.trim(), rawExpression.trim());
  };

  if (Array.isArray(input)) {
    input.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        addError(errors, `${fieldBase}[${index}]`, "invalid_affinity_entry");
        return;
      }
      addAffinityExpression(
        entry.kind ?? entry.affinity,
        entry.expression ?? entry.affinityExpression,
        `${fieldBase}[${index}].expression`,
      );
    });
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  if (!input || typeof input !== "object") {
    addError(errors, fieldBase, "invalid_affinities_map");
    return undefined;
  }

  Object.entries(input).forEach(([rawAffinity, rawExpressions]) => {
    if (!isNonEmptyString(rawAffinity) || !ALLOWED_AFFINITIES.includes(rawAffinity.trim())) {
      addError(errors, `${fieldBase}.${rawAffinity}`, "invalid_affinity");
      return;
    }
    const affinity = rawAffinity.trim();
    const expressions = Array.isArray(rawExpressions)
      ? rawExpressions
      : isNonEmptyString(rawExpressions)
        ? [rawExpressions]
        : [];
    if (expressions.length === 0) {
      addError(errors, `${fieldBase}.${affinity}`, "invalid_affinity_expressions");
      return;
    }
    expressions.forEach((rawExpression, index) => {
      if (!isNonEmptyString(rawExpression) || !ALLOWED_AFFINITY_EXPRESSIONS.includes(rawExpression.trim())) {
        addError(errors, `${fieldBase}.${affinity}[${index}]`, "invalid_affinity_expression");
        return;
      }
      pushAffinityExpression(normalized, affinity, rawExpression.trim());
    });
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeAttackerAffinityStacksMap(input, errors, fieldBase) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    addError(errors, fieldBase, "invalid_affinity_stacks");
    return undefined;
  }
  const normalized = {};
  Object.entries(input).forEach(([rawAffinity, rawStacks]) => {
    if (!isNonEmptyString(rawAffinity) || !ALLOWED_AFFINITIES.includes(rawAffinity.trim())) {
      addError(errors, `${fieldBase}.${rawAffinity}`, "invalid_affinity");
      return;
    }
    if (!Number.isInteger(rawStacks) || rawStacks <= 0) {
      addError(errors, `${fieldBase}.${rawAffinity.trim()}`, "invalid_positive_int");
      return;
    }
    normalized[rawAffinity.trim()] = rawStacks;
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeAttackerConfig(config, errors, { fieldBase = "attackerConfig" } = {}) {
  if (config === undefined) return undefined;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    addError(errors, fieldBase, "invalid_attacker_config");
    return undefined;
  }
  const setupMode = normalizeAttackerSetupMode(config.setupMode, errors, `${fieldBase}.setupMode`);
  const vitalsMax = normalizeVitalsConfigMap(config.vitalsMax, errors, `${fieldBase}.vitalsMax`);
  const vitalsRegen = normalizeVitalsConfigMap(config.vitalsRegen, errors, `${fieldBase}.vitalsRegen`);
  const affinities = normalizeAttackerAffinitiesMap(config.affinities, errors, `${fieldBase}.affinities`);
  const affinityStacks = normalizeAttackerAffinityStacksMap(config.affinityStacks, errors, `${fieldBase}.affinityStacks`);

  const normalized = {
    setupMode: setupMode || DEFAULT_ATTACKER_SETUP_MODE,
  };
  if (vitalsMax && Object.keys(vitalsMax).length > 0) normalized.vitalsMax = vitalsMax;
  if (vitalsRegen && Object.keys(vitalsRegen).length > 0) normalized.vitalsRegen = vitalsRegen;
  if (affinities && Object.keys(affinities).length > 0) normalized.affinities = affinities;
  if (affinityStacks && Object.keys(affinityStacks).length > 0) normalized.affinityStacks = affinityStacks;
  return normalized;
}

function normalizeAttackerConfigs(configs, errors) {
  if (configs === undefined) return undefined;
  if (!Array.isArray(configs)) {
    addError(errors, "attackerConfigs", "invalid_attacker_configs");
    return undefined;
  }
  return configs
    .map((entry, index) => normalizeAttackerConfig(entry, errors, { fieldBase: `attackerConfigs[${index}]` }))
    .filter(Boolean);
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
  const rawPattern = roomDesign.pattern ?? shapeInput?.pattern;
  if (rawPattern !== undefined) {
    const pattern = normalizeRoomDesignPattern(rawPattern);
    if (pattern) {
      normalized.pattern = pattern;
    } else {
      addWarning(warnings, "roomDesign.pattern", "invalid_pattern");
    }
  }
  const numericShapeFields = ["roomCount", "roomMinSize", "roomMaxSize", "corridorWidth"];
  numericShapeFields.forEach((field) => {
    const value = roomDesign[field] ?? shapeInput?.[field];
    if (value === undefined) return;
    if (!Number.isInteger(value) || value <= 0) {
      addWarning(warnings, `roomDesign.${field}`, `invalid_${field.toLowerCase()}`);
      return;
    }
    normalized[field] = value;
  });
  const totalRooms = roomDesign.totalRooms ?? shapeInput?.totalRooms;
  if (totalRooms !== undefined) {
    if (!Number.isInteger(totalRooms) || totalRooms <= 0) {
      addWarning(warnings, "roomDesign.totalRooms", "invalid_totalrooms");
    } else {
      normalized.totalRooms = totalRooms;
    }
  }
  const totalFloorTilesUsed = roomDesign.totalFloorTilesUsed ?? shapeInput?.totalFloorTilesUsed;
  if (totalFloorTilesUsed !== undefined) {
    if (!Number.isInteger(totalFloorTilesUsed) || totalFloorTilesUsed <= 0) {
      addWarning(warnings, "roomDesign.totalFloorTilesUsed", "invalid_totalfloortilesused");
    } else {
      normalized.totalFloorTilesUsed = totalFloorTilesUsed;
    }
  }
  const entryRoomId = roomDesign.entryRoomId ?? shapeInput?.entryRoomId;
  if (entryRoomId !== undefined) {
    if (!isNonEmptyString(entryRoomId)) {
      addWarning(warnings, "roomDesign.entryRoomId", "invalid_entryroomid");
    } else {
      normalized.entryRoomId = entryRoomId.trim();
    }
  }
  const exitRoomId = roomDesign.exitRoomId ?? shapeInput?.exitRoomId;
  if (exitRoomId !== undefined) {
    if (!isNonEmptyString(exitRoomId)) {
      addWarning(warnings, "roomDesign.exitRoomId", "invalid_exitroomid");
    } else {
      normalized.exitRoomId = exitRoomId.trim();
    }
  }
  const patternFields = ["patternSpacing", "patternLineWidth", "patternGapEvery"];
  patternFields.forEach((field) => {
    const value = roomDesign[field] ?? shapeInput?.[field];
    if (value === undefined) return;
    if (!Number.isInteger(value) || value <= 0) {
      addWarning(warnings, `roomDesign.${field}`, `invalid_${field.toLowerCase()}`);
      return;
    }
    normalized[field] = value;
  });
  const patternInset = roomDesign.patternInset ?? shapeInput?.patternInset;
  if (patternInset !== undefined) {
    if (!Number.isInteger(patternInset) || patternInset < 0) {
      addWarning(warnings, "roomDesign.patternInset", "invalid_patterninset");
    } else {
      normalized.patternInset = patternInset;
    }
  }
  const patternInfillPercent = roomDesign.patternInfillPercent ?? shapeInput?.patternInfillPercent;
  if (patternInfillPercent !== undefined) {
    if (!Number.isInteger(patternInfillPercent) || patternInfillPercent < 1 || patternInfillPercent > 100) {
      addWarning(warnings, "roomDesign.patternInfillPercent", "invalid_patterninfillpercent");
    } else {
      normalized.patternInfillPercent = patternInfillPercent;
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
        if (isNonEmptyString(room.affinity)) {
          const affinity = room.affinity.trim();
          if (ALLOWED_AFFINITIES.includes(affinity)) {
            entry.affinity = affinity;
          } else {
            addWarning(warnings, `roomDesign.rooms[${index}].affinity`, "invalid_affinity");
          }
        }
        const hasAnyBoundsField = (
          room.startX !== undefined
          || room.startY !== undefined
          || room.endX !== undefined
          || room.endY !== undefined
        );
        let boundsValid = false;
        const startX = room.startX;
        const startY = room.startY;
        const endX = room.endX;
        const endY = room.endY;
        if (hasAnyBoundsField) {
          if (
            Number.isInteger(startX)
            && Number.isInteger(startY)
            && Number.isInteger(endX)
            && Number.isInteger(endY)
            && startX >= 0
            && startY >= 0
            && endX >= startX
            && endY >= startY
          ) {
            entry.startX = startX;
            entry.startY = startY;
            entry.endX = endX;
            entry.endY = endY;
            boundsValid = true;
          } else {
            addWarning(warnings, `roomDesign.rooms[${index}]`, "invalid_room_bounds");
          }
        }
        let width = null;
        let height = null;
        if (Number.isInteger(room.width) && room.width > 0) width = room.width;
        else if (room.width !== undefined) addWarning(warnings, `roomDesign.rooms[${index}].width`, "invalid_room_width");
        if (Number.isInteger(room.height) && room.height > 0) height = room.height;
        else if (room.height !== undefined) addWarning(warnings, `roomDesign.rooms[${index}].height`, "invalid_room_height");
        if ((!Number.isInteger(width) || !Number.isInteger(height)) && boundsValid) {
          width = entry.endX - entry.startX + 1;
          height = entry.endY - entry.startY + 1;
        }
        if (Number.isInteger(width) && width > 0) entry.width = width;
        if (Number.isInteger(height) && height > 0) entry.height = height;
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
  let normalizedAttackerCount;
  if (summary.attackerCount !== undefined) {
    if (!Number.isInteger(summary.attackerCount) || summary.attackerCount <= 0) {
      addError(errors, "attackerCount", "invalid_attacker_count");
    } else {
      normalizedAttackerCount = summary.attackerCount;
    }
  }
  const attackerConfigs = normalizeAttackerConfigs(summary.attackerConfigs, errors);
  const attackerConfig = normalizeAttackerConfig(summary.attackerConfig, errors);
  if (Array.isArray(attackerConfigs) && attackerConfigs.length > 0) {
    value.attackerConfigs = attackerConfigs;
    value.attackerConfig = attackerConfigs[0];
  } else if (attackerConfig) {
    value.attackerConfig = attackerConfig;
    value.attackerConfigs = [attackerConfig];
  }
  if (Number.isInteger(normalizedAttackerCount)) {
    value.attackerCount = normalizedAttackerCount;
    if (Array.isArray(value.attackerConfigs) && value.attackerConfigs.length > 0
      && value.attackerConfigs.length !== normalizedAttackerCount) {
      addError(errors, "attackerConfigs", "attacker_count_mismatch");
    }
  } else if (Array.isArray(value.attackerConfigs) && value.attackerConfigs.length > 0) {
    value.attackerCount = value.attackerConfigs.length;
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

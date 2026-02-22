import { LEVEL_GEN_DEFAULTS } from "./defaults.js";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  DEFAULT_AFFINITY_EXPRESSION,
  TRAP_VITAL_KEYS,
} from "../../contracts/domain-constants.js";

const DEFAULT_TRAP_EXPRESSION = DEFAULT_AFFINITY_EXPRESSION;
const DEFAULT_TRAP_STACKS = 1;
const DEFAULT_TRAP_BLOCKING = false;
const LEVEL_PATTERN_TYPES = Object.freeze(["none", "grid", "diagonal_grid", "concentric_circles"]);

function normalizePatternType(rawPattern, errors) {
  if (typeof rawPattern !== "string") {
    pushError(errors, "shape.pattern", "invalid_pattern");
    return LEVEL_GEN_DEFAULTS.pattern;
  }
  const normalizedPattern = rawPattern.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalizedPattern === "horizontal_vertical_grid" || normalizedPattern === "horizontal_verticle_grid") {
    return "grid";
  }
  if (normalizedPattern === "diagonal") {
    return "diagonal_grid";
  }
  if (normalizedPattern === "concentric") {
    return "concentric_circles";
  }
  if (!LEVEL_PATTERN_TYPES.includes(normalizedPattern)) {
    pushError(errors, "shape.pattern", "invalid_pattern");
    return LEVEL_GEN_DEFAULTS.pattern;
  }
  return normalizedPattern;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pushError(errors, field, code) {
  errors.push({ field, code });
}

function pushWarning(warnings, field, code, from, to) {
  warnings.push({ field, code, from, to });
}

function readRequiredPositiveInt(value, field, errors) {
  if (!isInteger(value) || value <= 0) {
    pushError(errors, field, "invalid_positive_int");
    return null;
  }
  return value;
}

function readOptionalInt(value, field, errors) {
  if (value === undefined) return undefined;
  if (!isInteger(value)) {
    pushError(errors, field, "invalid_integer");
    return undefined;
  }
  return value;
}

function readOptionalPositiveInt(value, field, errors) {
  if (value === undefined) return undefined;
  if (!isInteger(value) || value <= 0) {
    pushError(errors, field, "invalid_positive_int");
    return undefined;
  }
  return value;
}

function readOptionalString(value, field, errors) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    pushError(errors, field, "invalid_string");
    return undefined;
  }
  return value;
}

function readOptionalBoolean(value, field, errors, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    pushError(errors, field, "invalid_boolean");
    return defaultValue;
  }
  return value;
}

function clampOptionalInt(value, field, min, max, warnings, errors, defaultValue) {
  if (value === undefined) return defaultValue;
  if (!isInteger(value)) {
    pushError(errors, field, "invalid_integer");
    return defaultValue;
  }
  if (value < min || value > max) {
    const clamped = clampNumber(value, min, max);
    pushWarning(warnings, field, "clamped", value, clamped);
    return clamped;
  }
  return value;
}

function normalizeTrapList(traps, width, height, errors) {
  if (traps === undefined) return [];
  if (!Array.isArray(traps)) {
    pushError(errors, "traps", "invalid_list");
    return [];
  }
  const seen = new Set();
  const normalized = [];
  traps.forEach((trap, index) => {
    const base = `traps[${index}]`;
    if (!isPlainObject(trap)) {
      pushError(errors, base, "invalid_trap");
      return;
    }
    if (!isInteger(trap.x) || !isInteger(trap.y)) {
      pushError(errors, `${base}.position`, "invalid_position");
      return;
    }
    if (trap.x < 0 || trap.y < 0 || trap.x >= width || trap.y >= height) {
      pushError(errors, `${base}.position`, "out_of_bounds");
      return;
    }
    const key = `${trap.x},${trap.y}`;
    if (seen.has(key)) {
      pushError(errors, `${base}.position`, "duplicate_trap");
      return;
    }
    seen.add(key);

    const blocking = trap.blocking === undefined ? DEFAULT_TRAP_BLOCKING : trap.blocking;
    if (typeof blocking !== "boolean") {
      pushError(errors, `${base}.blocking`, "invalid_boolean");
    }

    if (!isPlainObject(trap.affinity)) {
      pushError(errors, `${base}.affinity`, "invalid_affinity");
      return;
    }
    if (!AFFINITY_KINDS.includes(trap.affinity.kind)) {
      pushError(errors, `${base}.affinity.kind`, "invalid_kind");
    }
    const expression = trap.affinity.expression ?? DEFAULT_TRAP_EXPRESSION;
    if (!AFFINITY_EXPRESSIONS.includes(expression)) {
      pushError(errors, `${base}.affinity.expression`, "invalid_expression");
    }
    const stacks = trap.affinity.stacks ?? DEFAULT_TRAP_STACKS;
    if (!isInteger(stacks) || stacks < 1) {
      pushError(errors, `${base}.affinity.stacks`, "invalid_stacks");
    }

    if (trap.vitals && !isPlainObject(trap.vitals)) {
      pushError(errors, `${base}.vitals`, "invalid_vitals");
    }
    if (trap.vitals && Object.keys(trap.vitals).some((key) => !TRAP_VITAL_KEYS.includes(key))) {
      pushError(errors, `${base}.vitals`, "invalid_trap_vitals");
    }

    normalized.push({
      x: trap.x,
      y: trap.y,
      blocking: typeof blocking === "boolean" ? blocking : DEFAULT_TRAP_BLOCKING,
      affinity: {
        kind: trap.affinity.kind,
        expression: AFFINITY_EXPRESSIONS.includes(expression) ? expression : DEFAULT_TRAP_EXPRESSION,
        stacks: isInteger(stacks) && stacks > 0 ? stacks : DEFAULT_TRAP_STACKS,
      },
      vitals: trap.vitals ? trap.vitals : undefined,
    });
  });
  return normalized;
}

export function normalizeLevelGenInput(input = {}) {
  const errors = [];
  const warnings = [];

  const width = readRequiredPositiveInt(input.width, "width", errors);
  const height = readRequiredPositiveInt(input.height, "height", errors);
  const walkableTilesTarget = readOptionalPositiveInt(input.walkableTilesTarget, "walkableTilesTarget", errors);
  const seed = readOptionalInt(input.seed, "seed", errors);
  const theme = readOptionalString(input.theme, "theme", errors);

  const shapeInput = input.shape || {};

  const maxRoomSize = width && height ? Math.max(1, Math.min(width, height) - 2) : 1;
  const maxRoomCount = width && height ? Math.max(1, (width - 2) * (height - 2)) : Number.MAX_SAFE_INTEGER;
  const roomCount = clampOptionalInt(
    shapeInput.roomCount,
    "shape.roomCount",
    1,
    maxRoomCount,
    warnings,
    errors,
    LEVEL_GEN_DEFAULTS.roomCount,
  );
  const roomMinSize = clampOptionalInt(
    shapeInput.roomMinSize,
    "shape.roomMinSize",
    1,
    maxRoomSize,
    warnings,
    errors,
    LEVEL_GEN_DEFAULTS.roomMinSize,
  );
  let roomMaxSize =
    clampOptionalInt(
      shapeInput.roomMaxSize,
      "shape.roomMaxSize",
      1,
      maxRoomSize,
      warnings,
      errors,
      LEVEL_GEN_DEFAULTS.roomMaxSize,
    );
  if (roomMinSize !== undefined && roomMaxSize !== undefined && roomMaxSize < roomMinSize) {
    pushWarning(warnings, "shape.roomMaxSize", "clamped", roomMaxSize, roomMinSize);
    roomMaxSize = roomMinSize;
  }
  const corridorWidth = clampOptionalInt(
    shapeInput.corridorWidth,
    "shape.corridorWidth",
    1,
    maxRoomSize,
    warnings,
    errors,
    LEVEL_GEN_DEFAULTS.corridorWidth,
  );
  const rawPattern = shapeInput.pattern ?? LEVEL_GEN_DEFAULTS.pattern;
  const pattern = normalizePatternType(rawPattern, errors);
  const maxPatternStride = width && height ? Math.max(2, Math.max(width, height) - 2) : 2;
  const maxPatternInset = Math.max(0, maxRoomSize - 1);
  const patternSpacing = clampOptionalInt(
    shapeInput.patternSpacing,
    "shape.patternSpacing",
    2,
    maxPatternStride,
    warnings,
    errors,
    LEVEL_GEN_DEFAULTS.patternSpacing,
  );
  const patternLineWidth = clampOptionalInt(
    shapeInput.patternLineWidth,
    "shape.patternLineWidth",
    1,
    maxRoomSize,
    warnings,
    errors,
    LEVEL_GEN_DEFAULTS.patternLineWidth,
  );
  const patternGapEvery = clampOptionalInt(
    shapeInput.patternGapEvery,
    "shape.patternGapEvery",
    2,
    Math.max(2, maxRoomSize),
    warnings,
    errors,
    LEVEL_GEN_DEFAULTS.patternGapEvery,
  );
  const patternInset = clampOptionalInt(
    shapeInput.patternInset,
    "shape.patternInset",
    0,
    maxPatternInset,
    warnings,
    errors,
    LEVEL_GEN_DEFAULTS.patternInset,
  );
  const patternInfillPercent = clampOptionalInt(
    shapeInput.patternInfillPercent,
    "shape.patternInfillPercent",
    1,
    100,
    warnings,
    errors,
    undefined,
  );

  const maxDistance = width && height ? Math.max(0, width - 1) + Math.max(0, height - 1) : 0;
  const spawnInput = input.spawn || {};
  const exitInput = input.exit || {};

  const spawnEdgeBias = readOptionalBoolean(spawnInput.edgeBias, "spawn.edgeBias", errors, LEVEL_GEN_DEFAULTS.edgeBias);
  const exitEdgeBias = readOptionalBoolean(exitInput.edgeBias, "exit.edgeBias", errors, LEVEL_GEN_DEFAULTS.edgeBias);
  const spawnMinDistance = clampOptionalInt(
    spawnInput.minDistance,
    "spawn.minDistance",
    0,
    maxDistance,
    warnings,
    errors,
    LEVEL_GEN_DEFAULTS.minDistance,
  );
  const exitMinDistance = clampOptionalInt(
    exitInput.minDistance,
    "exit.minDistance",
    0,
    maxDistance,
    warnings,
    errors,
    LEVEL_GEN_DEFAULTS.minDistance,
  );

  const connectivityInput = input.connectivity || {};
  const requirePath = readOptionalBoolean(
    connectivityInput.requirePath,
    "connectivity.requirePath",
    errors,
    LEVEL_GEN_DEFAULTS.requirePath,
  );

  const traps = width && height ? normalizeTrapList(input.traps, width, height, errors) : [];
  let availableWalkableTiles = null;
  if (width && height && walkableTilesTarget !== undefined) {
    const hasBorder = width > 2 && height > 2;
    const maxWalkableTiles = hasBorder ? (width - 2) * (height - 2) : width * height;
    const blockingTrapCount = traps.reduce((sum, trap) => sum + (trap?.blocking ? 1 : 0), 0);
    availableWalkableTiles = Math.max(0, maxWalkableTiles - blockingTrapCount);
    if (walkableTilesTarget > availableWalkableTiles) {
      pushError(errors, "walkableTilesTarget", "exceeds_walkable_capacity");
    }
  }

  const ok = errors.length === 0;
  if (!ok) {
    return { ok, errors, warnings, value: null };
  }

  const shape = {};
  if (roomCount !== undefined) shape.roomCount = roomCount;
  if (roomMinSize !== undefined) shape.roomMinSize = roomMinSize;
  if (roomMaxSize !== undefined) shape.roomMaxSize = roomMaxSize;
  if (corridorWidth !== undefined) shape.corridorWidth = corridorWidth;
  if (pattern !== undefined) shape.pattern = pattern;
  if (pattern !== "none") {
    if (patternSpacing !== undefined) shape.patternSpacing = patternSpacing;
    if (patternLineWidth !== undefined) shape.patternLineWidth = patternLineWidth;
    if (patternGapEvery !== undefined) shape.patternGapEvery = patternGapEvery;
    if (patternInset !== undefined) shape.patternInset = patternInset;
    if (patternInfillPercent !== undefined) shape.patternInfillPercent = patternInfillPercent;
  }

  const value = {
    width,
    height,
    shape,
    spawn: { edgeBias: spawnEdgeBias, minDistance: spawnMinDistance },
    exit: { edgeBias: exitEdgeBias, minDistance: exitMinDistance },
    connectivity: { requirePath },
    traps,
  };
  if (walkableTilesTarget !== undefined) value.walkableTilesTarget = walkableTilesTarget;
  if (seed !== undefined) value.seed = seed;
  if (theme !== undefined) value.theme = theme;

  return { ok, errors: [], warnings, value };
}

export const LEVEL_GEN_LIMITS = Object.freeze({
  maxLevelSide: null,
  maxWalkableTilesTarget: null,
});

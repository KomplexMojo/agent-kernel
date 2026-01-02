import { LEVEL_GEN_DEFAULTS } from "./defaults.js";

const LEVEL_GEN_PROFILES = Object.freeze(["rectangular", "sparse_islands", "clustered_islands"]);
const TRAP_AFFINITY_KINDS = Object.freeze(["fire", "water", "earth", "wind", "life", "decay", "corrode", "dark"]);
const TRAP_AFFINITY_EXPRESSIONS = Object.freeze(["push", "pull", "emit"]);

const DEFAULT_TRAP_EXPRESSION = "push";
const DEFAULT_TRAP_STACKS = 1;
const DEFAULT_TRAP_BLOCKING = false;

function isNumber(value) {
  return typeof value === "number" && !Number.isNaN(value);
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

function clampOptionalNumber(value, field, min, max, warnings, errors) {
  if (value === undefined) return undefined;
  if (!isNumber(value)) {
    pushError(errors, field, "invalid_number");
    return undefined;
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
    if (!TRAP_AFFINITY_KINDS.includes(trap.affinity.kind)) {
      pushError(errors, `${base}.affinity.kind`, "invalid_kind");
    }
    const expression = trap.affinity.expression ?? DEFAULT_TRAP_EXPRESSION;
    if (!TRAP_AFFINITY_EXPRESSIONS.includes(expression)) {
      pushError(errors, `${base}.affinity.expression`, "invalid_expression");
    }
    const stacks = trap.affinity.stacks ?? DEFAULT_TRAP_STACKS;
    if (!isInteger(stacks) || stacks < 1) {
      pushError(errors, `${base}.affinity.stacks`, "invalid_stacks");
    }

    if (trap.vitals && !isPlainObject(trap.vitals)) {
      pushError(errors, `${base}.vitals`, "invalid_vitals");
    }
    if (trap.vitals && ("health" in trap.vitals || "stamina" in trap.vitals)) {
      pushError(errors, `${base}.vitals`, "invalid_trap_vitals");
    }

    normalized.push({
      x: trap.x,
      y: trap.y,
      blocking: typeof blocking === "boolean" ? blocking : DEFAULT_TRAP_BLOCKING,
      affinity: {
        kind: trap.affinity.kind,
        expression: TRAP_AFFINITY_EXPRESSIONS.includes(expression) ? expression : DEFAULT_TRAP_EXPRESSION,
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
  const seed = readOptionalInt(input.seed, "seed", errors);
  const theme = readOptionalString(input.theme, "theme", errors);

  const shapeInput = input.shape || {};
  const profile = shapeInput.profile ?? LEVEL_GEN_DEFAULTS.profile;
  if (!LEVEL_GEN_PROFILES.includes(profile)) {
    pushError(errors, "shape.profile", "invalid_profile");
  }

  const density = clampOptionalNumber(shapeInput.density, "shape.density", 0, 1, warnings, errors);
  const clusterSize = clampOptionalInt(shapeInput.clusterSize, "shape.clusterSize", 0, Number.MAX_SAFE_INTEGER, warnings, errors);

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

  const ok = errors.length === 0;
  if (!ok) {
    return { ok, errors, warnings, value: null };
  }

  const shape = { profile };
  if (density !== undefined) shape.density = density;
  if (clusterSize !== undefined) shape.clusterSize = clusterSize;

  const value = {
    width,
    height,
    shape,
    spawn: { edgeBias: spawnEdgeBias, minDistance: spawnMinDistance },
    exit: { edgeBias: exitEdgeBias, minDistance: exitMinDistance },
    connectivity: { requirePath },
    traps,
  };
  if (seed !== undefined) value.seed = seed;
  if (theme !== undefined) value.theme = theme;

  return { ok, errors: [], warnings, value };
}

export { LEVEL_GEN_PROFILES };

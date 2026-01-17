import { AFFINITY_EXPRESSIONS, AFFINITY_KINDS } from "./affinity-loadouts.js";
import { MOTIVATION_KINDS } from "./motivation-loadouts.js";

const DEFAULT_KIND = "ambulatory";
const DEFAULT_EDGE_PADDING = 1;
const DEFAULT_STACKS = 1;
const DEFAULT_INTENSITY = 1;

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function createRng(seed = 0) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleWithRng(list, rng) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function addError(errors, field, code) {
  errors.push({ field, code });
}

function addWarning(warnings, field, code, from, to) {
  warnings.push({ field, code, from, to });
}

function normalizeMenu(list, fallback, field, errors) {
  if (list === undefined) return fallback.slice();
  if (!Array.isArray(list) || list.length === 0) {
    addError(errors, field, "invalid_list");
    return fallback.slice();
  }
  const filtered = list.filter((entry) => typeof entry === "string" && entry.trim() !== "");
  if (filtered.length === 0) {
    addError(errors, field, "invalid_list");
    return fallback.slice();
  }
  return filtered.map((entry) => entry.trim());
}

function buildPlacementGrid({ width, height, count, edgePadding }) {
  const pad = Math.max(0, edgePadding);
  const innerWidth = Math.max(1, width - pad * 2);
  const innerHeight = Math.max(1, height - pad * 2);
  const maxCells = innerWidth * innerHeight;
  const safeCount = Math.min(count, maxCells);

  const columnsRaw = Math.ceil(Math.sqrt((safeCount * innerWidth) / innerHeight));
  const columns = clampInt(columnsRaw, 1, innerWidth);
  const rows = clampInt(Math.ceil(safeCount / columns), 1, innerHeight);

  const stepX = innerWidth / columns;
  const stepY = innerHeight / rows;
  const positions = [];

  for (let i = 0; i < safeCount; i += 1) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    const x = Math.floor(col * stepX + stepX / 2) + pad;
    const y = Math.floor(row * stepY + stepY / 2) + pad;
    positions.push({ x, y });
  }
  return { positions, maxCells };
}

export function generateActorSet({
  count,
  width,
  height,
  seed = 0,
  kind = DEFAULT_KIND,
  edgePadding = DEFAULT_EDGE_PADDING,
  idPrefix = "actor",
  affinities,
  expressions,
  motivations,
  stacks = DEFAULT_STACKS,
  intensity = DEFAULT_INTENSITY,
} = {}) {
  const errors = [];
  const warnings = [];

  if (!isPositiveInt(width)) addError(errors, "width", "invalid_positive_int");
  if (!isPositiveInt(height)) addError(errors, "height", "invalid_positive_int");
  if (!isPositiveInt(count)) addError(errors, "count", "invalid_positive_int");

  const affinityMenu = normalizeMenu(affinities, AFFINITY_KINDS, "affinities", errors);
  const expressionMenu = normalizeMenu(expressions, AFFINITY_EXPRESSIONS, "expressions", errors);
  const motivationMenu = normalizeMenu(motivations, MOTIVATION_KINDS, "motivations", errors);

  if (errors.length > 0) {
    return { ok: false, errors, warnings, actors: [] };
  }

  const rng = createRng(Number.isFinite(seed) ? seed : 0);
  const affinityOrder = shuffleWithRng(affinityMenu, rng);
  const expressionOrder = shuffleWithRng(expressionMenu, rng);
  const motivationOrder = shuffleWithRng(motivationMenu, rng);

  const { positions, maxCells } = buildPlacementGrid({
    width,
    height,
    count,
    edgePadding,
  });

  if (count > maxCells) {
    addWarning(warnings, "count", "clamped", count, positions.length);
  }

  const actors = positions.map((pos, index) => {
    const affinity = affinityOrder[index % affinityOrder.length];
    const expression = expressionOrder[index % expressionOrder.length];
    const motivation = motivationOrder[index % motivationOrder.length];
    const id = `${idPrefix}_${index + 1}`;
    return {
      id,
      kind,
      position: { x: pos.x, y: pos.y },
      motivations: [{ kind: motivation, intensity }],
      affinities: [{ kind: affinity, expression, stacks }],
      vitals: {
        health: { current: 1, max: 1, regen: 0 },
        mana: { current: 0, max: 0, regen: 0 },
        stamina: { current: 0, max: 0, regen: 0 },
        durability: { current: 1, max: 1, regen: 0 },
      },
    };
  });

  return { ok: true, errors, warnings, actors };
}

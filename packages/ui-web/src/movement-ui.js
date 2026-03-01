import { applyMoveAction, packMoveAction, renderFrameBuffer, readObservation } from "../../bindings-ts/src/mvp-movement.js";
import {
  AFFINITY_KINDS,
  DARKNESS_OBSCURE_RADIUS,
  DARKNESS_OBSCURE_STACK_THRESHOLD,
  LIGHT_SIGHT_MIN_STACK,
  ROOM_AFFINITY_EMIT_PERCENT_PER_STACK,
  TRAP_VITAL_KEYS,
  VITAL_KEYS,
} from "../../runtime/src/contracts/domain-constants.js";

const EVENT_STREAM_LIMIT = 6;
const DEFAULT_VIEWPORT_SIZE = 50;
const DEFAULT_VISION_RADIUS = 6;
const VISIBILITY_MODE_SIMULATION_FULL = "simulation_full";
const VISIBILITY_MODE_GAMEPLAY_FOG = "gameplay_fog";
const KNOWN_VISIBILITY_MODES = new Set([
  VISIBILITY_MODE_SIMULATION_FULL,
  VISIBILITY_MODE_GAMEPLAY_FOG,
]);
const FOG_TILE_CHAR = "?";
const ASCII_ACTOR_SYMBOLS = [
  "@",
  "A",
  "C",
  "D",
  "F",
  "G",
  "H",
  "J",
  "K",
  "L",
  "M",
  "N",
  "P",
  "Q",
  "R",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "a",
  "c",
  "d",
  "f",
  "g",
  "h",
  "j",
  "k",
  "m",
  "n",
  "p",
  "q",
  "r",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "+",
  "*",
  "%",
  "$",
  "&",
  "?",
  "!",
];
const AFFINITY_HUE_OVERRIDES = Object.freeze({
  fire: 12,
  water: 206,
  earth: 80,
  wind: 175,
  life: 140,
  decay: 280,
  corrode: 32,
  fortify: 102,
  light: 52,
  dark: 230,
});
const AFFINITY_HUES = Object.freeze(
  AFFINITY_KINDS.reduce((acc, kind, index) => {
    acc[kind] = AFFINITY_HUE_OVERRIDES[kind] ?? (index * 41) % 360;
    return acc;
  }, {}),
);
const REALTIME_MOVE_BY_ACTION = Object.freeze({
  up: { direction: "north", dx: 0, dy: -1 },
  down: { direction: "south", dx: 0, dy: 1 },
  left: { direction: "west", dx: -1, dy: 0 },
  right: { direction: "east", dx: 1, dy: 0 },
});
const STACK_STYLES = [
  { sat: 55, light: 55, glow: 0 },
  { sat: 65, light: 50, glow: 4 },
  { sat: 75, light: 45, glow: 6 },
  { sat: 85, light: 40, glow: 8 },
];

function escapeHtmlChar(char) {
  if (char === "&") return "&amp;";
  if (char === "<") return "&lt;";
  if (char === ">") return "&gt;";
  if (char === "\"") return "&quot;";
  if (char === "'") return "&#39;";
  return char;
}

function escapeHtml(value) {
  return String(value).split("").map(escapeHtmlChar).join("");
}

function normalizeStacks(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.max(1, Math.round(num));
}

function resolveAffinityFromTraits(traits) {
  const affinityStacks = traits?.affinities;
  if (!affinityStacks || typeof affinityStacks !== "object" || Array.isArray(affinityStacks)) {
    return null;
  }
  const entries = Object.entries(affinityStacks)
    .map(([key, stacks]) => ({
      kind: String(key).split(":")[0],
      stacks: normalizeStacks(stacks),
    }))
    .filter((entry) => entry.kind);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.stacks - a.stacks);
  return entries[0];
}

function resolveAffinityFromId(actorId) {
  if (!actorId) return null;
  const lowered = String(actorId).toLowerCase();
  return Object.keys(AFFINITY_HUES).find((key) => lowered.includes(`_${key}_`)) || null;
}

function resolveAffinityInfo(actor) {
  const fromTraits = resolveAffinityFromTraits(actor?.traits);
  if (fromTraits) return fromTraits;
  if (Array.isArray(actor?.affinities) && actor.affinities.length > 0) {
    const entries = actor.affinities.map((entry) => ({
      kind: entry?.kind,
      stacks: normalizeStacks(entry?.stacks),
    })).filter((entry) => entry.kind);
    if (entries.length > 0) {
      entries.sort((a, b) => b.stacks - a.stacks);
      return entries[0];
    }
  }
  if (typeof actor?.affinity === "string" && actor.affinity.trim()) {
    return { kind: actor.affinity.trim(), stacks: 1 };
  }
  const fromId = resolveAffinityFromId(actor?.id);
  if (fromId) {
    return { kind: fromId, stacks: 1 };
  }
  return null;
}

function resolveStackStyle(stacks) {
  const normalized = normalizeStacks(stacks);
  const index = Math.min(STACK_STYLES.length - 1, normalized - 1);
  return { ...STACK_STYLES[index], stacks: normalized };
}

function buildActorSymbolMap(actors = [], symbols, fallbackSymbols) {
  const ids = actors.map((actor) => String(actor?.id || "")).sort();
  const map = new Map();
  ids.forEach((id, index) => {
    const primary = symbols && symbols.length ? (index < symbols.length ? symbols[index] : null) : null;
    const fallback = fallbackSymbols?.[index % fallbackSymbols.length];
    map.set(id, primary || fallback || "@");
  });
  return map;
}

function resolveTrapAffinityEntry(trap = null) {
  if (!trap || typeof trap !== "object") return null;
  const candidates = Array.isArray(trap.affinities)
    ? trap.affinities
    : trap.affinity && typeof trap.affinity === "object"
      ? [trap.affinity]
      : [];
  const valid = candidates
    .map((entry) => {
      const kind = normalizeAffinityKind(entry?.kind);
      const stacks = normalizeStacks(entry?.stacks);
      const targetType = typeof entry?.targetType === "string" ? entry.targetType.trim().toLowerCase() : "";
      if (!kind || !AFFINITY_HUES[kind]) return null;
      return { kind, stacks, targetType };
    })
    .filter(Boolean);
  if (valid.length === 0) return null;
  const floorFirst = valid.filter((entry) => entry.targetType === "floor");
  const pool = floorFirst.length > 0 ? floorFirst : valid;
  pool.sort((a, b) => b.stacks - a.stacks);
  return pool[0];
}

function buildFloorAffinityIndex(traps = [], { viewport = null } = {}) {
  if (!Array.isArray(traps) || traps.length === 0) return new Map();
  const index = new Map();
  traps.forEach((trap) => {
    const x = Number(trap?.position?.x);
    const y = Number(trap?.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (viewport) {
      if (x < viewport.startX || x >= viewport.endX) return;
      if (y < viewport.startY || y >= viewport.endY) return;
    }
    const affinity = resolveTrapAffinityEntry(trap);
    if (!affinity) return;
    const localX = viewport ? x - viewport.startX : x;
    const localY = viewport ? y - viewport.startY : y;
    const key = keyForCell(localX, localY);
    const prior = index.get(key);
    if (!prior || affinity.stacks > prior.stacks) {
      index.set(key, affinity);
    }
  });
  return index;
}

function buildActorOverlay(baseTiles, actors = [], { floorAffinityByCell = null } = {}) {
  if (!Array.isArray(baseTiles) || baseTiles.length === 0) {
    return { text: "", html: "" };
  }
  const sortedActors = actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  const textGrid = baseTiles.map((row) => String(row).split(""));
  const htmlGrid = baseTiles.map((row) => String(row).split("").map(escapeHtmlChar));
  const asciiSymbols = buildActorSymbolMap(sortedActors, ASCII_ACTOR_SYMBOLS, ASCII_ACTOR_SYMBOLS);
  if (floorAffinityByCell && typeof floorAffinityByCell.get === "function") {
    for (let y = 0; y < textGrid.length; y += 1) {
      const rowText = textGrid[y];
      const rowHtml = htmlGrid[y];
      if (!Array.isArray(rowText) || !Array.isArray(rowHtml)) continue;
      for (let x = 0; x < rowText.length; x += 1) {
        if (rowText[x] !== ".") continue;
        const affinity = floorAffinityByCell.get(keyForCell(x, y));
        if (!affinity?.kind) continue;
        const hue = AFFINITY_HUES[affinity.kind];
        if (!Number.isFinite(hue)) continue;
        const style = resolveStackStyle(affinity.stacks);
        const tileStyle = `--tile-hue:${hue};--tile-sat:${Math.max(35, style.sat - 18)}%;--tile-light:${Math.min(75, style.light + 22)}%;--tile-glow:${Math.max(1, style.glow - 1)}px;`;
        rowHtml[x] = `<span class="affinity-floor-cell" data-affinity="${escapeHtml(affinity.kind)}" data-stacks="${style.stacks}" style="${tileStyle}">${escapeHtmlChar(".")}</span>`;
      }
    }
  }

  sortedActors.forEach((actor) => {
    const position = actor?.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const rowText = textGrid[position.y];
    const rowHtml = htmlGrid[position.y];
    if (!rowText || !rowHtml || position.x < 0 || position.x >= rowText.length) return;
    const actorId = String(actor?.id || "");
    const asciiSymbol = asciiSymbols.get(actorId) || "@";
    textGrid[position.y][position.x] = asciiSymbol;

    const affinityInfo = resolveAffinityInfo(actor);
    const hue = affinityInfo?.kind ? AFFINITY_HUES[affinityInfo.kind] : null;
    const safeActorId = escapeHtml(actorId);
    const actorAttr = ` data-actor-id="${safeActorId}"`;
    let style = "";
    let dataAttr = "";
    if (hue !== undefined && hue !== null) {
      const stackStyle = resolveStackStyle(affinityInfo.stacks);
      style = `--actor-hue:${hue};--actor-sat:${stackStyle.sat}%;--actor-light:${stackStyle.light}%;--actor-glow:${stackStyle.glow}px;`;
      dataAttr = ` data-affinity="${escapeHtml(affinityInfo.kind)}" data-stacks="${stackStyle.stacks}"`;
    }
    const styleAttr = style ? ` style="${style}"` : "";
    rowHtml[position.x] = `<span class="actor-cell"${actorAttr}${dataAttr}${styleAttr}>${escapeHtmlChar(asciiSymbol)}</span>`;
  });

  return {
    text: textGrid.map((row) => row.join("")).join("\n"),
    html: htmlGrid.map((row) => row.join("")).join("\n"),
  };
}

function kindLabel(kind) {
  if (kind === 0) return "stationary";
  if (kind === 1) return "barrier";
  if (kind === 2) return "motivated";
  return `kind:${kind}`;
}

function formatVitals(vitals = {}) {
  return VITAL_KEYS
    .map((key) => {
      const record = vitals[key] || { current: 0, max: 0, regen: 0 };
      return `${key[0].toUpperCase()}:${record.current}/${record.max}+${record.regen}`;
    })
    .join(" ");
}

function formatTrapVitals(vitals = {}) {
  return TRAP_VITAL_KEYS
    .map((key) => {
      const record = vitals[key] || { current: 0, max: 0, regen: 0 };
      return `${key}:${record.current}/${record.max}+${record.regen}`;
    })
    .join(" ");
}

function formatEventEntry(action, index) {
  if (!action) return null;
  const tick = Number.isFinite(action.tick) ? action.tick : "?";
  const actorId = action.actorId || "actor";
  const kind = action.kind || "event";
  if (kind === "move") {
    const from = action.params?.from;
    const to = action.params?.to;
    const direction = action.params?.direction ? ` ${action.params.direction}` : "";
    if (from && to) {
      return `${index + 1}. t${tick} ${actorId} move${direction} (${from.x},${from.y}) -> (${to.x},${to.y})`;
    }
  }
  return `${index + 1}. t${tick} ${actorId} ${kind}`;
}

function findExit(baseTiles) {
  if (!Array.isArray(baseTiles)) return null;
  for (let y = 0; y < baseTiles.length; y += 1) {
    const row = baseTiles[y];
    if (typeof row !== "string") continue;
    const x = row.indexOf("E");
    if (x !== -1) return { x, y };
  }
  return null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
}

function normalizeVisibilityMode(mode) {
  return KNOWN_VISIBILITY_MODES.has(mode) ? mode : VISIBILITY_MODE_SIMULATION_FULL;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function keyForCell(x, y) {
  return `${x},${y}`;
}

function normalizeAffinityKind(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function parseAffinityStacks(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.round(num));
}

function accumulateAffinityStack(target, kind, stacks) {
  const normalizedKind = normalizeAffinityKind(kind);
  const normalizedStacks = parseAffinityStacks(stacks, 0);
  if (!normalizedKind || normalizedStacks <= 0) return;
  const current = target.get(normalizedKind) || 0;
  if (normalizedStacks > current) {
    target.set(normalizedKind, normalizedStacks);
  }
}

function collectEntityAffinityStacks(entry = null) {
  const stacks = new Map();
  const traits = entry?.traits?.affinities;
  if (traits && typeof traits === "object" && !Array.isArray(traits)) {
    Object.entries(traits).forEach(([key, value]) => {
      const [kind] = String(key || "").split(":");
      accumulateAffinityStack(stacks, kind, value);
    });
  }
  if (Array.isArray(entry?.affinities)) {
    entry.affinities.forEach((affinity) => {
      accumulateAffinityStack(stacks, affinity?.kind, affinity?.stacks);
    });
  }
  if (typeof entry?.affinity === "string" && entry.affinity.trim()) {
    accumulateAffinityStack(stacks, entry.affinity, 1);
  }
  return stacks;
}

function resolveTrapDarknessStacks(trap = null) {
  const affinityStacks = collectEntityAffinityStacks(trap);
  const darkStacks = affinityStacks.get("dark") || 0;
  const manaReserve = Number(trap?.manaReserve);
  const potencyFromPercent = Number.isFinite(manaReserve) && manaReserve > 0
    ? Math.floor(manaReserve / ROOM_AFFINITY_EMIT_PERCENT_PER_STACK)
    : 0;
  return Math.max(darkStacks, potencyFromPercent);
}

function addObscuredRadius(obscuredCells, { x, y }, { width, height, radius = 0 } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const maxRadius = Math.max(0, Math.floor(radius));
  for (let py = y - maxRadius; py <= y + maxRadius; py += 1) {
    if (py < 0 || py >= height) continue;
    for (let px = x - maxRadius; px <= x + maxRadius; px += 1) {
      if (px < 0 || px >= width) continue;
      const distance = Math.abs(px - x) + Math.abs(py - y);
      if (distance > maxRadius) continue;
      obscuredCells.add(keyForCell(px, py));
    }
  }
}

function buildDarknessOcclusion({ baseTiles = [], actors = [], traps = [] } = {}) {
  const map = resolveBaseDimensions(baseTiles);
  const obscuredCells = new Set();
  const hiddenActorIds = new Set();

  (Array.isArray(traps) ? traps : []).forEach((trap) => {
    const darkStacks = resolveTrapDarknessStacks(trap);
    if (darkStacks < DARKNESS_OBSCURE_STACK_THRESHOLD) return;
    addObscuredRadius(
      obscuredCells,
      trap?.position || {},
      { width: map.width, height: map.height, radius: DARKNESS_OBSCURE_RADIUS },
    );
  });

  (Array.isArray(actors) ? actors : []).forEach((actor) => {
    const affinityStacks = collectEntityAffinityStacks(actor);
    const darkStacks = affinityStacks.get("dark") || 0;
    if (darkStacks < DARKNESS_OBSCURE_STACK_THRESHOLD) return;
    const actorId = String(actor?.id || "");
    if (actorId) hiddenActorIds.add(actorId);
    addObscuredRadius(
      obscuredCells,
      actor?.position || {},
      { width: map.width, height: map.height, radius: DARKNESS_OBSCURE_RADIUS },
    );
  });

  return { obscuredCells, hiddenActorIds };
}

function actorCanRevealDarkness(actor) {
  const affinityStacks = collectEntityAffinityStacks(actor);
  const lightStacks = affinityStacks.get("light") || 0;
  return lightStacks >= LIGHT_SIGHT_MIN_STACK;
}

function filterVisionByDarkness(cells = new Set(), { obscuredCells = new Set(), canRevealDarkness = false } = {}) {
  if (canRevealDarkness) return cells;
  const filtered = new Set();
  cells.forEach((cellKey) => {
    if (!obscuredCells.has(cellKey)) {
      filtered.add(cellKey);
    }
  });
  return filtered;
}

function resolveBaseDimensions(baseTiles = []) {
  const height = Array.isArray(baseTiles) ? baseTiles.length : 0;
  const width = Array.isArray(baseTiles)
    ? baseTiles.reduce((max, row) => Math.max(max, String(row || "").length), 0)
    : 0;
  return {
    width: Math.max(0, width),
    height: Math.max(0, height),
    totalTiles: Math.max(0, width * height),
  };
}

function collectVisionForActor({ baseTiles = [], actor = null, radius = DEFAULT_VISION_RADIUS } = {}) {
  if (!actor?.position) return new Set();
  const { width, height } = resolveBaseDimensions(baseTiles);
  if (width <= 0 || height <= 0) return new Set();
  const centerX = Number.isFinite(actor.position.x) ? actor.position.x : 0;
  const centerY = Number.isFinite(actor.position.y) ? actor.position.y : 0;
  const normalizedRadius = Math.max(1, parsePositiveInt(radius, DEFAULT_VISION_RADIUS));
  const cells = new Set();
  for (let y = centerY - normalizedRadius; y <= centerY + normalizedRadius; y += 1) {
    if (y < 0 || y >= height) continue;
    for (let x = centerX - normalizedRadius; x <= centerX + normalizedRadius; x += 1) {
      if (x < 0 || x >= width) continue;
      const distance = Math.abs(centerX - x) + Math.abs(centerY - y);
      if (distance <= normalizedRadius) {
        cells.add(keyForCell(x, y));
      }
    }
  }
  return cells;
}

function fogTilesByExploration(baseTiles = [], exploredCells = new Set()) {
  if (!Array.isArray(baseTiles) || baseTiles.length === 0) return [];
  return baseTiles.map((rowText, y) => {
    const row = String(rowText || "");
    let output = "";
    for (let x = 0; x < row.length; x += 1) {
      output += exploredCells.has(keyForCell(x, y)) ? row[x] : FOG_TILE_CHAR;
    }
    return output;
  });
}

function resolveViewportWindow({
  width,
  height,
  center = null,
  viewportSize = DEFAULT_VIEWPORT_SIZE,
} = {}) {
  const normalizedWidth = Math.max(0, Number(width) || 0);
  const normalizedHeight = Math.max(0, Number(height) || 0);
  const targetSize = Math.max(1, parsePositiveInt(viewportSize, DEFAULT_VIEWPORT_SIZE));
  const viewportWidth = Math.min(targetSize, normalizedWidth || targetSize);
  const viewportHeight = Math.min(targetSize, normalizedHeight || targetSize);
  const centerX = Number.isFinite(center?.x) ? center.x : Math.floor(normalizedWidth / 2);
  const centerY = Number.isFinite(center?.y) ? center.y : Math.floor(normalizedHeight / 2);
  const maxStartX = Math.max(0, normalizedWidth - viewportWidth);
  const maxStartY = Math.max(0, normalizedHeight - viewportHeight);
  const startX = clamp(Math.floor(centerX - viewportWidth / 2), 0, maxStartX);
  const startY = clamp(Math.floor(centerY - viewportHeight / 2), 0, maxStartY);
  return {
    startX,
    startY,
    width: viewportWidth,
    height: viewportHeight,
    endX: startX + viewportWidth,
    endY: startY + viewportHeight,
  };
}

function normalizeRoomBounds(bounds = null) {
  if (!bounds || typeof bounds !== "object") return null;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = Number.isFinite(bounds.width) ? Math.max(1, Math.floor(bounds.width)) : 1;
  const height = Number.isFinite(bounds.height) ? Math.max(1, Math.floor(bounds.height)) : 1;
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width,
    height,
  };
}

function resolveRoomViewport({ roomBounds = null, map = null } = {}) {
  const bounds = normalizeRoomBounds(roomBounds);
  const mapWidth = Math.max(0, Number(map?.width) || 0);
  const mapHeight = Math.max(0, Number(map?.height) || 0);
  if (!bounds || mapWidth <= 0 || mapHeight <= 0) return null;
  const startX = clamp(bounds.x, 0, mapWidth);
  const startY = clamp(bounds.y, 0, mapHeight);
  const endX = Math.min(mapWidth, bounds.x + bounds.width);
  const endY = Math.min(mapHeight, bounds.y + bounds.height);
  if (endX <= startX || endY <= startY) return null;
  return {
    startX,
    startY,
    width: endX - startX,
    height: endY - startY,
    endX,
    endY,
  };
}

function cropTilesToViewport(baseTiles = [], viewport = null) {
  if (!Array.isArray(baseTiles) || baseTiles.length === 0 || !viewport) return [];
  const rows = [];
  for (let y = viewport.startY; y < viewport.endY; y += 1) {
    const row = String(baseTiles[y] || "");
    rows.push(row.slice(viewport.startX, viewport.endX));
  }
  return rows;
}

function projectActorsForViewport(
  actors = [],
  { viewport = null, visibilityMask = null } = {},
) {
  if (!Array.isArray(actors) || !viewport) return [];
  return actors
    .filter((actor) => {
      const x = actor?.position?.x;
      const y = actor?.position?.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (x < viewport.startX || x >= viewport.endX) return false;
      if (y < viewport.startY || y >= viewport.endY) return false;
      if (visibilityMask && !visibilityMask.has(keyForCell(x, y))) return false;
      return true;
    })
    .map((actor) => ({
      ...actor,
      position: {
        x: actor.position.x - viewport.startX,
        y: actor.position.y - viewport.startY,
      },
    }));
}

export function formatAffinities(affinities = []) {
  if (!Array.isArray(affinities) || affinities.length === 0) {
    return "No affinities equipped";
  }
  return affinities.map((affinity) => {
    const kind = affinity?.kind || "unknown";
    const expression = affinity?.expression || "unknown";
    const stacks = Number.isFinite(affinity?.stacks) ? affinity.stacks : 1;
    let note = "";
    if (kind === "corrode") note = " (erodes durability)";
    if (kind === "fortify") note = " (reinforces durability-bearing targets)";
    if (kind === "light") note = " (extends sight in fog of war)";
    if (kind === "dark") note = " (obscures self and can blind)";
    return `${kind}:${expression} x${stacks}${note}`;
  }).join(", ");
}

export function formatAbilities(abilities = []) {
  if (!Array.isArray(abilities) || abilities.length === 0) {
    return "No abilities";
  }
  return abilities.map((ability) => {
    const id = ability?.id || "ability";
    const kind = ability?.kind || "unknown";
    const affinityKind = ability?.affinityKind || "unknown";
    const expression = ability?.expression || "unknown";
    const potency = Number.isFinite(ability?.potency) ? ability.potency : 0;
    const manaCost = Number.isFinite(ability?.manaCost) ? ability.manaCost : 0;
    return `${id} (${kind}, ${affinityKind}/${expression}, pot ${potency}, mana ${manaCost})`;
  }).join("; ");
}

export function renderActorSummary(entry) {
  const base = `${entry.id} [${kindLabel(entry.kind)}] @(${entry.position.x},${entry.position.y}) ${formatVitals(entry.vitals)}`;
  return `${base}\n  affinities: ${formatAffinities(entry.affinities)}\n  abilities: ${formatAbilities(entry.abilities)}`;
}

export function renderActorInspectSummary(entry) {
  return `${entry.id} [${kindLabel(entry.kind)}] @(${entry.position.x},${entry.position.y}) ${formatVitals(entry.vitals)}`;
}

export function renderTrapSummary(trap) {
  const position = trap?.position || { x: 0, y: 0 };
  const vitals = formatTrapVitals(trap?.vitals || {});
  const affinities = formatAffinities(trap?.affinities || []);
  const abilities = formatAbilities(trap?.abilities || []);
  return `trap @(${position.x},${position.y}) ${vitals}\n  affinities: ${affinities}\n  abilities: ${abilities}`;
}

export function setupPlayback({
  core,
  actions,
  actorIdLabel = "actor_mvp",
  actorIds,
  actorIdValue = 1,
  intervalMs = 500,
  elements,
  affinityEffects,
  initCore,
  visibility = {},
  onObservation,
}) {
  let currentIndex = 0;
  let playing = false;
  let timer = null;
  let visibilityMode = normalizeVisibilityMode(visibility?.mode);
  let visibilityFocusRoom = normalizeRoomBounds(visibility?.focusRoom);
  let fogFullMap = Boolean(visibility?.fogFullMap);
  let viewportSize = parsePositiveInt(visibility?.viewportSize, DEFAULT_VIEWPORT_SIZE);
  let visionRadius = parsePositiveInt(visibility?.visionRadius, DEFAULT_VISION_RADIUS);
  let viewerActorId = typeof visibility?.viewerActorId === "string" ? visibility.viewerActorId : actorIdLabel;
  const actorIdValueByLabel = new Map();
  if (Array.isArray(actorIds)) {
    actorIds.forEach((entry, index) => {
      const label = typeof entry === "string" ? entry.trim() : "";
      if (!label) return;
      actorIdValueByLabel.set(label, index + 1);
    });
  }
  if (typeof actorIdLabel === "string" && actorIdLabel.trim()) {
    actorIdValueByLabel.set(actorIdLabel.trim(), actorIdValue);
  }
  const exploredByActor = new Map();
  const visibleNowByActor = new Map();
  let latestVisibilitySummary = {
    mode: visibilityMode,
    viewerActorId: viewerActorId || null,
    map: { width: 0, height: 0, totalTiles: 0 },
    viewport: { startX: 0, startY: 0, width: 0, height: 0, endX: 0, endY: 0 },
    actorStats: [],
    viewer: null,
    roomFocus: visibilityFocusRoom ? { ...visibilityFocusRoom } : null,
    fogFullMap,
  };

  function clearVisibilityTracking() {
    exploredByActor.clear();
    visibleNowByActor.clear();
  }

  function ensureExploredSet(actorId) {
    const normalized = String(actorId || "");
    if (!normalized) return new Set();
    if (!exploredByActor.has(normalized)) {
      exploredByActor.set(normalized, new Set());
    }
    return exploredByActor.get(normalized);
  }

  function sortedActors(actors = []) {
    if (!Array.isArray(actors)) return [];
    return actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  }

  function toPercent(part, total) {
    if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
    return Number(((part / total) * 100).toFixed(2));
  }

  function recordVisibilitySnapshot(frame, obs) {
    const baseTiles = Array.isArray(frame?.baseTiles) ? frame.baseTiles : [];
    const actors = sortedActors(obs?.actors || []);
    const traps = Array.isArray(obs?.traps) ? obs.traps : [];
    const map = resolveBaseDimensions(baseTiles);
    const darkness = buildDarknessOcclusion({ baseTiles, actors, traps });

    visibleNowByActor.clear();
    actors.forEach((actor) => {
      const actorId = String(actor?.id || "");
      if (!actorId || !actor?.position) return;
      const baseVision = collectVisionForActor({
        baseTiles,
        actor,
        radius: visionRadius,
      });
      const currentVision = filterVisionByDarkness(baseVision, {
        obscuredCells: darkness.obscuredCells,
        canRevealDarkness: actorCanRevealDarkness(actor),
      });
      const selfX = actor?.position?.x;
      const selfY = actor?.position?.y;
      if (Number.isFinite(selfX) && Number.isFinite(selfY)) {
        currentVision.add(keyForCell(selfX, selfY));
      }
      visibleNowByActor.set(actorId, currentVision);
      const explored = ensureExploredSet(actorId);
      currentVision.forEach((cellKey) => explored.add(cellKey));
    });

    if (!viewerActorId && actors.length > 0) {
      viewerActorId = String(actors[0]?.id || "");
    }

    const actorStats = actors.map((actor) => {
      const actorId = String(actor?.id || "");
      const explored = exploredByActor.get(actorId) || new Set();
      const visibleNow = visibleNowByActor.get(actorId) || new Set();
      return {
        id: actorId,
        exploredTiles: explored.size,
        visibleNowTiles: visibleNow.size,
        exploredPercent: toPercent(explored.size, map.totalTiles),
        lightSight: actorCanRevealDarkness(actor),
      };
    });

    return {
      actors,
      map,
      actorStats,
      darkness,
    };
  }

  function resolveViewerActor(actors = []) {
    const normalizedViewer = String(viewerActorId || "");
    if (normalizedViewer) {
      const match = actors.find((actor) => String(actor?.id || "") === normalizedViewer);
      if (match) return match;
    }
    const primary = actors.find((actor) => String(actor?.id || "") === String(actorIdLabel || ""));
    if (primary) {
      viewerActorId = String(primary.id || "");
      return primary;
    }
    if (actors.length > 0) {
      viewerActorId = String(actors[0]?.id || "");
      return actors[0];
    }
    return null;
  }

  function cloneVisibilitySummary(summary = null) {
    if (!summary || typeof summary !== "object") return null;
    return {
      ...summary,
      map: summary.map ? { ...summary.map } : { width: 0, height: 0, totalTiles: 0 },
      viewport: summary.viewport ? { ...summary.viewport } : null,
      viewer: summary.viewer ? { ...summary.viewer } : null,
      roomFocus: summary.roomFocus ? { ...summary.roomFocus } : null,
      fogFullMap: Boolean(summary.fogFullMap),
      actorStats: Array.isArray(summary.actorStats)
        ? summary.actorStats.map((entry) => ({ ...entry }))
        : [],
    };
  }

  function resolveActorIdValueForLabel(label, observationActors = []) {
    const normalized = typeof label === "string" ? label.trim() : "";
    if (!normalized) return actorIdValue;
    if (actorIdValueByLabel.has(normalized)) {
      return actorIdValueByLabel.get(normalized);
    }
    if (Array.isArray(observationActors) && observationActors.length > 0) {
      const index = observationActors.findIndex((entry) => String(entry?.id || "") === normalized);
      if (index >= 0) {
        const fromCore = typeof core?.getMotivatedActorIdByIndex === "function"
          ? Number(core.getMotivatedActorIdByIndex(index))
          : NaN;
        const resolved = Number.isFinite(fromCore) && fromCore > 0 ? fromCore : index + 1;
        actorIdValueByLabel.set(normalized, resolved);
        return resolved;
      }
    }
    return actorIdValue;
  }

  function resolveActionActorIdValue(action = null) {
    const explicit = Number(action?.actorIdValue);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return resolveActorIdValueForLabel(action?.actorId);
  }

  function setActiveActorByValue(value) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return false;
    }
    if (typeof core?.setActiveMotivatedActor !== "function") {
      return true;
    }
    return Number(core.setActiveMotivatedActor(normalized)) === 0;
  }

  function readSnapshot() {
    const frame = renderFrameBuffer(core, { actorIdLabel });
    const obs = readObservation(core, { actorIdLabel, actorIds, affinityEffects });
    if (Array.isArray(obs?.actors)) {
      obs.actors.forEach((entry, index) => {
        const label = String(entry?.id || "").trim();
        if (!label) return;
        const fromCore = typeof core?.getMotivatedActorIdByIndex === "function"
          ? Number(core.getMotivatedActorIdByIndex(index))
          : NaN;
        const resolved = Number.isFinite(fromCore) && fromCore > 0 ? fromCore : index + 1;
        actorIdValueByLabel.set(label, resolved);
      });
    }
    const visibilityData = recordVisibilitySnapshot(frame, obs);
    return { frame, obs, visibilityData };
  }

  function renderFromSnapshot({ frame, obs, visibilityData }) {
    const baseTiles = Array.isArray(frame?.baseTiles) ? frame.baseTiles : [];
    const map = visibilityData?.map || resolveBaseDimensions(baseTiles);
    const allActors = visibilityData?.actors || sortedActors(obs?.actors || []);
    const darkness = visibilityData?.darkness || { obscuredCells: new Set(), hiddenActorIds: new Set() };
    const viewerActor = resolveViewerActor(allActors);
    const viewerKey = viewerActor ? String(viewerActor.id || "") : "";
    const viewerCanRevealDarkness = viewerActor ? actorCanRevealDarkness(viewerActor) : false;
    const viewerExplored = viewerKey ? (exploredByActor.get(viewerKey) || new Set()) : new Set();
    const viewerVisibleNow = viewerKey ? (visibleNowByActor.get(viewerKey) || new Set()) : new Set();

    let renderTiles = baseTiles;
    let renderActors = allActors;
    let actorListEntries = allActors;
    let viewport = resolveViewportWindow({
      width: map.width,
      height: map.height,
      center: viewerActor?.position || null,
      viewportSize: Math.max(map.width, map.height, 1),
    });

    if (visibilityMode === VISIBILITY_MODE_SIMULATION_FULL) {
      const roomViewport = resolveRoomViewport({ roomBounds: visibilityFocusRoom, map });
      if (roomViewport) {
        viewport = roomViewport;
        renderTiles = cropTilesToViewport(baseTiles, viewport);
        renderActors = projectActorsForViewport(allActors, { viewport });
        actorListEntries = allActors.filter((actor) => {
          const x = actor?.position?.x;
          const y = actor?.position?.y;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
          return x >= viewport.startX && x < viewport.endX && y >= viewport.startY && y < viewport.endY;
        });
      }
    }

    if (visibilityMode === VISIBILITY_MODE_GAMEPLAY_FOG) {
      const fogged = fogTilesByExploration(baseTiles, viewerExplored);
      viewport = fogFullMap
        ? {
          startX: 0,
          startY: 0,
          width: map.width,
          height: map.height,
          endX: map.width,
          endY: map.height,
        }
        : resolveViewportWindow({
          width: map.width,
          height: map.height,
          center: viewerActor?.position || null,
          viewportSize,
        });
      renderTiles = fogFullMap ? fogged : cropTilesToViewport(fogged, viewport);
      renderActors = projectActorsForViewport(allActors, {
        viewport,
        visibilityMask: viewerExplored,
      });
      actorListEntries = allActors.filter((actor) => {
        const x = actor?.position?.x;
        const y = actor?.position?.y;
        return Number.isFinite(x) && Number.isFinite(y) && viewerExplored.has(keyForCell(x, y));
      });
      if (!viewerCanRevealDarkness) {
        const canSeeActor = (actor) => {
          const actorId = String(actor?.id || "");
          if (!actorId) return false;
          if (actorId === viewerKey) return true;
          if (darkness.hiddenActorIds.has(actorId)) return false;
          const x = actor?.position?.x;
          const y = actor?.position?.y;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
          return !darkness.obscuredCells.has(keyForCell(x, y));
        };
        renderActors = renderActors.filter(canSeeActor);
        actorListEntries = actorListEntries.filter(canSeeActor);
      }
    }

    const floorAffinityByCell = buildFloorAffinityIndex(obs?.traps || [], { viewport });
    const overlay = buildActorOverlay(renderTiles, renderActors, { floorAffinityByCell });
    if (elements.frame) {
      if ("innerHTML" in elements.frame) {
        elements.frame.innerHTML = overlay.html || overlay.text;
      } else {
        elements.frame.textContent = overlay.text;
      }
    }
    if (elements.baseTiles) elements.baseTiles.textContent = renderTiles.join("\n");
    if (elements.actorId) elements.actorId.textContent = actorIdLabel;
    if (elements.actorPos) elements.actorPos.textContent = `(${obs.actor.x}, ${obs.actor.y})`;
    if (elements.actorHp) elements.actorHp.textContent = `${obs.actor.hp}/${obs.actor.maxHp}`;
    if (elements.tick) elements.tick.textContent = String(frame.tick);
    if (elements.status) {
      const exit = findExit(baseTiles);
      const atExit = exit && obs.actor.x === exit.x && obs.actor.y === exit.y;
      elements.status.textContent = atExit ? "Reached exit" : currentIndex >= actions.length ? "Out of actions" : "Ready";
    }
    if (elements.playButton) {
      elements.playButton.textContent = playing ? "Pause" : "Play";
      elements.playButton.disabled = currentIndex >= actions.length && !playing;
    }
    if (elements.stepBack) elements.stepBack.disabled = currentIndex <= 0;
    if (elements.stepForward) elements.stepForward.disabled = currentIndex >= actions.length;
    if (elements.reset) elements.reset.disabled = false;
    if (elements.actorList) {
      elements.actorList.textContent = actorListEntries.length
        ? actorListEntries.map((entry) => renderActorInspectSummary(entry)).join("\n")
        : "-";
    }
    if (elements.affinityList) {
      const hasAffinityData = actorListEntries.some(
        (entry) => (entry.affinities && entry.affinities.length) || (entry.abilities && entry.abilities.length),
      );
      elements.affinityList.textContent = actorListEntries.length && hasAffinityData
        ? actorListEntries.map((entry) => renderActorSummary(entry)).join("\n")
        : "No affinities resolved";
    }
    if (elements.tileActorList) {
      const tiles = obs.tileActors || [];
      elements.tileActorList.textContent = tiles.length
        ? tiles.map((entry) => `${entry.id} [${kindLabel(entry.kind)}] @(${entry.position.x},${entry.position.y}) ${formatVitals(entry.vitals)}`).join("\n")
        : "-";
      if (elements.tileActorCount) elements.tileActorCount.textContent = String(tiles.length);
    }
    if (elements.trapList) {
      const traps = obs.traps || [];
      elements.trapList.textContent = traps.length
        ? traps.map((trap) => renderTrapSummary(trap)).join("\n")
        : "No traps detected";
      if (elements.trapCount) elements.trapCount.textContent = String(traps.length);
    }
    if (elements.eventStream) {
      const completed = actions.slice(0, currentIndex);
      if (!completed.length) {
        elements.eventStream.textContent = "No events yet.";
      } else {
        const start = Math.max(0, completed.length - EVENT_STREAM_LIMIT);
        const lines = completed.slice(start).map(formatEventEntry).filter(Boolean);
        elements.eventStream.textContent = lines.join("\n");
      }
    }
    if (elements.eventStreamCount) {
      elements.eventStreamCount.textContent = String(actions.length);
    }

    latestVisibilitySummary = {
      mode: visibilityMode,
      viewerActorId: viewerKey || null,
      map,
      viewport,
      roomFocus: visibilityFocusRoom ? { ...visibilityFocusRoom } : null,
      fogFullMap,
      actorStats: Array.isArray(visibilityData?.actorStats) ? visibilityData.actorStats : [],
      viewer: viewerActor
        ? {
          id: viewerKey,
          exploredTiles: viewerExplored.size,
          visibleNowTiles: viewerVisibleNow.size,
          exploredPercent: toPercent(viewerExplored.size, map.totalTiles),
          lightSight: viewerCanRevealDarkness,
        }
        : null,
    };

    if (typeof onObservation === "function") {
      onObservation({
        observation: obs,
        frame,
        overlay,
        playing,
        index: currentIndex,
        actorIdLabel,
        visibility: cloneVisibilitySummary(latestVisibilitySummary),
      });
    }
  }

  function render() {
    const snapshot = readSnapshot();
    renderFromSnapshot(snapshot);
  }

  function resetCore() {
    if (typeof initCore === "function") {
      initCore();
      core.clearEffects?.();
      return;
    }
    core.init(1337);
    core.loadMvpScenario();
    core.clearEffects?.();
  }

  function applyAction(action) {
    const resolvedActorIdValue = resolveActionActorIdValue(action);
    setActiveActorByValue(resolvedActorIdValue);
    const packed = packMoveAction({
      actorId: resolvedActorIdValue,
      from: action.params.from,
      to: action.params.to,
      direction: action.params.direction,
      tick: action.tick,
    });
    applyMoveAction(core, packed);
    core.clearEffects?.();
  }

  function gotoIndex(target) {
    const clamped = Math.max(0, Math.min(actions.length, target));
    resetCore();
    clearVisibilityTracking();
    let snapshot = readSnapshot();
    for (let i = 0; i < clamped; i += 1) {
      applyAction(actions[i]);
      snapshot = readSnapshot();
    }
    currentIndex = clamped;
    renderFromSnapshot(snapshot);
  }

  function stepForward() {
    if (currentIndex >= actions.length) {
      stop();
      return;
    }
    applyAction(actions[currentIndex]);
    currentIndex += 1;
    render();
  }

  function stepBack() {
    gotoIndex(currentIndex - 1);
  }

  function stop() {
    playing = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    render();
  }

  function play() {
    if (playing || currentIndex >= actions.length) {
      return;
    }
    playing = true;
    render();
    timer = setInterval(() => {
      stepForward();
      if (currentIndex >= actions.length) {
        stop();
      }
    }, intervalMs);
  }

  function toggle() {
    if (playing) {
      stop();
    } else {
      play();
    }
  }

  function reset() {
    stop();
    gotoIndex(0);
  }

  function setVisibilityMode(mode) {
    visibilityMode = normalizeVisibilityMode(mode);
    render();
  }

  function setVisibilityFocusRoom(roomBounds) {
    visibilityFocusRoom = normalizeRoomBounds(roomBounds);
    render();
  }

  function setFogFullMap(enabled) {
    fogFullMap = Boolean(enabled);
    render();
  }

  function setViewerActor(actorId) {
    if (!actorId) return;
    viewerActorId = String(actorId);
    render();
  }

  function setViewportSize(size) {
    viewportSize = Math.max(1, parsePositiveInt(size, DEFAULT_VIEWPORT_SIZE));
    render();
  }

  function setVisionRadius(size) {
    visionRadius = Math.max(1, parsePositiveInt(size, DEFAULT_VISION_RADIUS));
    gotoIndex(currentIndex);
  }

  function performRealtimeAction({ action, actorId } = {}) {
    const normalizedAction = String(action || "").toLowerCase();
    if (normalizedAction === "cast") {
      return { ok: false, reason: "cast_unimplemented" };
    }
    const move = REALTIME_MOVE_BY_ACTION[normalizedAction];
    if (!move) {
      return { ok: false, reason: "unsupported_action" };
    }

    const snapshot = readSnapshot();
    const observedActors = Array.isArray(snapshot?.obs?.actors) ? snapshot.obs.actors : [];
    const selectedActorId = String(actorId || viewerActorId || actorIdLabel || "").trim();
    if (!selectedActorId) {
      return { ok: false, reason: "missing_actor" };
    }
    const actor = observedActors.find((entry) => String(entry?.id || "") === selectedActorId);
    if (!actor || !actor.position) {
      return { ok: false, reason: "actor_not_found", actorId: selectedActorId };
    }
    const fromX = Number(actor.position.x);
    const fromY = Number(actor.position.y);
    if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) {
      return { ok: false, reason: "invalid_position", actorId: selectedActorId };
    }

    const actorValue = resolveActorIdValueForLabel(selectedActorId, observedActors);
    const entry = {
      kind: "move",
      actorId: selectedActorId,
      actorIdValue: actorValue,
      tick: Number(core?.getCurrentTick?.() ?? 0) + 1,
      params: {
        from: { x: fromX, y: fromY },
        to: { x: fromX + move.dx, y: fromY + move.dy },
        direction: move.direction,
      },
    };

    stop();
    viewerActorId = selectedActorId;
    try {
      applyAction(entry);
    } catch (error) {
      return { ok: false, reason: "apply_failed", actorId: selectedActorId, error };
    }
    actions = actions.slice(0, currentIndex);
    actions.push(entry);
    currentIndex = actions.length;
    render();
    return { ok: true, actorId: selectedActorId, action: normalizedAction };
  }

  resetCore();
  clearVisibilityTracking();
  render();

  return {
    stepForward,
    stepBack,
    play,
    pause: stop,
    toggle,
    reset,
    gotoIndex,
    setVisibilityMode,
    setVisibilityFocusRoom,
    setFogFullMap,
    setViewerActor,
    setViewportSize,
    setVisionRadius,
    performRealtimeAction,
    getVisibilitySummary: () => cloneVisibilitySummary(latestVisibilitySummary),
    getIndex: () => currentIndex,
    isPlaying: () => playing,
  };
}

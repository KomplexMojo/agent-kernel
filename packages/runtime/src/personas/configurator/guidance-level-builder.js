import { buildBuildSpecFromSummary } from "../director/buildspec-assembler.js";
import { generateGridLayoutFromInput } from "./level-layout.js";
import { deriveLevelGenFromRoomCards } from "./card-model.js";
import { AFFINITY_COLOR_HEX, resolveStackIntensity } from "../../render/affinity-palette.js";

const WALKABLE_DENSITY_TARGET = 0.5;
export const DEFAULT_LEVEL_RENDER_PALETTE = Object.freeze({
  "#": "#0a0f0d",
  ".": "#d8f6c4",
  S: "#4cc9f0",
  E: "#f4a261",
  B: "#9ca3af",
});
const AFFINITY_ASCII_GLYPHS = Object.freeze({
  fire: "f",
  water: "w",
  earth: "e",
  wind: "n",
  life: "l",
  decay: "d",
  corrode: "c",
  fortify: "t",
  light: "i",
  dark: "k",
});
const AFFINITY_RENDER_ORDER = Object.freeze(Object.keys(AFFINITY_COLOR_HEX));
export const LEVEL_PREVIEW_IMAGE_PIXEL_FORMAT = "rgba8";

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function countWalkableTiles(tiles = []) {
  if (!Array.isArray(tiles)) return 0;
  let count = 0;
  for (let y = 0; y < tiles.length; y += 1) {
    const row = String(tiles[y] || "");
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== "#") count += 1;
    }
  }
  return count;
}

function normalizeTiles(tiles = []) {
  if (!Array.isArray(tiles) || tiles.length === 0) return null;
  const lines = tiles.map((row) => String(row || ""));
  const width = lines.reduce((max, row) => Math.max(max, row.length), 0);
  if (!isPositiveInt(width) || !isPositiveInt(lines.length)) return null;
  return {
    lines: lines.map((row) => (row.length === width ? row : row.padEnd(width, "#"))),
    width,
    height: lines.length,
  };
}

function normalizeHexColor(value, fallback = "#000000") {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  return fallback;
}

function normalizeAffinityKind(value) {
  const kind = typeof value === "string" ? value.trim().toLowerCase() : "";
  return kind && AFFINITY_COLOR_HEX[kind] ? kind : "";
}

function normalizeAffinityStacks(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.round(parsed));
}

function affinityOrder(kind) {
  const index = AFFINITY_RENDER_ORDER.indexOf(kind);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
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
      if (!kind) return null;
      const targetType = typeof entry?.targetType === "string" ? entry.targetType.trim().toLowerCase() : "";
      const stacks = normalizeAffinityStacks(entry?.roomStacks ?? entry?.stacks);
      return { kind, stacks, targetType };
    })
    .filter(Boolean);
  if (valid.length === 0) return null;
  const floorFirst = valid.filter((entry) => entry.targetType === "floor");
  const pool = floorFirst.length > 0 ? floorFirst : valid;
  pool.sort((left, right) => {
    if (right.stacks !== left.stacks) return right.stacks - left.stacks;
    return affinityOrder(left.kind) - affinityOrder(right.kind);
  });
  return pool[0];
}

function resolveTrapPosition(trap) {
  if (!trap || typeof trap !== "object") return null;
  const x = Number(trap?.position?.x ?? trap?.x);
  const y = Number(trap?.position?.y ?? trap?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

function upsertAffinityCell(index, x, y, affinity, { width, height }) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const key = `${x},${y}`;
  const prior = index.get(key);
  if (!prior) {
    index.set(key, { kind: affinity.kind, stacks: affinity.stacks });
    return;
  }
  if (affinity.stacks > prior.stacks) {
    index.set(key, { kind: affinity.kind, stacks: affinity.stacks });
    return;
  }
  if (affinity.stacks === prior.stacks && affinityOrder(affinity.kind) < affinityOrder(prior.kind)) {
    index.set(key, { kind: affinity.kind, stacks: affinity.stacks });
  }
}

const NEIGHBOR_DELTAS = Object.freeze([
  { dx: 0, dy: -1 },   // N
  { dx: 1, dy: -1 },   // NE
  { dx: 1, dy: 0 },    // E
  { dx: 1, dy: 1 },    // SE
  { dx: 0, dy: 1 },    // S
  { dx: -1, dy: 1 },   // SW
  { dx: -1, dy: 0 },   // W
  { dx: -1, dy: -1 },  // NW
]);

function spreadAffinityToNeighbors(index, originX, originY, affinity, bounds) {
  const queue = [{ x: originX, y: originY, remainingStacks: affinity.stacks - 1 }];
  const visited = new Set([`${originX},${originY}`]);
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current.remainingStacks <= 0) continue;
    for (const delta of NEIGHBOR_DELTAS) {
      const nx = current.x + delta.dx;
      const ny = current.y + delta.dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (nx < 0 || nx >= bounds.width || ny < 0 || ny >= bounds.height) continue;
      upsertAffinityCell(index, nx, ny, { kind: affinity.kind, stacks: current.remainingStacks }, bounds);
      if (current.remainingStacks > 1) {
        queue.push({ x: nx, y: ny, remainingStacks: current.remainingStacks - 1 });
      }
    }
  }
}

function buildFloorAffinityByCell({ width, height, floorAffinityCells = null, floorAffinityTraps = null } = {}) {
  const index = new Map();
  if (Array.isArray(floorAffinityCells)) {
    floorAffinityCells.forEach((entry) => {
      const x = Number(entry?.x);
      const y = Number(entry?.y);
      const kind = normalizeAffinityKind(entry?.kind);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !kind) return;
      const stacks = normalizeAffinityStacks(entry?.stacks);
      upsertAffinityCell(index, Math.floor(x), Math.floor(y), { kind, stacks }, { width, height });
    });
  }
  if (Array.isArray(floorAffinityTraps)) {
    floorAffinityTraps.forEach((trap) => {
      const position = resolveTrapPosition(trap);
      const affinity = resolveTrapAffinityEntry(trap);
      if (!position || !affinity) return;
      upsertAffinityCell(index, position.x, position.y, affinity, { width, height });
      if (affinity.stacks > 1) {
        spreadAffinityToNeighbors(index, position.x, position.y, affinity, { width, height });
      }
    });
  }
  return index;
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = ((bn - rn) / delta) + 2;
    else h = ((rn - gn) / delta) + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs((2 * l) - 1));
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs((2 * l) - 1)) * s;
  const hPrime = (h % 360) / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hPrime >= 0 && hPrime < 1) {
    r1 = c;
    g1 = x;
  } else if (hPrime < 2) {
    r1 = x;
    g1 = c;
  } else if (hPrime < 3) {
    g1 = c;
    b1 = x;
  } else if (hPrime < 4) {
    g1 = x;
    b1 = c;
  } else if (hPrime < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = l - (c / 2);
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function resolveAffinityFloorRgba(affinity) {
  const baseHex = AFFINITY_COLOR_HEX[affinity?.kind];
  if (!baseHex) return null;
  const [baseR, baseG, baseB] = colorHexToRgba(baseHex);
  const { h } = rgbToHsl(baseR, baseG, baseB);
  const style = resolveStackIntensity(affinity?.stacks);
  const sat = Math.max(0, Math.min(1, style.sat / 100));
  const light = Math.max(0, Math.min(1, style.light / 100));
  const [r, g, b] = hslToRgb(h, sat, light);
  return [r, g, b, 255];
}

function resolveAffinityFloorGlyph(affinity) {
  const kind = normalizeAffinityKind(affinity?.kind);
  if (!kind) return ".";
  const base = AFFINITY_ASCII_GLYPHS[kind] || ".";
  const style = resolveStackIntensity(affinity?.stacks);
  return style.stacks >= 2 ? base.toUpperCase() : base;
}

function resolveRenderPalette(palette = null) {
  const resolved = { ...DEFAULT_LEVEL_RENDER_PALETTE };
  if (palette && typeof palette === "object" && !Array.isArray(palette)) {
    Object.keys(resolved).forEach((key) => {
      if (key in palette) {
        resolved[key] = normalizeHexColor(palette[key], resolved[key]);
      }
    });
  }
  return resolved;
}

function colorHexToRgba(hex) {
  const normalized = normalizeHexColor(hex, "#000000");
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return [r, g, b, 255];
}

function buildAsciiArtifact(lines = [], { floorAffinityByCell = null } = {}) {
  if (!(floorAffinityByCell instanceof Map) || floorAffinityByCell.size === 0) {
    return {
      lines: lines.slice(),
      text: lines.join("\n"),
    };
  }
  const styledLines = lines.map((rawRow, y) => {
    const row = String(rawRow || "");
    const chars = row.split("");
    for (let x = 0; x < chars.length; x += 1) {
      if (chars[x] !== ".") continue;
      const affinity = floorAffinityByCell.get(`${x},${y}`);
      if (!affinity) continue;
      chars[x] = resolveAffinityFloorGlyph(affinity);
    }
    return chars.join("");
  });
  return {
    lines: styledLines,
    text: styledLines.join("\n"),
  };
}

function buildImageArtifact(lines = [], { palette = null, floorAffinityByCell = null } = {}) {
  const normalized = normalizeTiles(lines);
  if (!normalized) return null;
  const resolvedPalette = resolveRenderPalette(palette);
  const pixels = new Uint8ClampedArray(normalized.width * normalized.height * 4);
  const colorCache = new Map();
  let idx = 0;
  for (let y = 0; y < normalized.height; y += 1) {
    const row = normalized.lines[y];
    for (let x = 0; x < normalized.width; x += 1) {
      const char = row[x] || "#";
      const floorAffinity = char === "." && floorAffinityByCell instanceof Map
        ? floorAffinityByCell.get(`${x},${y}`)
        : null;
      const colorHex = resolvedPalette[char]
        || (char === "#" ? resolvedPalette["#"] : resolvedPalette["."]);
      const cacheKey = floorAffinity
        ? `affinity|${floorAffinity.kind}|${floorAffinity.stacks}`
        : `${char}|${colorHex}`;
      let rgba = colorCache.get(cacheKey);
      if (!rgba) {
        rgba = floorAffinity
          ? resolveAffinityFloorRgba(floorAffinity)
          : colorHexToRgba(colorHex);
        if (!rgba) {
          rgba = colorHexToRgba(colorHex);
        }
        colorCache.set(cacheKey, rgba);
      }
      pixels[idx] = rgba[0];
      pixels[idx + 1] = rgba[1];
      pixels[idx + 2] = rgba[2];
      pixels[idx + 3] = rgba[3];
      idx += 4;
    }
  }
  return {
    width: normalized.width,
    height: normalized.height,
    palette: resolvedPalette,
    pixelFormat: LEVEL_PREVIEW_IMAGE_PIXEL_FORMAT,
    pixels,
  };
}

export function buildLevelRenderArtifactsFromTiles(
  tiles = [],
  {
    includeAscii = true,
    includeImage = true,
    palette = null,
    floorAffinityCells = null,
    floorAffinityTraps = null,
  } = {},
) {
  const normalized = normalizeTiles(tiles);
  if (!normalized) {
    return { ok: false, reason: "missing_tiles" };
  }
  const floorAffinityByCell = buildFloorAffinityByCell({
    width: normalized.width,
    height: normalized.height,
    floorAffinityCells,
    floorAffinityTraps,
  });
  const result = {
    ok: true,
    tiles: normalized.lines,
    width: normalized.width,
    height: normalized.height,
    walkableTiles: countWalkableTiles(normalized.lines),
  };
  if (includeAscii) {
    result.ascii = buildAsciiArtifact(normalized.lines, { floorAffinityByCell });
  }
  if (includeImage) {
    result.image = buildImageArtifact(normalized.lines, { palette, floorAffinityByCell });
  }
  return result;
}

function deriveFallbackLevelGenFromSummary(summary) {
  const floorTiles = isPositiveInt(summary?.layout?.floorTiles) ? summary.layout.floorTiles : 0;
  const walkableTilesTarget = floorTiles;
  if (!isPositiveInt(walkableTilesTarget)) return null;
  const interiorArea = Math.ceil(walkableTilesTarget / WALKABLE_DENSITY_TARGET);
  const interiorSide = Math.max(3, Math.ceil(Math.sqrt(interiorArea)));
  const size = Math.max(5, interiorSide + 2);
  const shape = {};
  return {
    width: size,
    height: size,
    shape,
    walkableTilesTarget,
  };
}

export function deriveLevelGenFromCardSet(cardSet) {
  if (!Array.isArray(cardSet) || cardSet.length === 0) return null;
  return deriveLevelGenFromRoomCards(cardSet);
}

export function deriveLevelGenFromGuidanceSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  const fromCards = deriveLevelGenFromCardSet(summary.cardSet || summary.cards);
  if (fromCards) {
    return fromCards;
  }
  const built = buildBuildSpecFromSummary({
    summary,
    source: "guidance-level-builder",
    runId: "guidance_level_builder",
  });
  if (built?.ok) {
    const levelGen = built.spec?.configurator?.inputs?.levelGen;
    if (levelGen && typeof levelGen === "object") {
      return levelGen;
    }
  }
  return deriveFallbackLevelGenFromSummary(summary);
}

export function buildLevelPreviewFromLevelGen(
  levelGen,
  {
    includeAscii = true,
    includeImage = true,
    palette = null,
    floorAffinityCells = null,
    floorAffinityTraps = null,
  } = {},
) {
  if (!levelGen || typeof levelGen !== "object") {
    return { ok: false, reason: "missing_level_gen" };
  }
  let generated = generateGridLayoutFromInput(levelGen);
  let resolvedLevelGen = levelGen;
  if (!generated?.ok) {
    const errors = Array.isArray(generated?.errors) ? generated.errors : [];
    const hasTargetMismatch = errors.some((entry) => entry?.code === "target_mismatch");
    const alreadyRelaxed = !resolvedLevelGen.shape || Object.keys(resolvedLevelGen.shape).length === 0;
    if (hasTargetMismatch && !alreadyRelaxed) {
      const relaxedLevelGen = {
        ...levelGen,
        shape: {},
      };
      generated = generateGridLayoutFromInput(relaxedLevelGen);
      resolvedLevelGen = relaxedLevelGen;
    }
  }
  if (!generated?.ok) {
    return {
      ok: false,
      reason: "layout_generation_failed",
      errors: Array.isArray(generated.errors) ? generated.errors : [],
    };
  }
  const rendered = buildLevelRenderArtifactsFromTiles(generated.value?.tiles, {
    includeAscii,
    includeImage,
    palette,
    floorAffinityCells,
    floorAffinityTraps: Array.isArray(floorAffinityTraps) ? floorAffinityTraps : generated.value?.traps,
  });
  if (!rendered.ok) {
    return rendered;
  }
  return {
    ...rendered,
    levelGen: resolvedLevelGen,
  };
}

export function buildLevelPreviewFromGuidanceSummary(
  summary,
  {
    includeAscii = true,
    includeImage = true,
    palette = null,
    floorAffinityCells = null,
    floorAffinityTraps = null,
  } = {},
) {
  if (!summary || typeof summary !== "object") {
    return { ok: false, reason: "missing_summary" };
  }
  const levelGen = deriveLevelGenFromGuidanceSummary(summary);
  if (!levelGen) {
    return { ok: false, reason: "missing_level_gen" };
  }
  return buildLevelPreviewFromLevelGen(levelGen, {
    includeAscii,
    includeImage,
    palette,
    floorAffinityCells,
    floorAffinityTraps,
  });
}

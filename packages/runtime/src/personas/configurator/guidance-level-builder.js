import { buildBuildSpecFromSummary } from "../director/buildspec-assembler.js";
import { generateGridLayoutFromInput } from "./level-layout.js";

const WALKABLE_DENSITY_TARGET = 0.5;
export const DEFAULT_LEVEL_RENDER_PALETTE = Object.freeze({
  "#": "#0a0f0d",
  ".": "#d8f6c4",
  S: "#4cc9f0",
  E: "#f4a261",
  B: "#9ca3af",
});

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

function buildAsciiArtifact(lines = []) {
  return {
    lines: lines.slice(),
    text: lines.join("\n"),
  };
}

function buildImageArtifact(lines = [], { palette = null } = {}) {
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
      const colorHex = resolvedPalette[char]
        || (char === "#" ? resolvedPalette["#"] : resolvedPalette["."]);
      const cacheKey = `${char}|${colorHex}`;
      let rgba = colorCache.get(cacheKey);
      if (!rgba) {
        rgba = colorHexToRgba(colorHex);
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
    pixels,
  };
}

export function buildLevelRenderArtifactsFromTiles(
  tiles = [],
  { includeAscii = true, includeImage = true, palette = null } = {},
) {
  const normalized = normalizeTiles(tiles);
  if (!normalized) {
    return { ok: false, reason: "missing_tiles" };
  }
  const result = {
    ok: true,
    tiles: normalized.lines,
    width: normalized.width,
    height: normalized.height,
    walkableTiles: countWalkableTiles(normalized.lines),
  };
  if (includeAscii) {
    result.ascii = buildAsciiArtifact(normalized.lines);
  }
  if (includeImage) {
    result.image = buildImageArtifact(normalized.lines, { palette });
  }
  return result;
}

function deriveFallbackLevelGenFromSummary(summary) {
  const floorTiles = isPositiveInt(summary?.layout?.floorTiles) ? summary.layout.floorTiles : 0;
  const hallwayTiles = isPositiveInt(summary?.layout?.hallwayTiles) ? summary.layout.hallwayTiles : 0;
  const walkableTilesTarget = floorTiles + hallwayTiles;
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

export function deriveLevelGenFromGuidanceSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
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
  { includeAscii = true, includeImage = true, palette = null } = {},
) {
  if (!levelGen || typeof levelGen !== "object") {
    return { ok: false, reason: "missing_level_gen" };
  }
  const generated = generateGridLayoutFromInput(levelGen);
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
  });
  if (!rendered.ok) {
    return rendered;
  }
  return {
    ...rendered,
    levelGen,
  };
}

export function buildLevelPreviewFromGuidanceSummary(
  summary,
  { includeAscii = true, includeImage = true, palette = null } = {},
) {
  if (!summary || typeof summary !== "object") {
    return { ok: false, reason: "missing_summary" };
  }
  const levelGen = deriveLevelGenFromGuidanceSummary(summary);
  if (!levelGen) {
    return { ok: false, reason: "missing_level_gen" };
  }
  return buildLevelPreviewFromLevelGen(levelGen, { includeAscii, includeImage, palette });
}

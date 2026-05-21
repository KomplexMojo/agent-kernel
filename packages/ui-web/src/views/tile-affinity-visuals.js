/**
 * tile-affinity-visuals.js
 *
 * Pure presentation-logic module that derives per-tile visual data from
 * hazard affinity fields or precomputed core field records.
 * No Phaser dependency — returns a plain Map consumed by the gameplay renderer.
 *
 * When fieldRecords are provided (from WASM core), visuals are derived
 * directly from precomputed data — no JS-side spread computation.
 * When fieldRecords are absent, falls back to hazard-based JS spread.
 */

// ── Canonical 10-kind palette (numeric RGB for Phaser tint) ──

const AFFINITY_COLORS = {
  fire:    0xf05a28,
  water:   0x2b7fff,
  earth:   0x7a5c33,
  wind:    0x8fd3ff,
  life:    0x49b96b,
  decay:   0x6f7b46,
  corrode: 0x7fbf42,
  fortify: 0x8c6dd7,
  light:   0xf5d14d,
  dark:    0x3a2a57,
};

const DEFAULT_COLOR = 0xffffff;

/**
 * Map an affinity kind to a conventional overlay key in the resource bundle.
 * Convention: "fire" -> "fireGlow", "ice" -> "iceGlow", etc.
 */
function overlayKeyForKind(kind) {
  if (!kind) return null;
  return kind + "Glow";
}

function resolveOverlayAssetId(kind, resourceBundle) {
  const overlayKey = overlayKeyForKind(kind);
  return overlayKey
    ? (resourceBundle?.mappings?.overlays?.[overlayKey] || null)
    : null;
}

// ── Field-record path (WASM core data) ──

/**
 * Derive tile visuals from precomputed core field records.
 *
 * fieldRecords is an array of { x, y, kind, kindCode, intensity, stacks,
 * expression, expressionName, contributionCount } — one entry per
 * (tile, affinityKind) pair where intensity > 0.
 *
 * @param {Array} fieldRecords
 * @param {object} resourceBundle
 * @returns {Map<string, object>}
 */
function deriveFromFieldRecords(fieldRecords, resourceBundle) {
  const visuals = new Map();
  if (!Array.isArray(fieldRecords) || fieldRecords.length === 0) return visuals;

  // Group records by tile coordinate
  const byTile = new Map();
  for (const record of fieldRecords) {
    if (!record || typeof record !== "object") continue;
    const { x, y, kind, intensity } = record;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!Number.isFinite(intensity) || intensity <= 0) continue;
    const key = `${x},${y}`;
    let group = byTile.get(key);
    if (!group) {
      group = [];
      byTile.set(key, group);
    }
    group.push(record);
  }

  for (const [key, records] of byTile) {
    // Build contributions array
    const contributions = records.map((r) => ({
      kind: r.kind || "unknown",
      kindCode: r.kindCode || 0,
      expression: r.expressionName || r.expression || "unknown",
      expressionCode: r.expressionCode || 0,
      stacks: r.stacks || 0,
      intensity: r.intensity,
      alpha: Math.min(1, Math.max(0, r.intensity)),
    }));

    // Pick dominant contribution (highest intensity)
    contributions.sort((a, b) => b.intensity - a.intensity);
    const dominant = contributions[0];

    const color = AFFINITY_COLORS[dominant.kind] ?? DEFAULT_COLOR;
    const overlayAssetId = resolveOverlayAssetId(dominant.kind, resourceBundle);

    visuals.set(key, {
      intensity: dominant.intensity,
      affinityKind: dominant.kind,
      expression: dominant.expression,
      color,
      alpha: dominant.alpha,
      overlayAssetId,
      contributions,
    });
  }

  return visuals;
}

// ── Hazard-based fallback path (legacy JS spread) ──

/**
 * Derive a Map<"x,y", TileVisual> from the board tiles, hazards, and resource bundle.
 *
 * @param {object} params
 * @param {string[]} params.tiles       - Row strings like ["XXXXX", "X...X", ...]
 * @param {object[]} params.hazards     - Hazard objects with position, emitStrength, affinityStacks
 * @param {object[]} [params.fieldRecords] - Precomputed core field records (from WASM).
 *        When present, bypasses JS spread and uses field data directly.
 * @param {object}   params.resourceBundle - Resource bundle with .mappings.overlays
 * @returns {Map<string, object>}
 */
export function deriveTileAffinityVisuals({ tiles, hazards, fieldRecords, resourceBundle } = {}) {
  // When field records are provided, derive from precomputed WASM data
  if (Array.isArray(fieldRecords) && fieldRecords.length > 0) {
    return deriveFromFieldRecords(fieldRecords, resourceBundle);
  }

  const visuals = new Map();

  if (!Array.isArray(hazards) || hazards.length === 0) return visuals;

  const boardHeight = Array.isArray(tiles) ? tiles.length : 0;
  const boardWidth = boardHeight > 0 ? (tiles[0]?.length || 0) : 0;

  function isWall(x, y) {
    if (y < 0 || y >= boardHeight || x < 0 || x >= boardWidth) return false;
    const symbol = tiles[y]?.[x];
    return symbol === "X" || symbol === "#" || symbol === "B";
  }

  for (const hazard of hazards) {
    const hx = hazard?.position?.x;
    const hy = hazard?.position?.y;
    const emitStrength = Number(hazard?.emitStrength) || 0;

    // Zero or negative emitStrength produces no affected tiles at all.
    if (emitStrength <= 0) continue;
    if (!Number.isFinite(hx) || !Number.isFinite(hy)) continue;

    const stack = hazard.affinityStacks?.[0] || {};
    const affinityKind = stack.kind || hazard.kind || "unknown";
    const expression = stack.expression || "";
    const color = AFFINITY_COLORS[affinityKind] ?? DEFAULT_COLOR;

    // Resolve overlay asset id from the resource bundle via convention.
    const overlayAssetId = resolveOverlayAssetId(affinityKind, resourceBundle);

    // Spread within manhattan distance of emitStrength.
    const reach = Math.floor(emitStrength);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const tx = hx + dx;
        const ty = hy + dy;
        if (tx < 0 || ty < 0 || tx >= boardWidth || ty >= boardHeight) continue;

        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist > reach) continue;

        // Intensity: 1.0 at origin, linearly falls with distance.
        const rawIntensity = dist === 0 ? 1.0 : 1 - dist / emitStrength;
        if (rawIntensity <= 0) continue;

        const intensity = Math.round(rawIntensity * 100) / 100;
        const key = `${tx},${ty}`;
        const existing = visuals.get(key);

        // Overlap: keep the higher intensity for the tile.
        const resolvedIntensity = existing
          ? Math.max(existing.intensity, intensity)
          : intensity;

        visuals.set(key, {
          intensity: resolvedIntensity,
          affinityKind,
          expression,
          color,
          alpha: resolvedIntensity,
          overlayAssetId: overlayAssetId,
          isWall: isWall(tx, ty),
        });
      }
    }
  }

  return visuals;
}

/**
 * Null-safe lookup of a tile visual at a given position.
 *
 * @param {Map|null|undefined} visuals  - The Map from deriveTileAffinityVisuals
 * @param {{ x: number, y: number }}    position
 * @returns {object|null}
 */
export function resolveTileVisualAt(visuals, position) {
  if (!visuals || !position) return null;
  const x = Math.floor(Number(position.x));
  const y = Math.floor(Number(position.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return visuals.get(`${x},${y}`) || null;
}

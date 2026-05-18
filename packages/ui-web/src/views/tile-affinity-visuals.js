/**
 * tile-affinity-visuals.js
 *
 * Pure presentation-logic module that derives per-tile visual data from
 * hazard affinity fields.  No Phaser dependency — returns a plain Map
 * consumed by the gameplay renderer.
 */

const AFFINITY_COLORS = {
  fire:   0xff4400,
  ice:    0x4488ff,
  poison: 0x44ff44,
  arcane: 0xaa44ff,
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

/**
 * Derive a Map<"x,y", TileVisual> from the board tiles, hazards, and resource bundle.
 *
 * @param {object} params
 * @param {string[]} params.tiles       - Row strings like ["XXXXX", "X...X", ...]
 * @param {object[]} params.hazards     - Hazard objects with position, emitStrength, affinityStacks
 * @param {object}   params.resourceBundle - Resource bundle with .mappings.overlays
 * @returns {Map<string, object>}
 */
export function deriveTileAffinityVisuals({ tiles, hazards, resourceBundle } = {}) {
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
    const overlayKey = overlayKeyForKind(affinityKind);
    const overlayAssetId = overlayKey
      ? (resourceBundle?.mappings?.overlays?.[overlayKey] || null)
      : null;

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

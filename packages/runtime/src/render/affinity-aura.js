/**
 * Affinity Aura Projection and Tile Resolution
 *
 * @deprecated This JS aura computation is superseded by core-as WASM field
 * buffers (AK-AFF-M3, AK-AFF-M4) and the interaction resolution matrix
 * (AK-AFF-M5). Use deriveTileAffinityVisuals with fieldRecords from
 * computeAffinityField/readAffinityFieldAt for new code.
 * This module is retained for backward compatibility only.
 *
 * Wave 2: Given actor positions and affinities, compute what each tile "sees" and resolve overlaps.
 *
 * Functions:
 * - projectExpression(sourcePos, expression, kind, stacks, tiles, weights) → affected tiles[]
 * - computeAuraMap(actors, baseTiles, { affinityOpposites, weights }) → Map<"x,y", projections[]>
 * - resolveInteractionAtTile(projections[], matrix, weights) → { layers, visualState, sourceEffects, targetEffects }
 * - serializeAuraMap(resolvedMap) → array of resolved tile data
 *
 * @module affinity-aura
 */

import { computeRadius, computeIntensity } from "./affinity-spatial-formulas.js";
import { INTERACTION_MATRIX, resolveAffinityRelationship } from "../contracts/affinity-spatial-rules.js";

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

/**
 * Compute Chebyshev distance (max(|dx|, |dy|)).
 */
function chebyshevDistance(x1, y1, x2, y2) {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

/**
 * Project an expression from sourcePos and return array of affected tiles.
 *
 * Each tile object: { x, y, distance, intensity, actorId, expression, kind, stacks }
 *
 * @param {{ x: number, y: number }} sourcePos
 * @param {string} expression - "push"|"pull"|"emit"|"draw"
 * @param {string} kind - affinity kind (e.g., "fire", "water")
 * @param {number} stacks - stack count >= 1
 * @param {Array<{ x: number, y: number, type: string }>} tiles - base tiles from layout
 * @param {object} weights - SPATIAL_WEIGHTS
 * @param {string} actorId - source actor ID
 * @returns {Array<{ x: number, y: number, distance: number, intensity: number, actorId: string, expression: string, kind: string, stacks: number }>}
 */
export function projectExpression(sourcePos, expression, kind, stacks, tiles, weights, actorId) {
  const radius = computeRadius(expression, stacks, weights);
  const projections = [];

  for (const tile of tiles) {
    // Skip non-floor tiles
    if (tile.type !== "floor") continue;

    const d = chebyshevDistance(sourcePos.x, sourcePos.y, tile.x, tile.y);
    if (d > radius) continue;

    const intensity = computeIntensity(d, stacks, expression, weights);
    if (intensity <= 0) continue;

    projections.push({
      x: tile.x,
      y: tile.y,
      distance: d,
      intensity,
      actorId,
      expression,
      kind,
      stacks,
    });
  }

  return projections;
}

// ---------------------------------------------------------------------------
// Aura map computation
// ---------------------------------------------------------------------------

/**
 * Compute the full aura map from all actors.
 *
 * Returns Map<"x,y", Array<projection>> where each tile may have multiple overlapping projections.
 *
 * @param {Array<{ id: string, x: number, y: number, affinities: Array<{ kind: string, expression: string, stacks: number }> }>} actors
 * @param {Array<{ x: number, y: number, type: string }>} baseTiles
 * @param {{ affinityOpposites: object, weights: object }} config
 * @returns {Map<string, Array<projection>>}
 */
export function computeAuraMap(actors, baseTiles, { affinityOpposites, weights }) {
  const auraMap = new Map();

  for (const actor of actors) {
    if (!actor.affinities || !Array.isArray(actor.affinities)) continue;

    const sourcePos = { x: actor.x, y: actor.y };

    for (const aff of actor.affinities) {
      const { kind, expression, stacks = 1 } = aff;
      if (!kind || !expression || stacks < 1) continue;

      const projections = projectExpression(sourcePos, expression, kind, stacks, baseTiles, weights, actor.id);

      for (const proj of projections) {
        const key = `${proj.x},${proj.y}`;
        if (!auraMap.has(key)) {
          auraMap.set(key, []);
        }
        auraMap.get(key).push(proj);
      }
    }
  }

  return auraMap;
}

// ---------------------------------------------------------------------------
// Interaction resolution at a tile
// ---------------------------------------------------------------------------

/**
 * Resolve all projections at a single tile into a single visual state and effect summary.
 *
 * Returns:
 * - layers: array of { actorId, expression, kind, stacks, intensity } (all contributors)
 * - visualState: interaction matrix key (e.g., "clash-opposed", "absorb", "reinforcement")
 * - sourceEffects: array of { actorId, effect: "damage"|"mana_gain"|... }
 * - targetEffects: array of { actorId, effect: ... }
 *
 * @param {Array<projection>} projections
 * @param {object} matrix - INTERACTION_MATRIX
 * @param {object} weights - SPATIAL_WEIGHTS
 * @returns {{ layers: Array, visualState: string, sourceEffects: Array, targetEffects: Array }}
 */
export function resolveInteractionAtTile(projections, matrix, weights) {
  if (projections.length === 0) {
    return { layers: [], visualState: "none", sourceEffects: [], targetEffects: [] };
  }

  if (projections.length === 1) {
    const proj = projections[0];
    return {
      layers: [{ actorId: proj.actorId, expression: proj.expression, kind: proj.kind, stacks: proj.stacks, intensity: proj.intensity }],
      visualState: `${proj.expression}-field`,
      sourceEffects: [],
      targetEffects: [],
    };
  }

  // Multiple projections: resolve interactions
  // Strategy: pick the two strongest (highest intensity) and resolve them via the interaction matrix

  const sorted = projections.slice().sort((a, b) => b.intensity - a.intensity);
  const source = sorted[0];
  const target = sorted[1];

  const affinityRel = resolveAffinityRelationship(source.kind, target.kind);
  const cell = matrix?.[source.expression]?.[target.expression]?.[affinityRel];

  if (!cell) {
    // Fallback: layered
    return {
      layers: projections.map((p) => ({ actorId: p.actorId, expression: p.expression, kind: p.kind, stacks: p.stacks, intensity: p.intensity })),
      visualState: "layered",
      sourceEffects: [],
      targetEffects: [],
    };
  }

  const sourceEffects = [];
  const targetEffects = [];

  if (cell.sourceEffect && cell.sourceEffect !== "none") {
    sourceEffects.push({ actorId: source.actorId, effect: cell.sourceEffect });
  }
  if (cell.targetEffect && cell.targetEffect !== "none") {
    targetEffects.push({ actorId: target.actorId, effect: cell.targetEffect });
  }

  return {
    layers: projections.map((p) => ({ actorId: p.actorId, expression: p.expression, kind: p.kind, stacks: p.stacks, intensity: p.intensity })),
    visualState: cell.visualState,
    sourceEffects,
    targetEffects,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize the resolved aura map into an array for observation attachment.
 *
 * Returns: [{ x, y, layers, visualState, sourceEffects, targetEffects }, ...]
 *
 * @param {Map<string, Array<projection>>} auraMap
 * @returns {Array<{ x: number, y: number, layers: Array, visualState: string, sourceEffects: Array, targetEffects: Array }>}
 */
export function serializeAuraMap(auraMap, matrix, weights) {
  const serialized = [];

  for (const [key, projections] of auraMap.entries()) {
    const [x, y] = key.split(",").map(Number);
    const resolved = resolveInteractionAtTile(projections, matrix, weights);

    serialized.push({
      x,
      y,
      layers: resolved.layers,
      visualState: resolved.visualState,
      sourceEffects: resolved.sourceEffects,
      targetEffects: resolved.targetEffects,
    });
  }

  return serialized;
}

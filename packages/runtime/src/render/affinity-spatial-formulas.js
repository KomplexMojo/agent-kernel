/**
 * Affinity Spatial Formulas — pure parametric functions.
 *
 * Visual alpha only: what an aura tile looks like, never what it does. Game
 * rules (radius, intensity, potency, mana) are core's (core-ts
 * rules/actor-fields.ts, rules/actor-cast.ts); the potency, merge,
 * cancellation and mana-cost copies that used to live here were removed
 * (drift review 2026-10-13) because nothing but their tests read them.
 *
 * All formulas take a weights object so coefficients can be tuned
 * without changing code. Weights are sourced from SPATIAL_WEIGHTS
 * in affinity-spatial-rules.js.
 *
 * Formula reference:
 *   §1.1 radius     §1.2 intensity    §2.2 stack alpha multiplier
 *
 * @module affinity-spatial-formulas
 */

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

function toPositiveStacks(value) {
  const n = Number.isFinite(value) ? Math.floor(value) : 0;
  return n >= 1 ? n : 1;
}

function toNonNegativeInt(value, fallback = 0) {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  return n >= 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// §1.1 Radius
// ---------------------------------------------------------------------------

/**
 * Compute the projection radius for an expression at a given stack level.
 *
 * radius(stacks, W) = floor(W.baseRadius + W.radiusGrowth * stacks^W.radiusExponent)
 *
 * @param {string} expression - "push"|"pull"|"emit"|"draw"
 * @param {number} stacks - stack count (>= 1)
 * @param {object} weights - SPATIAL_WEIGHTS
 * @returns {number} radius in tiles (Chebyshev distance)
 */
export function computeRadius(expression, stacks, weights) {
  const w = weights?.radius?.[expression];
  if (!w) return 1;
  const s = toPositiveStacks(stacks);
  return Math.floor(w.baseRadius + w.radiusGrowth * Math.pow(s, w.radiusExponent));
}

// ---------------------------------------------------------------------------
// §1.2 Intensity falloff
// ---------------------------------------------------------------------------

/**
 * Compute the field intensity at distance d from the source.
 *
 * intensity(d, stacks, W) =
 *   W.peakIntensity * stacks^W.stackExponent
 *   * max(0, 1 - ((d - W.buffer) / radius)^W.falloffCurve)
 *
 * Returns 0 for buffer zone and out-of-range tiles.
 *
 * @param {number} d - Chebyshev distance from source (>= 0)
 * @param {number} stacks - stack count (>= 1)
 * @param {string} expression - "push"|"pull"|"emit"|"draw"
 * @param {object} weights - SPATIAL_WEIGHTS
 * @returns {number} intensity in [0, 1]
 */
export function computeIntensity(d, stacks, expression, weights) {
  const w = weights?.intensity?.[expression];
  if (!w) return 0;
  const s = toPositiveStacks(stacks);
  const dist = toNonNegativeInt(d, 0);

  // Buffer zone: no effect
  if (dist <= w.buffer) return 0;

  const radius = computeRadius(expression, s, weights);
  if (dist > radius) return 0;

  // Draw: flat (no falloff) — full intensity at d=1
  if (w.falloffCurve === 0) {
    return w.peakIntensity * Math.pow(s, w.stackExponent);
  }

  const normalizedDist = (dist - w.buffer) / radius;
  const falloff = Math.max(0, 1 - Math.pow(normalizedDist, w.falloffCurve));
  return w.peakIntensity * Math.pow(s, w.stackExponent) * falloff;
}

// ---------------------------------------------------------------------------
// §2.2 Stack alpha multiplier
// ---------------------------------------------------------------------------

/**
 * Compute the alpha multiplier for pixel rendering at a given stack level.
 *
 * stackAlphaMultiplier(stacks) = W.alphaBase + W.alphaGrowth * (stacks - 1)^W.alphaExponent
 *
 * @param {number} stacks - stack count (>= 1)
 * @param {object} weights - SPATIAL_WEIGHTS
 * @returns {number} alpha multiplier in [W.alphaBase, ~1.0]
 */
export function computeStackAlphaMultiplier(stacks, weights) {
  const s = toPositiveStacks(stacks);
  const base = Number.isFinite(weights?.alphaBase) ? weights.alphaBase : 0.2;
  const growth = Number.isFinite(weights?.alphaGrowth) ? weights.alphaGrowth : 0.05;
  const exponent = Number.isFinite(weights?.alphaExponent) ? weights.alphaExponent : 1.5;
  return base + growth * Math.pow(s - 1, exponent);
}

// ---------------------------------------------------------------------------
// Convenience: effective visual alpha at a tile
// ---------------------------------------------------------------------------

/**
 * Compute the final visual alpha for an aura tile.
 *
 * maskAlpha = clamp(0, 1, intensity_at_tile * stackAlphaMultiplier(stacks))
 *
 * @param {number} distance - Chebyshev distance from source
 * @param {number} stacks
 * @param {string} expression
 * @param {object} weights
 * @returns {number} alpha in [0, 1]
 */
export function computeTileAlpha(distance, stacks, expression, weights) {
  const intensity = computeIntensity(distance, stacks, expression, weights);
  if (intensity <= 0) return 0;
  const alphaMultiplier = computeStackAlphaMultiplier(stacks, weights);
  return Math.min(1, intensity * alphaMultiplier);
}

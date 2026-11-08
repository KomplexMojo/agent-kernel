/**
 * Affinity Spatial Formulas — pure parametric functions.
 *
 * Visual alpha only: what a field tile looks like, never what it does. Game
 * rules (radius, intensity, potency, mana) are core's (core-ts
 * rules/actor-fields.ts, rules/actor-cast.ts); the potency, merge,
 * cancellation and mana-cost copies that used to live here were removed
 * (drift review 2026-10-13) because nothing but their tests read them.
 *
 * All formulas take a weights object so coefficients can be tuned
 * without changing code. Weights are sourced from SPATIAL_WEIGHTS,
 * declared below (the render layer's own visual coefficients; rules are core's).
 *
 * Formula reference:
 *   §1.1 radius     §1.2 intensity    §2.2 stack alpha multiplier
 *
 * @module affinity-spatial-formulas
 */

// ---------------------------------------------------------------------------
// Visual weights
// ---------------------------------------------------------------------------

/**
 * Radius weights per expression (§1.1).
 * radius(stacks) = floor(baseRadius + radiusGrowth * stacks^radiusExponent)
 */
const RADIUS_WEIGHTS = Object.freeze({
  push: Object.freeze({ baseRadius: 0.5, radiusGrowth: 0.5, radiusExponent: 1.0 }),
  pull: Object.freeze({ baseRadius: 0.5, radiusGrowth: 0.5, radiusExponent: 1.0 }),
  emit: Object.freeze({ baseRadius: 1.0, radiusGrowth: 1.0, radiusExponent: 1.0 }),
  draw: Object.freeze({ baseRadius: 1.0, radiusGrowth: 0.0, radiusExponent: 1.0 }),
});

/**
 * Intensity falloff weights per expression (§1.2).
 * intensity(d, stacks) = peakIntensity * stacks^stackExponent * max(0, 1 - ((d - buffer) / radius)^falloffCurve)
 *
 * falloffCurve: 0 = flat, 1 = linear, 2 = quadratic, 0.5 = sqrt
 */
const INTENSITY_WEIGHTS = Object.freeze({
  push: Object.freeze({ peakIntensity: 1.0, stackExponent: 0.5, buffer: 0, falloffCurve: 2.0 }),
  pull: Object.freeze({ peakIntensity: 1.0, stackExponent: 0.5, buffer: 0, falloffCurve: 2.0 }),
  emit: Object.freeze({ peakIntensity: 1.0, stackExponent: 0.3, buffer: 0, falloffCurve: 1.0 }),
  draw: Object.freeze({ peakIntensity: 1.0, stackExponent: 0.0, buffer: 0, falloffCurve: 0.0 }),
});

// ---------------------------------------------------------------------------
// Master weights object
// ---------------------------------------------------------------------------

export const SPATIAL_WEIGHTS = Object.freeze({
  // Expression-keyed profiles
  radius: RADIUS_WEIGHTS,
  intensity: INTENSITY_WEIGHTS,

  // Pixel mask weights (§2.x)
  alphaBase: 0.20,
  alphaGrowth: 0.05,
  alphaExponent: 1.5,

  emitCenter: 0.8,
  emitSoftness: 0.5,
  pushSpread: 1.5,
  pushSharpness: 2.0,
  pullEdge: 0.6,
  pullCenter: 1.0,
  pullCurve: 0.5,
  drawRingRadius: 0.6,
  drawRingWidth: 0.15,
  drawFill: 0.3,

  // Interaction modifiers
  oppositeVulnerability: 1.5,
  stealEfficiency: 0.8,
  absorbRate: 0.6,
  toxicExposureRate: 1.0,

  // Conflict visual weights (pixel masks)
  conflictEdge: 0.3,
  conflictAlphaBoost: 1.4,
  reinforceSatBoost: 0.05,
  layerFrequency: 4.0,
  layerAlphaDim: 0.85,
});

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
 * computeStackAlphaMultiplier(stacks) = W.alphaBase + W.alphaGrowth * (stacks - 1)^W.alphaExponent
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
 * Compute the final visual alpha for a field tile.
 *
 * alpha = clamp(0, 1, intensity_at_tile * computeStackAlphaMultiplier(stacks))
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

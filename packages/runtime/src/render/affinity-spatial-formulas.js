/**
 * Affinity Spatial Formulas — pure parametric functions.
 *
 * @deprecated These JS formulas are superseded by core-ts core-ts spatial
 * computation (AK-AFF-M2, AK-AFF-M3). Use core-ts readAffinityFieldAt
 * or the core-ts exports (computeAffinityRadius, computeAffinityIntensity,
 * computeAffinityPotency, computeAffinityManaCost) for new code.
 * This module is retained for backward compatibility only.
 *
 * All formulas take a weights object so coefficients can be tuned
 * without changing code. Weights are sourced from SPATIAL_WEIGHTS
 * in affinity-spatial-rules.js.
 *
 * Formula reference:
 *   §1.1 radius     §1.2 intensity    §1.3 potency
 *   §1.4 opposite cancellation        §1.5 same-kind merge
 *   §1.6 effective potency at tile    §1.7 mana cost
 *   §2.2 stack alpha multiplier
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
// §1.3 Potency
// ---------------------------------------------------------------------------

/**
 * Compute the mechanical potency for an expression at a given stack level.
 *
 * potency(stacks, W) = W.basePotency + W.potencyGrowth * stacks^W.potencyExponent
 *
 * push: quadratic (1, 4, 9, 16, 25)
 * pull/emit/draw: linear (1, 2, 3, 4, 5)
 *
 * @param {number} stacks - stack count (>= 1)
 * @param {string} expression - "push"|"pull"|"emit"|"draw"
 * @param {object} weights - SPATIAL_WEIGHTS
 * @returns {number} potency value
 */
export function computePotency(stacks, expression, weights) {
  const w = weights?.potency?.[expression];
  if (!w) return 0;
  const s = toPositiveStacks(stacks);
  return w.basePotency + w.potencyGrowth * Math.pow(s, w.potencyExponent);
}

// ---------------------------------------------------------------------------
// §1.4 Opposite affinity stack cancellation
// ---------------------------------------------------------------------------

/**
 * Resolve the net stacks after opposite-affinity cancellation.
 *
 * canceled = min(sourceStacks, targetStacks)
 * netSource = sourceStacks - canceled
 * netTarget = targetStacks - canceled
 *
 * @param {number} sourceStacks
 * @param {number} targetStacks
 * @returns {{ canceled: number, netSource: number, netTarget: number }}
 */
export function resolveStackCancellation(sourceStacks, targetStacks) {
  const s = toPositiveStacks(sourceStacks);
  const t = toPositiveStacks(targetStacks);
  const canceled = Math.min(s, t);
  return {
    canceled,
    netSource: s - canceled,
    netTarget: t - canceled,
  };
}

// ---------------------------------------------------------------------------
// §1.5 Same-kind stack merge
// ---------------------------------------------------------------------------

/**
 * Compute merged stacks for same-kind projection overlap.
 *
 * mergedStacks = min(sourceStacks + targetStacks, W.maxMergedStacks)
 *
 * The merged value is used for visual intensity only;
 * each source retains its own potency for mechanical effects.
 *
 * @param {number} sourceStacks
 * @param {number} targetStacks
 * @param {object} weights - SPATIAL_WEIGHTS
 * @returns {number} merged stack count
 */
export function resolveMergedStacks(sourceStacks, targetStacks, weights) {
  const s = toPositiveStacks(sourceStacks);
  const t = toPositiveStacks(targetStacks);
  const max = Number.isFinite(weights?.maxMergedStacks) ? weights.maxMergedStacks : 8;
  return Math.min(s + t, max);
}

// ---------------------------------------------------------------------------
// §1.6 Effective potency at a tile
// ---------------------------------------------------------------------------

/**
 * Compute the effective mechanical potency at a tile given affinity relationship.
 *
 * - opposite: use netStacks after §1.4 cancellation
 * - same/unrelated: use sourceStacks directly
 *
 * @param {number} sourceStacks
 * @param {number} targetStacks - only used for "opposite"
 * @param {"same"|"opposite"|"unrelated"} affinityRel
 * @param {string} expression
 * @param {object} weights
 * @returns {number} effective potency
 */
export function computeEffectivePotency(sourceStacks, targetStacks, affinityRel, expression, weights) {
  if (affinityRel === "opposite") {
    const { netSource } = resolveStackCancellation(sourceStacks, targetStacks);
    return computePotency(netSource, expression, weights);
  }
  return computePotency(toPositiveStacks(sourceStacks), expression, weights);
}

// ---------------------------------------------------------------------------
// §1.7 Mana cost
// ---------------------------------------------------------------------------

/**
 * Compute the per-tick mana cost for a persistent expression field.
 *
 * manaCost(stacks, W) = ceil(W.baseMana + W.manaGrowth * stacks^W.manaExponent)
 *
 * push/pull return 0 (instantaneous, no per-tick cost).
 *
 * @param {number} stacks - stack count (>= 1)
 * @param {string} expression - "push"|"pull"|"emit"|"draw"
 * @param {object} weights - SPATIAL_WEIGHTS
 * @returns {number} mana cost per tick (integer >= 0)
 */
export function computeManaCost(stacks, expression, weights) {
  const w = weights?.manaCost?.[expression];
  if (!w) return 0;
  const s = toPositiveStacks(stacks);
  return Math.ceil(w.baseMana + w.manaGrowth * Math.pow(s, w.manaExponent));
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

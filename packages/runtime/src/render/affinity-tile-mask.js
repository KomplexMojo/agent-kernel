/**
 * Affinity tile mask functions for pixel-level aura rendering.
 *
 * Each mask function takes normalized (u, v) coordinates in [0, 1]
 * and returns an alpha value in [0, 1] describing the mask shape.
 *
 * Interaction masks blend two aura sources at a tile.
 *
 * @module affinity-tile-mask
 */

import { SPATIAL_WEIGHTS } from "../contracts/affinity-spatial-rules.js";
import { computeStackAlphaMultiplier } from "./affinity-spatial-formulas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Deterministic hash-based noise for conflict dithering.
 * Returns a value in [0, 1).
 */
function deterministicNoise(x, y) {
  let h = (x * 374761393 + y * 668265263 + 13) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// §2.1 Stack alpha multiplier (re-export from formulas)
// ---------------------------------------------------------------------------

/**
 * Compute the alpha multiplier for a given stack level.
 * @param {number} stacks
 * @param {object} [weights=SPATIAL_WEIGHTS]
 * @returns {number}
 */
export function stackAlphaMultiplier(stacks, weights = SPATIAL_WEIGHTS) {
  return computeStackAlphaMultiplier(stacks, weights);
}

// ---------------------------------------------------------------------------
// §2.2 Emit mask — radial falloff from center
// ---------------------------------------------------------------------------

/**
 * Emit mask: bright center, soft radial falloff.
 * @param {number} u - normalized x in [0, 1]
 * @param {number} v - normalized y in [0, 1]
 * @param {object} [weights=SPATIAL_WEIGHTS]
 * @returns {number} alpha in [0, 1]
 */
export function emitMask(u, v, weights = SPATIAL_WEIGHTS) {
  const cx = u - 0.5;
  const cy = v - 0.5;
  const d = Math.sqrt(cx * cx + cy * cy) * 2; // normalized to [0, ~1.41]
  const center = weights.emitCenter ?? 0.8;
  const softness = weights.emitSoftness ?? 0.5;
  return clamp01(center * (1 - Math.pow(d, 1 / softness)));
}

// ---------------------------------------------------------------------------
// §2.3 Push mask — directional concentration
// ---------------------------------------------------------------------------

/**
 * Push mask: directional spread along a heading.
 * @param {number} u - normalized x in [0, 1]
 * @param {number} v - normalized y in [0, 1]
 * @param {object} [weights=SPATIAL_WEIGHTS]
 * @param {number} [angle=0] - direction angle in radians (0 = right)
 * @returns {number} alpha in [0, 1]
 */
export function pushMask(u, v, weights = SPATIAL_WEIGHTS, angle = 0) {
  const cx = u - 0.5;
  const cy = v - 0.5;
  // Project onto direction vector
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const proj = cx * cosA + cy * sinA; // projection along direction
  const perp = Math.abs(-cx * sinA + cy * cosA); // perpendicular distance
  const spread = weights.pushSpread ?? 1.5;
  const sharpness = weights.pushSharpness ?? 2.0;
  // Stronger in the forward direction, falls off perpendicular
  const forward = clamp01(0.5 + proj * spread);
  const narrow = clamp01(1 - Math.pow(perp * 2, sharpness));
  return forward * narrow;
}

// ---------------------------------------------------------------------------
// §2.4 Pull mask — edge-heavy gradient
// ---------------------------------------------------------------------------

/**
 * Pull mask: stronger at edges, weaker at center.
 * @param {number} u - normalized x in [0, 1]
 * @param {number} v - normalized y in [0, 1]
 * @param {object} [weights=SPATIAL_WEIGHTS]
 * @returns {number} alpha in [0, 1]
 */
export function pullMask(u, v, weights = SPATIAL_WEIGHTS) {
  const cx = u - 0.5;
  const cy = v - 0.5;
  const d = Math.sqrt(cx * cx + cy * cy) * 2; // [0, ~1.41]
  const edge = weights.pullEdge ?? 0.6;
  const center = weights.pullCenter ?? 1.0;
  const curve = weights.pullCurve ?? 0.5;
  // Interpolate from center value at d=0 to edge value at d=1
  const t = clamp01(Math.pow(d, curve));
  return clamp01(center + (edge - center) * t);
}

// ---------------------------------------------------------------------------
// §2.5 Draw mask — ring shape
// ---------------------------------------------------------------------------

/**
 * Draw mask: ring at a characteristic radius.
 * @param {number} u - normalized x in [0, 1]
 * @param {number} v - normalized y in [0, 1]
 * @param {object} [weights=SPATIAL_WEIGHTS]
 * @returns {number} alpha in [0, 1]
 */
export function drawMask(u, v, weights = SPATIAL_WEIGHTS) {
  const cx = u - 0.5;
  const cy = v - 0.5;
  const d = Math.sqrt(cx * cx + cy * cy) * 2; // [0, ~1.41]
  const ringR = weights.drawRingRadius ?? 0.6;
  const ringW = weights.drawRingWidth ?? 0.15;
  const fill = weights.drawFill ?? 0.3;
  const ringDist = Math.abs(d - ringR);
  const ring = clamp01(1 - ringDist / ringW);
  return Math.max(fill, ring);
}

// ---------------------------------------------------------------------------
// §2.6 Conflict mask — dithered blend of two sources
// ---------------------------------------------------------------------------

/**
 * Conflict mask: deterministic dithered blend between two colors.
 * @param {number} u - normalized x in [0, 1]
 * @param {number} v - normalized y in [0, 1]
 * @param {[number,number,number,number]} sourceColor - RGBA
 * @param {[number,number,number,number]} targetColor - RGBA
 * @param {object} [weights=SPATIAL_WEIGHTS]
 * @returns {{r: number, g: number, b: number, a: number}}
 */
export function conflictMask(u, v, sourceColor, targetColor, weights = SPATIAL_WEIGHTS) {
  const edge = weights.conflictEdge ?? 0.3;
  const alphaBoost = weights.conflictAlphaBoost ?? 1.4;
  // Deterministic pixel-level dithering
  const px = Math.floor(u * 256);
  const py = Math.floor(v * 256);
  const noise = deterministicNoise(px, py);
  // Bias: center favors source, edges favor target
  const cx = u - 0.5;
  const cy = v - 0.5;
  const d = Math.sqrt(cx * cx + cy * cy) * 2;
  const bias = clamp01(d / (1 - edge));
  const pick = noise < bias ? targetColor : sourceColor;
  return {
    r: pick[0],
    g: pick[1],
    b: pick[2],
    a: Math.min(255, Math.round(pick[3] * alphaBoost)),
  };
}

// ---------------------------------------------------------------------------
// §2.7 Reinforce mask — same-kind saturation boost
// ---------------------------------------------------------------------------

/**
 * Reinforce mask: alpha modifier for same-kind overlap.
 * @param {number} u - normalized x in [0, 1]
 * @param {number} v - normalized y in [0, 1]
 * @param {number} combinedStacks - merged stack count
 * @param {object} [weights=SPATIAL_WEIGHTS]
 * @returns {number} alpha modifier (>= 1.0)
 */
export function reinforceMask(u, v, combinedStacks, weights = SPATIAL_WEIGHTS) {
  const satBoost = weights.reinforceSatBoost ?? 0.05;
  return 1 + satBoost * Math.max(0, combinedStacks - 1);
}

// ---------------------------------------------------------------------------
// §2.8 Layered mask — two independent auras coexisting
// ---------------------------------------------------------------------------

/**
 * Layered mask: striped blend of dominant and secondary colors.
 * @param {number} u - normalized x in [0, 1]
 * @param {number} v - normalized y in [0, 1]
 * @param {[number,number,number,number]} dominantColor - RGBA
 * @param {[number,number,number,number]} secondaryColor - RGBA
 * @param {object} [weights=SPATIAL_WEIGHTS]
 * @returns {{r: number, g: number, b: number, a: number}}
 */
export function layeredMask(u, v, dominantColor, secondaryColor, weights = SPATIAL_WEIGHTS) {
  const freq = weights.layerFrequency ?? 4.0;
  const dim = weights.layerAlphaDim ?? 0.85;
  // Diagonal stripe pattern
  const stripe = Math.sin((u + v) * freq * Math.PI);
  const t = clamp01((stripe + 1) * 0.5); // [0, 1]
  const pick = t > 0.5 ? dominantColor : secondaryColor;
  const alphaDim = t > 0.5 ? 1.0 : dim;
  return {
    r: pick[0],
    g: pick[1],
    b: pick[2],
    a: Math.round(pick[3] * alphaDim),
  };
}

// ---------------------------------------------------------------------------
// §2.9 applyAuraMask — write mask to pixel buffer
// ---------------------------------------------------------------------------

/**
 * Alpha-blend a single pixel. Matches resource-bundle.js alphaBlend.
 */
function alphaBlend(dst, src) {
  const srcAlpha = src[3] / 255;
  const dstAlpha = dst[3] / 255;
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
  if (outAlpha <= 0) return [0, 0, 0, 0];
  return [
    Math.round((src[0] * srcAlpha + dst[0] * dstAlpha * (1 - srcAlpha)) / outAlpha),
    Math.round((src[1] * srcAlpha + dst[1] * dstAlpha * (1 - srcAlpha)) / outAlpha),
    Math.round((src[2] * srcAlpha + dst[2] * dstAlpha * (1 - srcAlpha)) / outAlpha),
    Math.round(outAlpha * 255),
  ];
}

/**
 * Apply an aura mask to a pixel buffer region.
 *
 * @param {Uint8ClampedArray} pixels - RGBA pixel buffer
 * @param {number} width - buffer width in pixels
 * @param {number} tileX - tile top-left x in pixels
 * @param {number} tileY - tile top-left y in pixels
 * @param {number} tileSize - tile size in pixels
 * @param {[number,number,number,number]} affinityRgba - base RGBA color
 * @param {function} maskFn - mask function (u, v) => alpha [0, 1]
 * @param {number} maskAlpha - overall alpha multiplier [0, 1]
 */
export function applyAuraMask(pixels, width, tileX, tileY, tileSize, affinityRgba, maskFn, maskAlpha) {
  for (let py = 0; py < tileSize; py++) {
    for (let px = 0; px < tileSize; px++) {
      const u = tileSize > 1 ? px / (tileSize - 1) : 0.5;
      const v = tileSize > 1 ? py / (tileSize - 1) : 0.5;
      const mask = maskFn(u, v);
      const alpha = clamp01(mask * maskAlpha) * 255;
      if (alpha < 1) continue;

      const bufX = tileX + px;
      const bufY = tileY + py;
      const idx = (bufY * width + bufX) * 4;

      const dst = [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]];
      const src = [affinityRgba[0], affinityRgba[1], affinityRgba[2], Math.round(alpha)];
      const blended = alphaBlend(dst, src);
      pixels[idx] = blended[0];
      pixels[idx + 1] = blended[1];
      pixels[idx + 2] = blended[2];
      pixels[idx + 3] = blended[3];
    }
  }
}

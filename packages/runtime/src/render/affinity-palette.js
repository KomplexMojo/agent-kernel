/**
 * Shared affinity visual palette and stack intensity rules.
 *
 * This module owns the canonical color palette for all affinity kinds
 * and the intensity progression rules for affinity stack visualization.
 *
 * These rules drive:
 * - Resource bundle sprite generation (resource-bundle.js)
 * - ASCII-styled affinity rendering (movement-ui.js)
 * - Future CLI-generated imagery with affinity-aware room/floor visuals
 *
 * @module affinity-palette
 */

import { AFFINITY_KINDS } from "../contracts/domain-constants.js";

/**
 * Canonical hex color for each affinity kind.
 * Used for sprite generation and visual styling.
 */
export const AFFINITY_COLOR_HEX = Object.freeze({
  fire: "#f05a28",
  water: "#2b7fff",
  earth: "#7a5c33",
  wind: "#8fd3ff",
  life: "#49b96b",
  decay: "#6f7b46",
  corrode: "#7fbf42",
  fortify: "#8c6dd7",
  light: "#f5d14d",
  dark: "#3a2a57",
});

/**
 * Stack intensity progression rules.
 * Each tier increases saturation, reduces lightness, and adds glow.
 *
 * Used by ASCII styling and can drive CLI-generated image intensity overlays.
 *
 * Tiers:
 * - tier1: stacks = 1 (baseline)
 * - tier2: stacks = 2 (moderate boost)
 * - tier3: stacks >= 3 (strong boost)
 *
 * @type {Array<{sat: number, light: number, glow: number}>}
 */
export const STACK_INTENSITY_TIERS = Object.freeze([
  { sat: 55, light: 55, glow: 0 }, // tier1
  { sat: 65, light: 50, glow: 4 }, // tier2
  { sat: 75, light: 45, glow: 6 }, // tier3
  { sat: 85, light: 40, glow: 8 }, // tier4
  { sat: 95, light: 35, glow: 10 }, // tier5 (max saturation, deep glow)
]);

/**
 * Convert hex color to RGBA array.
 * @param {string} hex - 6-character hex color (e.g., "#f05a28")
 * @param {number} alpha - Alpha channel (0-255), default 255
 * @returns {[number, number, number, number]} RGBA array
 */
export function hexToRgba(hex, alpha = 255) {
  const normalized = normalizeHex(hex, "#000000");
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
    alpha,
  ];
}

/**
 * Normalize and validate a hex color string.
 * @param {string} value - Hex color to normalize
 * @param {string} fallback - Fallback color if invalid
 * @returns {string} Normalized hex color
 */
export function normalizeHex(value, fallback) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
}

/**
 * Resolve the intensity tier for a given stack count.
 * @param {number} stacks - Affinity stack count (1+)
 * @returns {{sat: number, light: number, glow: number, stacks: number}}
 */
export function resolveStackIntensity(stacks) {
  const normalized = Math.max(1, Math.round(Number(stacks) || 1));
  const index = Math.min(STACK_INTENSITY_TIERS.length - 1, normalized - 1);
  return { ...STACK_INTENSITY_TIERS[index], stacks: normalized };
}

/**
 * Get the RGBA color for an affinity kind.
 * @param {string} kind - Affinity kind
 * @param {number} alpha - Alpha channel (0-255), default 255
 * @returns {[number, number, number, number]} RGBA array
 */
export function getAffinityRgba(kind, alpha = 255) {
  const hex = AFFINITY_COLOR_HEX[kind];
  if (!hex) {
    return [255, 255, 255, alpha]; // fallback white
  }
  return hexToRgba(hex, alpha);
}

/**
 * Resolve RGBA from an aura cell with intensity-based alpha.
 *
 * @param {{ kind: string, stacks: number }} resolvedAuraCell - aura data
 * @param {number} [baseAlpha=1.0] - base alpha multiplier in [0, 1]
 * @returns {[number, number, number, number]} RGBA with intensity-scaled alpha
 */
export function resolveAuraRgba(resolvedAuraCell, baseAlpha = 1.0) {
  const kind = resolvedAuraCell?.kind;
  const stacks = Math.max(1, Math.round(Number(resolvedAuraCell?.stacks) || 1));
  const tier = resolveStackIntensity(stacks);
  // Scale alpha by tier glow + base (tier glow 0-10 maps to 0.6-1.0 range)
  const glowAlpha = 0.6 + (tier.glow / 10) * 0.4;
  const alpha = Math.min(255, Math.round(baseAlpha * glowAlpha * 255));
  return getAffinityRgba(kind, alpha);
}

/**
 * Validate that all canonical affinity kinds have palette entries.
 * @returns {{ok: boolean, missing: string[]}}
 */
export function validateAffinityPalette() {
  const missing = [];
  AFFINITY_KINDS.forEach((kind) => {
    if (!AFFINITY_COLOR_HEX[kind]) {
      missing.push(kind);
    }
  });
  return { ok: missing.length === 0, missing };
}

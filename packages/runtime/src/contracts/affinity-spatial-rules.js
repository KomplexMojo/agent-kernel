/**
 * Affinity Spatial Rules — the definitive interaction grid.
 *
 * This module defines:
 * - SPATIAL_WEIGHTS: tunable coefficients for all spatial formulas
 * - INTERACTION_MATRIX: 48-cell lookup for expression×expression×affinityRelationship
 *
 * All game behaviors are parameterized through SPATIAL_WEIGHTS.
 * Changing a weight adjusts behavior without changing code.
 *
 * Formulas reference design sections:
 *   §1.1 Radius, §1.2 Intensity, §1.3 Potency, §1.4 Opposite cancellation,
 *   §1.5 Same-kind merge, §1.6 Effective potency, §1.7 Mana cost,
 *   §2.x Pixel masks
 *
 * @module affinity-spatial-rules
 */

import { AFFINITY_OPPOSITES } from "./domain-constants.js";

// ---------------------------------------------------------------------------
// Expression-keyed weight profiles
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
  emit: Object.freeze({ peakIntensity: 1.0, stackExponent: 0.3, buffer: 1, falloffCurve: 1.0 }),
  draw: Object.freeze({ peakIntensity: 1.0, stackExponent: 0.0, buffer: 0, falloffCurve: 0.0 }),
});

/**
 * Potency weights per expression (§1.3).
 * potency(stacks) = basePotency + potencyGrowth * stacks^potencyExponent
 */
const POTENCY_WEIGHTS = Object.freeze({
  push: Object.freeze({ basePotency: 0, potencyGrowth: 1.0, potencyExponent: 2.0 }),
  pull: Object.freeze({ basePotency: 0, potencyGrowth: 1.0, potencyExponent: 1.0 }),
  emit: Object.freeze({ basePotency: 0, potencyGrowth: 1.0, potencyExponent: 1.0 }),
  draw: Object.freeze({ basePotency: 0, potencyGrowth: 1.0, potencyExponent: 1.0 }),
});

/**
 * Mana cost weights per expression (§1.7).
 * manaCost(stacks) = ceil(baseMana + manaGrowth * stacks^manaExponent)
 */
const MANA_COST_WEIGHTS = Object.freeze({
  push: Object.freeze({ baseMana: 0, manaGrowth: 0, manaExponent: 0 }),
  pull: Object.freeze({ baseMana: 0, manaGrowth: 0, manaExponent: 0 }),
  emit: Object.freeze({ baseMana: 1, manaGrowth: 0.5, manaExponent: 2.0 }),
  draw: Object.freeze({ baseMana: 0, manaGrowth: 0.25, manaExponent: 2.0 }),
});

// ---------------------------------------------------------------------------
// Master weights object
// ---------------------------------------------------------------------------

export const SPATIAL_WEIGHTS = Object.freeze({
  // Expression-keyed profiles
  radius: RADIUS_WEIGHTS,
  intensity: INTENSITY_WEIGHTS,
  potency: POTENCY_WEIGHTS,
  manaCost: MANA_COST_WEIGHTS,

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
  maxMergedStacks: 8,
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
// Affinity relationship resolver
// ---------------------------------------------------------------------------

/**
 * Determine the relationship between two affinity kinds.
 * @param {string} sourceKind
 * @param {string} targetKind
 * @returns {"same"|"opposite"|"unrelated"}
 */
export function resolveAffinityRelationship(sourceKind, targetKind) {
  if (sourceKind === targetKind) return "same";
  if (AFFINITY_OPPOSITES[sourceKind] === targetKind) return "opposite";
  return "unrelated";
}

// ---------------------------------------------------------------------------
// Interaction matrix (48 cells)
// ---------------------------------------------------------------------------

/**
 * Each cell defines:
 * - sourceEffect: what happens to the source actor ("none" | "damage" | "mana_gain" | "mana_loss")
 * - targetEffect: what happens to the target actor
 * - visualState: tile visual key for the pixel mask system
 * - formula: description of the computation
 * - usesStackCancellation: whether §1.4 opposite cancellation applies
 */

function cell(sourceEffect, targetEffect, visualState, formula, opts = {}) {
  return Object.freeze({
    sourceEffect,
    targetEffect,
    visualState,
    formula,
    usesStackCancellation: opts.usesStackCancellation || false,
  });
}

const PUSH_ENCOUNTERS = Object.freeze({
  push: Object.freeze({
    same: cell("none", "none", "clash-neutral", "same-kind push cancel: net = 0"),
    opposite: cell("conditional_damage", "conditional_damage", "clash-opposed",
      "§1.4: canceled = min(s,t), loser takes potency(net, W)", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent, no interaction"),
  }),
  pull: Object.freeze({
    same: cell("none", "none", "redirect", "push absorbed by same-kind pull"),
    opposite: cell("damage", "damage", "conflict",
      "§1.4: each side takes residual potency after cancellation", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
  emit: Object.freeze({
    same: cell("none", "none", "emit-field", "push passes through same-kind field"),
    opposite: cell("potency_reduced", "potency_reduced", "disruption",
      "§1.4: canceled = min(pushStacks, emitStacks), residual to winner", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
  draw: Object.freeze({
    same: cell("none", "damage", "strike", "draw takes potency(pushStacks) * intensity"),
    opposite: cell("none", "amplified_damage", "vulnerability",
      "§1.4 cancellation then vulnerability: potency(net) * W.oppositeVulnerability", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
});

const PULL_ENCOUNTERS = Object.freeze({
  push: Object.freeze({
    same: cell("none", "none", "redirect", "pull absorbs same-kind push"),
    opposite: cell("damage", "none", "backlash",
      "§1.4: puller takes residual push potency", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
  pull: Object.freeze({
    same: cell("mana_gain", "mana_loss", "siphon",
      "steal = min(potency(s), potency(t)) * W.stealEfficiency"),
    opposite: cell("damage", "damage", "mutual-drain",
      "§1.4: each takes potency(netOpponent)", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
  emit: Object.freeze({
    same: cell("mana_gain", "none", "absorb",
      "absorption = floor(emit.intensity * potency(pullStacks) * W.absorbRate)"),
    opposite: cell("damage", "potency_reduced", "toxic-exposure",
      "§1.4: puller takes potency(netEmit) * W.toxicExposureRate", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
  draw: Object.freeze({
    same: cell("mana_gain", "mana_loss", "tug",
      "steal = min(potency(s), potency(t)) * W.stealEfficiency"),
    opposite: cell("damage", "mana_loss", "rend",
      "§1.4: cancellation then residual damage/drain", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
});

const EMIT_ENCOUNTERS = Object.freeze({
  push: Object.freeze({
    same: cell("none", "none", "emit-field", "push passes through same-kind emit"),
    opposite: cell("potency_reduced", "potency_reduced", "disruption",
      "§1.4: canceled = min(emitStacks, pushStacks), residual to winner", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
  pull: Object.freeze({
    same: cell("none", "mana_gain", "absorb",
      "puller gains absorption from same-kind emit"),
    opposite: cell("potency_reduced", "damage", "toxic-exposure",
      "§1.4: puller takes potency(netEmit) * W.toxicExposureRate", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
  emit: Object.freeze({
    same: cell("none", "none", "reinforcement",
      "§1.5: mergedStacks = min(sStacks + tStacks, W.maxMergedStacks)"),
    opposite: cell("potency_reduced", "potency_reduced", "conflict-zone",
      "§1.4: canceled = min(s,t), winner keeps netStacks", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "both coexist independently"),
  }),
  draw: Object.freeze({
    same: cell("none", "mana_gain", "absorb",
      "draw gains floor(emit.intensity * potency(drawStacks) * W.absorbRate)"),
    opposite: cell("none", "damage", "susceptible",
      "§1.4: draw takes potency(netEmit) * W.toxicExposureRate", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "no interaction"),
  }),
});

const DRAW_ENCOUNTERS = Object.freeze({
  push: Object.freeze({
    same: cell("damage", "none", "strike", "draw takes potency(pushStacks) * intensity"),
    opposite: cell("amplified_damage", "none", "vulnerability",
      "§1.4 cancellation then vulnerability: potency(net) * W.oppositeVulnerability", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
  pull: Object.freeze({
    same: cell("mana_loss", "mana_gain", "tug",
      "draw loses mana from same-kind pull steal"),
    opposite: cell("mana_loss", "damage", "rend",
      "§1.4: cancellation then residual", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "independent"),
  }),
  emit: Object.freeze({
    same: cell("mana_gain", "none", "absorb",
      "draw gains floor(emit.intensity * potency(drawStacks) * W.absorbRate)"),
    opposite: cell("damage", "none", "susceptible",
      "§1.4: draw takes potency(netEmit) * W.toxicExposureRate", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "no interaction"),
  }),
  draw: Object.freeze({
    same: cell("none", "none", "resonance", "no interaction, both absorbing"),
    opposite: cell("damage", "damage", "corrosion",
      "§1.4: each takes potency(netOpponent)", { usesStackCancellation: true }),
    unrelated: cell("none", "none", "layered", "no interaction"),
  }),
});

/**
 * The 48-cell interaction matrix.
 * Access: INTERACTION_MATRIX[sourceExpression][targetExpression][affinityRelationship]
 *
 * @type {Record<string, Record<string, Record<string, InteractionCell>>>}
 */
export const INTERACTION_MATRIX = Object.freeze({
  push: PUSH_ENCOUNTERS,
  pull: PULL_ENCOUNTERS,
  emit: EMIT_ENCOUNTERS,
  draw: DRAW_ENCOUNTERS,
});

/**
 * All visual state keys used in the interaction matrix.
 * Rendering code can validate against this set.
 */
export const VISUAL_STATES = Object.freeze([
  "clash-neutral",
  "clash-opposed",
  "redirect",
  "conflict",
  "disruption",
  "strike",
  "vulnerability",
  "backlash",
  "siphon",
  "mutual-drain",
  "absorb",
  "toxic-exposure",
  "tug",
  "rend",
  "reinforcement",
  "conflict-zone",
  "susceptible",
  "resonance",
  "corrosion",
  "layered",
  "emit-field",
]);

/**
 * Expressions that produce persistent spatial fields (vs instantaneous).
 */
export const PERSISTENT_EXPRESSIONS = Object.freeze(["emit", "draw"]);
export const INSTANTANEOUS_EXPRESSIONS = Object.freeze(["push", "pull"]);

/**
 * Canonical list of valid expressions for spatial projection.
 */
export const SPATIAL_EXPRESSIONS = Object.freeze(["push", "pull", "emit", "draw"]);

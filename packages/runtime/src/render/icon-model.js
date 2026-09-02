/**
 * icon-model.js
 *
 * Decides what a UI icon *means* — its shape, its colour, its outline — so that
 * `ui-web` can draw a chip without inventing any of it.
 *
 * Icons had been medallion-era PNGs with opaque baked-in backgrounds, stretched
 * edge-to-edge inside a 28px chip by `width: 100% !important`. The art's own
 * square background covered the chip's ring and matched its fill, so the chip
 * read as a solid block of colour with no containment — and the art was in the
 * retired visual language while the board had moved on.
 *
 * The rule here is the same one the board uses:
 *
 *   role     -> silhouette   (delver ▲ · warden ⬢ · hazard ▼ · resource ◆)
 *   affinity -> fill colour  (one shared neutral mark, ten fills)
 *
 * **Colour does not mean the same thing in every category, and the model says so.**
 * For roles and affinities colour IS the identity, so the glyph is drawn in it.
 * For expressions and motivations it is not — those palettes collide badly
 * (expressions worst pair ΔE 10.0, motivations 7.2) — so the glyph is drawn in a
 * neutral ink and the colour is demoted to a wash on the disc. Drawing them in
 * their own near-identical colours would imply a distinction that is not there.
 *
 * Expressions are directional (push/pull/emit/draw), so their geometry is
 * near-literal. Motivations are abstract and stay typographic: see
 * MOTIVATION_MARKS for why a generated set cannot cover twelve of them.
 *
 * @module icon-model
 */

import { GAME_COLOR_PALETTE, GAME_AFFINITY_COLOR_HEX } from "../contracts/game-elements.js";
import { outlineForFill } from "./entity-sprite-composer.js";

/** Shapes `ui-web` knows how to draw. Adding one here means adding a path there. */
export const ICON_SHAPES = Object.freeze([
  "delver",   // up triangle
  "warden",   // hexagon
  "hazard",   // down triangle
  "resource", // diamond
  "room",     // rounded square
  "mark",     // neutral disc — affinities, where colour is the whole message
  "bar",      // horizontal bar — vitals, which read as meters
  // Expressions are directional, so these are near-literal rather than invented.
  "push",     // chevron pointing out
  "pull",     // chevron pointing in
  "emit",     // rays from a solid core
  "draw",     // rays into a hollow ring
]);

/**
 * Monochrome marks for motivations.
 *
 * Motivations are abstract — there is no shape in the sprite language for
 * "strategy_focused" — and a generated set provably cannot cover them: four
 * family shapes times a filled/hollow split is eight slots for twelve items, and
 * separating the rest by dot count is the same failure as separating two
 * silhouettes by sixteen pixels. So these stay typographic, drawn in one neutral
 * ink inside the same chip as everything else.
 *
 * Chosen from Geometric Shapes, Arrows, Dingbats and Misc Technical, which have
 * broad font coverage; they are rasterised into a texture for the card rail, so
 * an exotic codepoint would silently become tofu.
 */
const MOTIVATION_MARKS = Object.freeze({
  random: "◌",
  stationary: "■",
  exploring: "◇",
  patrolling: "⇄",
  attacking: "✕",
  defending: "⌂",
  stealthy: "◐",
  friendly: "♡",
  reflexive: "↯",
  goal_oriented: "◎",
  strategy_focused: "▦",
  user_controlled: "⌘",
});

/**
 * Role silhouettes, matching `entity-sprite-composer`'s board shapes. `attacker`
 * and `defender` are type aliases the card surfaces use for the same two roles.
 */
const TYPE_SHAPES = Object.freeze({
  delver: "delver",
  attacker: "delver",
  warden: "warden",
  defender: "warden",
  hazard: "hazard",
  resource: "resource",
  room: "room",
  untyped: "mark",
});

const ITEM_SHAPES = Object.freeze({
  hazard: "hazard",
  resource: "resource",
});

/** Neutral ink for categories whose palette cannot carry identity. */
export const ICON_NEUTRAL_INK = "#cfd6dd";

/** Categories where colour identifies, so the glyph is drawn in it. */
const COLOUR_IDENTIFIES = Object.freeze(["types", "items", "affinities", "vitals"]);

/** Only `ui` stays outside the chip system entirely. */
const TEXT_ONLY_CATEGORIES = Object.freeze(["ui"]);

function token(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @typedef {object} IconModel
 * @property {"shape"|"glyph"|"text"} kind
 *   "shape" = generated geometry · "glyph" = monochrome mark in the same chip ·
 *   "text"  = plain unicode fallback, no chip.
 * @property {string} [mark]         The monochrome character, for "glyph".
 * @property {string} [shape]        One of ICON_SHAPES.
 * @property {string} [colorHex]     The category colour: glyph fill where colour
 *   identifies, otherwise the disc wash only.
 * @property {string} [inkHex]       Glyph colour. Equals colorHex where colour
 *   identifies; a neutral ink where it does not.
 * @property {string} [outlineHex]   Outline, from the board's own lightness rule.
 *   Absent when the ink is neutral — a neutral glyph on a dark disc already reads.
 * @property {string} category
 * @property {string} key
 */

/**
 * Resolve the icon model for a category/key.
 *
 * @param {string} category "types" | "items" | "affinities" | "vitals" | …
 * @param {string} key
 * @returns {IconModel | null} null when the pair is unknown — callers fall back.
 */
export function buildIconModel(category, key) {
  const cat = token(category);
  const id = token(key);
  if (!cat || !id) return null;

  // Categories the sprite language does not cover. Not a failure — a refusal.
  if (TEXT_ONLY_CATEGORIES.includes(cat)) {
    return { kind: "text", category: cat, key: id };
  }

  let shape = null;
  let colorHex = null;

  if (cat === "affinities") {
    colorHex = GAME_AFFINITY_COLOR_HEX[id] || null;
    shape = colorHex ? "mark" : null;
  } else if (cat === "types") {
    shape = TYPE_SHAPES[id] || null;
    colorHex = GAME_COLOR_PALETTE.types?.[id] || null;
  } else if (cat === "items") {
    shape = ITEM_SHAPES[id] || null;
    colorHex = GAME_COLOR_PALETTE.items?.[id] || null;
  } else if (cat === "vitals") {
    colorHex = GAME_COLOR_PALETTE.vitals?.[id] || null;
    shape = colorHex ? "bar" : null;
  } else if (cat === "expressions") {
    shape = ICON_SHAPES.includes(id) ? id : null;
    colorHex = GAME_COLOR_PALETTE.expressions?.[id] || null;
  } else if (cat === "motivations") {
    const mark = MOTIVATION_MARKS[id];
    const tint = GAME_COLOR_PALETTE.motivations?.[id];
    if (!mark || !tint) return null;
    // The wash carries no identity here -- motivation colours collide (worst pair
    // dE 7.2), as do expression colours (dE 10.0). The glyph identifies; the disc
    // only contains. That is the inverse of affinities, where colour is everything.
    return { kind: "glyph", mark, colorHex: tint, inkHex: ICON_NEUTRAL_INK, category: cat, key: id };
  } else {
    return null;
  }

  if (!shape || !colorHex) return null;

  const colourIdentifies = COLOUR_IDENTIFIES.includes(cat);
  return {
    kind: "shape",
    shape,
    colorHex,
    inkHex: colourIdentifies ? colorHex : ICON_NEUTRAL_INK,
    // Same rule as the board sprite, not a second implementation of it. Only
    // needed when the glyph is drawn in the element colour; a neutral ink on a
    // dark disc already separates.
    ...(colourIdentifies ? { outlineHex: outlineForFill(colorHex) } : {}),
    category: cat,
    key: id,
  };
}

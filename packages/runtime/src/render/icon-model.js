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
 * **Where the language has nothing to say, this declines.** Expressions and
 * motivations have no shape and no colour in the sprite language. Generating
 * marks for them would be inventing design and calling it a port, so they come
 * back as `kind: "text"` and the caller keeps the existing unicode glyph. That
 * refusal is asserted in `tests/runtime/icon-model.test.js`.
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
]);

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

const TEXT_ONLY_CATEGORIES = Object.freeze(["expressions", "motivations", "ui"]);

function token(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @typedef {object} IconModel
 * @property {"shape"|"text"} kind   "text" means: use the unicode fallback.
 * @property {string} [shape]        One of ICON_SHAPES.
 * @property {string} [colorHex]     Fill colour.
 * @property {string} [outlineHex]   Outline, from the board's own lightness rule.
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
  } else {
    return null;
  }

  if (!shape || !colorHex) return null;

  return {
    kind: "shape",
    shape,
    colorHex,
    // Same rule as the board sprite, not a second implementation of it.
    outlineHex: outlineForFill(colorHex),
    category: cat,
    key: id,
  };
}

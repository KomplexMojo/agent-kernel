/**
 * ascii-cell-style.js — the colour of each ASCII board character.
 *
 * Which palette entry a character takes is visual semantics, so it lives here
 * with the rest of `render/`, and every value comes from `GAME_COLOR_PALETTE`
 * (the single origin for colour; charter → *Affinity Visualization*). A
 * terminal surface turns the hex values into escape codes; it never picks a
 * colour itself.
 *
 * The scheme is the Phaser board's, in two layers:
 *   - **Tiles are flat fills** (`tiles.*`) drawn as the cell background, the
 *     same rule the gameplay renderer follows ("board tiles are flat fills").
 *   - **What stands on a tile** is the foreground glyph in its role colour
 *     (`actors.*`, `items.*`), over the floor fill.
 *
 * The player is `@` in `motivations.user_controlled`: the palette's own colour
 * for a user-controlled actor. An actor's letter (`@`, `D`, `W`) already says
 * its role.
 *
 * An actor with an equipped affinity is coloured by it instead, on the board
 * sprite's own two-channel rule (role as shape, affinity as fill): the cell
 * background is the affinity fill (`GAME_AFFINITY_COLOR_HEX`) and the letter
 * takes the sprite's outline for that fill (`outlineForFill`), so it stays
 * legible on `light` and `dark` alike. Affinity is read by the sprite's own
 * `resolveEquippedAffinity`, so the two surfaces cannot disagree.
 *
 * Output is plain data: `{ [char]: { fg, bg } }` with hex strings.
 */
import { GAME_COLOR_PALETTE } from "../contracts/game-elements.js";
import { AFFINITY_COLOR_HEX } from "./affinity-palette.js";
import { outlineForFill, resolveEquippedAffinity } from "./entity-sprite-composer.js";
import { ASCII_ENTITY_GLYPHS } from "./visualization-snapshot.js";

const { tiles, tileBorders, actors, items, types, motivations } = GAME_COLOR_PALETTE;

// The glyph drawn ON a tile fill. Walls keep the board's wall stroke colour so
// room shape stays readable; floor dots are the neutral untyped grey.
const TILE_GLYPH_COLOR = Object.freeze({
  wall: tileBorders.wall,
  floor: types.untyped,
  spawn: tileBorders.wall,
  exit: tileBorders.wall,
  barrier: tileBorders.wall,
});

const ENTITY_COLOR = Object.freeze({
  [ASCII_ENTITY_GLYPHS.delver]: actors.delver,
  [ASCII_ENTITY_GLYPHS.warden]: actors.warden,
  [ASCII_ENTITY_GLYPHS.hazard]: items.hazard,
  [ASCII_ENTITY_GLYPHS.resource]: items.resource,
});

/**
 * Characters come from core's frame legend, so this restates no glyph.
 *
 * @param {Record<string, string>} legend tile kind -> character, as `renderCoreFrame(...).legend`
 * @returns {Record<string, {fg: string, bg: string}>}
 */
export function buildAsciiCellStyles(legend) {
  const styles = {};
  for (const [kind, char] of Object.entries(legend || {})) {
    if (kind === "actor" || typeof char !== "string") continue;
    if (tiles[kind] && TILE_GLYPH_COLOR[kind]) {
      styles[char] = { fg: TILE_GLYPH_COLOR[kind], bg: tiles[kind] };
    }
  }
  for (const [char, fg] of Object.entries(ENTITY_COLOR)) {
    styles[char] = { fg, bg: tiles.floor };
  }
  if (typeof legend?.actor === "string") {
    styles[legend.actor] = { fg: motivations.user_controlled, bg: tiles.floor };
  }
  return styles;
}

/**
 * The cell style for one actor from its equipped affinity, or null when it has
 * none (the caller then uses its glyph's role colour from buildAsciiCellStyles).
 *
 * @param {object} entity any actor-shaped object (observation, HUD model, artifact actor)
 * @returns {{fg: string, bg: string, affinity: string} | null}
 */
export function asciiActorCellStyle(entity) {
  const affinity = resolveEquippedAffinity(entity);
  const fill = affinity ? AFFINITY_COLOR_HEX[affinity] : null;
  return fill ? { fg: outlineForFill(fill), bg: fill, affinity } : null;
}

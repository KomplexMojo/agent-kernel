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
 * Fog of war (`view().sight` from the play session) adds two looks: a
 * never-seen cell is the fog glyph on the palette's `tiles.fog`, and a
 * remembered cell (seen before, out of sight now) is its usual style dimmed
 * toward that same fog colour, so memory reads as fading into the dark.
 *
 * A source whose affinity is off until its mana is full (`affinityOff` on the view
 * actor, #412) takes that same dimmed look, so a drained trap or warden reads as idle.
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
 * @param {Record<string, string>} legend tile kind -> character, as a play-session `view().legend`
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
  if (typeof legend?.fog === "string") {
    styles[legend.fog] = { fg: types.untyped, bg: tiles.fog };
  }
  return styles;
}

// How far a remembered cell fades toward the fog fill (0 = unchanged, 1 = fog).
export const ASCII_REMEMBERED_FADE = 0.55;

/**
 * Without colour there is no fade, so remembered FLOOR draws as this instead
 * (#284, maintainer 2026-10-17): seen floor stays `.`, remembered floor is blank,
 * and remembered walls, doors and the exit keep their glyphs so the map keeps its shape.
 */
export const ASCII_REMEMBERED_FLOOR_MONO = " ";

function mixHex(from, to, amount) {
  const parse = (hex) => {
    const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
    return match ? match.slice(1).map((part) => parseInt(part, 16)) : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return from;
  return `#${a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A cell's style as remembered under fog of war: both colours faded toward
 * `tiles.fog`. Null in, null out.
 *
 * @param {{fg: string, bg: string} | null} style
 * @returns {{fg: string, bg: string} | null}
 */
export function asciiRememberedCellStyle(style) {
  if (!style) return null;
  return {
    fg: mixHex(style.fg, tiles.fog, ASCII_REMEMBERED_FADE),
    bg: mixHex(style.bg, tiles.fog, ASCII_REMEMBERED_FADE),
  };
}

/**
 * The cell style for one actor or trap from its equipped affinity, or null when it has
 * none (the caller then uses its glyph's role colour from buildAsciiCellStyles).
 *
 * @param {object} entity any actor-shaped object (observation, HUD model, artifact actor)
 * @returns {{fg: string, bg: string, affinity: string} | null}
 */
export function asciiActorCellStyle(entity) {
  const affinity = resolveEquippedAffinity(entity);
  const fill = affinity ? AFFINITY_COLOR_HEX[affinity] : null;
  if (!fill) return null;
  const style = { fg: outlineForFill(fill), bg: fill };
  // A source that is off until its mana is full (#412) is drawn dimmed, like memory.
  return { ...(entity?.affinityOff ? asciiRememberedCellStyle(style) : style), affinity };
}

// How far a cell's fill moves toward its field colour: a floor plus a share per unit of
// falloff, capped so the tile still reads as floor under the tint.
export const ASCII_FIELD_TINT_BASE = 0.2;
export const ASCII_FIELD_TINT_PER_INTENSITY = 0.35;
export const ASCII_FIELD_TINT_MAX = 0.7;

/**
 * A tile's style under the affinity fields on it (#287), for every affinity alike:
 * the fill moves toward the falloff-weighted mix of each field's affinity colour
 * (`GAME_AFFINITY_COLOR_HEX`), further the stronger the fields are. Opposite pairs
 * have already cancelled in core, so what shows is what acts on the tile; kinds that
 * are not opposed show as their mix. No fields, or none with a colour, leaves the
 * style as it is; the glyph leans toward the outline for the new fill so it stays
 * legible. Null style in, null out.
 *
 * @param {{fg: string, bg: string} | null} style
 * @param {Array<{kind: string, falloff: number}> | null} fields
 * @returns {{fg: string, bg: string} | null}
 */
export function asciiFieldCellStyle(style, fields) {
  if (!style || !Array.isArray(fields)) return style;
  const coloured = fields.filter((entry) => AFFINITY_COLOR_HEX[entry?.kind] && entry.falloff > 0);
  if (coloured.length === 0) return style;
  const total = coloured.reduce((sum, entry) => sum + entry.falloff, 0);
  let mix = AFFINITY_COLOR_HEX[coloured[0].kind];
  let weight = coloured[0].falloff;
  for (const entry of coloured.slice(1)) {
    weight += entry.falloff;
    mix = mixHex(mix, AFFINITY_COLOR_HEX[entry.kind], entry.falloff / weight);
  }
  const tint = Math.min(ASCII_FIELD_TINT_MAX, ASCII_FIELD_TINT_BASE + ASCII_FIELD_TINT_PER_INTENSITY * total);
  const bg = mixHex(style.bg, mix, tint);
  // The glyph leans toward the sprite outline for the new fill, so it stays legible on a pale tint.
  return { fg: mixHex(style.fg, outlineForFill(bg), 0.5), bg };
}

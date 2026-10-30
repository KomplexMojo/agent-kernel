/**
 * The board glyph for each kind of actor (#575). Every glyph is exactly one terminal column
 * wide: East Asian Width Narrow or Neutral, with no emoji presentation. The obvious picks
 * (`◆ ▲ ■ ● Ω ♣`) are Ambiguous and render two columns wide in CJK-locale terminals, and
 * `▪ ▶ ☀ ☠ ☺` are emoji, so none of them is used here. The ASCII set (the same switch as the
 * #574 wall fallback) brings back the letters.
 *
 * Defined once for terminal, web and phone: the play view carries the table as
 * `view.legend.glyphs`, so no UI hardcodes a glyph or imports core-ts.
 */
export const ACTOR_GLYPH_SETS = Object.freeze({
  unicode: Object.freeze({ player: "@", delver: "◊", warden: "▴", hazard: "☼", resource: "◙", barrier: "▮" }),
  ascii: Object.freeze({ player: "@", delver: "D", warden: "W", hazard: "H", resource: "R", barrier: "B" }),
});

/** The actor glyph table for a glyph set name; Unicode when the name is unknown. */
export function actorGlyphs(set = "unicode") {
  return ACTOR_GLYPH_SETS[set] ?? ACTOR_GLYPH_SETS.unicode;
}

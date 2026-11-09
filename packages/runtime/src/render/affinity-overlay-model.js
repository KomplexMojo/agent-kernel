/**
 * Affinity board overlay model (#814, #815): what a graphical client paints over the floor for
 * affinity fields, draw sustains, the casts of the last tick and recent defeats. Pure: it reads
 * only the object `session.view()` returns, which is already masked to what the player sees, so
 * it reveals nothing the ASCII board does not. The numbers (mix, tint, valence) come from
 * `ascii-cell-style.js`, the same functions the terminal paints with; a client never recomputes
 * overlap, falloff or fog.
 *
 * Layers per cell, any of which may be null:
 * - `field`: lasting emit and push fields. `mark` is the terminal's `:` (an empty floor or fog
 *   cell under a field); `tint` is `{ mix, alpha, valence }`; `contributors` lists every kind
 *   there with its falloff, intensity, stacks, `strength` (falloff x intensity squared, the scale
 *   of its effect), `restores`, `vital` and `sources`. An out-of-sight cell holds only the
 *   viewer's own reach, flagged `own`, with no strength.
 * - `draw`: lasting draw sustains, the same shape, `expression: "draw"` on each contributor, never
 *   `restores`. No `mark`: a draw is not an emit; the client chooses its motif.
 * - `cast`: the last tick's push or pull path on a floor cell: `{ kind, expression, glyph,
 *   direction, hex, alpha, sourceId }`. A pull is already reversed in `glyph` and `direction`.
 * - `mark`: a recent defeat (`defeat`) or emptied resource (`spent`) on a floor cell.
 *
 * Entities draw above all of this; the client layers them, so a cell under an actor still carries
 * its field. Only the terminal hides a field mark under an actor glyph, and `mark` follows that.
 *
 * @module affinity-overlay-model
 */

import { AFFINITY_COLOR_HEX } from "./affinity-palette.js";
import { ASCII_FIELD_MARK_GLYPH } from "./visualization-snapshot.js";
import { ASCII_FIELD_TINT_MAX, affinityFieldTint } from "./ascii-cell-style.js";
import { GAME_COLOR_PALETTE } from "../contracts/game-elements.js";
import { PLAY_SIGHT } from "../runner/play-session.js";

const strengthOf = (entry) => (Number.isFinite(entry.falloff) && Number.isFinite(entry.intensity)
  ? entry.falloff * entry.intensity * entry.intensity : null);

function fieldLayer(entries, isMarkCell) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const tint = affinityFieldTint(entries);
  return {
    mark: isMarkCell,
    own: entries.some((entry) => entry.own === true),
    tint: tint ? { mix: tint.mix, alpha: tint.alpha, valence: tint.valence } : null,
    contributors: entries.map((entry) => ({
      kind: entry.kind,
      hex: AFFINITY_COLOR_HEX[entry.kind] ?? null,
      weight: tint?.weights.find((weight) => weight.kind === entry.kind)?.weight ?? 0,
      ...(entry.expression ? { expression: entry.expression } : {}),
      falloff: entry.falloff ?? null,
      intensity: entry.intensity ?? null,
      stacks: entry.stacks ?? null,
      strength: strengthOf(entry),
      ...(entry.restores !== undefined ? { restores: entry.restores } : {}),
      ...(entry.vital ? { vital: entry.vital } : {}),
      sources: [...(entry.sources ?? [])],
      ...(entry.own ? { own: true } : {}),
    })),
  };
}

/**
 * @param {object} view  what `createPlaySession().view()` returns
 * @returns {{ width: number, height: number, cells: object[][] }} `cells[y][x]` is
 *   `{ sight, field, draw, cast, mark }`.
 */
export function buildAffinityBoardOverlayModel(view) {
  if (!view || !Array.isArray(view.rows)) throw new Error("buildAffinityBoardOverlayModel: a play-session view is required");
  const floor = view.legend?.floor;
  const fog = view.legend?.fog;
  const cells = view.rows.map((row, y) => [...row].map((glyph, x) => {
    const entries = view.field?.[y]?.[x];
    const markable = Array.isArray(entries) && entries.length > 0 && (glyph === floor || (fog && glyph === fog) || glyph === ASCII_FIELD_MARK_GLYPH);
    return {
      sight: view.sight?.[y]?.[x] ?? PLAY_SIGHT.UNKNOWN,
      field: fieldLayer(entries, markable),
      draw: fieldLayer(view.drawField?.[y]?.[x], false),
      cast: null,
      mark: null,
    };
  }));
  const onFloor = (cell) => cells[cell.y]?.[cell.x] && view.rows[cell.y]?.[cell.x] === floor;
  for (const cast of view.casts ?? []) {
    for (const cell of cast.path ?? []) {
      if (!cell.glyph || !onFloor(cell)) continue;
      cells[cell.y][cell.x].cast = {
        kind: cast.kind, expression: cast.expression, sourceId: cast.sourceId,
        glyph: cell.glyph, direction: cell.direction ?? null,
        hex: AFFINITY_COLOR_HEX[cast.kind] ?? null, alpha: AFFINITY_COLOR_HEX[cast.kind] ? ASCII_FIELD_TINT_MAX : 0,
      };
    }
  }
  for (const mark of view.defeatMarks ?? []) {
    if (!onFloor(mark)) continue;
    cells[mark.y][mark.x].mark = { type: mark.spent ? "spent" : "defeat", role: mark.role ?? null, age: mark.age ?? 0,
      hex: GAME_COLOR_PALETTE.items.hazard };
  }
  return { width: cells[0]?.length ?? 0, height: cells.length, cells };
}

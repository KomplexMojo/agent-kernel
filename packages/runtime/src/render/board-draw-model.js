/**
 * Board draw model (#770): what a graphical client draws, projected from the play-session
 * view that ASCII also reads. Pure: it reads only the object `session.view()` returns,
 * never the session, so it cannot reveal more than the ASCII board shows (fog and sight
 * come through unchanged).
 *
 * A board sprite carries exactly two channels, `role` and `affinity` (the two-channel
 * rule, see entity-sprite-composer.js). Vitals, expression and motivation stay in the
 * seat HUD, which is the view's own player model (built by `buildActorHudModel`).
 *
 * @module board-draw-model
 */

import { PLAY_SIGHT } from "../runner/play-session.js";
import { normalizeEntitySpriteState } from "./entity-sprite-composer.js";

const TILE_BY_LEGEND_KEY = Object.freeze({ floor: "floor", spawn: "spawn", exit: "exit", barrier: "barrier" });

function tileKindResolver(legend = {}) {
  const wallGlyphs = new Set([legend.wall, ...(Array.isArray(legend.wallGlyphs) ? legend.wallGlyphs : [])].filter(Boolean));
  const byGlyph = new Map();
  for (const [key, kind] of Object.entries(TILE_BY_LEGEND_KEY)) {
    if (legend[key]) byGlyph.set(legend[key], kind);
  }
  // Entity glyphs overwrite the tile in `rows`; the entity is listed separately, so the tile beneath is floor.
  return (glyph) => (wallGlyphs.has(glyph) ? "wall" : byGlyph.get(glyph) ?? "floor");
}

const spriteOf = (entity) => normalizeEntitySpriteState(entity, { role: entity.role });

/**
 * @param {object} view  what `createPlaySession().view()` returns
 * @returns {{ width: number, height: number, cells: object[][], entities: object[], seatHud: object|null }}
 *   `cells[y][x]` is `{ tile, sight }` (`tile` is "fog" where the cell was never seen); `entities` are
 *   `{ id, x, y, sprite: { role, affinity } }` for everything the view shows standing in sight.
 */
export function buildBoardDrawModel(view) {
  if (!view || !Array.isArray(view.rows)) throw new Error("buildBoardDrawModel: a play-session view is required");
  const tileOf = tileKindResolver(view.legend);
  const cells = view.rows.map((row, y) => [...row].map((glyph, x) => {
    const sight = view.sight?.[y]?.[x] ?? PLAY_SIGHT.UNKNOWN;
    if (sight === PLAY_SIGHT.UNKNOWN) return { tile: "fog", sight };
    const tile = tileOf(glyph);
    const mask = view.wallMasks?.[y]?.[x];
    return tile === "wall" && Number.isInteger(mask) ? { tile, sight, wallMask: mask } : { tile, sight };
  }));
  const seen = [
    ...(view.player ? [view.player] : []),
    ...(view.actors ?? []),
    ...(view.hazards ?? []),
    ...(view.lootBodies ?? []),
  ];
  const entities = seen.filter((entity) => entity?.position)
    .map((entity) => ({ id: entity.id, x: entity.position.x, y: entity.position.y, sprite: spriteOf(entity) }));
  return {
    width: cells[0]?.length ?? 0,
    height: cells.length,
    cells,
    entities,
    seatHud: view.player ? structuredClone(view.player) : null,
  };
}

/**
 * The published surface for a graphical game client (#767).
 *
 * One facade instead of five internal modules: Primordial imports this file (listed in
 * `apiSurface`, exported by the runtime package) and the internals stay free to move.
 * Re-exports only, no logic. Everything here is additive-first: a name leaves this list
 * only after the game has moved off it, and `tests/architecture/client-surface.test.js`
 * pins the list so a removal or rename cannot happen by accident.
 *
 * Drive play with `createPlaySession` (act + view); draw from what `view()` returns.
 * Clients choose how pixels reach the screen; visual meaning stays here.
 *
 * @module client-surface
 */

export {
  createPlaySession,
  replayPlaySession,
  normalizePlayCommand,
  PLAY_SIGHT,
  PLAY_DIRECTIONS,
  PLAY_DIRECTION_STEPS,
  PLAY_COMMAND_KINDS,
} from "../runner/play-session.js";

export { buildActorHudModel, HUD_VITAL_LABELS } from "./actor-hud-model.js";
export { buildIconModel, ICON_SHAPES } from "./icon-model.js";
export {
  createDefaultResourceBundleArtifact,
  dressResourceBundle,
  validateResourceBundleArtifact,
  validateResourceBundleDressing,
  listResourceBundleAssetFiles,
  RESOURCE_BUNDLE_DRESSING_SCHEMA,
  RESOURCE_BUNDLE_SCHEMA,
} from "./resource-bundle.js";
export { normalizeEntitySpriteState, ENTITY_SPRITE_ROLES } from "./entity-sprite-composer.js";
export { buildBoardDrawModel } from "./board-draw-model.js";
export { buildBoardFrame } from "./board-frame.js";
export { playWindowBounds } from "./window-size.js";
export { WALL_NEIGHBOUR_BITS, WALL_BLOB_BITS, WALL_BLOB_MASKS, wallBlobSlot } from "./wall-glyphs.js";
export { buildAffinityBoardOverlayModel } from "./affinity-overlay-model.js";
export { resolveElementArt, elementArtCoverage, elementKeyFor } from "./element-art.js";

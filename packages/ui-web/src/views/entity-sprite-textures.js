/**
 * entity-sprite-textures.js
 *
 * Turns the runtime's entity-sprite pixels into a Phaser texture descriptor.
 * Replaces `actor-medallion-textures.js`.
 *
 * Sprite *semantics* stay in runtime (`entity-sprite-composer.js`); this module
 * only does Phaser cache mechanics, per the charter's rule that `ui-web` renders
 * and emits intents without owning meaning.
 *
 * The cache key is the whole point of the rewrite. The medallion keyed on the
 * actor's id **and a fingerprint of all four vitals**, so every point of damage
 * invalidated that actor's texture and forced a fresh canvas compose — one live
 * texture per actor, churning every tick. A sprite now depends only on
 * `{ role, affinity, size }`, so every fire delver on the board shares a single
 * texture and nothing is rebuilt when vitals change. Vitals live in the HUD.
 *
 * @module entity-sprite-textures
 */

import {
  composeEntitySprite,
  normalizeEntitySpriteState,
} from "../../../runtime/src/render/entity-sprite-composer.js";

const MIN_TEXTURE_SIZE = 8;
const DEFAULT_TEXTURE_SIZE = 32;

/**
 * v1 bundles keep their static PNG actor assets; composed sprites are a v2
 * feature. Carried over from the medallion path deliberately — changing what a
 * v1 bundle renders is a contract change, not a rendering change.
 */
export function shouldComposeEntitySprite(resourceBundle) {
  return Number(resourceBundle?.schemaVersion || 0) >= 2;
}

export function normalizeEntitySpriteTextureSize({ width, height, size } = {}) {
  const requested = Number(size);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.max(MIN_TEXTURE_SIZE, Math.round(requested));
  }
  const displaySize = Math.max(Number(width) || 0, Number(height) || 0);
  return Math.max(MIN_TEXTURE_SIZE, Math.round(displaySize || DEFAULT_TEXTURE_SIZE));
}

/**
 * Build a texture descriptor for one entity.
 *
 * @param {{ resourceBundle?: object, entity?: unknown, role?: string,
 *           width?: number, height?: number, size?: number }} input
 * @returns {{ key: string, size: number, state: object, pixels: Uint8ClampedArray } | null}
 */
export function createEntitySpriteTextureDescriptor({
  resourceBundle,
  entity,
  role,
  width,
  height,
  size,
} = {}) {
  if (!shouldComposeEntitySprite(resourceBundle)) return null;

  const textureSize = normalizeEntitySpriteTextureSize({ width, height, size });
  const state = normalizeEntitySpriteState(entity || {}, role ? { role } : {});

  return {
    key: `ak-sprite:${textureSize}:${state.role}:${state.affinity}`,
    size: textureSize,
    state,
    pixels: composeEntitySprite({ state, size: textureSize }),
  };
}

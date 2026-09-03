/**
 * entity-sprite-composer.js
 *
 * Composes the board sprite for one entity as raw RGBA pixels.
 *
 * This replaces `actor-medallion-composer.js`, which encoded eight independent
 * dimensions (role, affinity, expression, motivation and four vitals) into a
 * single 32x32 tile. That is ~64 physical pixels once the gameplay camera zooms
 * out, and eight channels do not fit in 64 pixels -- the medallion was legible
 * at 64px, muddy at 32px and noise at 16px. See
 * `docs/design/archive/2026-09-medallion-era/` for the retired art and the
 * measurement, and `interface-refinement.md` for the plan.
 *
 * The budget here is deliberately **two channels**:
 *
 *   role     -> silhouette shape   (readable without colour)
 *   affinity -> flat fill colour   (readable without shape)
 *
 * Everything else -- vitals, expression, motivation -- belongs to the HUD.
 * `EntitySpriteState` has no field to carry them, and
 * `tests/runtime/entity-sprite-composer.test.mts` asserts that passing them
 * changes not one byte. That refusal is the design; do not widen the state.
 *
 * Figure-ground is split between the two, and the split matters:
 *   the FILL separates the sprite from the board -- guaranteed by the tile gate
 *     in `tests/runtime/affinity-palette-separation.test.js`;
 *   the OUTLINE separates the silhouette's edge from its own fill.
 * That is why the palette can spend its range on separating fills from each
 * other, and why the outline is chosen from fill lightness rather than fixed.
 *
 * Pure: no IO, no clock, no randomness. Identical input yields a byte-identical
 * buffer.
 *
 * @module entity-sprite-composer
 */

import { AFFINITY_COLOR_HEX, hexToRgba } from "./affinity-palette.js";
import { AFFINITY_KINDS } from "../contracts/domain-constants.js";

/** Canonical composition size. Callers may request any size; this is the reference. */
export const ENTITY_SPRITE_CANONICAL_SIZE = 32;

/** The four board silhouettes. Order is stable -- tests iterate it. */
export const ENTITY_SPRITE_ROLES = Object.freeze(["delver", "warden", "hazard", "resource"]);

const DEFAULT_ROLE = "delver";
const DEFAULT_AFFINITY = "fire";

/**
 * Outline colours.
 *
 * These were a single near-white constant until M2 measured it: against the
 * near-white `light` fill it came out at dE 23.4, so a `light` sprite was a white
 * blob with no visible edge. A single mid-tone that clears both `light` and
 * `dark` exists (the search returned a pale pink), but imposing one hue on every
 * sprite is a large aesthetic cost to pay for a constant.
 *
 * Instead the outline is chosen from the fill's own lightness. That adds no
 * information channel -- it is a pure function of the affinity already shown, so
 * the two-channel budget is intact -- and it guarantees a hard edge on every
 * fill. Worst case is now dE 42.9 (`fortify`).
 *
 * Division of labour: the FILL separates the sprite from the board (guaranteed by
 * the tile gate in affinity-palette-separation.test.js); the OUTLINE separates the
 * silhouette's edge from its own fill.
 */
export const ENTITY_SPRITE_OUTLINE_LIGHT = "#f2f5f8";
export const ENTITY_SPRITE_OUTLINE_DARK = "#0a0c10";

/** CIE L* of a hex colour. Only the lightness axis is needed here. */
function lightnessOf(hex) {
  const linear = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  });
  const y = linear[0] * 0.2126729 + linear[1] * 0.7151522 + linear[2] * 0.072175;
  const f = y > 216 / 24389 ? Math.cbrt(y) : (841 / 108) * y + 4 / 29;
  return 116 * f - 16;
}

/**
 * Pick the outline for a fill colour.
 * @param {string} fillHex
 * @returns {string} one of ENTITY_SPRITE_OUTLINE_LIGHT / ENTITY_SPRITE_OUTLINE_DARK
 */
export function outlineForFill(fillHex) {
  return lightnessOf(fillHex) > 55 ? ENTITY_SPRITE_OUTLINE_DARK : ENTITY_SPRITE_OUTLINE_LIGHT;
}

/** Minimum size that still yields a recognisable silhouette. */
const MIN_SIZE = 6;

/**
 * @typedef {object} EntitySpriteState
 * @property {string} role     One of ENTITY_SPRITE_ROLES.
 * @property {string} affinity One of AFFINITY_KINDS.
 */

function normalizeToken(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Infer the board role from an entity. Mirrors the renderer's historical
 * inference so hazards and resources keep resolving as they did.
 */
function inferRole(entity) {
  const explicit = normalizeToken(
    [entity?.role, entity?.type, entity?.archetype, entity?.actorType, entity?.kind]
      .find((v) => typeof v === "string" && v.trim()),
  );
  if (ENTITY_SPRITE_ROLES.includes(explicit)) return explicit;
  const haystack = `${explicit} ${normalizeToken(entity?.id)}`;
  if (haystack.includes("warden") || haystack.includes("defender")) return "warden";
  if (haystack.includes("hazard")) return "hazard";
  if (haystack.includes("resource")) return "resource";
  return DEFAULT_ROLE;
}

/**
 * Pull the single active affinity. Single-equip is a domain decision (2026-09-02).
 *
 * Observation objects carry affinity in several shapes and all of them are live:
 * actors use `affinities[]`, hazards use a singular `affinity` OBJECT or
 * `affinityStacks[]`, and cards use `traits.affinities`. Reading only the string
 * form silently rendered every hazard and resource as the default `fire`.
 */
function inferAffinity(entity) {
  const explicit = normalizeToken(
    typeof entity?.affinity === "string" ? entity.affinity : entity?.affinity?.kind,
  );
  if (AFFINITY_KINDS.includes(explicit)) return explicit;

  const equipped = normalizeToken(entity?.equippedAffinity?.kind ?? entity?.equippedAffinity);
  if (AFFINITY_KINDS.includes(equipped)) return equipped;

  for (const source of [entity?.affinities, entity?.affinityStacks]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      const kind = normalizeToken(typeof entry === "string" ? entry : entry?.kind ?? entry?.name);
      if (AFFINITY_KINDS.includes(kind)) return kind;
    }
  }

  const traits = entity?.traits?.affinities;
  if (traits && typeof traits === "object" && !Array.isArray(traits)) {
    for (const key of Object.keys(traits)) {
      const kind = normalizeToken(String(key).split(":")[0]);
      if (AFFINITY_KINDS.includes(kind)) return kind;
    }
  }
  return DEFAULT_AFFINITY;
}

/**
 * Reduce any entity-shaped object to the two channels a sprite may carry.
 *
 * Deliberately lossy. Vitals, expression and motivation are dropped here, and
 * that is the point -- this is the choke point that keeps the sprite readable.
 *
 * @param {unknown} entity
 * @param {Partial<EntitySpriteState>} [override]
 * @returns {EntitySpriteState}
 */
export function normalizeEntitySpriteState(entity = {}, override = {}) {
  const source = entity && typeof entity === "object" ? entity : {};
  const role = ENTITY_SPRITE_ROLES.includes(normalizeToken(override.role))
    ? normalizeToken(override.role)
    : inferRole(source);
  const affinity = AFFINITY_KINDS.includes(normalizeToken(override.affinity))
    ? normalizeToken(override.affinity)
    : inferAffinity(source);
  return { role, affinity };
}

/**
 * Signed inside-test for each silhouette, in normalized [-1, 1] tile space.
 * Shapes are chosen for distinct *area distribution*, not decorative detail:
 * that is what survives downscaling.
 */
function isInsideShape(role, u, v) {
  switch (role) {
    // Upward triangle: mass at the bottom, a single apex.
    case "delver":
      return v > -0.92 && Math.abs(u) <= ((v + 0.92) / 1.84) * 0.98;
    // Hexagon: broad, flat-sided, reads as a solid block.
    case "warden": {
      const angle = Math.atan2(v, u);
      const sector = (((angle % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6;
      return Math.hypot(u, v) <= (0.94 * Math.cos(Math.PI / 6)) / Math.cos(sector);
    }
    // Downward triangle: inverts the delver, and orientation is one of the few
    // cues that survives downscaling. A four-point star was tried first and
    // measured 0.79 mask overlap with the resource diamond -- same family, both
    // centred and pointy. Inverting instead drops worst-case overlap to 0.53.
    case "hazard":
      return v < 0.92 && Math.abs(u) <= ((0.92 - v) / 1.84) * 0.98;
    // Small diamond. Deliberately tighter than the warden hexagon: at 12px a
    // hexagon is a disc, so the resource has to differ in area as well as edges.
    case "resource":
      return Math.abs(u) + Math.abs(v) <= 0.7;
    default:
      return false;
  }
}

function clampSize(size) {
  const requested = Number(size);
  if (!Number.isFinite(requested) || requested <= 0) return ENTITY_SPRITE_CANONICAL_SIZE;
  return Math.max(MIN_SIZE, Math.round(requested));
}

/**
 * Compose one sprite.
 *
 * @param {{ state?: EntitySpriteState, entity?: unknown, size?: number }} input
 * @returns {Uint8ClampedArray} RGBA, `size * size * 4` bytes.
 */
export function composeEntitySprite({ state, entity, size } = {}) {
  const resolved = state && typeof state === "object"
    ? normalizeEntitySpriteState(state)
    : normalizeEntitySpriteState(entity);
  const dim = clampSize(size);
  const fillHex = AFFINITY_COLOR_HEX[resolved.affinity] || AFFINITY_COLOR_HEX[DEFAULT_AFFINITY];
  const fill = hexToRgba(fillHex, 255);
  const outline = hexToRgba(outlineForFill(fillHex), 255);
  const pixels = new Uint8ClampedArray(dim * dim * 4);

  // Pass 1 -- solid fill wherever the silhouette covers.
  const inside = new Uint8Array(dim * dim);
  for (let y = 0; y < dim; y += 1) {
    for (let x = 0; x < dim; x += 1) {
      const u = ((x + 0.5) / dim) * 2 - 1;
      const v = ((y + 0.5) / dim) * 2 - 1;
      if (!isInsideShape(resolved.role, u, v)) continue;
      inside[y * dim + x] = 1;
      const i = (y * dim + x) * 4;
      pixels[i] = fill[0];
      pixels[i + 1] = fill[1];
      pixels[i + 2] = fill[2];
      pixels[i + 3] = 255;
    }
  }

  // Pass 2 -- overwrite the boundary with the constant outline. Done as a second
  // pass so outline width does not depend on scan order.
  for (let y = 0; y < dim; y += 1) {
    for (let x = 0; x < dim; x += 1) {
      if (!inside[y * dim + x]) continue;
      const edge = (
        x === 0 || y === 0 || x === dim - 1 || y === dim - 1 ||
        !inside[y * dim + (x - 1)] || !inside[y * dim + (x + 1)] ||
        !inside[(y - 1) * dim + x] || !inside[(y + 1) * dim + x]
      );
      if (!edge) continue;
      const i = (y * dim + x) * 4;
      pixels[i] = outline[0];
      pixels[i + 1] = outline[1];
      pixels[i + 2] = outline[2];
      pixels[i + 3] = outline[3];
    }
  }

  return pixels;
}

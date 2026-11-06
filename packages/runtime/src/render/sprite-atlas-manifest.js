/**
 * Sprite atlas manifest (#735 sub-issue 10): which atlas frame draws which game thing.
 *
 * Visual semantics live in runtime; the UI loads one spritesheet PNG plus its Aseprite JSON
 * and asks `resolveSpriteFrame` what to draw. Pure data and functions, no IO.
 *
 * Frame names are `<category>/<kind>[/<variant>]`. Every key has a status:
 *   final        – art approved for play
 *   recoloured   – bought pack art recoloured to the ten affinities, awaiting full pass
 *   placeholder  – no real art yet; resolves to the category placeholder frame
 * Swapping art is a status/frame edit here, never a UI change.
 *
 * @module sprite-atlas-manifest
 */

import { GAME_AFFINITY_KINDS, GAME_VITAL_KEYS } from "../contracts/game-elements.js";

export const SPRITE_ATLAS_SCHEMA = "agent-kernel/SpriteAtlasManifest";
export const SPRITE_ATLAS_SCHEMA_VERSION = 1;
export const SPRITE_ATLAS_TILE_SIZE = 32;
/** Default atlas files the UI loads (spritesheet PNG + Aseprite JSON export). */
export const SPRITE_ATLAS_FILES = Object.freeze({ image: "deepward-32.png", data: "deepward-32.json" });

export const SPRITE_ATLAS_TILE_KINDS = Object.freeze([
  "floor", "wall", "barrier", "exit", "spawn", "inaccessible", "fog", "door", "stairs-down", "stairs-up",
]);
export const SPRITE_ATLAS_ACTOR_ROLES = Object.freeze(["delver", "warden"]);

/** Tile kinds with recoloured pack art so far (dd-recolour-test). Everything else is a placeholder. */
const RECOLOURED_TILES = new Set(["floor", "stairs-down", "stairs-up"]);
/** Actor art is the pre-pack 32px set; Darren is replacing it, so it stays placeholder-status. */
const STATUS_BY_CATEGORY = Object.freeze({ actor: "placeholder", hazard: "recoloured", "resource/affinity": "recoloured", "resource/vital": "placeholder" });

export function placeholderFrame(category) {
  return `placeholder/${category}`;
}

function entry(frame, status, category) {
  return Object.freeze({ frame, status, fallback: placeholderFrame(category) });
}

function buildEntries() {
  const entries = {};
  for (const kind of SPRITE_ATLAS_TILE_KINDS) {
    const status = RECOLOURED_TILES.has(kind) ? "recoloured" : "placeholder";
    entries[`tile/${kind}`] = entry(`tile/${kind}`, status, "tile");
  }
  for (const role of SPRITE_ATLAS_ACTOR_ROLES) {
    for (const affinity of GAME_AFFINITY_KINDS) {
      entries[`${role}/${affinity}`] = entry(`actor/${role}/${affinity}`, STATUS_BY_CATEGORY.actor, "actor");
    }
  }
  for (const affinity of GAME_AFFINITY_KINDS) {
    entries[`hazard/${affinity}`] = entry(`hazard/${affinity}`, STATUS_BY_CATEGORY.hazard, "hazard");
    // Resource yielding an affinity: the orb, recoloured per affinity.
    entries[`resource/affinity/${affinity}`] = entry(`resource/affinity/${affinity}`, STATUS_BY_CATEGORY["resource/affinity"], "resource");
  }
  for (const vital of GAME_VITAL_KEYS) {
    // Resource yielding a vital: its own variant, so a player can tell vital from affinity at a glance.
    entries[`resource/vital/${vital}`] = entry(`resource/vital/${vital}`, STATUS_BY_CATEGORY["resource/vital"], "resource");
  }
  entries["resource/chest"] = entry("resource/chest", "recoloured", "resource");
  return Object.freeze(entries);
}

export const SPRITE_ATLAS_ENTRIES = buildEntries();

export function spriteAtlasManifest() {
  return {
    schema: SPRITE_ATLAS_SCHEMA,
    schemaVersion: SPRITE_ATLAS_SCHEMA_VERSION,
    meta: { producedBy: "runtime/render" },
    tileSize: SPRITE_ATLAS_TILE_SIZE,
    files: { ...SPRITE_ATLAS_FILES },
    entries: SPRITE_ATLAS_ENTRIES,
  };
}

/**
 * Semantic key for a thing on the board. Unknown input returns "" (caller draws nothing).
 * descriptor: { tile } | { role: "delver"|"warden", affinity } | { role:"hazard", affinity }
 *   | { role:"resource", yields: "affinity"|"vital", affinity?, vital? } | { role:"resource", chest:true }
 */
export function spriteKeyFor(descriptor = {}) {
  if (descriptor.tile) return `tile/${descriptor.tile}`;
  const { role, affinity } = descriptor;
  if (role === "delver" || role === "warden" || role === "hazard") return `${role}/${affinity}`;
  if (role === "resource") {
    if (descriptor.chest) return "resource/chest";
    if (descriptor.yields === "vital") return `resource/vital/${descriptor.vital}`;
    if (descriptor.yields === "affinity") return `resource/affinity/${affinity}`;
  }
  return "";
}

/**
 * Resolve a descriptor to the frame to draw. `frames` (optional) is the set/array/Aseprite-JSON
 * `frames` of the loaded atlas; a frame missing from the atlas falls back to the category
 * placeholder, so a half-finished sheet never breaks the board.
 * Returns { key, frame, status } or null for an unknown key.
 */
export function resolveSpriteFrame(descriptor, frames) {
  const key = spriteKeyFor(descriptor);
  const item = SPRITE_ATLAS_ENTRIES[key];
  if (!item) return null;
  const names = frames ? frameNameSet(frames) : null;
  if (item.status === "placeholder" || (names && !names.has(item.frame))) {
    return { key, frame: item.fallback, status: "placeholder" };
  }
  return { key, frame: item.frame, status: item.status };
}

/** Frame names from an Aseprite JSON export (hash or array form), a Set, or an array of names. */
export function frameNameSet(frames) {
  if (frames instanceof Set) return frames;
  const source = frames && !Array.isArray(frames) && frames.frames ? frames.frames : frames;
  if (Array.isArray(source)) return new Set(source.map((f) => (typeof f === "string" ? f : f?.filename)).filter(Boolean));
  return new Set(Object.keys(source || {}));
}

/** What the loaded atlas still lacks: keys per status plus frames the manifest expects but the sheet omits. */
export function spriteAtlasCoverage(atlasJson) {
  const names = frameNameSet(atlasJson);
  const out = { final: [], recoloured: [], placeholder: [], missingFrames: [] };
  for (const [key, item] of Object.entries(SPRITE_ATLAS_ENTRIES)) {
    const present = item.status === "placeholder" || names.has(item.frame);
    if (!present) out.missingFrames.push(item.frame);
    out[present ? item.status : "placeholder"].push(key);
  }
  return out;
}

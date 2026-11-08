/**
 * Element art resolver (#768): game meaning -> drawable art, through the ResourceBundle only.
 *
 * A client describes a thing the way the board and HUD already do (a tile kind, a role plus
 * affinity, a resource and what it yields) and gets back the bundle asset to draw. It never
 * builds a path or keeps its own id map: dressing the bundle (`dressResourceBundle`) swaps the
 * art with no client change. Art that cannot be resolved is reported `missing`, never replaced
 * with a guess. Pure functions over a bundle, no IO.
 *
 * status: "painted" (dressed art) | "procedural" (framework default) | "missing".
 *
 * @module element-art
 */

import { GAME_AFFINITY_KINDS, GAME_VITAL_KEYS } from "../contracts/game-vocabulary.js";

const MISSING = Object.freeze({ key: "", assetId: null, status: "missing", dataUri: null, relativePath: null, width: null, height: null });

/** Stable element key, shared by resolution and coverage. "" when the descriptor says nothing. */
export function elementKeyFor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") return "";
  if (descriptor.tile) return `tile/${descriptor.tile}`;
  const { role, affinity } = descriptor;
  if (role === "delver" || role === "warden") return affinity ? `${role}/${affinity}` : role;
  if (role === "hazard") return "hazard";
  if (role === "resource") {
    if (descriptor.yields === "vital") return descriptor.vital ? `resource/vital/${descriptor.vital}` : "";
    if (descriptor.yields === "affinity") return affinity ? `resource/affinity/${affinity}` : "";
    return "resource";
  }
  return "";
}

function assetIdFor(bundle, descriptor) {
  const m = bundle?.mappings || {};
  if (descriptor.tile) return m.tiles?.[descriptor.tile] ?? null;
  const { role, affinity } = descriptor;
  if (role === "delver" || role === "warden") {
    if (!affinity) return m.actors?.[role] ?? null;
    return m.actors?.byRoleAndAffinity?.[role]?.[affinity] ?? null;
  }
  if (role === "hazard") return m.items?.hazard ?? null;
  if (role === "resource") {
    if (descriptor.yields === "vital") return m.icons?.vitals?.[descriptor.vital] ?? null;
    if (descriptor.yields === "affinity") return m.icons?.affinities?.[affinity] ?? null;
    return m.items?.resource ?? null;
  }
  return null;
}

/** Resolve a descriptor to `{ key, assetId, status, dataUri, relativePath, width, height }`. */
export function resolveElementArt(bundle, descriptor) {
  const key = elementKeyFor(descriptor);
  if (!key) return MISSING;
  const assetId = assetIdFor(bundle, descriptor);
  const asset = assetId ? (bundle.assets || []).find((candidate) => candidate?.id === assetId) : null;
  if (!asset || typeof asset.dataUri !== "string") return { ...MISSING, key };
  return {
    key,
    assetId,
    status: asset.origin === "painted" ? "painted" : "procedural",
    dataUri: asset.dataUri,
    relativePath: asset.relativePath ?? null,
    width: asset.width,
    height: asset.height,
  };
}

function everyDescriptor(bundle) {
  const list = [];
  for (const tile of Object.keys(bundle?.mappings?.tiles || {})) list.push({ tile });
  for (const tile of ["floor", "wall", "barrier", "spawn", "exit", "inaccessible", "fog"]) {
    if (!(tile in (bundle?.mappings?.tiles || {}))) list.push({ tile });
  }
  for (const role of ["delver", "warden"]) {
    for (const affinity of GAME_AFFINITY_KINDS) list.push({ role, affinity });
  }
  list.push({ role: "hazard" }, { role: "resource" });
  for (const affinity of GAME_AFFINITY_KINDS) list.push({ role: "resource", yields: "affinity", affinity });
  for (const vital of GAME_VITAL_KEYS) list.push({ role: "resource", yields: "vital", vital });
  return list;
}

/** Which elements still lack final art: `{ painted, procedural, missing }`, each a list of element keys. */
export function elementArtCoverage(bundle) {
  const out = { painted: [], procedural: [], missing: [] };
  const seen = new Set();
  for (const descriptor of everyDescriptor(bundle)) {
    const result = resolveElementArt(bundle, descriptor);
    const key = result.key || elementKeyFor(descriptor);
    if (seen.has(key)) continue;
    seen.add(key);
    out[result.status].push(key);
  }
  return out;
}

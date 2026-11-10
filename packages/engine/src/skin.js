/**
 * `@agon-engine/engine/skin` (#828): what a game dresses the engine in. The palette and element
 * visuals, board sprite pixels, and the resource bundle with its dressing and element art.
 * Re-exports only.
 */
export * from "../../runtime/src/contracts/game-elements.js";
export * from "../../runtime/src/render/entity-sprite-composer.js";
export {
  RESOURCE_BUNDLE_DRESSING_SCHEMA, RESOURCE_BUNDLE_SCHEMA, createDefaultResourceBundleArtifact, dressResourceBundle,
  elementArtCoverage, elementKeyFor, listResourceBundleAssetFiles, resolveElementArt, validateResourceBundleArtifact,
  validateResourceBundleDressing,
} from "../../runtime/src/render/client-surface.js";

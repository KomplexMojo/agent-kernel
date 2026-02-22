import {
  buildLevelPreviewFromGuidanceSummary,
  buildLevelPreviewFromLevelGen,
  buildLevelRenderArtifactsFromTiles,
} from "../../../../runtime/src/personas/configurator/guidance-level-builder.js";

function serializeError(error) {
  if (!error) return { message: "Unknown worker error" };
  if (typeof error === "string") return { message: error };
  return {
    message: error.message || String(error),
    name: error.name || "Error",
    stack: error.stack || undefined,
  };
}

function postResult(id, result) {
  const pixels = result?.image?.pixels;
  if (pixels instanceof Uint8ClampedArray && pixels.buffer instanceof ArrayBuffer) {
    self.postMessage({ id, ok: true, result }, [pixels.buffer]);
    return;
  }
  self.postMessage({ id, ok: true, result });
}

self.addEventListener("message", (event) => {
  const payload = event?.data || {};
  const { id, action, summary, levelGen, tiles, renderOptions } = payload;
  if (!id) {
    return;
  }
  try {
    let result = null;
    if (action === "build_from_guidance") {
      result = buildLevelPreviewFromGuidanceSummary(summary, renderOptions);
    } else if (action === "build_from_level_gen") {
      result = buildLevelPreviewFromLevelGen(levelGen, renderOptions);
    } else if (action === "build_from_tiles") {
      result = buildLevelRenderArtifactsFromTiles(tiles, renderOptions);
    } else if (action === "regenerate_level") {
      if (Array.isArray(tiles) && tiles.length > 0) {
        result = buildLevelRenderArtifactsFromTiles(tiles, renderOptions);
      } else if (levelGen && typeof levelGen === "object") {
        result = buildLevelPreviewFromLevelGen(levelGen, renderOptions);
      } else {
        result = buildLevelPreviewFromGuidanceSummary(summary, renderOptions);
      }
    } else {
      return;
    }
    postResult(id, result);
  } catch (error) {
    self.postMessage({ id, ok: false, error: serializeError(error) });
  }
});

// CR.7 / WP-5 — level preview rendering is Configurator geometry, taken from the persona's
// PUBLIC surface. An adapter owns the IO around a preview, not the geometry inside it.
import { createConfiguratorPersona } from "../../../../runtime/src/personas/configurator/persona.js";
import { UNUSED_CLOCK } from "../../../../runtime/src/personas/_shared/require-clock.js";

const {
  buildLevelPreviewFromGuidanceSummary,
  buildLevelPreviewFromLevelGen,
  buildLevelRenderArtifactsFromTiles,
} = createConfiguratorPersona({ clock: UNUSED_CLOCK });
import { createDirectorPersona } from "../../../../runtime/src/personas/director/persona.js";

// D8.1 — the Director derives level geometry; the Configurator consumes it.
//
// Glue may hold a persona's PUBLIC barrel, so the adapter constructs a Director and passes
// its `deriveLevelGen` down. `guidance-level-builder.js` used to reach into
// `director/buildspec-assembler.js` itself, which was the one leg of the Director<->
// Configurator cycle pointing that way.
//
// Ungated and stateless on purpose: a preview is not a build round, so no `beginBuild` is
// opened here. UNUSED_CLOCK is safe because nothing on this path stamps an artifact.
const DIRECTOR_LEVEL_GEN = createDirectorPersona({ clock: () => "1970-01-01T00:00:00.000Z" }).deriveLevelGen;

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
      result = buildLevelPreviewFromGuidanceSummary(summary, {
        ...renderOptions,
        // D8.1: level geometry is the Director's to derive; glue asks it on the
        // Configurator's behalf rather than the Configurator importing it.
        deriveLevelGen: DIRECTOR_LEVEL_GEN,
      });
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
        result = buildLevelPreviewFromGuidanceSummary(summary, {
          ...renderOptions,
          deriveLevelGen: DIRECTOR_LEVEL_GEN,
        });
      }
    } else {
      return;
    }
    postResult(id, result);
  } catch (error) {
    self.postMessage({ id, ok: false, error: serializeError(error) });
  }
});

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

function resolvePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

function createInProcessLevelBuilderAdapter() {
  return {
    async buildFromGuidance({ summary, renderOptions } = {}) {
      return buildLevelPreviewFromGuidanceSummary(summary, {
        ...renderOptions,
        // D8.1: level geometry is the Director's to derive; glue asks it on the
        // Configurator's behalf rather than the Configurator importing it.
        deriveLevelGen: DIRECTOR_LEVEL_GEN,
      });
    },
    async buildFromLevelGen({ levelGen, renderOptions } = {}) {
      return buildLevelPreviewFromLevelGen(levelGen, renderOptions);
    },
    async buildFromTiles({ tiles, renderOptions } = {}) {
      return buildLevelRenderArtifactsFromTiles(tiles, renderOptions);
    },
    async regenerateLevel({ summary, levelGen, tiles, renderOptions } = {}) {
      if (Array.isArray(tiles) && tiles.length > 0) {
        return buildLevelRenderArtifactsFromTiles(tiles, renderOptions);
      }
      if (levelGen && typeof levelGen === "object") {
        return buildLevelPreviewFromLevelGen(levelGen, renderOptions);
      }
      return buildLevelPreviewFromGuidanceSummary(summary, {
        ...renderOptions,
        // D8.1: level geometry is the Director's to derive; glue asks it on the
        // Configurator's behalf rather than the Configurator importing it.
        deriveLevelGen: DIRECTOR_LEVEL_GEN,
      });
    },
    dispose() {},
  };
}

export function createLevelBuilderAdapter({
  workerFactory,
  workerUrl,
  requestTimeoutMs = 120000,
  forceInProcess = false,
} = {}) {
  const timeoutMs = resolvePositiveInt(requestTimeoutMs);
  const shouldUseWorker = !forceInProcess && typeof Worker === "function";
  if (!shouldUseWorker) {
    return createInProcessLevelBuilderAdapter();
  }

  let worker = null;
  try {
    worker = typeof workerFactory === "function"
      ? workerFactory()
      : new Worker(workerUrl || new URL("./worker.js", import.meta.url), { type: "module" });
  } catch (error) {
    return createInProcessLevelBuilderAdapter();
  }
  const pending = new Map();
  let nextId = 1;

  worker.addEventListener("message", (event) => {
    const payload = event?.data || {};
    const id = payload?.id;
    if (!id || !pending.has(id)) return;
    const entry = pending.get(id);
    pending.delete(id);
    if (entry?.timeoutHandle) {
      clearTimeout(entry.timeoutHandle);
    }
    if (payload.ok === false) {
      const message = payload?.error?.message || "Level builder worker failed";
      entry.reject(new Error(message));
      return;
    }
    entry.resolve(payload.result);
  });
  worker.addEventListener("error", (event) => {
    const message = event?.message || "Level builder worker failed";
    pending.forEach((entry) => {
      if (entry?.timeoutHandle) {
        clearTimeout(entry.timeoutHandle);
      }
      entry.reject(new Error(message));
    });
    pending.clear();
  });

  function runWorkerRequest({ action, summary, levelGen, tiles, renderOptions } = {}) {
    const id = `level_builder_${nextId}`;
    nextId += 1;
    return new Promise((resolve, reject) => {
      let timeoutHandle = null;
      if (timeoutMs) {
        timeoutHandle = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`Level builder request timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      }
      pending.set(id, { resolve, reject, timeoutHandle });
      worker.postMessage({
        id,
        action,
        summary,
        levelGen,
        tiles,
        renderOptions,
      });
    });
  }

  return {
    async buildFromGuidance({ summary, renderOptions } = {}) {
      return runWorkerRequest({ action: "build_from_guidance", summary, renderOptions });
    },
    async buildFromLevelGen({ levelGen, renderOptions } = {}) {
      return runWorkerRequest({ action: "build_from_level_gen", levelGen, renderOptions });
    },
    async buildFromTiles({ tiles, renderOptions } = {}) {
      return runWorkerRequest({ action: "build_from_tiles", tiles, renderOptions });
    },
    async regenerateLevel({ summary, levelGen, tiles, renderOptions } = {}) {
      return runWorkerRequest({
        action: "regenerate_level",
        summary,
        levelGen,
        tiles,
        renderOptions,
      });
    },
    dispose() {
      pending.forEach((entry) => {
        if (entry?.timeoutHandle) {
          clearTimeout(entry.timeoutHandle);
        }
        entry.reject(new Error("Level builder adapter disposed"));
      });
      pending.clear();
      worker.terminate();
    },
  };
}

import {
  buildLevelPreviewFromGuidanceSummary,
  buildLevelPreviewFromLevelGen,
  buildLevelRenderArtifactsFromTiles,
} from "../../../../runtime/src/personas/configurator/guidance-level-builder.js";

function resolvePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

function createInProcessLevelBuilderAdapter() {
  return {
    async buildFromGuidance({ summary, renderOptions } = {}) {
      return buildLevelPreviewFromGuidanceSummary(summary, renderOptions);
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
      return buildLevelPreviewFromGuidanceSummary(summary, renderOptions);
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

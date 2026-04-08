import { loadCore } from "../../../bindings-ts/src/core-as.js";
import { readObservation, renderBaseTiles, renderFrameBuffer } from "../../../bindings-ts/src/mvp-movement.js";
import { applyInitialStateToCore, applySimConfigToCore } from "../../../runtime/src/runner/core-setup.mjs";
import { LEVEL_PREVIEW_IMAGE_PIXEL_FORMAT } from "../../../runtime/src/personas/configurator/guidance-level-builder.js";
import { createLevelBuilderAdapter } from "../../../adapters-web/src/adapters/level-builder/index.js";
import { collectBuildSpecCardSet } from "../build-spec-ui.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const REQUIRED_PREVIEW_CARD_TYPES = Object.freeze(["room", "delver", "warden"]);
const DEFAULT_PREVIEW_HELP_TEXT = "Inspect the current design bundle here. When ready, use Build And Load Game to open Run.";

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}

function setStatus(el, message, level = "info") {
  if (!el) return;
  el.textContent = message;
  if (el.dataset) {
    el.dataset.level = level === "error" ? "error" : "info";
  }
}

function sortActors(actors = []) {
  return Array.isArray(actors)
    ? actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")))
    : [];
}

function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((artifact) => artifact?.schema === schema) || null;
}

function normalizeCardTypeName(type) {
  const normalized = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (normalized === "attacker") return "delver";
  if (normalized === "defender") return "warden";
  return normalized;
}

function readConfiguredCount(count) {
  const parsed = Number(count);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function formatMissingCardTypes(types = []) {
  return types.map((type) => {
    if (type === "room") return "room";
    if (type === "delver") return "delver";
    if (type === "warden") return "warden";
    return type;
  }).join(", ");
}

export function validatePreviewLaunchBundle(bundle) {
  const cardSet = collectBuildSpecCardSet(bundle?.spec);
  if (cardSet.length === 0) {
    return {
      ok: false,
      reason: "missing_card_set",
      message: "Build blocked: preview bundle is missing the authored card set.",
    };
  }

  const counts = REQUIRED_PREVIEW_CARD_TYPES.reduce((acc, type) => {
    acc[type] = 0;
    return acc;
  }, {});

  cardSet.forEach((entry) => {
    const type = normalizeCardTypeName(entry?.type);
    if (!REQUIRED_PREVIEW_CARD_TYPES.includes(type)) return;
    counts[type] += readConfiguredCount(entry?.count ?? 1);
  });

  const missing = REQUIRED_PREVIEW_CARD_TYPES.filter((type) => counts[type] <= 0);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "missing_required_types",
      missing,
      counts,
      message: `Build blocked: configure at least 1 room, 1 delver, and 1 warden before loading the run. Missing: ${formatMissingCardTypes(missing)}.`,
    };
  }

  return { ok: true, counts };
}

function summarizeVitals(vitals = {}) {
  const health = vitals?.health || { current: 0, max: 0 };
  const mana = vitals?.mana || { current: 0, max: 0 };
  const stamina = vitals?.stamina || { current: 0, max: 0 };
  const durability = vitals?.durability || { current: 0, max: 0 };
  return `hp ${health.current}/${health.max} mana ${mana.current}/${mana.max} sta ${stamina.current}/${stamina.max} dur ${durability.current}/${durability.max}`;
}

function summarizeActor(actor) {
  const id = String(actor?.id || "actor");
  const x = Number.isFinite(actor?.position?.x) ? actor.position.x : 0;
  const y = Number.isFinite(actor?.position?.y) ? actor.position.y : 0;
  return `${id} @(${x},${y}) ${summarizeVitals(actor?.vitals)}`;
}

function summarizePreview(simConfig, initialState) {
  const width = Number.isFinite(simConfig?.layout?.data?.width) ? simConfig.layout.data.width : 0;
  const height = Number.isFinite(simConfig?.layout?.data?.height) ? simConfig.layout.data.height : 0;
  const roomCount = Array.isArray(simConfig?.layout?.data?.rooms) ? simConfig.layout.data.rooms.length : 0;
  const actorCount = Array.isArray(initialState?.actors) ? initialState.actors.length : 0;
  const parts = [];
  if (width > 0 && height > 0) parts.push(`Map ${width}x${height}`);
  parts.push(`Rooms ${roomCount}`);
  parts.push(`Actors ${actorCount}`);
  return parts.join(" · ");
}

function clearCanvas(canvas) {
  const context = canvas?.getContext?.("2d");
  if (!context || !canvas) return;
  context.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
}

function isRenderablePreviewImage(image) {
  if (!image || typeof image !== "object") return false;
  if (image.pixelFormat !== LEVEL_PREVIEW_IMAGE_PIXEL_FORMAT) return false;
  if (!Number.isFinite(image.width) || image.width <= 0) return false;
  if (!Number.isFinite(image.height) || image.height <= 0) return false;
  if (!(image.pixels instanceof Uint8ClampedArray)) return false;
  return image.pixels.length === image.width * image.height * 4;
}

function renderPreviewImageToCanvas(canvas, image) {
  if (!canvas || !isRenderablePreviewImage(image)) return false;
  const context = canvas.getContext?.("2d");
  if (!context || typeof context.createImageData !== "function" || typeof context.putImageData !== "function") {
    return false;
  }
  canvas.width = image.width;
  canvas.height = image.height;
  const imageData = context.createImageData(image.width, image.height);
  imageData.data.set(image.pixels);
  context.putImageData(imageData, 0, 0);
  return true;
}

export function wirePreviewView({
  root = document,
  loadCoreFn = loadCore,
  applySimConfig = applySimConfigToCore,
  applyInitialState = applyInitialStateToCore,
  renderFrame = renderFrameBuffer,
  renderBase = renderBaseTiles,
  readObservationFn = readObservation,
  levelBuilderAdapter = null,
  onBuildAndLoadGame,
} = {}) {
  const buildButton = root.querySelector("#preview-build-and-load");
  const canvasEl = root.querySelector("#preview-render-canvas");
  const frameEl = root.querySelector("#preview-frame-buffer");
  const statusEl = root.querySelector("#preview-status");
  const summaryEl = root.querySelector("#preview-summary");
  const actorsEl = root.querySelector("#preview-actor-list");

  const wasmUrl = new URL("../../assets/core-as.wasm", import.meta.url);
  let core = null;
  let loadingCore = null;
  let lastBundle = null;
  let buildingGame = false;
  let levelBuilder = levelBuilderAdapter;
  let renderRequestId = 0;

  function ensureLevelBuilder() {
    if (levelBuilder) return levelBuilder;
    levelBuilder = createLevelBuilderAdapter({ forceInProcess: typeof Worker !== "function" });
    return levelBuilder;
  }

  function showAsciiFrame() {
    if (canvasEl) {
      clearCanvas(canvasEl);
      canvasEl.hidden = true;
    }
    if (frameEl) {
      frameEl.hidden = false;
    }
  }

  async function renderPreviewImage({ tiles = [], floorAffinityTraps = [] } = {}) {
    if (!canvasEl || !Array.isArray(tiles) || tiles.length === 0) {
      showAsciiFrame();
      return false;
    }
    try {
      const requestId = ++renderRequestId;
      const result = await ensureLevelBuilder().buildFromTiles({
        tiles,
        renderOptions: {
          includeAscii: false,
          includeImage: true,
          floorAffinityTraps,
        },
      });
      if (requestId !== renderRequestId) {
        return false;
      }
      const rendered = renderPreviewImageToCanvas(canvasEl, result?.image);
      if (!rendered) {
        showAsciiFrame();
        return false;
      }
      canvasEl.hidden = false;
      if (frameEl) {
        frameEl.hidden = true;
      }
      return true;
    } catch (_error) {
      showAsciiFrame();
      return false;
    }
  }

  async function ensureCore() {
    if (core) return core;
    if (!loadingCore) {
      setStatus(statusEl, "Loading preview engine...");
      loadingCore = Promise.resolve(loadCoreFn({ wasmUrl }))
        .then((loaded) => {
          core = loaded;
          return loaded;
        })
        .finally(() => {
          loadingCore = null;
        });
    }
    return loadingCore;
  }

  function clearPreview(
    message = DEFAULT_PREVIEW_HELP_TEXT,
    level = "info",
  ) {
    lastBundle = null;
    renderRequestId += 1;
    showAsciiFrame();
    setText(frameEl, "No preview loaded.");
    setText(summaryEl, "No preview bundle loaded.");
    setText(actorsEl, "No actors loaded.");
    setStatus(statusEl, message, level);
  }

  async function buildAndLoadGame() {
    if (buildingGame) return { ok: false, reason: "busy" };
    if (typeof onBuildAndLoadGame !== "function") {
      const message = "Build action unavailable.";
      setText(statusEl, message);
      return { ok: false, reason: "missing_handler", message };
    }
    buildingGame = true;
    if (buildButton) buildButton.disabled = true;
    setStatus(statusEl, "Building game from Preview...");

    try {
      const result = await onBuildAndLoadGame?.();
      if (result?.ok === false) {
        setStatus(statusEl, result.message || "Build failed. Check Diagnostics for details.", "error");
        return result;
      }
      setStatus(statusEl, result?.message || "Run loaded from Preview.");
      return { ok: true };
    } catch (error) {
      const message = error?.message || String(error);
      setStatus(statusEl, `Build failed: ${message}`, "error");
      return { ok: false, reason: "build_failed", message };
    } finally {
      buildingGame = false;
      if (buildButton) buildButton.disabled = false;
    }
  }

  async function loadBundle(bundle, { source = "bundle" } = {}) {
    if (!bundle) {
      clearPreview();
      return false;
    }

    const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
    if (!simConfig) {
      clearPreview("Bundle missing SimConfigArtifact.", "error");
      return false;
    }
    const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA) || { actors: [] };

    lastBundle = bundle;

    try {
      const runtimeCore = await ensureCore();
      const seed = Number.isFinite(simConfig?.seed) ? simConfig.seed : 0;
      runtimeCore.init?.(seed);

      const layoutResult = applySimConfig(runtimeCore, simConfig);
      if (!layoutResult?.ok) {
        clearPreview(`Preview failed: invalid layout (${layoutResult?.reason || "unknown"}).`, "error");
        return false;
      }

      const sortedActors = sortActors(initialState?.actors);
      const hasActors = sortedActors.length > 0;
      let actorResult = null;
      let actorIdLabel = "actor_preview";
      let actorIds = [];
      if (hasActors) {
        actorIds = sortedActors.map((actor) => actor.id).filter(Boolean);
        actorIdLabel = actorIds[0] || actorIdLabel;
        actorResult = applyInitialState(runtimeCore, initialState, { spawn: layoutResult.spawn });
        if (!actorResult?.ok) {
          clearPreview(`Preview failed: invalid actors (${actorResult?.reason || "unknown"}).`, "error");
          return false;
        }
      }

      const baseTiles = renderBase(runtimeCore);
      const frame = hasActors
        ? renderFrame(runtimeCore, { actorIdLabel })
        : {
          tick: 0,
          baseTiles,
          buffer: baseTiles,
        };
      const observation = hasActors
        ? readObservationFn(runtimeCore, { actorIdLabel, actorIds })
        : { actors: [] };
      const previewTiles = Array.isArray(frame?.baseTiles) && frame.baseTiles.length > 0
        ? frame.baseTiles
        : baseTiles;

      setText(frameEl, Array.isArray(frame?.buffer) ? frame.buffer.join("\n") : "No preview frame available.");
      await renderPreviewImage({
        tiles: previewTiles,
        floorAffinityTraps: Array.isArray(simConfig?.layout?.data?.traps) ? simConfig.layout.data.traps : [],
      });
      setText(summaryEl, summarizePreview(simConfig, initialState));
      setText(
        actorsEl,
        hasActors
          ? sortActors(observation?.actors).map(summarizeActor).join("\n")
          : "Layout-only preview (no actors in initial state).",
      );
      setStatus(
        statusEl,
        hasActors
          ? `Preview loaded from ${source}.`
          : `Layout preview loaded from ${source}.`,
      );
      return true;
    } catch (error) {
      clearPreview(`Preview failed: ${error?.message || String(error)}`, "error");
      return false;
    }
  }

  buildButton?.addEventListener?.("click", () => {
    void buildAndLoadGame();
  });

  clearPreview();

  return {
    buildAndLoadGame,
    loadBundle,
    clear: clearPreview,
    getLastBundle: () => lastBundle,
    dispose() {
      if (levelBuilder && typeof levelBuilder.dispose === "function" && levelBuilder !== levelBuilderAdapter) {
        levelBuilder.dispose();
      }
      levelBuilder = levelBuilderAdapter;
    },
  };
}

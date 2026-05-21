import { loadCore } from "../../../bindings-ts/src/core-as.js";
import { readObservation, renderBaseTiles, renderFrameBuffer } from "../../../bindings-ts/src/mvp-movement.js";
import { applyInitialStateToCore, applySimConfigToCore } from "../../../runtime/src/runner/core-setup.mjs";
import { collectBuildSpecCardSet } from "../build-spec-ui.js";
import { computeAuraMap, serializeAuraMap } from "../../../runtime/src/render/affinity-aura.js";
import { SPATIAL_WEIGHTS, INTERACTION_MATRIX } from "../../../runtime/src/contracts/affinity-spatial-rules.js";
import { AFFINITY_OPPOSITES } from "../../../runtime/src/contracts/domain-constants.js";
import { deriveTileAffinityVisuals } from "./tile-affinity-visuals.js";
import {
  createCanvasPreviewRenderer,
  createPhaserPreviewRenderer,
  readPreviewRendererPreference,
  normalizePreviewRendererId,
  writePreviewRendererPreference,
} from "./preview-renderers.js";
import { renderBundleBoardToCanvas } from "../resource-bundle-view.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";
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

export function wirePreviewView({
  root = document,
  loadCoreFn = loadCore,
  applySimConfig = applySimConfigToCore,
  applyInitialState = applyInitialStateToCore,
  renderFrame = renderFrameBuffer,
  renderBase = renderBaseTiles,
  readObservationFn = readObservation,
  renderBundleBoard = renderBundleBoardToCanvas,
  actorInspector = null,
  onBuildAndLoadGame,
  storage = globalThis.localStorage,
  createCanvasRenderer = createCanvasPreviewRenderer,
  createPhaserRenderer = createPhaserPreviewRenderer,
  buildTileAffinityVisualsFromBundleFn = null,
} = {}) {
  const buildButton = root.querySelector("#preview-build-and-load");
  const rendererHostEl = root.querySelector("#preview-renderer-host");
  const canvasEl = root.querySelector("#preview-render-canvas");
  const frameEl = root.querySelector("#preview-frame-buffer");
  const statusEl = root.querySelector("#preview-status");
  const summaryEl = root.querySelector("#preview-summary");
  const actorsEl = root.querySelector("#preview-actor-list");
  const rendererButtons = Array.from(root.querySelectorAll?.("[data-preview-renderer]") || []);

  const wasmUrl = new URL("../../assets/core-as.wasm", import.meta.url);
  let core = null;
  let loadingCore = null;
  let lastBundle = null;
  let buildingGame = false;
  let lastPreviewState = null;
  let activeRendererId = readPreviewRendererPreference(storage);
  let activeRenderer = null;

  const rendererFactories = {
    canvas: () => createCanvasRenderer({
      canvas: canvasEl,
      onSelect: handleBoardSelection,
      renderBundleBoard,
    }),
    phaser: () => createPhaserRenderer({
      onSelect: handleBoardSelection,
    }),
  };

  function updateRendererButtons() {
    rendererButtons.forEach((button) => {
      const isActive = normalizePreviewRendererId(button?.dataset?.previewRenderer) === activeRendererId;
      button.setAttribute?.("aria-pressed", isActive ? "true" : "false");
      button.dataset.active = isActive ? "true" : "false";
      if (button.classList?.toggle) {
        button.classList.toggle("active", isActive);
      }
    });
    const host = getRendererHost();
    if (host?.dataset) {
      host.dataset.activeRenderer = activeRendererId;
    }
  }

  function getRendererHost() {
    return rendererHostEl || canvasEl?.parentElement || frameEl?.parentElement || null;
  }

  async function ensureRenderer(rendererId = activeRendererId) {
    const nextId = normalizePreviewRendererId(rendererId);
    if (activeRenderer && activeRendererId === nextId) return activeRenderer;
    activeRenderer?.dispose?.();
    activeRendererId = nextId;
    const factory = rendererFactories[nextId] || rendererFactories.canvas;
    activeRenderer = factory?.() || null;
    activeRenderer?.mount?.(getRendererHost(), { canvas: canvasEl, frame: frameEl });
    updateRendererButtons();
    return activeRenderer;
  }

  function showAsciiFrame() {
    activeRenderer?.clear?.();
    if (canvasEl) clearCanvas(canvasEl);
    if (frameEl) {
      frameEl.hidden = false;
    }
  }

  async function renderPreviewBoard(previewState = null) {
    if (!previewState || !Array.isArray(previewState?.tiles) || previewState.tiles.length === 0) {
      showAsciiFrame();
      return false;
    }
    try {
      const renderer = await ensureRenderer(activeRendererId);
      const result = await renderer?.renderPreview?.(previewState);
      if (!result?.ok) {
        showAsciiFrame();
        return false;
      }
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
    lastPreviewState = null;
    showAsciiFrame();
    setText(frameEl, "No preview loaded.");
    setText(summaryEl, "No preview bundle loaded.");
    setText(actorsEl, "No actors loaded.");
    actorInspector?.setMode?.("preview");
    actorInspector?.setScenario?.({});
    actorInspector?.setActors?.([], { tick: null });
    actorInspector?.setRunning?.(false);
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

  async function setRenderer(rendererId, { rerender = true } = {}) {
    const normalized = writePreviewRendererPreference(storage, rendererId);
    await ensureRenderer(normalized);
    if (rerender && lastPreviewState?.boardState) {
      await renderPreviewBoard(lastPreviewState.boardState);
    }
    return normalized;
  }

  function handleBoardSelection(position) {
    if (!position) return null;
    const selected = actorInspector?.selectEntityAtPosition?.(position, { notify: true });
    if (!selected?.instanceId) return null;
    focusInspectorEntity(selected);
    return selected;
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
    const resourceBundle = findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA) || null;

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

      // Derive tile affinity visuals — prefer core field records via facade,
      // fall back to legacy JS aura computation (deprecated)
      if (typeof buildTileAffinityVisualsFromBundleFn === "function" && lastBundle) {
        observation.tileVisuals = buildTileAffinityVisualsFromBundleFn(lastBundle);
      } else if (observation && frame?.baseTiles && (Array.isArray(observation.actors) || Array.isArray(observation.traps))) {
        const actors = Array.isArray(observation.actors) ? observation.actors : [];
        const traps = Array.isArray(observation.traps) ? observation.traps : [];

        // Convert traps to pseudo-actors for legacy aura computation (deprecated path)
        const trapActors = traps.map((trap, index) => ({
          id: `trap_${index}`,
          x: trap.position?.x ?? 0,
          y: trap.position?.y ?? 0,
          affinities: trap.affinities || [],
        }));

        const allActors = [...actors, ...trapActors];
        const auraMap = computeAuraMap(allActors, frame.baseTiles, {
          affinityOpposites: AFFINITY_OPPOSITES,
          weights: SPATIAL_WEIGHTS,
        });
        observation.auras = serializeAuraMap(auraMap, INTERACTION_MATRIX, SPATIAL_WEIGHTS);

        // Also derive tile visuals from hazards for the hazard-based fallback
        const simConfig = findArtifact(lastBundle, SIM_CONFIG_SCHEMA);
        const resourceBundle = findArtifact(lastBundle, RESOURCE_BUNDLE_SCHEMA);
        const hazards = Array.isArray(simConfig?.layout?.data?.hazards) ? simConfig.layout.data.hazards : [];
        if (hazards.length > 0) {
          observation.tileVisuals = deriveTileAffinityVisuals({
            tiles: previewTiles,
            hazards,
            resourceBundle,
          });
        }
      }

      setText(frameEl, Array.isArray(frame?.buffer) ? frame.buffer.join("\n") : "No preview frame available.");
      const boardState = {
        bundle,
        resourceBundle,
        simConfig,
        initialState,
        tiles: previewTiles,
        actors: sortActors(observation?.actors),
        floorAffinityTraps: Array.isArray(simConfig?.layout?.data?.traps) ? simConfig.layout.data.traps : [],
        observation,
        boardWidth: previewTiles.reduce((max, row) => Math.max(max, String(row || "").length), 0),
        boardHeight: previewTiles.length,
      };
      await renderPreviewBoard(boardState);
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
      lastPreviewState = {
        bundle,
        source,
        hasActors,
        simConfig,
        initialState,
        observation,
        boardState,
      };
      actorInspector?.setMode?.("preview");
      actorInspector?.setResourceBundle?.(resourceBundle);
      actorInspector?.setScenario?.({ simConfig, initialState, spec: bundle?.spec || null });
      actorInspector?.setActors?.(observation?.actors || [], { tick: observation?.tick });
      actorInspector?.setRunning?.(false);
      return true;
    } catch (error) {
      clearPreview(`Preview failed: ${error?.message || String(error)}`, "error");
      return false;
    }
  }

  function focusInspectorEntity(entity) {
    if (!lastPreviewState) return null;
    if (entity?.instanceId) {
      setStatus(statusEl, `Preview selected: ${entity.instanceId}.`);
      return entity;
    }
    setStatus(
      statusEl,
      lastPreviewState.hasActors
        ? `Preview loaded from ${lastPreviewState.source}.`
        : `Layout preview loaded from ${lastPreviewState.source}.`,
    );
    return null;
  }

  buildButton?.addEventListener?.("click", () => {
    void buildAndLoadGame();
  });

  rendererButtons.forEach((button) => {
    button.addEventListener?.("click", () => {
      void setRenderer(button?.dataset?.previewRenderer);
    });
  });

  void ensureRenderer(activeRendererId);
  clearPreview();

  return {
    buildAndLoadGame,
    loadBundle,
    focusInspectorEntity,
    clear: clearPreview,
    getLastBundle: () => lastBundle,
    getRendererId: () => activeRendererId,
    setRenderer,
    dispose() {
      activeRenderer?.dispose?.();
      activeRenderer = null;
    },
  };
}

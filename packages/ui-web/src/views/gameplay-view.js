import { createGameplayPhaserRenderer } from "./gameplay-phaser-renderer.js";
import { deriveTileAffinityVisuals } from "./tile-affinity-visuals.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";

function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((a) => a?.schema === schema) || null;
}

function buildEntityIndex(bundle) {
  const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA);
  const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
  const layoutData = simConfig?.layout?.data || {};
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  const hazards = Array.isArray(layoutData.hazards) ? layoutData.hazards : [];
  const resources = Array.isArray(layoutData.resources) ? layoutData.resources : [];
  const index = new Map();
  [
    ...actors.map((entity) => ({ ...entity, entityType: entity?.entityType || "actor" })),
    ...hazards.map((entity) => ({ ...entity, entityType: entity?.entityType || "hazard" })),
    ...resources.map((entity) => ({ ...entity, entityType: entity?.entityType || "resource" })),
  ].forEach((entity) => {
    if (entity?.position != null) {
      const key = `${entity.position.x},${entity.position.y}`;
      index.set(key, entity);
    }
  });
  return index;
}

function buildBoardState(bundle, { buildTileVisualsFn } = {}) {
  const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
  const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA);
  const resourceBundle = findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA);
  const layoutData = simConfig?.layout?.data || {};
  const tiles = Array.isArray(layoutData.tiles) ? layoutData.tiles : [];
  const hazards = Array.isArray(layoutData.hazards) ? layoutData.hazards : [];

  // Derive tile visuals via injected facade or default hazard-based fallback
  let tileVisuals;
  if (typeof buildTileVisualsFn === "function") {
    tileVisuals = buildTileVisualsFn(bundle);
  } else {
    tileVisuals = deriveTileAffinityVisuals({ tiles, hazards, resourceBundle });
  }

  return {
    tiles,
    boardWidth: Number(layoutData.width) || 1,
    boardHeight: Number(layoutData.height) || 1,
    simConfig,
    initialState,
    observation: {
      actors: Array.isArray(initialState?.actors) ? initialState.actors : [],
      hazards,
      resources: Array.isArray(layoutData.resources) ? layoutData.resources : [],
    },
    resourceBundle,
    tileVisuals,
  };
}

export function wireGameplayView({
  root = document,
  onRunLoaded,
  onDiscardToDesign,
  actorInspector = null,
  createRenderer = createGameplayPhaserRenderer,
  buildTileAffinityVisualsFromBundleFn = null,
} = {}) {
  const statusEl = root.querySelector?.("#gameplay-status") ?? null;
  const phaserHost = root.querySelector?.("#gameplay-phaser-host") ?? null;
  const stepBackBtn = root.querySelector?.("#gameplay-step-back") ?? null;
  const stepForwardBtn = root.querySelector?.("#gameplay-step-forward") ?? null;
  const zoomInBtn = root.querySelector?.("#gameplay-zoom-in") ?? null;
  const zoomOutBtn = root.querySelector?.("#gameplay-zoom-out") ?? null;
  const fitBtn = root.querySelector?.("#gameplay-fit-level") ?? null;
  const fullscreenBtn = root.querySelector?.("#gameplay-fullscreen") ?? null;

  let activeBundle = null;
  let entityIndex = new Map();
  let selectedEntity = null;
  let frames = [];
  let currentFrameIndex = -1;

  const renderer = createRenderer({
    onSelect: (pos) => selectEntity(pos),
    onHover: (pos) => {
      const model = resolveDisplayModel(pos);
      if (model) {
        renderer.showQuickView?.(model);
      } else {
        renderer.hideQuickView?.();
      }
    },
    onHoverEnd: () => renderer.hideQuickView?.(),
    onKeyPress: ({ key }) => {
      if (!isRunActive()) return;
      if (key === "escape") {
        closePlayerPanel();
        return;
      }
      if (!selectedEntity) return;
      console.log("[gameplay] key:", key, "actor:", selectedEntity.id);
      if (key === "z") {
        openPlayerPanel();
      }
    },
  });
  renderer.mount(phaserHost);

  function setStatus(message, level = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    if (statusEl.dataset) statusEl.dataset.level = level;
  }

  function updateStepButtons() {
    if (stepBackBtn) stepBackBtn.disabled = currentFrameIndex <= 0;
    if (stepForwardBtn) stepForwardBtn.disabled = currentFrameIndex >= frames.length - 1;
  }

  function isRunActive() {
    return activeBundle !== null;
  }

  function loadRun(bundle) {
    if (!bundle) return;
    activeBundle = bundle;
    entityIndex = buildEntityIndex(bundle);
    selectedEntity = null;
    frames = [buildBoardState(bundle, { buildTileVisualsFn: buildTileAffinityVisualsFromBundleFn })];
    currentFrameIndex = 0;
    setStatus("Run loaded.");

    if (actorInspector) {
      const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
      const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA);
      actorInspector.setScenario({ simConfig, initialState, spec: bundle?.spec || null });
      actorInspector.setMode("simulation");
      actorInspector.setActors?.(initialState?.actors || [], { tick: 0 });
      actorInspector.setRunning?.(true);
    }

    void renderer.renderRun(frames[0]);
    renderer.setPlaybackControls?.({
      stepBack: () => stepBack(),
      stepForward: () => stepForward(),
      togglePlay: () => {},
      reset: () => clear(),
    });
    updateStepButtons();
    onRunLoaded?.(bundle);
  }

  function clear(message = "No run loaded.") {
    activeBundle = null;
    entityIndex = new Map();
    selectedEntity = null;
    frames = [];
    currentFrameIndex = -1;
    setStatus(message);
    updateStepButtons();
    closePlayerPanel();
    renderer.clearHighlight?.();
    actorInspector?.clearSelection?.();
    actorInspector?.setRunning?.(false);
  }

  function stepForward() {
    if (!isRunActive() || currentFrameIndex >= frames.length - 1) return;
    currentFrameIndex++;
    const frame = frames[currentFrameIndex];
    void renderer.renderFrame(frame);
    updateStepButtons();
    actorInspector?.setActors?.(frame?.observation?.actors || [], { tick: currentFrameIndex });
  }

  function stepBack() {
    if (!isRunActive() || currentFrameIndex <= 0) return;
    currentFrameIndex--;
    const frame = frames[currentFrameIndex];
    void renderer.renderFrame(frame);
    updateStepButtons();
    actorInspector?.setActors?.(frame?.observation?.actors || [], { tick: currentFrameIndex });
  }

  function selectEntity(position) {
    if (!position || !isRunActive()) return null;
    const key = `${position.x},${position.y}`;
    const entity = entityIndex.get(key) ?? null;
    selectedEntity = entity;
    actorInspector?.selectEntityAtPosition?.(position);
    if (entity?.position) {
      renderer.highlightActor?.(entity.position);
      renderer.centerOnTile?.(entity.position);
    }
    return entity;
  }

  function zoomIn() {
    return renderer.zoomIn?.();
  }

  function zoomOut() {
    return renderer.zoomOut?.();
  }

  function fitToLevel() {
    return renderer.fitToLevel?.();
  }

  function getSelectedEntity() {
    return selectedEntity;
  }

  function requestDesignTransition() {
    if (!isRunActive()) {
      onDiscardToDesign?.();
      return;
    }
    const confirmed = globalThis.confirm("Discard current run and return to design?");
    if (confirmed) {
      clear();
      onDiscardToDesign?.();
    }
  }

  function dispose() {
    clear();
    renderer.dispose();
  }

  if (stepBackBtn?.addEventListener) {
    stepBackBtn.addEventListener("click", () => stepBack());
  }
  if (stepForwardBtn?.addEventListener) {
    stepForwardBtn.addEventListener("click", () => stepForward());
  }
  if (zoomInBtn?.addEventListener) {
    zoomInBtn.addEventListener("click", () => zoomIn());
  }
  if (zoomOutBtn?.addEventListener) {
    zoomOutBtn.addEventListener("click", () => zoomOut());
  }
  if (fitBtn?.addEventListener) {
    fitBtn.addEventListener("click", () => fitToLevel());
  }
  if (fullscreenBtn?.addEventListener) {
    fullscreenBtn.addEventListener("click", () => enterFullscreen());
  }

  // Disable step controls initially (no run loaded)
  if (stepBackBtn) stepBackBtn.disabled = true;
  if (stepForwardBtn) stepForwardBtn.disabled = true;

  // Signal that playback controls are wired to the renderer bridge
  if (phaserHost) phaserHost.dataset.__gameplayPlaybackControlsWired = "true";

  function resolveDisplayModel(position) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const key = `${Math.floor(x)},${Math.floor(y)}`;
    const entity = entityIndex.get(key) ?? null;
    if (!entity) return null;
    const affinities = Array.isArray(entity.affinities) ? entity.affinities : [];
    return {
      id: entity.id,
      entityType: entity.entityType || "actor",
      position: entity.position ?? null,
      vitals: entity.vitals ?? null,
      affinities,
      motivations: Array.isArray(entity.motivations) ? entity.motivations : [],
      equippedAffinity: affinities.length > 0 ? affinities[0] : null,
    };
  }

  function openPlayerPanel() {
    if (!selectedEntity || selectedEntity.entityType !== "actor") return;
    const model = resolveDisplayModel(selectedEntity.position);
    if (!model) return;
    renderer.openPlayerPanel?.(model);
  }

  function closePlayerPanel() {
    renderer.closePlayerPanel?.();
  }

  function enterFullscreen() {
    if (phaserHost) phaserHost.dataset.gameplayFullscreen = "true";
  }

  function exitFullscreen() {
    if (phaserHost) phaserHost.dataset.gameplayFullscreen = "false";
  }

  function handleInspectorSelect(payload) {
    if (!payload?.position) return;
    const pos = payload.position;
    const key = `${Math.floor(Number(pos.x))},${Math.floor(Number(pos.y))}`;
    const entity = entityIndex.get(key) ?? null;
    selectedEntity = entity;
    renderer.highlightActor?.(pos);
    renderer.centerOnTile?.(pos);
  }

  return {
    loadRun,
    stepForward,
    stepBack,
    dispose,
    isRunActive,
    clear,
    requestDesignTransition,
    getSelectedEntity,
    selectEntity,
    resolveDisplayModel,
    handleInspectorSelect,
    openPlayerPanel,
    closePlayerPanel,
    isPlayerPanelOpen: () => renderer.isPlayerPanelOpen?.() ?? false,
    zoomIn,
    zoomOut,
    fitToLevel,
    enterFullscreen,
    exitFullscreen,
  };
}

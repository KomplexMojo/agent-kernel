import { createGameplayPhaserRenderer } from "./gameplay-phaser-renderer.js";
import { deriveTileAffinityVisuals } from "./tile-affinity-visuals.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";

function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((a) => a?.schema === schema) || null;
}

function resolveHazards(layoutData) {
  const explicit = Array.isArray(layoutData.hazards) ? layoutData.hazards : [];
  const fromTraps = Array.isArray(layoutData.traps)
    ? layoutData.traps
        .filter((t) => t != null && t.x != null && t.y != null)
        .map((t) => ({
          ...t,
          position: { x: t.x, y: t.y },
          entityType: "hazard",
          emitStrength: t.affinity?.stacks ?? 0,
          affinityStacks: t.affinity
            ? [{ kind: t.affinity.kind, expression: t.affinity.expression }]
            : [],
        }))
    : [];
  const seen = new Set(explicit.map((h) => `${h.position?.x},${h.position?.y}`));
  return [...explicit, ...fromTraps.filter((t) => !seen.has(`${t.position.x},${t.position.y}`))];
}

function buildEntityIndex(bundle) {
  const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA);
  const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
  const layoutData = simConfig?.layout?.data || {};
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  const hazards = resolveHazards(layoutData);
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

async function buildBoardState(bundle, { buildTileVisualsFn } = {}) {
  const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
  const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA);
  const resourceBundle = findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA);
  const layoutData = simConfig?.layout?.data || {};
  const tiles = Array.isArray(layoutData.tiles) ? layoutData.tiles : [];
  const hazards = resolveHazards(layoutData);

  // Derive tile visuals via injected facade or default hazard-based fallback.
  // The injected function may be async depending on the field bridge.
  let tileVisuals;
  if (typeof buildTileVisualsFn === "function") {
    const result = buildTileVisualsFn(bundle);
    tileVisuals = result instanceof Promise ? await result : result;
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

/**
 * Build a board-state frame for every unique tick in bundle.tickFrames by
 * accumulating accepted Move actions against the initial actor positions.
 *
 * Returns an array whose index 0 is the initial state and each subsequent
 * entry represents the world after that tick completes.
 */
function buildTickBoardStates(baseFrame, tickFrames) {
  if (!Array.isArray(tickFrames) || tickFrames.length === 0) return [baseFrame];

  // Deep-clone the initial actor positions so we can mutate them.
  let actorPositions = (baseFrame.observation?.actors || []).map((a) => ({ ...a }));

  const frames = [baseFrame];

  // Group tick frames by tick number; process in ascending tick order.
  const byTick = new Map();
  for (const tf of tickFrames) {
    const t = tf?.tick;
    if (typeof t !== "number" || !Array.isArray(tf?.acceptedActions)) continue;
    if (!byTick.has(t)) byTick.set(t, []);
    byTick.get(t).push(tf);
  }

  const ticks = Array.from(byTick.keys()).sort((a, b) => a - b);
  for (const tick of ticks) {
    const tfGroup = byTick.get(tick);
    // Apply every accepted Move action across all frames in this tick.
    for (const tf of tfGroup) {
      for (const action of tf.acceptedActions || []) {
        if (action?.kind !== "move") continue;
        const to = action.params?.to;
        if (!to) continue;
        const actor = actorPositions.find((a) => a.id === action.actorId);
        if (actor) actor.position = { ...to };
      }
    }
    // Snapshot the world after this tick.
    frames.push({
      ...baseFrame,
      observation: {
        ...baseFrame.observation,
        actors: actorPositions.map((a) => ({ ...a })),
      },
    });
  }

  return frames;
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
  const runToEndBtn = root.querySelector?.("#gameplay-run-to-end") ?? null;
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
    if (runToEndBtn) runToEndBtn.disabled = currentFrameIndex >= frames.length - 1;
  }

  function isRunActive() {
    return activeBundle !== null;
  }

  async function loadRun(bundle) {
    if (!bundle) return;
    activeBundle = bundle;
    entityIndex = buildEntityIndex(bundle);
    selectedEntity = null;
    const initialFrame = await buildBoardState(bundle, { buildTileVisualsFn: buildTileAffinityVisualsFromBundleFn });
    frames = buildTickBoardStates(initialFrame, bundle.tickFrames);
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

    void renderer.renderRun(frames[0], { tickIndex: currentFrameIndex });
    renderer.setPlaybackControls?.({
      stepBack: () => stepBack(),
      stepForward: () => stepForward(),
      togglePlay: () => {},
      reset: () => clear(),
      jumpToStart: () => runToStart(),
      jumpToEnd: () => runToEnd(),
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
    void renderer.renderFrame(frame, { tickIndex: currentFrameIndex });
    updateStepButtons();
    actorInspector?.setActors?.(frame?.observation?.actors || [], { tick: currentFrameIndex });
  }

  function stepBack() {
    if (!isRunActive() || currentFrameIndex <= 0) return;
    currentFrameIndex--;
    const frame = frames[currentFrameIndex];
    void renderer.renderFrame(frame, { tickIndex: currentFrameIndex });
    updateStepButtons();
    actorInspector?.setActors?.(frame?.observation?.actors || [], { tick: currentFrameIndex });
  }

  /**
   * Run To End — jump cursor to the last frame and render it.
   * From M1 contract: this is UI playback over precomputed tickFrames,
   * not live tick execution. Updates the actor inspector to the final state
   * and disables forward stepping.
   */
  function runToEnd() {
    if (!isRunActive() || frames.length === 0) return;
    currentFrameIndex = frames.length - 1;
    const frame = frames[currentFrameIndex];
    void renderer.renderFrame(frame, { tickIndex: currentFrameIndex });
    updateStepButtons();
    actorInspector?.setActors?.(frame?.observation?.actors || [], { tick: currentFrameIndex });
    setStatus(`Run completed at tick ${currentFrameIndex}.`);
  }

  /**
   * Run To Start — jump cursor to the first frame (tick 0) and render it.
   * Mirrors runToEnd(): UI-only playback-cursor reset, no re-simulation.
   */
  function runToStart() {
    if (!isRunActive() || frames.length === 0) return;
    currentFrameIndex = 0;
    const frame = frames[currentFrameIndex];
    void renderer.renderFrame(frame, { tickIndex: currentFrameIndex });
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

  function selectEntityById(cardId) {
    if (!cardId || !isRunActive()) return null;
    for (const entity of entityIndex.values()) {
      if (entity.id === cardId) {
        return selectEntity(entity.position);
      }
    }
    return null;
  }

  function requestDesignTransition() {
    // The gameplay view is read-only — nothing here is ever edited, so
    // there's no "unsaved changes" to confirm discarding. Just go back.
    if (isRunActive()) clear();
    onDiscardToDesign?.();
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
  if (runToEndBtn?.addEventListener) {
    runToEndBtn.addEventListener("click", () => runToEnd());
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
  if (runToEndBtn) runToEndBtn.disabled = true;

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
    runToEnd,
    runToStart,
    dispose,
    isRunActive,
    clear,
    requestDesignTransition,
    getSelectedEntity,
    selectEntity,
    selectEntityById,
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

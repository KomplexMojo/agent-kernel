import { loadCore } from "../../../bindings-ts/src/core-as.js";
import { runMvpMovement } from "../../../runtime/src/mvp/movement.js";
import { initializeCoreFromArtifacts } from "../../../runtime/src/runner/core-setup.mjs";
import { hasGeneratedResourceBundleAssets } from "../../../runtime/src/render/resource-bundle.js";
import {
  AFFINITY_TARGET_TYPES,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION,
} from "../../../runtime/src/contracts/domain-constants.js";
import { createLevelBuilderAdapter } from "../../../adapters-web/src/adapters/level-builder/index.js";
import { setupPlayback } from "../movement-ui.js";
import { clearBundleCanvas, positionFromCanvasEvent, renderBundleBoardToCanvas } from "../resource-bundle-view.js";

const ACTOR_ID_LABEL = "actor_mvp";
const ACTOR_ID_VALUE = 1;
const VISIBILITY_MODE_SIMULATION_FULL = "simulation_full";
const VISIBILITY_MODE_GAMEPLAY_FOG = "gameplay_fog";
const DEFAULT_VIEWPORT_SIZE = 50;
const DEFAULT_VISION_RADIUS = 6;
const DEFAULT_RUN_HELP_TEXT = "Build and load a game from Preview, then select a room, delver, or warden to inspect and control it here.";

function sortActorsById(initialState) {
  const actors = Array.isArray(initialState?.actors) ? initialState.actors.slice() : [];
  actors.sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  return actors;
}

function buildActorIdMap(initialState, primaryActorId, { preserveIds = false } = {}) {
  const actors = sortActorsById(initialState);
  const map = new Map();
  if (typeof primaryActorId === "string" && primaryActorId.trim()) {
    map.set(primaryActorId, primaryActorId);
  }
  actors.forEach((actor, index) => {
    const originalId = typeof actor?.id === "string" && actor.id.trim() ? actor.id.trim() : null;
    const resolvedId = preserveIds
      ? (originalId || `actor_${index + 1}`)
      : index === 0
        ? (typeof primaryActorId === "string" && primaryActorId.trim() ? primaryActorId.trim() : originalId)
        : `actor_${index + 1}`;
    if (originalId && resolvedId) {
      map.set(originalId, resolvedId);
    }
    if (resolvedId) {
      map.set(resolvedId, resolvedId);
    }
  });
  return { actors, map };
}

function normalizeAffinityStacks(affinityStacks) {
  if (!affinityStacks || typeof affinityStacks !== "object" || Array.isArray(affinityStacks)) {
    return null;
  }
  const normalized = {};
  Object.entries(affinityStacks).forEach(([rawKey, rawStacks]) => {
    const stacks = Number.isFinite(rawStacks) ? Math.max(1, Math.floor(rawStacks)) : null;
    if (!stacks) return;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key) return;
    const scopedKey = key.includes(":") ? key : `${key}:${DEFAULT_AFFINITY_EXPRESSION}`;
    normalized[scopedKey] = stacks;
  });
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeAffinityTargets(affinityTargets) {
  if (!affinityTargets || typeof affinityTargets !== "object" || Array.isArray(affinityTargets)) {
    return null;
  }
  const normalized = {};
  Object.entries(affinityTargets).forEach(([rawKey, rawStacks]) => {
    const stacks = Number.isFinite(rawStacks) ? Math.max(1, Math.floor(rawStacks)) : null;
    if (!stacks) return;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key) return;
    const [rawKind, rawExpression, rawTargetType] = key.split(":");
    const kind = rawKind || "";
    const expression = rawExpression || DEFAULT_AFFINITY_EXPRESSION;
    const targetType = AFFINITY_TARGET_TYPES.includes(rawTargetType)
      ? rawTargetType
      : DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION[expression] || DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION.push;
    if (!kind) return;
    normalized[`${kind}:${expression}:${targetType}`] = stacks;
  });
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function cloneAbilities(abilities) {
  if (!Array.isArray(abilities)) return [];
  return abilities
    .filter((ability) => ability && typeof ability === "object" && !Array.isArray(ability))
    .map((ability) => ({ ...ability }));
}

function cloneResolvedEffects(effects) {
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((effect) => effect && typeof effect === "object" && !Array.isArray(effect))
    .map((effect) => ({ ...effect }));
}

function mapAffinityEffectsActors(entries, actorIdMap) {
  if (!Array.isArray(entries)) return [];
  const mapped = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const rawId = typeof entry.actorId === "string" ? entry.actorId : "";
    const actorId = actorIdMap.get(rawId) || rawId;
    if (!actorId) return;
    const affinityTargets = normalizeAffinityTargets(entry.affinityTargets);
    const affinityStacks = normalizeAffinityStacks(entry.affinityStacks);
    const abilities = cloneAbilities(entry.abilities);
    const resolvedEffects = cloneResolvedEffects(entry.resolvedEffects);
    if (!affinityTargets && !affinityStacks && abilities.length === 0 && resolvedEffects.length === 0) return;
    const next = { actorId };
    if (affinityTargets) next.affinityTargets = affinityTargets;
    if (affinityStacks) next.affinityStacks = affinityStacks;
    if (abilities.length > 0) next.abilities = abilities;
    if (resolvedEffects.length > 0) next.resolvedEffects = resolvedEffects;
    mapped.set(actorId, next);
  });
  return Array.from(mapped.values()).sort((a, b) => a.actorId.localeCompare(b.actorId));
}

function buildFallbackAffinityActors(actors, actorIdMap) {
  const fallback = [];
  actors.forEach((actor) => {
    if (!actor || typeof actor !== "object" || Array.isArray(actor)) return;
    const rawId = typeof actor.id === "string" ? actor.id : "";
    const actorId = actorIdMap.get(rawId) || rawId;
    if (!actorId) return;
    const traits = actor.traits && typeof actor.traits === "object" && !Array.isArray(actor.traits)
      ? actor.traits
      : null;
    const affinityTargets = normalizeAffinityTargets(traits?.affinityTargets);
    const affinityStacks = normalizeAffinityStacks(traits?.affinities);
    const abilities = cloneAbilities(traits?.abilities);
    const resolvedEffects = cloneResolvedEffects(traits?.resolvedEffects);
    if (!affinityTargets && !affinityStacks && abilities.length === 0 && resolvedEffects.length === 0) return;
    const next = { actorId };
    if (affinityTargets) next.affinityTargets = affinityTargets;
    if (affinityStacks) next.affinityStacks = affinityStacks;
    if (abilities.length > 0) next.abilities = abilities;
    if (resolvedEffects.length > 0) next.resolvedEffects = resolvedEffects;
    fallback.push(next);
  });
  fallback.sort((a, b) => a.actorId.localeCompare(b.actorId));
  return fallback;
}

function cloneTrapEffects(traps) {
  if (!Array.isArray(traps)) return [];
  return traps
    .filter((trap) => trap && typeof trap === "object" && !Array.isArray(trap))
    .map((trap) => ({ ...trap }));
}

function normalizeVisibilityMode(mode) {
  return mode === VISIBILITY_MODE_GAMEPLAY_FOG
    ? VISIBILITY_MODE_GAMEPLAY_FOG
    : VISIBILITY_MODE_SIMULATION_FULL;
}

function normalizeRoomBounds(roomBounds = null) {
  if (!roomBounds || typeof roomBounds !== "object") return null;
  const x = Number(roomBounds.x);
  const y = Number(roomBounds.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = Number.isFinite(roomBounds.width) ? Math.max(1, Math.floor(roomBounds.width)) : 1;
  const height = Number.isFinite(roomBounds.height) ? Math.max(1, Math.floor(roomBounds.height)) : 1;
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width,
    height,
  };
}

function ensureRenderCanvas(root, frameEl) {
  const existingCanvas = root?.querySelector?.("#simulation-render-canvas");
  if (existingCanvas) return existingCanvas;
  const parent = frameEl?.parentElement || frameEl?.parentNode;
  const doc = frameEl?.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!parent || typeof parent.insertBefore !== "function" || !doc || typeof doc.createElement !== "function") {
    return null;
  }
  const canvas = doc.createElement("canvas");
  canvas.id = "simulation-render-canvas";
  canvas.className = "level-preview-canvas";
  canvas.hidden = true;
  parent.insertBefore(canvas, frameEl);
  return canvas;
}

export function resolveCanvasBoardPosition(position, visibilitySummary = null) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return null;
  }
  const viewport = visibilitySummary?.viewport;
  const startX = Number(viewport?.startX);
  const startY = Number(viewport?.startY);
  return {
    x: Math.floor(position.x + (Number.isFinite(startX) ? startX : 0)),
    y: Math.floor(position.y + (Number.isFinite(startY) ? startY : 0)),
  };
}

export function resolveArtifactAffinityEffects({
  initialState,
  affinityEffects,
  primaryActorId,
  preserveActorIds = false,
} = {}) {
  const { actors, map: actorIdMap } = buildActorIdMap(initialState, primaryActorId, { preserveIds: preserveActorIds });
  const primaryActors = mapAffinityEffectsActors(affinityEffects?.actors, actorIdMap);
  const primaryTraps = cloneTrapEffects(affinityEffects?.traps);
  const fallbackActors = buildFallbackAffinityActors(actors, actorIdMap);

  if (primaryActors.length === 0 && primaryTraps.length === 0) {
    return fallbackActors.length > 0 ? { actors: fallbackActors, traps: [] } : null;
  }

  if (fallbackActors.length === 0) {
    return {
      actors: primaryActors,
      traps: primaryTraps,
    };
  }

  const mergedActors = new Map();
  fallbackActors.forEach((entry) => {
    mergedActors.set(entry.actorId, entry);
  });
  primaryActors.forEach((entry) => {
    mergedActors.set(entry.actorId, entry);
  });
  return {
    actors: Array.from(mergedActors.values()).sort((a, b) => a.actorId.localeCompare(b.actorId)),
    traps: primaryTraps,
  };
}

export function wireSimulationView({
  root = document,
  actorInspector,
  getInitialConfig,
  autoBoot = true,
  levelBuilderOptions = {},
  onObservation,
} = {}) {
  const frameEl = root.querySelector("#frame-buffer");
  const renderCanvasEl = ensureRenderCanvas(root, frameEl);
  const actorListEl = root.querySelector("#actor-list");
  const affinityListEl = root.querySelector("#affinity-list");
  const tileActorListEl = root.querySelector("#tile-actor-list");
  const tileActorCountEl = root.querySelector("#tile-actor-count");
  const trapListEl = root.querySelector("#trap-list");
  const trapTabCountEl = root.querySelector("#trap-tab-count");
  const baseTilesEl = root.querySelector("#base-tiles");
  const statusEl = root.querySelector("#status-message");
  const stepBackButton = root.querySelector("#step-back");
  const stepForwardButton = root.querySelector("#step-forward");
  const playPauseButton = root.querySelector("#play-pause");
  const resetRunButton = root.querySelector("#reset-run");
  const moveUpButton = root.querySelector("#runtime-move-up");
  const moveDownButton = root.querySelector("#runtime-move-down");
  const moveLeftButton = root.querySelector("#runtime-move-left");
  const moveRightButton = root.querySelector("#runtime-move-right");
  const castButton = root.querySelector("#runtime-cast");

  let core = null;
  let controller = null;
  let actions = [];
  let ready = false;
  let pendingConfig = null;
  let pendingArtifacts = null;
  let levelBuilder = null;
  let latestLevelArtifacts = null;
  let latestRuntimeArtifacts = null;
  let lastBaseTilesHash = "";
  let levelRenderRequestId = 0;
  let lastVisibilitySummary = null;
  let lastObservationActors = [];
  let inspectorVisible = actorInspector?.isVisible?.() === true;
  let inspectorSelectedEntity = null;
  const visibilityPreferences = {
    mode: VISIBILITY_MODE_SIMULATION_FULL,
    viewportSize: DEFAULT_VIEWPORT_SIZE,
    visionRadius: DEFAULT_VISION_RADIUS,
    viewerActorId: "",
  };

  function setStatus(message, level = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    if (statusEl.dataset) {
      statusEl.dataset.level = level === "error" ? "error" : "info";
    }
  }

  function getSelectedActorId() {
    const actorId = typeof actorInspector?.getSelectedEntity?.()?.actorId === "string"
      ? actorInspector.getSelectedEntity().actorId.trim()
      : "";
    return actorId || null;
  }

  function clear(message = DEFAULT_RUN_HELP_TEXT) {
    controller?.pause?.();
    controller = null;
    pendingConfig = null;
    pendingArtifacts = null;
    latestLevelArtifacts = null;
    latestRuntimeArtifacts = null;
    lastBaseTilesHash = "";
    lastVisibilitySummary = null;
    lastObservationActors = [];
    lastObservationTraps = [];
    clearBundleCanvas(renderCanvasEl);
    if (renderCanvasEl) renderCanvasEl.hidden = true;
    if (frameEl) frameEl.hidden = false;
    if (frameEl) {
      frameEl.textContent = "No game loaded.";
    }
    actorInspector?.setScenario?.({});
    actorInspector?.setActors?.([], { tick: null });
    actorInspector?.setRunning?.(false);
    setStatus(message);
  }

  function ensureLevelBuilder() {
    if (levelBuilder) return levelBuilder;
    levelBuilder = createLevelBuilderAdapter(levelBuilderOptions);
    return levelBuilder;
  }

  function hashTiles(tiles = []) {
    if (!Array.isArray(tiles)) return "";
    return tiles.map((row) => String(row || "")).join("\n");
  }

  async function regenerateLevelArtifacts({ tiles, renderOptions } = {}) {
    if (!Array.isArray(tiles) || tiles.length === 0) {
      return { ok: false, reason: "missing_tiles" };
    }
    const requestId = ++levelRenderRequestId;
    const builder = ensureLevelBuilder();
    const result = await builder.buildFromTiles({
      tiles,
      renderOptions: {
        includeAscii: true,
        includeImage: true,
        ...(renderOptions && typeof renderOptions === "object" ? renderOptions : {}),
      },
    });
    if (requestId !== levelRenderRequestId) {
      return { ok: false, reason: "stale_render_request" };
    }
    if (result?.ok) {
      latestLevelArtifacts = result;
    }
    return result;
  }

  function normalizeInspectorEntity(entity) {
    if (!entity || typeof entity !== "object") return null;
    const actorId = typeof entity.actorId === "string" ? entity.actorId.trim() : "";
    const type = typeof entity.type === "string" ? entity.type.trim().toLowerCase() : "";
    const roomBounds = normalizeRoomBounds(entity.roomBounds);
    const position = entity.position && Number.isFinite(entity.position.x) && Number.isFinite(entity.position.y)
      ? { x: Math.floor(entity.position.x), y: Math.floor(entity.position.y) }
      : null;
    return {
      ...entity,
      type,
      actorId,
      roomBounds,
      position,
    };
  }

  function updateVisibilityModePreference(mode) {
    const normalized = normalizeVisibilityMode(mode);
    visibilityPreferences.mode = normalized;
  }

  function applyInspectorVisibilityOverrides() {
    if (!controller) return;
    if (!inspectorVisible) {
      controller?.setVisibilityFocusRoom?.(null);
      controller?.setFogFullMap?.(false);
      updateVisibilityModePreference(VISIBILITY_MODE_SIMULATION_FULL);
      controller?.setVisibilityMode?.(VISIBILITY_MODE_SIMULATION_FULL);
      return;
    }

    const selected = inspectorSelectedEntity;
    const roomBounds = normalizeRoomBounds(selected?.roomBounds);
    if (selected?.type === "room" && roomBounds) {
      controller?.setFogFullMap?.(false);
      controller?.setVisibilityFocusRoom?.(roomBounds);
      updateVisibilityModePreference(VISIBILITY_MODE_SIMULATION_FULL);
      controller?.setVisibilityMode?.(VISIBILITY_MODE_SIMULATION_FULL);
      return;
    }

    controller?.setVisibilityFocusRoom?.(null);
    const actorId = typeof selected?.actorId === "string" ? selected.actorId.trim() : "";
    if (actorId) {
      visibilityPreferences.viewerActorId = actorId;
      controller?.setViewerActor?.(actorId);
      controller?.setFogFullMap?.(true);
      updateVisibilityModePreference(VISIBILITY_MODE_GAMEPLAY_FOG);
      controller?.setVisibilityMode?.(VISIBILITY_MODE_GAMEPLAY_FOG);
      return;
    }

    controller?.setFogFullMap?.(false);
    updateVisibilityModePreference(VISIBILITY_MODE_SIMULATION_FULL);
    controller?.setVisibilityMode?.(VISIBILITY_MODE_SIMULATION_FULL);
  }

  let lastObservationTraps = [];

  function handleObservation({ observation, frame, playing, visibility, actorIdLabel }) {
    actorInspector?.setActors?.(observation?.actors || [], { tick: observation?.tick });
    actorInspector?.setRunning?.(playing);
    lastVisibilitySummary = visibility || null;
    lastObservationActors = Array.isArray(observation?.actors) ? observation.actors.slice() : [];
    lastObservationTraps = Array.isArray(observation?.traps) ? observation.traps.slice() : [];
    if (typeof onObservation === "function") {
      onObservation({
        observation,
        frame,
        playing,
        visibility,
        actorIdLabel,
      });
    }
    const baseTiles = Array.isArray(frame?.baseTiles) ? frame.baseTiles : null;
    if (!baseTiles || baseTiles.length === 0) {
      if (renderCanvasEl && frameEl) {
        renderCanvasEl.hidden = true;
        frameEl.hidden = false;
      }
      return;
    }
    const canRenderGeneratedBundle = hasGeneratedResourceBundleAssets(latestRuntimeArtifacts?.resourceBundle);
    if (renderCanvasEl && frameEl && canRenderGeneratedBundle) {
      const bundle = latestRuntimeArtifacts?.resourceBundle
        ? { spec: latestRuntimeArtifacts?.spec || null, artifacts: [latestRuntimeArtifacts.resourceBundle] }
        : null;
      void renderBundleBoardToCanvas({
        canvas: renderCanvasEl,
        tiles: baseTiles,
        actors: lastObservationActors,
        floorAffinityTraps: lastObservationTraps,
        bundle,
      }).then((result) => {
        if (!renderCanvasEl || !frameEl) return;
        const rendered = result?.ok === true;
        renderCanvasEl.hidden = !rendered;
        frameEl.hidden = rendered;
      }).catch(() => {
        if (!renderCanvasEl || !frameEl) return;
        renderCanvasEl.hidden = true;
        frameEl.hidden = false;
      });
    } else if (renderCanvasEl && frameEl) {
      renderCanvasEl.hidden = true;
      frameEl.hidden = false;
    }
    const nextHash = hashTiles(baseTiles);
    if (nextHash === lastBaseTilesHash) return;
    lastBaseTilesHash = nextHash;
    void regenerateLevelArtifacts({
      tiles: baseTiles,
      renderOptions: {
        floorAffinityTraps: Array.isArray(observation?.traps) ? observation.traps : [],
      },
    });
  }

  function mountPlayback(config, { initCore } = {}) {
    controller?.pause?.();
    const actorLabel = config?.actorId || ACTOR_ID_LABEL;
    actions = config?.actions || [];
    controller = setupPlayback({
      core,
      actions,
      actorIdLabel: actorLabel,
      actorIds: Array.isArray(config?.actorIds) ? config.actorIds : undefined,
      actorIdValue: ACTOR_ID_VALUE,
      affinityEffects: config?.affinityEffects,
      visibility: {
        mode: visibilityPreferences.mode,
        viewportSize: visibilityPreferences.viewportSize,
        visionRadius: visibilityPreferences.visionRadius,
        viewerActorId: visibilityPreferences.viewerActorId || actorLabel,
      },
      elements: {
        frame: frameEl,
        actorList: actorListEl,
        affinityList: affinityListEl,
        tileActorList: tileActorListEl,
        tileActorCount: tileActorCountEl,
        trapList: trapListEl,
        trapCount: trapTabCountEl,
        baseTiles: baseTilesEl,
        status: statusEl,
        playButton: playPauseButton,
        stepBack: stepBackButton,
        stepForward: stepForwardButton,
        reset: resetRunButton,
      },
      onObservation: handleObservation,
      initCore,
    });
    applyInspectorVisibilityOverrides();
  }

  function startRun(config) {
    if (!config) return;
    if (!ready || !core) {
      pendingConfig = config;
      return;
    }
    try {
      lastBaseTilesHash = "";
      latestLevelArtifacts = null;
      latestRuntimeArtifacts = null;
      lastObservationActors = [];
      lastObservationTraps = [];
      actorInspector?.setScenario?.({});
      const movement = runMvpMovement({
        core,
        actorIdLabel: config.actorId || ACTOR_ID_LABEL,
        actorIdValue: ACTOR_ID_VALUE,
        seed: config.seed,
      });
      mountPlayback({
        actorId: config.actorId,
        actions: movement.actions,
      });
      setStatus("Select a room, delver, or warden to inspect and control it here.");
    } catch (err) {
      setStatus(err.message || "Failed to start run", "error");
      console.error(err);
    }
  }

  function startRunFromArtifacts({
    simConfig,
    initialState,
    affinityEffects,
    resourceBundle,
    spec,
  } = {}) {
    if (!ready || !core) {
      pendingArtifacts = {
        simConfig,
        initialState,
        affinityEffects,
        resourceBundle,
        spec,
      };
      return;
    }
    try {
      lastBaseTilesHash = "";
      latestLevelArtifacts = null;
      latestRuntimeArtifacts = { simConfig, initialState, affinityEffects, spec, resourceBundle };
      lastObservationActors = [];
      lastObservationTraps = [];
      actorInspector?.setScenario?.({ simConfig, initialState, spec });
      const sortedActors = sortActorsById(initialState);
      const actorIds = sortedActors
        .map((actor) => (typeof actor?.id === "string" ? actor.id.trim() : ""))
        .filter(Boolean);
      const actorLabel = actorIds[0] || "actor_bundle";
      const resolvedAffinityEffects = resolveArtifactAffinityEffects({
        initialState,
        affinityEffects,
        primaryActorId: actorLabel,
        preserveActorIds: true,
      });
      mountPlayback(
        {
          actorId: actorLabel,
          actorIds,
          actions: [],
          affinityEffects: resolvedAffinityEffects,
        },
        {
          initCore: () => {
            const seed = Number.isFinite(simConfig?.seed) ? simConfig.seed : 0;
            core.init(seed);
            const { layout, actor } = initializeCoreFromArtifacts(core, { simConfig, initialState });
            if (!layout.ok) {
              throw new Error(`SimConfig invalid: ${layout.reason || "unknown"}`);
            }
            if (!actor.ok) {
              throw new Error(`InitialState invalid: ${actor.reason || "unknown"}`);
            }
          },
        },
      );
      setStatus("Select a room, delver, or warden to inspect and control it here.");
    } catch (err) {
      setStatus(err.message || "Failed to start bundle run", "error");
      console.error(err);
    }
  }

  if (frameEl?.addEventListener) {
    frameEl.addEventListener("click", (event) => {
      const target = event.target;
      const cell = target?.closest ? target.closest(".actor-cell") : null;
      const actorId = cell?.dataset?.actorId;
      if (actorId) {
        actorInspector?.selectActorById?.(actorId);
        visibilityPreferences.viewerActorId = actorId;
        controller?.setViewerActor?.(actorId);
      }
    });
  }

  if (renderCanvasEl?.addEventListener) {
    renderCanvasEl.addEventListener("click", (event) => {
      const position = positionFromCanvasEvent(event, renderCanvasEl);
      const boardPosition = resolveCanvasBoardPosition(position, lastVisibilitySummary);
      if (!boardPosition) return;
      const actor = lastObservationActors.find(
        (entry) => entry?.position?.x === boardPosition.x && entry?.position?.y === boardPosition.y,
      );
      const actorId = typeof actor?.id === "string" ? actor.id.trim() : "";
      if (!actorId) return;
      actorInspector?.selectActorById?.(actorId);
      visibilityPreferences.viewerActorId = actorId;
      controller?.setViewerActor?.(actorId);
    });
  }

  function scrollFrameToPosition(position) {
    if (!frameEl || !position) return;
    const x = Number.isFinite(position.x) ? Math.max(0, Math.floor(position.x)) : null;
    const y = Number.isFinite(position.y) ? Math.max(0, Math.floor(position.y)) : null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const targetCell = Array.from(frameEl.querySelectorAll?.(".actor-cell") || [])
      .find((cell) => {
        const cellX = Number(cell?.dataset?.x);
        const cellY = Number(cell?.dataset?.y);
        return Number.isFinite(cellX) && Number.isFinite(cellY) && cellX === x && cellY === y;
      });
    if (targetCell && typeof targetCell.scrollIntoView === "function") {
      targetCell.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      return;
    }

    const lineHeight = Number.parseFloat(globalThis.getComputedStyle?.(frameEl)?.lineHeight || "") || 14;
    const charWidth = Number.parseFloat(globalThis.getComputedStyle?.(frameEl)?.fontSize || "") * 0.62 || 8;
    if (typeof frameEl.scrollTo === "function") {
      frameEl.scrollTo({
        top: Math.max(0, y * lineHeight - lineHeight * 4),
        left: Math.max(0, x * charWidth - charWidth * 8),
        behavior: "smooth",
      });
      return;
    }
    frameEl.scrollTop = Math.max(0, y * lineHeight - lineHeight * 4);
    frameEl.scrollLeft = Math.max(0, x * charWidth - charWidth * 8);
  }

  function focusInspectorEntity(entity) {
    const normalizedEntity = normalizeInspectorEntity(entity);
    if (!normalizedEntity) {
      inspectorSelectedEntity = null;
      applyInspectorVisibilityOverrides();
      return;
    }
    inspectorSelectedEntity = normalizedEntity;
    applyInspectorVisibilityOverrides();
    const actorId = normalizedEntity.actorId;
    if (actorId) {
      visibilityPreferences.viewerActorId = actorId;
      controller?.setViewerActor?.(actorId);
      const actorCell = Array.from(frameEl?.querySelectorAll?.(".actor-cell") || [])
        .find((cell) => String(cell?.dataset?.actorId || "") === actorId);
      if (actorCell && typeof actorCell.scrollIntoView === "function") {
        actorCell.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      }
      return;
    }
    if (!normalizedEntity.position && normalizedEntity.roomBounds) {
      scrollFrameToPosition({
        x: normalizedEntity.roomBounds.x + Math.floor(normalizedEntity.roomBounds.width / 2),
        y: normalizedEntity.roomBounds.y + Math.floor(normalizedEntity.roomBounds.height / 2),
      });
      return;
    }
    scrollFrameToPosition(normalizedEntity.position);
  }

  function setInspectorVisibility(visible, entity = null) {
    inspectorVisible = Boolean(visible);
    if (entity && typeof entity === "object") {
      inspectorSelectedEntity = normalizeInspectorEntity(entity);
    } else if (!inspectorVisible) {
      inspectorSelectedEntity = null;
    }
    applyInspectorVisibilityOverrides();
  }

  stepForwardButton?.addEventListener("click", () => controller?.stepForward?.());
  stepBackButton?.addEventListener("click", () => controller?.stepBack?.());
  playPauseButton?.addEventListener("click", () => controller?.toggle?.());
  resetRunButton?.addEventListener("click", () => controller?.reset?.());
  moveUpButton?.addEventListener("click", () => performGameAction({ action: "up", actorId: getSelectedActorId() }));
  moveDownButton?.addEventListener("click", () => performGameAction({ action: "down", actorId: getSelectedActorId() }));
  moveLeftButton?.addEventListener("click", () => performGameAction({ action: "left", actorId: getSelectedActorId() }));
  moveRightButton?.addEventListener("click", () => performGameAction({ action: "right", actorId: getSelectedActorId() }));
  castButton?.addEventListener("click", () => performGameAction({ action: "cast", actorId: getSelectedActorId() }));

  async function boot() {
    stepBackButton && (stepBackButton.disabled = true);
    stepForwardButton && (stepForwardButton.disabled = true);
    playPauseButton && (playPauseButton.disabled = true);
    resetRunButton && (resetRunButton.disabled = true);
    setStatus("Loading WASM...");
    try {
      const wasmUrl = new URL("../../assets/core-as.wasm", import.meta.url);
      core = await loadCore({ wasmUrl });
      ready = true;
      clear(DEFAULT_RUN_HELP_TEXT);

      if (pendingArtifacts) {
        const payload = pendingArtifacts;
        pendingArtifacts = null;
        startRunFromArtifacts(payload);
        return;
      }

      const initialConfig = pendingConfig || (typeof getInitialConfig === "function" ? getInitialConfig() : null);
      pendingConfig = null;
      if (initialConfig) {
        startRun(initialConfig);
      }
    } catch (error) {
      setStatus(`Failed to load: ${error.message}`, "error");
    }
  }

  if (autoBoot) {
    boot();
  }

  inspectorSelectedEntity = normalizeInspectorEntity(actorInspector?.getSelectedEntity?.() || null);

  function setViewerActor(actorId) {
    const normalized = typeof actorId === "string" ? actorId.trim() : "";
    if (!normalized) return;
    visibilityPreferences.viewerActorId = normalized;
    controller?.setViewerActor?.(normalized);
  }

  function performGameAction({ action, actorId } = {}) {
    if (!controller || typeof controller.performRealtimeAction !== "function") {
      return { ok: false, reason: "missing_controller" };
    }
    const result = controller.performRealtimeAction({ action, actorId });
    if (result?.ok === false) {
      if (result.reason === "cast_unimplemented") {
        setStatus("Cast not implemented yet.");
      } else if (result.reason === "actor_not_found") {
        setStatus(`Actor ${result.actorId || "unknown"} is unavailable.`, "error");
      } else if (result.reason === "missing_actor") {
        setStatus("Select an delver or warden first.", "error");
      } else if (result.reason === "unsupported_action") {
        setStatus("Unsupported game action.", "error");
      }
    }
    return result;
  }

  return {
    clear,
    startRun,
    startRunFromArtifacts,
    focusInspectorEntity,
    regenerateLevelArtifacts,
    getLatestLevelArtifacts: () => latestLevelArtifacts,
    getVisibilitySummary: () => (lastVisibilitySummary ? { ...lastVisibilitySummary } : null),
    setViewerActor,
    performGameAction,
    setInspectorVisibility,
    isReady: () => ready,
    dispose: () => {
      controller?.pause?.();
      if (levelBuilder && typeof levelBuilder.dispose === "function") {
        levelBuilder.dispose();
      }
      levelBuilder = null;
    },
  };
}

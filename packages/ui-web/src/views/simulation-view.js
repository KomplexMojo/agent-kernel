import { loadCore } from "../../../bindings-ts/src/core-as.js";
import { runMvpMovement } from "../../../runtime/src/mvp/movement.js";
import { initializeCoreFromArtifacts } from "../../../runtime/src/runner/core-setup.mjs";
import { DEFAULT_AFFINITY_EXPRESSION } from "../../../runtime/src/contracts/domain-constants.js";
import { setupPlayback } from "../movement-ui.js";

const ACTOR_ID_LABEL = "actor_mvp";
const ACTOR_ID_VALUE = 1;

function sortActorsById(initialState) {
  const actors = Array.isArray(initialState?.actors) ? initialState.actors.slice() : [];
  actors.sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  return actors;
}

function buildActorIdMap(initialState, primaryActorId) {
  const actors = sortActorsById(initialState);
  const map = new Map();
  if (typeof primaryActorId === "string" && primaryActorId.trim()) {
    map.set(primaryActorId, primaryActorId);
  }
  actors.forEach((actor, index) => {
    const originalId = typeof actor?.id === "string" && actor.id.trim() ? actor.id.trim() : null;
    const resolvedId = index === 0
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

function cloneAbilities(abilities) {
  if (!Array.isArray(abilities)) return [];
  return abilities
    .filter((ability) => ability && typeof ability === "object" && !Array.isArray(ability))
    .map((ability) => ({ ...ability }));
}

function mapAffinityEffectsActors(entries, actorIdMap) {
  if (!Array.isArray(entries)) return [];
  const mapped = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const rawId = typeof entry.actorId === "string" ? entry.actorId : "";
    const actorId = actorIdMap.get(rawId) || rawId;
    if (!actorId) return;
    const affinityStacks = normalizeAffinityStacks(entry.affinityStacks);
    const abilities = cloneAbilities(entry.abilities);
    if (!affinityStacks && abilities.length === 0) return;
    const next = { actorId };
    if (affinityStacks) next.affinityStacks = affinityStacks;
    if (abilities.length > 0) next.abilities = abilities;
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
    const affinityStacks = normalizeAffinityStacks(traits?.affinities);
    const abilities = cloneAbilities(traits?.abilities);
    if (!affinityStacks && abilities.length === 0) return;
    const next = { actorId };
    if (affinityStacks) next.affinityStacks = affinityStacks;
    if (abilities.length > 0) next.abilities = abilities;
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

export function resolveArtifactAffinityEffects({ initialState, affinityEffects, primaryActorId } = {}) {
  const { actors, map: actorIdMap } = buildActorIdMap(initialState, primaryActorId);
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
} = {}) {
  const frameEl = root.querySelector("#frame-buffer");
  const actorIdEl = root.querySelector("#actor-id-display");
  const actorPosEl = root.querySelector("#actor-pos");
  const actorHpEl = root.querySelector("#actor-hp");
  const actorListEl = root.querySelector("#actor-list");
  const affinityListEl = root.querySelector("#affinity-list");
  const tileActorListEl = root.querySelector("#tile-actor-list");
  const tileActorCountEl = root.querySelector("#tile-actor-count");
  const trapListEl = root.querySelector("#trap-list");
  const trapTabCountEl = root.querySelector("#trap-tab-count");
  const eventStreamEl = root.querySelector("#event-stream");
  const baseTilesEl = root.querySelector("#base-tiles");
  const tickEl = root.querySelector("#tick-indicator");
  const statusEl = root.querySelector("#status-message");
  const stepBackButton = root.querySelector("#step-back");
  const stepForwardButton = root.querySelector("#step-forward");
  const playPauseButton = root.querySelector("#play-pause");
  const resetRunButton = root.querySelector("#reset-run");

  let core = null;
  let controller = null;
  let actions = [];
  let ready = false;
  let pendingConfig = null;
  let pendingArtifacts = null;

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function handleObservation({ observation, playing }) {
    actorInspector?.setActors?.(observation?.actors || [], { tick: observation?.tick });
    actorInspector?.setRunning?.(playing);
  }

  function mountPlayback(config, { initCore } = {}) {
    controller?.pause?.();
    const actorLabel = config?.actorId || ACTOR_ID_LABEL;
    actions = config?.actions || [];
    controller = setupPlayback({
      core,
      actions,
      actorIdLabel: actorLabel,
      actorIdValue: ACTOR_ID_VALUE,
      affinityEffects: config?.affinityEffects,
      elements: {
        frame: frameEl,
        actorId: actorIdEl,
        actorPos: actorPosEl,
        actorHp: actorHpEl,
        actorList: actorListEl,
        affinityList: affinityListEl,
        tileActorList: tileActorListEl,
        tileActorCount: tileActorCountEl,
        trapList: trapListEl,
        trapCount: trapTabCountEl,
        eventStream: eventStreamEl,
        baseTiles: baseTilesEl,
        tick: tickEl,
        status: statusEl,
        playButton: playPauseButton,
        stepBack: stepBackButton,
        stepForward: stepForwardButton,
        reset: resetRunButton,
      },
      onObservation: handleObservation,
      initCore,
    });
  }

  function startRun(config) {
    if (!config) return;
    if (!ready || !core) {
      pendingConfig = config;
      return;
    }
    try {
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
      setStatus("Ready");
    } catch (err) {
      setStatus(err.message || "Failed to start run");
      console.error(err);
    }
  }

  function startRunFromArtifacts({ simConfig, initialState, affinityEffects } = {}) {
    if (!ready || !core) {
      pendingArtifacts = { simConfig, initialState, affinityEffects };
      return;
    }
    try {
      const actorLabel = sortActorsById(initialState)[0]?.id || "actor_bundle";
      const resolvedAffinityEffects = resolveArtifactAffinityEffects({
        initialState,
        affinityEffects,
        primaryActorId: actorLabel,
      });
      mountPlayback(
        {
          actorId: actorLabel,
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
      setStatus("Ready (bundle artifacts).");
    } catch (err) {
      setStatus(err.message || "Failed to start bundle run");
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
      }
    });
  }

  stepForwardButton?.addEventListener("click", () => controller?.stepForward?.());
  stepBackButton?.addEventListener("click", () => controller?.stepBack?.());
  playPauseButton?.addEventListener("click", () => controller?.toggle?.());
  resetRunButton?.addEventListener("click", () => controller?.reset?.());

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
      setStatus("Ready");

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
      setStatus(`Failed to load: ${error.message}`);
    }
  }

  if (autoBoot) {
    boot();
  }

  return {
    startRun,
    startRunFromArtifacts,
    isReady: () => ready,
  };
}

/**
 * affinity-field-bridge.js
 *
 * Connects the WASM core affinity field computation to the UI tile visuals
 * pipeline. Loads core-as WASM, initialises it from the bundle's SimConfig +
 * InitialState, reads the computed field records, and returns renderer-ready
 * tile visuals via deriveTileAffinityVisuals.
 *
 * Dependency direction: ui-web → runtime → bindings-ts → core-as  (valid)
 */

import { loadCore } from "../../../bindings-ts/src/core-as.js";
import { readAffinityFieldAt, AFFINITY_KIND_BY_CODE } from "../../../bindings-ts/src/affinity-readers.js";
import { initializeCoreFromArtifacts } from "../../../runtime/src/runner/core-setup.mjs";
import { deriveTileAffinityVisuals } from "./tile-affinity-visuals.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";

// All 10 affinity kind codes (1–10)
const ALL_KIND_CODES = Object.keys(AFFINITY_KIND_BY_CODE).map(Number);

let corePromise = null;

/**
 * Lazily load the WASM core (cached across calls).
 * Falls back gracefully — returns null if WASM is unavailable.
 */
function getCore() {
  if (!corePromise) {
    const wasmUrl = new URL("../../assets/core-as.wasm", import.meta.url);
    corePromise = loadCore({ wasmUrl }).catch((err) => {
      console.warn("[affinity-field-bridge] WASM load failed, falling back to JS path:", err.message);
      corePromise = null;
      return null;
    });
  }
  return corePromise;
}

function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((a) => a?.schema === schema) || null;
}

/**
 * Read all non-zero field records from the core after field computation.
 * Returns an array of { x, y, kind, kindCode, intensity, stacks, expression,
 * expressionName, contributionCount }.
 */
function readAllFieldRecords(core, width, height) {
  const records = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (const kindCode of ALL_KIND_CODES) {
        const field = readAffinityFieldAt(core, x, y, kindCode);
        if (field.intensity > 0) {
          records.push({
            x,
            y,
            kind: AFFINITY_KIND_BY_CODE[kindCode] || "unknown",
            kindCode,
            intensity: field.intensity,
            stacks: field.stacks,
            expression: field.expression,
            expressionName: field.expressionName,
            contributionCount: field.contributionCount,
          });
        }
      }
    }
  }
  return records;
}

/**
 * Build tile affinity visuals from a bundle using the WASM core pipeline.
 *
 * Pipeline: bundle → initializeCoreFromArtifacts → computeAffinityField →
 * readAllFieldRecords → deriveTileAffinityVisuals({ fieldRecords })
 *
 * Falls back to the JS hazard-spread path if WASM is unavailable.
 *
 * @param {object} bundle - The artifact bundle
 * @returns {Map<string, object>} - Tile visuals map for the renderer
 */
export async function buildTileAffinityVisualsFromBundle(bundle) {
  const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
  const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA);
  const resourceBundle = findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA);
  const layoutData = simConfig?.layout?.data || {};
  const tiles = Array.isArray(layoutData.tiles) ? layoutData.tiles : [];
  const hazards = Array.isArray(layoutData.hazards) ? layoutData.hazards : [];

  // Try WASM path
  const core = await getCore();
  if (core && simConfig && initialState) {
    try {
      const result = initializeCoreFromArtifacts(core, { simConfig, initialState });
      if (result.layout?.ok) {
        const width = result.layout.dimensions?.width || 0;
        const height = result.layout.dimensions?.height || 0;
        if (width > 0 && height > 0) {
          const fieldRecords = readAllFieldRecords(core, width, height);
          if (fieldRecords.length > 0) {
            return deriveTileAffinityVisuals({ fieldRecords, resourceBundle });
          }
        }
      }
    } catch (err) {
      console.warn("[affinity-field-bridge] WASM field computation failed, falling back to JS:", err.message);
    }
  }

  // JS fallback — hazard-based spread
  return deriveTileAffinityVisuals({ tiles, hazards, resourceBundle });
}

/**
 * Synchronous wrapper that returns a function suitable for the
 * buildTileAffinityVisualsFromBundleFn injection point.
 *
 * Because the WASM path is async (loadCore), but the view expects a
 * synchronous return from buildTileVisualsFn, we cache the last result
 * and trigger an async re-compute. On first call the JS fallback runs
 * synchronously; subsequent calls after WASM loads get field records.
 */
export function createAffinityFieldBridge() {
  let cachedVisuals = null;
  let lastBundleRef = null;

  // Kick off WASM load immediately so it's ready before first render
  getCore();

  /**
   * Synchronous entry point for the view layer.
   * Returns the JS-fallback visuals immediately; triggers async WASM
   * computation in background to upgrade on next render.
   */
  function buildVisualsSync(bundle) {
    // If same bundle reference, return cached
    if (bundle === lastBundleRef && cachedVisuals) {
      return cachedVisuals;
    }
    lastBundleRef = bundle;

    // Synchronous JS fallback for immediate return
    const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
    const resourceBundle = findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA);
    const layoutData = simConfig?.layout?.data || {};
    const tiles = Array.isArray(layoutData.tiles) ? layoutData.tiles : [];
    const hazards = Array.isArray(layoutData.hazards) ? layoutData.hazards : [];
    cachedVisuals = deriveTileAffinityVisuals({ tiles, hazards, resourceBundle });

    // Fire-and-forget: upgrade to WASM visuals in background
    buildTileAffinityVisualsFromBundle(bundle).then((wasmVisuals) => {
      if (bundle === lastBundleRef && wasmVisuals.size > 0) {
        cachedVisuals = wasmVisuals;
      }
    }).catch(() => {
      // JS fallback already applied — nothing to do
    });

    return cachedVisuals;
  }

  return buildVisualsSync;
}

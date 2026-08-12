/**
 * affinity-field-bridge.js
 *
 * Connects the core affinity field computation to the UI tile visuals
 * pipeline. Initialises a core from the bundle's SimConfig + InitialState,
 * reads the computed field records, and returns renderer-ready tile visuals
 * via deriveTileAffinityVisuals.
 *
 * Dependency direction: ui-web -> runtime -> core-ts
 */

import {
  createRuntimeCore,
  readCoreAffinityFieldRecordsFromArtifacts,
} from "../../../runtime/src/runner/core-facade.js";
import { deriveTileAffinityVisuals } from "./tile-affinity-visuals.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";

let cachedCore = null;

function getCore() {
  if (!cachedCore) {
    cachedCore = createRuntimeCore();
  }
  return cachedCore;
}

function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((a) => a?.schema === schema) || null;
}

/**
 * Build tile affinity visuals from a bundle using the core field pipeline.
 *
 * Pipeline: bundle -> initializeCoreFromArtifacts -> computeAffinityField ->
 * readAllFieldRecords -> deriveTileAffinityVisuals({ fieldRecords })
 *
 * Falls back to the hazard-spread path if the field path cannot produce records.
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

  const core = getCore();
  if (core && simConfig && initialState) {
    try {
      const result = readCoreAffinityFieldRecordsFromArtifacts(core, { simConfig, initialState });
      if (result.fieldRecords.length > 0) {
        return deriveTileAffinityVisuals({ fieldRecords: result.fieldRecords, resourceBundle });
      }
    } catch (err) {
      console.warn("[affinity-field-bridge] Field computation failed, falling back:", err.message);
    }
  }

  // Hazard-based spread fallback.
  return deriveTileAffinityVisuals({ tiles, hazards, resourceBundle });
}

/**
 * Build tile affinity visuals from a sandbox bundle
 * `{ simConfig, initialState, resourceBundle? }`.
 *
 * Accepts the sandbox bundle shape directly (no wrapping `artifacts` array needed).
 * Pipeline: simConfig + initialState -> initializeCoreFromArtifacts ->
 *   readAllFieldRecords -> deriveTileAffinityVisuals({ fieldRecords })
 *
 * Falls back to the hazard-spread JS path when the field pipeline cannot
 * produce records (missing actors, unsupported layout, etc.).
 *
 * @param {{ simConfig: object, initialState: object, resourceBundle?: object }} sandboxBundle
 * @returns {Promise<Map<string, object>>}
 */
export async function buildTileAffinityVisualsFromSandboxBundle({
  simConfig,
  initialState,
  resourceBundle = null,
} = {}) {
  const layoutData = simConfig?.layout?.data || {};
  const tiles   = Array.isArray(layoutData.tiles)   ? layoutData.tiles   : [];
  const hazards = Array.isArray(layoutData.hazards) ? layoutData.hazards : [];

  const core = getCore();
  if (core && simConfig && initialState) {
    try {
      const result = readCoreAffinityFieldRecordsFromArtifacts(core, { simConfig, initialState });
      if (result.fieldRecords.length > 0) {
        return deriveTileAffinityVisuals({ fieldRecords: result.fieldRecords, resourceBundle });
      }
    } catch (err) {
      console.warn(
        "[affinity-field-bridge] Sandbox field computation failed, falling back:",
        err.message,
      );
    }
  }

  // Hazard-based spread fallback.
  return deriveTileAffinityVisuals({ tiles, hazards, resourceBundle });
}

/**
 * Synchronous wrapper that returns a function suitable for the
 * buildTileAffinityVisualsFromBundleFn injection point.
 */
export function createAffinityFieldBridge() {
  let cachedVisuals = null;
  let lastBundleRef = null;

  /**
   * Synchronous entry point for the view layer.
   */
  function buildVisualsSync(bundle) {
    // If same bundle reference, return cached
    if (bundle === lastBundleRef && cachedVisuals) {
      return cachedVisuals;
    }
    lastBundleRef = bundle;

    const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
    const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA);
    const resourceBundle = findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA);
    const layoutData = simConfig?.layout?.data || {};
    const tiles = Array.isArray(layoutData.tiles) ? layoutData.tiles : [];
    const hazards = Array.isArray(layoutData.hazards) ? layoutData.hazards : [];

    cachedVisuals = deriveTileAffinityVisuals({ tiles, hazards, resourceBundle });
    const core = getCore();
    if (core && simConfig && initialState) {
      try {
        const result = readCoreAffinityFieldRecordsFromArtifacts(core, { simConfig, initialState });
        if (result.fieldRecords.length > 0) {
          cachedVisuals = deriveTileAffinityVisuals({ fieldRecords: result.fieldRecords, resourceBundle });
        }
      } catch {
        // Hazard fallback already applied.
      }
    }

    return cachedVisuals;
  }

  return buildVisualsSync;
}

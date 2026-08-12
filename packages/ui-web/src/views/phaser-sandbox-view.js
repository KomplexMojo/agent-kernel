// Standalone Phaser sandbox view — wraps createGameplayPhaserRenderer.
//
// Responsibilities:
//   - Convert a sandbox bundle { simConfig, initialState, resourceBundle? } into
//     the boardState format expected by the renderer.
//   - Partition actors by archetype: delver/warden → observation.actors,
//     hazard → observation.hazards, resource → observation.resources.
//   - Forward arrow-key and WASD "keydown" events as movement intents via
//     onMovementIntent({ direction }) without implementing game rules.
//
// Does NOT fork createGameplayPhaserRenderer — reuses it wholesale.

import { createGameplayPhaserRenderer } from "./gameplay-phaser-renderer.js";
import { buildTileAffinityVisualsFromSandboxBundle } from "./affinity-field-bridge.js";

// ---------------------------------------------------------------------------
// Key → direction mapping (keys arrive lower-cased from the renderer)
// ---------------------------------------------------------------------------

const KEY_DIRECTION_MAP = {
  arrowup:    "north",
  arrowdown:  "south",
  arrowleft:  "west",
  arrowright: "east",
  w:          "north",
  s:          "south",
  a:          "west",
  d:          "east",
};

// ---------------------------------------------------------------------------
// Bundle → boardState conversion
// ---------------------------------------------------------------------------

function sandboxBundleToBoardState(bundle) {
  const simConfig     = bundle?.simConfig    || null;
  const initialState  = bundle?.initialState || null;
  const resourceBundle = bundle?.resourceBundle || null;

  const layoutData  = simConfig?.layout?.data || {};
  const tiles       = Array.isArray(layoutData.tiles) ? layoutData.tiles : [];
  const boardWidth  = Number.isFinite(layoutData.width)  && layoutData.width  > 0
    ? layoutData.width
    : (tiles[0]?.length || 0);
  const boardHeight = Number.isFinite(layoutData.height) && layoutData.height > 0
    ? layoutData.height
    : tiles.length;

  const actors    = [];
  const hazards   = [];
  const resources = [];

  for (const actor of (initialState?.actors || [])) {
    const archetype = String(actor?.archetype || "");
    if (archetype === "hazard") {
      hazards.push(actor);
    } else if (archetype === "resource") {
      resources.push(actor);
    } else {
      // ambulatory actors (delver, warden) and anything unrecognised
      actors.push(actor);
    }
  }

  return {
    tiles,
    boardWidth,
    boardHeight,
    simConfig,
    initialState,
    observation: { actors, hazards, resources },
    resourceBundle,
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createPhaserSandboxView({
  loadPhaser,
  onMovementIntent,
  onSelect,
  onHover,
  onHoverEnd,
} = {}) {
  const renderer = createGameplayPhaserRenderer({
    loadPhaser,
    onSelect,
    onHover,
    onHoverEnd,
    // The renderer lowercases event.key before forwarding it here.
    onKeyPress({ key }) {
      const direction = KEY_DIRECTION_MAP[String(key || "")];
      if (direction && typeof onMovementIntent === "function") {
        onMovementIntent({ direction });
      }
    },
  });

  return {
    /** Attach the renderer to a DOM container element. */
    mount(container) {
      renderer.mount(container);
    },

    /**
     * Convert a sandbox bundle and draw it with the renderer.
     * Computes affinity tile visuals via the affinity-field-bridge when the
     * bundle contains simConfig hazards, then resets the camera.
     *
     * @param {{ simConfig, initialState, resourceBundle? }} bundle
     */
    async renderBundle(bundle) {
      const boardState = sandboxBundleToBoardState(bundle);
      // Compute affinity visuals (async; field-records path preferred, hazard-spread fallback).
      try {
        const tileVisuals = await buildTileAffinityVisualsFromSandboxBundle({
          simConfig:     bundle?.simConfig    || null,
          initialState:  bundle?.initialState || null,
          resourceBundle: bundle?.resourceBundle || null,
        });
        if (tileVisuals instanceof Map && tileVisuals.size > 0) {
          boardState.tileVisuals = tileVisuals;
        }
      } catch {
        // Non-fatal: render without affinity visuals if the bridge fails.
      }
      return renderer.renderRun(boardState);
    },

    /** Tear down the Phaser game instance. */
    dispose() {
      renderer.dispose();
    },

    /**
     * Expose the underlying renderer so callers can call zoom, pan,
     * highlight, etc. without the view needing to re-proxy every method.
     */
    getRenderer() {
      return renderer;
    },
  };
}

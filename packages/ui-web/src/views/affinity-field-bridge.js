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

import { readCoreAffinityFieldRecordsFromArtifacts } from "../../../runtime/src/runner/core-facade.js";
import { deriveTileAffinityVisuals } from "./tile-affinity-visuals.js";
import {
  INITIAL_STATE_SCHEMA,
  RESOURCE_BUNDLE_SCHEMA,
  SIM_CONFIG_SCHEMA,
} from "../../../runtime/src/contracts/artifacts.ts";


function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((a) => a?.schema === schema) || null;
}

function presentationCategory(actor, presentation) {
  const fromActor = actor?.category ?? actor?.presentation?.category;
  if (typeof fromActor === "string" && fromActor.trim()) return fromActor.trim().toLowerCase();
  const id = typeof actor?.id === "string" ? actor.id : "";
  const fromMap = id ? presentation?.[id]?.category : "";
  if (typeof fromMap === "string" && fromMap.trim()) return fromMap.trim().toLowerCase();
  return "";
}

function hazardVisualsFromState(initialState) {
  const presentation = initialState?.presentation ?? {};
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  return actors
    .filter((actor) => {
      const category = presentationCategory(actor, presentation);
      return category === "hazard" || category === "hazards";
    })
    .map((actor) => {
      const stacks = Array.isArray(actor.affinities) ? actor.affinities : [];
      return {
        ...actor,
        entityType: "hazard",
        position: actor.position,
        affinityStacks: stacks,
        emitStrength: stacks[0]?.stacks ?? 0,
      };
    });
}

function tilesFromLayout(layoutData) {
  const width = layoutData?.width;
  const height = layoutData?.height;
  const terrain = layoutData?.terrain;
  if (Array.isArray(terrain) && Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0 && terrain.length === width * height) {
    const glyphs = { wall: "#", floor: ".", spawn: "S", exit: "E" };
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        row += glyphs[terrain[y * width + x]] || ".";
      }
      rows.push(row);
    }
    return rows;
  }
  if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0) {
    return Array.from({ length: height }, () => ".".repeat(width));
  }
  return [];
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
  const tiles = tilesFromLayout(layoutData);
  const hazards = hazardVisualsFromState(initialState);

  if (simConfig && initialState) {
    try {
      const result = readCoreAffinityFieldRecordsFromArtifacts({ simConfig, initialState });
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

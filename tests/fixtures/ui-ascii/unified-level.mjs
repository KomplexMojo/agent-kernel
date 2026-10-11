/**
 * Build a unified-actor level (SimConfig + InitialState) from a hand-drawn maze,
 * through the Configurator's own artifact builders, so a test or a hand-written
 * level never restates the artifact shape.
 *
 * `tiles` are rows of `#` wall, `.` floor, `S` spawn and `E` exit. Each actor is
 * a Configurator authoring request (`category`, `id`, `position`, `vitals`, ...).
 */
import { createConfiguratorPersona } from "../../../packages/runtime/src/personas/configurator/controller.js";

const CLOCK = "2026-10-11T00:00:00.000Z";
const TERRAIN_BY_TILE = Object.freeze({ "#": "wall", ".": "floor", S: "spawn", E: "exit" });

export function terrainFromTiles(tiles) {
  return tiles.flatMap((row) => row.split("").map((tile) => {
    const kind = TERRAIN_BY_TILE[tile];
    if (!kind) throw new Error(`unknown tile "${tile}"`);
    return kind;
  }));
}

/** Vitals that meet the actor viability floor (10 max, 1 regen each). */
export function viableVitals({ health = 10, mana = 10, stamina = 12, durability = 10 } = {}) {
  return {
    health: { current: health, max: health, regen: 1 },
    mana: { current: mana, max: mana, regen: 1 },
    stamina: { current: stamina, max: stamina, regen: 2 },
    durability: { current: durability, max: durability, regen: 1 },
  };
}

export function buildUnifiedLevel({ id, tiles, actors, seed = 0, approaches = {} }) {
  const configurator = createConfiguratorPersona({ clock: () => CLOCK });
  const width = tiles[0].length;
  const height = tiles.length;
  const terrain = terrainFromTiles(tiles);
  const meta = (kind) => ({ id: `${id}_${kind}`, runId: id, createdAt: CLOCK, producedBy: "test" });
  const simConfig = configurator.buildSimConfigArtifact({
    meta: meta("sim_config"),
    planRef: { id: `${id}_plan`, schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    seed,
    layout: { width, height, terrain, ...approaches },
    movementStamina: configurator.assembleMovementStamina({ actors }),
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: meta("initial_state"),
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width, height },
    terrain,
    actors,
  });
  return { simConfig, initialState };
}

// ## TODO: Test Permutations

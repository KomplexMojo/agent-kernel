import { generateGridLayoutFromInput } from "./level-layout.js";
import {
  LAYOUT_TILE_FIELDS,
  normalizeLayoutCounts,
  sumLayoutTiles,
} from "../../contracts/domain-constants.js";

const WALKABLE_DENSITY_TARGET = 0.5;

/**
 * CR.4 M5b.2f — above this many walkable tiles, feasibility is APPROXIMATED.
 *
 * `validateLayoutCountsAndActors` materializes the grid to answer exactly
 * (`generateGridLayoutFromInput`), which is unaffordable at this scale. So above the
 * threshold the verdict is computed from the tile COUNTS alone: enough floor tiles for the
 * actors, and nothing else.
 *
 * ⚠️ **This constant and the approximation it selects are FEASIBILITY POLICY, and they lived
 * in `personas/orchestrator/llm-budget-loop.js` until 2026-08-08** — the Orchestrator
 * deciding, for large levels, what "feasible" means. Threading the loop's two
 * `validateLayout*` calls out to this persona while leaving the threshold behind would have
 * cleared both allowlist rows and moved no decision, which is M5b.2c's finding exactly.
 */
export const MAX_EXACT_LAYOUT_FEASIBILITY_TILES = 1_000_000;

function pushError(errors, field, code, detail) {
  const entry = { field, code };
  if (detail !== undefined) entry.detail = detail;
  errors.push(entry);
}

function positionKey(pos) {
  return `${pos.x},${pos.y}`;
}

function collectWalkablePositions(layout) {
  const data = layout?.data || layout;
  if (!data) return [];

  const walkable = [];
  const hazards = Array.isArray(data.hazards) ? data.hazards : [];
  const blockingHazards = new Set(
    hazards
      .filter((hazard) => hazard && hazard.blocking === true)
      .map((hazard) => `${hazard.x},${hazard.y}`),
  );

  if (Array.isArray(data.kinds)) {
    for (let y = 0; y < data.kinds.length; y += 1) {
      const row = data.kinds[y] || [];
      for (let x = 0; x < row.length; x += 1) {
        const kind = row[x];
        if (kind === 1) continue;
        if (kind === 2 && blockingHazards.has(`${x},${y}`)) continue;
        walkable.push({ x, y });
      }
    }
    return walkable;
  }

  if (Array.isArray(data.tiles)) {
    const legend = data.legend || {};
    for (let y = 0; y < data.tiles.length; y += 1) {
      const row = String(data.tiles[y] ?? "");
      for (let x = 0; x < row.length; x += 1) {
        const char = row[x];
        const entry = legend[char];
        const tileType = entry?.tile;
        if (tileType === "wall" || tileType === "barrier" || tileType === "spawn" || tileType === "exit") continue;
        if (char === "#" || char === "B" || char === "S" || char === "E") continue;
        walkable.push({ x, y });
      }
    }
  }

  return walkable;
}

function normalizeLayoutCount(value, field, errors) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    pushError(errors, `layout.${field}`, "invalid_tile_count", value);
    return 0;
  }
  return value;
}

/**
 * The FEASIBILITY reader: every field gets a number so the walkable-area arithmetic below
 * always has one, and anything wrong is an ERROR rather than a warning — an infeasible
 * layout must fail loudly here, not be quietly costed.
 *
 * ⚠️ RENAMED 2026-08-08 (D8-V), for the same reason as
 * `prompt-contract.js#normalizeLayoutCountsStrict`. It shares neither its diagnostics
 * channel (errors, not warnings), its missing-layout code (`missing_layout`, not
 * `invalid_layout`) nor its string handling with the shared reader in
 * `contracts/domain-constants.js`. Deliberately not merged: these codes are asserted by
 * feasibility tests and read by callers.
 */
function normalizeLayoutCountsOrZero(layout, errors) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    pushError(errors, "layout", "missing_layout");
    return null;
  }
  const counts = {};
  LAYOUT_TILE_FIELDS.forEach((field) => {
    counts[field] = normalizeLayoutCount(layout[field], field, errors);
  });

  return counts;
}

function deriveLevelSideForWalkableTiles(totalTiles, minSide = 5) {
  const normalizedTotalTiles = Number.isInteger(totalTiles) && totalTiles > 0 ? totalTiles : 1;
  const interiorArea = Math.ceil(normalizedTotalTiles / WALKABLE_DENSITY_TARGET);
  const interiorSide = Math.ceil(Math.sqrt(interiorArea));
  return Math.max(minSide, interiorSide + 2);
}

function deriveLevelGenFromCounts(counts, minSide) {
  const totalTiles = (counts.floorTiles || 0) + (counts.hallwayTiles || 0);
  const side = deriveLevelSideForWalkableTiles(totalTiles, minSide);
  const levelGen = {
    width: side,
    height: side,
    shape: {},
  };
  if (totalTiles > 0) {
    levelGen.walkableTilesTarget = totalTiles;
  }
  return levelGen;
}

function collectFloorPositions(layout) {
  const data = layout?.data || layout;
  if (!data) return [];

  const floors = [];
  const hazards = Array.isArray(data.hazards) ? data.hazards : [];
  const blockingHazards = new Set(
    hazards
      .filter((hazard) => hazard && hazard.blocking === true)
      .map((hazard) => `${hazard.x},${hazard.y}`),
  );

  if (Array.isArray(data.kinds)) {
    for (let y = 0; y < data.kinds.length; y += 1) {
      const row = data.kinds[y] || [];
      for (let x = 0; x < row.length; x += 1) {
        const kind = row[x];
        if (kind !== 0) continue;
        if (blockingHazards.has(`${x},${y}`)) continue;
        floors.push({ x, y });
      }
    }
    return floors;
  }

  if (Array.isArray(data.tiles)) {
    const legend = data.legend || {};
    for (let y = 0; y < data.tiles.length; y += 1) {
      const row = String(data.tiles[y] ?? "");
      for (let x = 0; x < row.length; x += 1) {
        const char = row[x];
        const entry = legend[char];
        const tileType = entry?.tile;
        if (tileType === "floor") {
          floors.push({ x, y });
        }
      }
    }
  }

  return floors;
}

/**
 * `assessActorFit` (ITEM C-c, 2026-08-12) exists because the actor fit must have ONE origin.
 *
 * This function answers it from the MATERIALIZED grid; `validateLayoutCountsAndActors` answers
 * it from the caller's DECLARED counts and then delegates here for the geometry checks. Both
 * ran, so both pushed `insufficient_floor_tiles` and the caller received the same cause twice.
 * The declared count is the authoritative one — see the delegation site for why — so that
 * caller passes `false` and this check is skipped there.
 *
 * It stays `true` by default because the absent-layout path calls this directly with a
 * caller-supplied levelGen, where there are no declared counts to consult and this is the only
 * actor-fit answer available.
 */
export function validateLayoutAndActors({ levelGen, actorCount = 0, assessActorFit = true } = {}) {
  const errors = [];
  if (!levelGen || typeof levelGen !== "object" || Array.isArray(levelGen)) {
    pushError(errors, "levelGen", "invalid_level_gen");
    return { ok: false, errors, layout: null };
  }

  const layoutResult = generateGridLayoutFromInput(levelGen);
  if (!layoutResult.ok) {
    layoutResult.errors.forEach((err) => {
      pushError(errors, `levelGen.${err.field || "unknown"}`, err.code || "invalid_level_gen");
    });
    return { ok: false, errors, layout: null };
  }

  const layout = layoutResult.value;
  const walkable = collectWalkablePositions(layout);
  if (walkable.length === 0) {
    pushError(errors, "layout", "no_walkable_tiles");
  }
  const walkableTilesTarget = Number.isInteger(levelGen.walkableTilesTarget) && levelGen.walkableTilesTarget > 0
    ? levelGen.walkableTilesTarget
    : null;
  if (walkableTilesTarget !== null && walkable.length !== walkableTilesTarget) {
    pushError(errors, "layout.walkableTilesTarget", "target_mismatch", {
      target: walkableTilesTarget,
      walkableTiles: walkable.length,
    });
  }

  const walkableSet = new Set(walkable.map(positionKey));
  const layoutData = layout?.data || layout;
  const spawnApproach = layoutData?.spawnApproach || null;
  const exitApproach = layoutData?.exitApproach || null;
  if (spawnApproach) {
    const key = positionKey(spawnApproach);
    if (!walkableSet.has(key)) {
      pushError(errors, "layout.spawnApproach", "spawn_approach_not_walkable", spawnApproach);
    }
  }
  if (exitApproach) {
    const key = positionKey(exitApproach);
    if (!walkableSet.has(key)) {
      pushError(errors, "layout.exitApproach", "exit_approach_not_walkable", exitApproach);
    }
  }
  // Portal-on-wall is enforced at generation time (level-layout). Feasibility only
  // checks approach walkability when approaches are present, so count-only and
  // legacy floor-spawn fixtures keep their characterized verdicts.

  if (assessActorFit && Number.isInteger(actorCount) && actorCount > 0) {
    const floors = collectFloorPositions(layout);
    if (floors.length < actorCount) {
      pushError(errors, "actors", "insufficient_floor_tiles", {
        actorCount,
        floorTiles: floors.length,
      });
    }
  }

  return { ok: errors.length === 0, errors, layout };
}

/**
 * CR.4 M5b.2f — "can this level host these actors?", the whole decision in one place.
 *
 * Moved VERBATIM from `llm-budget-loop.js#validateFeasibility` (2026-08-08). It dispatches
 * between three answers, and choosing between them is the part that had no owner:
 *
 *   1. a valid layout above `MAX_EXACT_LAYOUT_FEASIBILITY_TILES` → approximate from counts
 *   2. any other layout                                          → `validateLayoutCountsAndActors`
 *   3. no layout at all                                          → `validateLayoutAndActors`
 *                                                                   on a caller-supplied levelGen
 *
 * The caller supplies `levelGen` rather than a `roomCount` because deriving level geometry
 * from an intent is the DIRECTOR's translation, and the Configurator asking the Director for
 * it would be a reverse edge — the exact leg D8.1 removed. The Director derives, then asks.
 *
 * ⚠️ `tests/personas/configurator/configurator-layout-feasibility.test.js` replays 185 cases
 * captured from the pre-move implementation. **If one fails, do not re-record it** — it is
 * the only evidence the verdicts did not shift, and a drifted approximation still returns a
 * well-formed `{ ok, errors }` that nothing downstream could question.
 */
export function assessLayoutFeasibility({ layout, levelGen, actorCount = 0 } = {}) {
  if (layout) {
    const normalizationWarnings = [];
    const normalizedLayout = normalizeLayoutCounts(layout, normalizationWarnings);
    const hasInvalidCounts = normalizationWarnings.some((warning) => (
      warning?.code === "invalid_layout" || warning?.code === "invalid_tile_count"
    ));
    const walkableTiles = sumLayoutTiles(normalizedLayout);
    if (normalizedLayout && !hasInvalidCounts && walkableTiles > MAX_EXACT_LAYOUT_FEASIBILITY_TILES) {
      // ITEM C (2026-08-12) — a `walkableTiles <= 0` check emitting `empty_layout` stood here
      // and has been REMOVED. Reaching this branch requires
      // `walkableTiles > MAX_EXACT_LAYOUT_FEASIBILITY_TILES`, so the test could never be true:
      // dead by construction, not merely unexercised. A zero tile count takes the exact path
      // instead, where `validateLayoutCountsAndActors` emits `empty_layout` for real — pinned
      // by `configurator-layout-feasibility.test.js`, which also records that no perturbation
      // can prove this removal, because unreachable code has no distinguishing input.
      const errors = [];
      if (Number.isInteger(actorCount) && actorCount > 0) {
        const floorTiles = normalizedLayout.floorTiles || 0;
        if (floorTiles < actorCount) {
          errors.push({
            field: "actors",
            code: "insufficient_floor_tiles",
            detail: {
              actorCount,
              floorTiles,
            },
          });
        }
      }
      return { ok: errors.length === 0, errors };
    }
    const result = validateLayoutCountsAndActors({ layout, actorCount });
    return { ok: result.ok, errors: result.errors || [] };
  }
  const result = validateLayoutAndActors({ levelGen, actorCount });
  return { ok: result.ok, errors: result.errors || [] };
}

export function validateLayoutCountsAndActors({ layout, actorCount = 0, minSide = 5 } = {}) {
  const errors = [];
  const counts = normalizeLayoutCountsOrZero(layout, errors);
  if (!counts) {
    return { ok: false, errors, layout: null, levelGen: null };
  }
  const totalTiles = (counts.floorTiles || 0) + (counts.hallwayTiles || 0);
  if (totalTiles <= 0) {
    pushError(errors, "layout", "empty_layout");
  }
  if (Number.isInteger(actorCount) && actorCount > 0) {
    const floorTiles = counts.floorTiles || 0;
    if (floorTiles < actorCount) {
      pushError(errors, "actors", "insufficient_floor_tiles", {
        actorCount,
        floorTiles,
      });
    }
  }
  const levelGen = deriveLevelGenFromCounts(counts, minSide);
  /**
   * ITEM C-c (2026-08-12) — the actor fit is decided ONCE, above, from the caller's DECLARED
   * counts. The delegate is asked only to validate the DERIVED geometry (walkability, spawn,
   * target match), hence `assessActorFit: false`.
   *
   * Until now both checks ran and both pushed `insufficient_floor_tiles`, so the exact path
   * reported one cause twice — 31 of the 185 characterization cases, 20 of them with two
   * DIFFERENT numbers. The duplicate was not a redundant copy but a misleading one: it reported
   * the floor count of the level `deriveLevelGenFromCounts` invented, so a layout declaring
   * `floorTiles: 0` produced `insufficient_floor_tiles` with `floorTiles: 9` — the 9 floors of
   * the 5×5 minimum-side fallback, geometry the caller never asked for.
   *
   * ⚠️ THE DECLARED COUNT IS KEPT AND THE DERIVED ONE DROPPED, not the other way round. The
   * grid's floor count is an artifact of a derivation this function performed, while the
   * declared count is the caller's own input, which is what "can this layout host these actors"
   * asks about. `configurator-feasibility.test.js` already asserted exactly that: it reads the
   * error's `detail.floorTiles` and expects the DECLARED 5, not the grid's number.
   *
   * Dropping it loses no coverage, and that was measured rather than assumed: across all 185
   * cases the grid check fires only when the counts check has already fired (0 grid-only). It
   * cannot be otherwise — the derived level targets `floorTiles + hallwayTiles` walkable tiles,
   * so its floor count cannot fall below `floorTiles` without `target_mismatch`, which is the
   * error that genuinely reports an undershooting generator.
   */
  const result = validateLayoutAndActors({ levelGen, actorCount, assessActorFit: false });
  return {
    ok: errors.length === 0 && result.ok,
    errors: [...errors, ...(result.errors || [])],
    layout: result.layout,
    levelGen,
  };
}

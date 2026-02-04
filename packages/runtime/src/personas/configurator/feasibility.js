import { generateGridLayoutFromInput } from "./level-layout.js";

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
  const traps = Array.isArray(data.traps) ? data.traps : [];
  const blockingTraps = new Set(
    traps
      .filter((trap) => trap && trap.blocking === true)
      .map((trap) => `${trap.x},${trap.y}`),
  );

  if (Array.isArray(data.kinds)) {
    for (let y = 0; y < data.kinds.length; y += 1) {
      const row = data.kinds[y] || [];
      for (let x = 0; x < row.length; x += 1) {
        const kind = row[x];
        if (kind === 1) continue;
        if (kind === 2 && blockingTraps.has(`${x},${y}`)) continue;
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
        if (tileType === "wall" || tileType === "barrier") continue;
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

function normalizeLayoutCounts(layout, errors) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    pushError(errors, "layout", "missing_layout");
    return null;
  }
  return {
    wallTiles: normalizeLayoutCount(layout.wallTiles, "wallTiles", errors),
    floorTiles: normalizeLayoutCount(layout.floorTiles, "floorTiles", errors),
    hallwayTiles: normalizeLayoutCount(layout.hallwayTiles, "hallwayTiles", errors),
  };
}

function deriveLevelGenFromCounts(counts, minSide) {
  const totalTiles = (counts.wallTiles || 0) + (counts.floorTiles || 0) + (counts.hallwayTiles || 0);
  const side = Math.max(minSide, Math.ceil(Math.sqrt(Math.max(1, totalTiles))));
  return {
    width: side,
    height: side,
    shape: { profile: "rectangular" },
  };
}

export function validateLayoutAndActors({ levelGen, actorCount = 0 } = {}) {
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

  const walkableSet = new Set(walkable.map(positionKey));
  const spawn = (layout?.data || layout)?.spawn || null;
  if (spawn) {
    const spawnKey = positionKey(spawn);
    if (!walkableSet.has(spawnKey)) {
      pushError(errors, "layout.spawn", "spawn_not_walkable", spawn);
    }
  }

  if (Number.isInteger(actorCount) && actorCount > 0) {
    if (walkable.length < actorCount) {
      pushError(errors, "actors", "insufficient_walkable_tiles", {
        actorCount,
        walkableTiles: walkable.length,
      });
    }
  }

  return { ok: errors.length === 0, errors, layout };
}

export function validateLayoutCountsAndActors({ layout, actorCount = 0, minSide = 5 } = {}) {
  const errors = [];
  const counts = normalizeLayoutCounts(layout, errors);
  if (!counts) {
    return { ok: false, errors, layout: null, levelGen: null };
  }
  const totalTiles = (counts.wallTiles || 0) + (counts.floorTiles || 0) + (counts.hallwayTiles || 0);
  if (totalTiles <= 0) {
    pushError(errors, "layout", "empty_layout");
  }
  const levelGen = deriveLevelGenFromCounts(counts, minSide);
  const result = validateLayoutAndActors({ levelGen, actorCount });
  return {
    ok: errors.length === 0 && result.ok,
    errors: [...errors, ...(result.errors || [])],
    layout: result.layout,
    levelGen,
  };
}

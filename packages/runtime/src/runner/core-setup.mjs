const TILE_CODES = Object.freeze({
  wall: 0,
  floor: 1,
  spawn: 2,
  exit: 3,
  barrier: 4,
});

const TILE_TYPE_TO_CODE = Object.freeze({
  wall: TILE_CODES.wall,
  floor: TILE_CODES.floor,
  spawn: TILE_CODES.spawn,
  exit: TILE_CODES.exit,
  barrier: TILE_CODES.barrier,
});

const TILE_CHAR_TO_CODE = Object.freeze({
  "#": TILE_CODES.wall,
  ".": TILE_CODES.floor,
  S: TILE_CODES.spawn,
  E: TILE_CODES.exit,
  B: TILE_CODES.barrier,
});

const VITAL_KEYS = Object.freeze(["health", "mana", "stamina", "durability"]);

function toInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function resolvePoint(value, { width, height } = {}) {
  if (!value || typeof value !== "object") return null;
  const x = toInt(value.x);
  const y = toInt(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Number.isFinite(width) && (x < 0 || x >= width)) return null;
  if (Number.isFinite(height) && (y < 0 || y >= height)) return null;
  return { x, y };
}

function resolveDimensions(layoutData) {
  if (!layoutData || typeof layoutData !== "object") {
    return null;
  }
  let width = toInt(layoutData.width);
  let height = toInt(layoutData.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    if (Array.isArray(layoutData.tiles)) {
      height = layoutData.tiles.length;
      width = layoutData.tiles.reduce((max, row) => Math.max(max, String(row).length), 0);
    }
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function resolveTileCode(char, legend) {
  const entry = legend && legend[char];
  const tileType = entry && typeof entry.tile === "string" ? entry.tile : null;
  if (tileType && TILE_TYPE_TO_CODE[tileType] !== undefined) {
    return TILE_TYPE_TO_CODE[tileType];
  }
  return TILE_CHAR_TO_CODE[char] ?? TILE_CODES.wall;
}

function buildTrapIndex(traps) {
  if (!Array.isArray(traps)) return null;
  const index = new Map();
  traps.forEach((trap) => {
    if (!trap || typeof trap !== "object") return;
    const x = toInt(trap.x);
    const y = toInt(trap.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    index.set(`${x},${y}`, trap.blocking === true);
  });
  return index;
}

function buildTileGrid(layoutData, dimensions) {
  const { width, height } = dimensions;
  const tilesInput = Array.isArray(layoutData.tiles) ? layoutData.tiles : null;
  const kindsInput = Array.isArray(layoutData.kinds) ? layoutData.kinds : null;
  const legend = layoutData.legend || null;
  const trapIndex = buildTrapIndex(layoutData.traps);
  const grid = [];

  for (let y = 0; y < height; y += 1) {
    const row = [];
    const rowStr = tilesInput ? String(tilesInput[y] ?? "") : "";
    for (let x = 0; x < width; x += 1) {
      let code = TILE_CODES.wall;
      if (tilesInput) {
        const char = rowStr[x];
        if (char) {
          code = resolveTileCode(char, legend);
        }
      } else if (kindsInput) {
        const kind = kindsInput[y]?.[x];
        if (kind === 1) {
          code = TILE_CODES.barrier;
        } else if (kind === 2) {
          const blocking = trapIndex?.get(`${x},${y}`) === true;
          code = blocking ? TILE_CODES.barrier : TILE_CODES.floor;
        } else if (kind === 0) {
          code = TILE_CODES.floor;
        }
      }
      row.push(code);
    }
    grid.push(row);
  }

  const spawn = resolvePoint(layoutData.spawn, dimensions);
  const exit = resolvePoint(layoutData.exit, dimensions);
  if (spawn) grid[spawn.y][spawn.x] = TILE_CODES.spawn;
  if (exit) grid[exit.y][exit.x] = TILE_CODES.exit;

  return { grid, spawn, exit };
}

function normalizeVitals(vitals) {
  const records = {};
  VITAL_KEYS.forEach((key) => {
    const entry = vitals && typeof vitals === "object" ? vitals[key] || {} : {};
    const current = Number.isFinite(entry.current) ? entry.current : 0;
    const max = Number.isFinite(entry.max) ? entry.max : 0;
    const regen = Number.isFinite(entry.regen) ? entry.regen : 0;
    records[key] = { current, max, regen };
  });
  return records;
}

export function applySimConfigToCore(core, simConfig) {
  if (!core || !simConfig) {
    return { ok: false, reason: "missing_inputs" };
  }
  const layout = simConfig.layout;
  if (!layout || layout.kind !== "grid") {
    return { ok: false, reason: "unsupported_layout" };
  }
  if (typeof core.configureGrid !== "function" || typeof core.setTileAt !== "function") {
    return { ok: false, reason: "missing_core_exports" };
  }

  const dimensions = resolveDimensions(layout.data);
  if (!dimensions) {
    return { ok: false, reason: "missing_dimensions" };
  }

  const error = core.configureGrid(dimensions.width, dimensions.height);
  if (Number.isFinite(error) && error !== 0) {
    return { ok: false, reason: "invalid_dimensions", error };
  }

  const { grid, spawn, exit } = buildTileGrid(layout.data, dimensions);
  for (let y = 0; y < dimensions.height; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      core.setTileAt(x, y, grid[y][x]);
    }
  }

  return { ok: true, dimensions, spawn, exit };
}

export function applyInitialStateToCore(core, initialState, { spawn } = {}) {
  if (!core || !initialState) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (typeof core.spawnActorAt !== "function" || typeof core.setActorVital !== "function") {
    return { ok: false, reason: "missing_core_exports" };
  }

  const actors = Array.isArray(initialState.actors)
    ? initialState.actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")))
    : [];
  if (actors.length === 0) {
    return { ok: false, reason: "missing_actors" };
  }

  const primary = actors[0];
  const position = resolvePoint(primary.position) || (spawn ? { ...spawn } : null);
  if (!position) {
    return { ok: false, reason: "missing_position" };
  }

  core.spawnActorAt(position.x, position.y);

  const vitals = normalizeVitals(primary.vitals);
  VITAL_KEYS.forEach((key, index) => {
    const record = vitals[key];
    core.setActorVital(index, record.current, record.max, record.regen);
  });

  return { ok: true, actorId: primary.id, position };
}

export function initializeCoreFromArtifacts(core, { simConfig, initialState } = {}) {
  const layoutResult = applySimConfigToCore(core, simConfig);
  const actorResult = applyInitialStateToCore(core, initialState, { spawn: layoutResult.spawn });
  return { layout: layoutResult, actor: actorResult };
}

import { VITAL_KEYS, VITAL_KIND } from "../contracts/domain-constants.js";

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

const CAPABILITY_DEFAULTS = Object.freeze({
  movementCost: 1,
  actionCostMana: 0,
  actionCostStamina: 0,
});

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

function loadTileGrid(core, grid, dimensions) {
  const { width, height } = dimensions;
  const total = width * height;
  const canBulk = typeof core.prepareTileBuffer === "function"
    && typeof core.loadTilesFromBuffer === "function"
    && (core.memory || typeof core.getMemory === "function");
  if (canBulk) {
    const ptr = core.prepareTileBuffer(total);
    const memory = core.memory || core.getMemory?.();
    if (ptr && memory?.buffer) {
      const view = new Uint8Array(memory.buffer, ptr, total);
      let offset = 0;
      for (let y = 0; y < height; y += 1) {
        const row = grid[y] || [];
        for (let x = 0; x < width; x += 1) {
          view[offset] = row[x] ?? TILE_CODES.wall;
          offset += 1;
        }
      }
      const error = core.loadTilesFromBuffer(total);
      return Number.isFinite(error) ? error : 0;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      core.setTileAt(x, y, grid[y][x]);
    }
  }
  return 0;
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

function normalizeCapabilities(capabilities) {
  const entry = capabilities && typeof capabilities === "object" ? capabilities : {};
  const movementCost = toInt(entry.movementCost);
  const actionCostMana = toInt(entry.actionCostMana);
  const actionCostStamina = toInt(entry.actionCostStamina);
  return {
    movementCost: Number.isFinite(movementCost) ? movementCost : CAPABILITY_DEFAULTS.movementCost,
    actionCostMana: Number.isFinite(actionCostMana) ? actionCostMana : CAPABILITY_DEFAULTS.actionCostMana,
    actionCostStamina: Number.isFinite(actionCostStamina) ? actionCostStamina : CAPABILITY_DEFAULTS.actionCostStamina,
  };
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

  const { grid, spawn, exit } = buildTileGrid(layout.data, dimensions);
  const error = core.configureGrid(dimensions.width, dimensions.height);
  if (Number.isFinite(error) && error !== 0) {
    return { ok: false, reason: "invalid_dimensions", error };
  }
  const tileError = loadTileGrid(core, grid, dimensions);
  if (Number.isFinite(tileError) && tileError !== 0) {
    return { ok: false, reason: "invalid_layout_tiles", error: tileError };
  }

  return { ok: true, dimensions, spawn, exit };
}

export function applyInitialStateToCore(core, initialState, { spawn } = {}) {
  if (!core || !initialState) {
    return { ok: false, reason: "missing_inputs" };
  }

  const actors = Array.isArray(initialState.actors)
    ? initialState.actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")))
    : [];
  if (actors.length === 0) {
    return { ok: false, reason: "missing_actors" };
  }

  const primary = actors[0];
  const supportsMulti = typeof core.applyActorPlacements === "function"
    && typeof core.setMotivatedActorVital === "function"
    && typeof core.clearActorPlacements === "function"
    && typeof core.addActorPlacement === "function"
    && typeof core.validateActorPlacement === "function";

  if (supportsMulti) {
    core.clearActorPlacements();
    const positions = [];
    for (let index = 0; index < actors.length; index += 1) {
      const actor = actors[index];
      const position = resolvePoint(actor.position) || (index === 0 && spawn ? { ...spawn } : null);
      if (!position) {
        return { ok: false, reason: "missing_position" };
      }
      positions.push(position);
      core.addActorPlacement(index + 1, position.x, position.y);
    }
    const placementError = core.validateActorPlacement();
    if (Number.isFinite(placementError) && placementError !== 0) {
      return { ok: false, reason: "invalid_actor_placement", error: placementError };
    }
    const applyError = core.applyActorPlacements();
    if (Number.isFinite(applyError) && applyError !== 0) {
      return { ok: false, reason: "invalid_actor_placement", error: applyError };
    }
    for (let index = 0; index < actors.length; index += 1) {
      const vitals = normalizeVitals(actors[index].vitals);
      VITAL_KEYS.forEach((key) => {
        const record = vitals[key];
        core.setMotivatedActorVital(index, VITAL_KIND[key], record.current, record.max, record.regen);
      });
      const capabilities = normalizeCapabilities(actors[index].capabilities);
      if (typeof core.setMotivatedActorMovementCost === "function") {
        core.setMotivatedActorMovementCost(index, capabilities.movementCost);
      }
      if (typeof core.setMotivatedActorActionCostMana === "function") {
        core.setMotivatedActorActionCostMana(index, capabilities.actionCostMana);
      }
      if (typeof core.setMotivatedActorActionCostStamina === "function") {
        core.setMotivatedActorActionCostStamina(index, capabilities.actionCostStamina);
      }
    }
    if (typeof core.validateActorCapabilities === "function") {
      const capError = core.validateActorCapabilities();
      if (Number.isFinite(capError) && capError !== 0) {
        return { ok: false, reason: "invalid_actor_capabilities", error: capError };
      }
    }
    return { ok: true, actorId: primary.id, position: positions[0], actorCount: actors.length };
  }

  if (typeof core.spawnActorAt !== "function" || typeof core.setActorVital !== "function") {
    return { ok: false, reason: "missing_core_exports" };
  }

  const position = resolvePoint(primary.position) || (spawn ? { ...spawn } : null);
  if (!position) {
    return { ok: false, reason: "missing_position" };
  }

  core.spawnActorAt(position.x, position.y);

  const vitals = normalizeVitals(primary.vitals);
  VITAL_KEYS.forEach((key) => {
    const record = vitals[key];
    core.setActorVital(VITAL_KIND[key], record.current, record.max, record.regen);
  });
  const capabilities = normalizeCapabilities(primary.capabilities);
  if (typeof core.setActorMovementCost === "function") {
    core.setActorMovementCost(capabilities.movementCost);
  }
  if (typeof core.setActorActionCostMana === "function") {
    core.setActorActionCostMana(capabilities.actionCostMana);
  }
  if (typeof core.setActorActionCostStamina === "function") {
    core.setActorActionCostStamina(capabilities.actionCostStamina);
  }
  if (typeof core.validateActorCapabilities === "function") {
    const capError = core.validateActorCapabilities();
    if (Number.isFinite(capError) && capError !== 0) {
      return { ok: false, reason: "invalid_actor_capabilities", error: capError };
    }
  }

  return { ok: true, actorId: primary.id, position };
}

export function initializeCoreFromArtifacts(core, { simConfig, initialState } = {}) {
  const layoutResult = applySimConfigToCore(core, simConfig);
  const actorResult = applyInitialStateToCore(core, initialState, { spawn: layoutResult.spawn });
  return { layout: layoutResult, actor: actorResult };
}

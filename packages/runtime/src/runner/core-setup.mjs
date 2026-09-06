import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  RESOURCE_PERMANENCE_MODES,
  RESOURCE_VITAL_KEYS,
  VITAL_KEYS,
  VITAL_KIND,
} from "../contracts/domain-constants.js";

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
const AFFINITY_KIND_CODES = Object.freeze(
  AFFINITY_KINDS.reduce((acc, kind, index) => {
    acc[kind] = index + 1;
    return acc;
  }, {}),
);
const AFFINITY_EXPRESSION_CODES = Object.freeze(
  AFFINITY_EXPRESSIONS.reduce((acc, expression, index) => {
    acc[expression] = index + 1;
    return acc;
  }, {}),
);

// Positional, like the affinity tables above, but zero-based: these are the core's
// own ResourceMode values (`rules/move.ts`), where 0 raises an actor's current
// vital and 1/2 raise its max. The artifact contract's three permanence names are
// listed in the same order, so the two cannot drift without this map going wrong.
const RESOURCE_PERMANENCE_MODE_CODES = Object.freeze(
  RESOURCE_PERMANENCE_MODES.reduce((acc, mode, index) => {
    acc[mode] = index;
    return acc;
  }, {}),
);

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

function buildHazardIndex(hazards) {
  if (!Array.isArray(hazards)) return null;
  const index = new Map();
  hazards.forEach((hazard) => {
    if (!hazard || typeof hazard !== "object") return;
    const x = toInt(hazard.position?.x ?? hazard.x);
    const y = toInt(hazard.position?.y ?? hazard.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    index.set(`${x},${y}`, hazard.blocking === true);
  });
  return index;
}

function buildTileGrid(layoutData, dimensions) {
  const { width, height } = dimensions;
  const tilesInput = Array.isArray(layoutData.tiles) ? layoutData.tiles : null;
  const kindsInput = Array.isArray(layoutData.kinds) ? layoutData.kinds : null;
  const legend = layoutData.legend || null;
  const hazardIndex = buildHazardIndex(layoutData.hazards);
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
          const blocking = hazardIndex?.get(`${x},${y}`) === true;
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
  const spawnApproach = resolvePoint(layoutData.spawnApproach, dimensions);
  const exitApproach = resolvePoint(layoutData.exitApproach, dimensions);
  if (spawn) grid[spawn.y][spawn.x] = TILE_CODES.spawn;
  if (exit) grid[exit.y][exit.x] = TILE_CODES.exit;

  return { grid, spawn, exit, spawnApproach, exitApproach };
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

function normalizeVitalRecord(vital, fallbackCurrent) {
  const entry = vital && typeof vital === "object" ? vital : {};
  const fallback = Number.isFinite(fallbackCurrent) ? fallbackCurrent : 0;
  if (entry.kind === "one-time" && Number.isFinite(toInt(entry.amount))) {
    const amount = Math.max(0, toInt(entry.amount));
    return { current: amount, max: amount, regen: 0 };
  }
  const current = Number.isFinite(toInt(entry.current)) ? toInt(entry.current) : fallback;
  const max = Number.isFinite(toInt(entry.max)) ? toInt(entry.max) : current;
  const regen = Number.isFinite(toInt(entry.regen)) ? toInt(entry.regen) : 0;
  return {
    current: Math.max(0, current),
    max: Math.max(0, max),
    regen: Math.max(0, regen),
  };
}

function armStaticHazardsFromLayout(core, layoutData = {}) {
  if (typeof core?.armStaticHazardAt !== "function") {
    return;
  }
  const hazards = Array.isArray(layoutData?.hazards) ? layoutData.hazards : [];
  hazards.forEach((hazard) => {
    if (!hazard || typeof hazard !== "object") return;
    const x = toInt(hazard.position?.x ?? hazard.x);
    const y = toInt(hazard.position?.y ?? hazard.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (hazard.blocking === true) return;
    const affinityEntry = Array.isArray(hazard.affinityStacks) && hazard.affinityStacks.length > 0
      ? hazard.affinityStacks[0]
      : hazard.affinity && typeof hazard.affinity === "object"
        ? hazard.affinity
        : { kind: hazard.affinity, expression: hazard.expression, stacks: hazard.stacks };
    const kind = typeof affinityEntry?.kind === "string" ? affinityEntry.kind : "";
    const rawExpression = typeof affinityEntry?.expression === "string" ? affinityEntry.expression : "push";
    const expression = AFFINITY_EXPRESSION_CODES[rawExpression] ? rawExpression : "push";
    const stacks = toInt(affinityEntry?.stacks);
    const affinityKind = AFFINITY_KIND_CODES[kind];
    const affinityExpression = AFFINITY_EXPRESSION_CODES[expression];
    if (!Number.isFinite(affinityKind) || !Number.isFinite(affinityExpression)) return;
    if (!Number.isFinite(stacks) || stacks <= 0) return;
    const mana = normalizeVitalRecord(hazard.vitals?.mana, stacks * 3);
    const durability = normalizeVitalRecord(hazard.vitals?.durability, 0);
    core.armStaticHazardAt(
      x,
      y,
      affinityKind,
      affinityExpression,
      stacks,
      mana.current,
      durability.current,
      durability.max,
      durability.regen,
      mana.max,
      mana.regen,
    );
  });
}

/**
 * Places the vital half of a resource: the payload an actor collects by entering
 * the cell.
 *
 * A cell holds exactly one vital payload, so only the first declared grant can be
 * represented; a resource authored with more is placed with its first. Everything
 * else is rejected rather than defaulted — a resource that grants the wrong vital,
 * or raises a max where it should have topped up a current, is worse than one that
 * never appears, because the run still looks like it executed.
 */
function placeResourceVital(core, resource, x, y) {
  const grant = Array.isArray(resource.vitals) ? resource.vitals[0] : null;
  if (!grant || typeof grant !== "object") return;
  if (!RESOURCE_VITAL_KEYS.includes(grant.key)) return;
  const vitalKind = VITAL_KIND[grant.key];
  if (!Number.isFinite(vitalKind)) return;
  const mode = RESOURCE_PERMANENCE_MODE_CODES[resource.permanenceMode];
  if (!Number.isFinite(mode)) return;
  if (typeof grant.delta !== "number" || !Number.isFinite(grant.delta)) return;
  if (grant.regen !== undefined && (typeof grant.regen !== "number" || !Number.isFinite(grant.regen))) return;
  const regen = grant.regen === undefined ? 0 : grant.regen;
  if (regen < 0) return;
  core.placeResourceAt(x, y, vitalKind, grant.delta, mode, regen);
}

/**
 * Places the affinity half of a resource.
 *
 * `manaRegen` is carried through untouched because it is the only thing that makes
 * a granted affinity permanent — defaulting it would silently turn every permanent
 * grant temporary.
 */
function placeResourceAffinity(core, resource, x, y) {
  const affinity = resource.affinity;
  if (!affinity || typeof affinity !== "object") return;
  const kind = AFFINITY_KIND_CODES[affinity.kind];
  const expression = AFFINITY_EXPRESSION_CODES[affinity.expression];
  if (!Number.isFinite(kind) || !Number.isFinite(expression)) return;
  const stacks = toInt(affinity.stacks);
  if (!Number.isFinite(stacks) || stacks <= 0) return;
  const mana = affinity.mana === undefined ? 0 : Number(affinity.mana);
  const manaRegen = affinity.manaRegen === undefined ? 0 : Number(affinity.manaRegen);
  if (!Number.isFinite(mana) || mana < 0) return;
  if (!Number.isFinite(manaRegen) || manaRegen < 0) return;
  core.placeAffinityResourceAt(x, y, kind, expression, stacks, mana, manaRegen);
}

/**
 * Loads `layout.data.resources` into the core.
 *
 * A resource may carry a vital payload, an affinity payload, or both, and the two
 * occupy independent slots on the same cell — so each is placed on its own terms
 * rather than one being chosen over the other.
 */
function placeResourcesFromLayout(core, layoutData = {}) {
  const resources = Array.isArray(layoutData?.resources) ? layoutData.resources : [];
  if (resources.length === 0) return;
  const canPlaceVital = typeof core?.placeResourceAt === "function";
  const canPlaceAffinity = typeof core?.placeAffinityResourceAt === "function";
  if (!canPlaceVital && !canPlaceAffinity) return;

  resources.forEach((resource) => {
    if (!resource || typeof resource !== "object") return;
    const x = toInt(resource.position?.x ?? resource.x);
    const y = toInt(resource.position?.y ?? resource.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (canPlaceVital) placeResourceVital(core, resource, x, y);
    if (canPlaceAffinity) placeResourceAffinity(core, resource, x, y);
  });
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

  const { grid, spawn, exit, spawnApproach, exitApproach } = buildTileGrid(layout.data, dimensions);
  const error = core.configureGrid(dimensions.width, dimensions.height);
  if (Number.isFinite(error) && error !== 0) {
    return { ok: false, reason: "invalid_dimensions", error };
  }
  const tileError = loadTileGrid(core, grid, dimensions);
  if (Number.isFinite(tileError) && tileError !== 0) {
    return { ok: false, reason: "invalid_layout_tiles", error: tileError };
  }
  if (spawn && typeof core.setSpawnPosition === "function") {
    core.setSpawnPosition(spawn.x, spawn.y);
  }
  if (exit && typeof core.setExitPosition === "function") {
    core.setExitPosition(exit.x, exit.y);
  }
  if (spawnApproach && typeof core.setSpawnApproachPosition === "function") {
    core.setSpawnApproachPosition(spawnApproach.x, spawnApproach.y);
  }
  if (exitApproach && typeof core.setExitApproachPosition === "function") {
    core.setExitApproachPosition(exitApproach.x, exitApproach.y);
  }
  armStaticHazardsFromLayout(core, layout.data);
  placeResourcesFromLayout(core, layout.data);

  return { ok: true, dimensions, spawn, exit, spawnApproach, exitApproach };
}


function remapPortalSeat(position, { spawn, exit, spawnApproach, exitApproach } = {}) {
  if (!position) return position;
  if (
    spawn && spawnApproach
    && position.x === spawn.x && position.y === spawn.y
  ) {
    return { ...spawnApproach };
  }
  if (
    exit && exitApproach
    && position.x === exit.x && position.y === exit.y
  ) {
    return { ...exitApproach };
  }
  return position;
}

function resolveActorExitEligible(actor) {
  const role = typeof actor?.role === "string" ? actor.role.trim().toLowerCase() : "";
  const type = typeof actor?.type === "string" ? actor.type.trim().toLowerCase() : "";
  const id = typeof actor?.id === "string" ? actor.id.trim().toLowerCase() : "";
  const bag = `${role} ${type} ${id}`;
  if (bag.includes("warden") || bag.includes("guard") || bag.includes("defend")) return 0;
  return 1;
}

export function applyInitialStateToCore(core, initialState, { spawn, exit, spawnApproach, exitApproach } = {}) {
  if (!core || !initialState) {
    return { ok: false, reason: "missing_inputs" };
  }

  const actors = Array.isArray(initialState.actors)
    ? initialState.actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")))
    : [];
  if (actors.length === 0) {
    return { ok: false, reason: "missing_actors" };
  }

  const seenIds = new Set();
  for (const actor of actors) {
    const id = String(actor?.id || "");
    if (seenIds.has(id)) {
      // A shared id makes action attribution ambiguous; two id-less actors
      // collide the same way but the root cause is the missing id.
      return { ok: false, reason: id === "" ? "missing_actor_id" : "duplicate_actor_id", actorId: id };
    }
    seenIds.add(id);
  }

  const primary = actors[0];
  const supportsMulti = typeof core.applyActorPlacements === "function"
    && typeof core.setMotivatedActorVital === "function"
    && typeof core.clearActorPlacements === "function"
    && typeof core.addActorPlacement === "function"
    && typeof core.validateActorPlacement === "function";

  if (supportsMulti) {
    const multiResult = (() => {
    core.clearActorPlacements();
    const positions = [];
    for (let index = 0; index < actors.length; index += 1) {
      const actor = actors[index];
      const position = remapPortalSeat(
        resolvePoint(actor.position)
          || (index === 0 && spawnApproach ? { ...spawnApproach } : null)
          || (index === 0 && spawn ? { ...spawn } : null),
        { spawn, exit, spawnApproach, exitApproach },
      );
      if (!position) {
        // Non-primary actors without positions only ever existed in states
        // authored for the legacy spawn path (which ignores them entirely).
        return { ok: false, reason: index > 0 ? "legacy_fallback" : "missing_position" };
      }
      positions.push(position);
      core.addActorPlacement(index + 1, position.x, position.y);
    }
    // Seeding mode: an initial state may seat actors on the spawn/exit tiles
    // at tick 0 (bounds/walkability/collision checks still apply).
    const placementError = core.validateActorPlacement(true);
    if (Number.isFinite(placementError) && placementError !== 0) {
      return { ok: false, reason: "invalid_actor_placement", error: placementError };
    }
    const applyError = core.applyActorPlacements(true);
    if (Number.isFinite(applyError) && applyError !== 0) {
      return { ok: false, reason: "invalid_actor_placement", error: applyError };
    }
    if (typeof core.setMotivatedActorExitEligible === "function") {
      for (let index = 0; index < actors.length; index += 1) {
        core.setMotivatedActorExitEligible(index, resolveActorExitEligible(actors[index]));
      }
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
    // Write first affinity entry for each actor to core
    if (typeof core.setMotivatedActorAffinity === "function") {
      for (let index = 0; index < actors.length; index += 1) {
        const affinities = Array.isArray(actors[index].affinities) ? actors[index].affinities : [];
        const first = affinities.length > 0 ? affinities[0] : null;
        if (!first || typeof first !== "object") continue;
        const kind = typeof first.kind === "string" ? first.kind : "";
        const rawExpression = typeof first.expression === "string" ? first.expression : "push";
        const expression = AFFINITY_EXPRESSION_CODES[rawExpression] ? rawExpression : "push";
        const stacks = toInt(first.stacks);
        const affinityKind = AFFINITY_KIND_CODES[kind];
        const affinityExpression = AFFINITY_EXPRESSION_CODES[expression];
        if (!Number.isFinite(affinityKind) || !Number.isFinite(affinityExpression)) continue;
        if (!Number.isFinite(stacks) || stacks <= 0) continue;
        core.setMotivatedActorAffinity(index, affinityKind, affinityExpression, stacks);
      }
    }
    return { ok: true, actorId: primary.id, position: positions[0], actorCount: actors.length };
    })();
    // Single-actor states whose placement the strict validator rejects (e.g.
    // older fixtures that seat the actor on the spawn tile) historically ran
    // through the legacy spawn path below, which does not validate placement.
    // Preserve that behavior by falling through for them; multi-actor states
    // with invalid placements must keep failing loudly — the legacy path can
    // only spawn one actor and would silently drop the rest.
    const fallBackToLegacy = multiResult?.reason === "legacy_fallback"
      || (multiResult?.reason === "invalid_actor_placement" && actors.length === 1);
    if (!fallBackToLegacy) {
      return multiResult;
    }
    core.clearActorPlacements();
  }

  if (typeof core.spawnActorAt !== "function" || typeof core.setActorVital !== "function") {
    return { ok: false, reason: "missing_core_exports" };
  }

  const position = remapPortalSeat(
    resolvePoint(primary.position)
      || (spawnApproach ? { ...spawnApproach } : null)
      || (spawn ? { ...spawn } : null),
    { spawn, exit, spawnApproach, exitApproach },
  );
  if (!position) {
    return { ok: false, reason: "missing_position" };
  }

  core.spawnActorAt(position.x, position.y);
  if (typeof core.setMotivatedActorExitEligible === "function") {
    core.setMotivatedActorExitEligible(0, resolveActorExitEligible(primary));
  }

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
  const actorResult = applyInitialStateToCore(core, initialState, {
    spawn: layoutResult.spawn,
    exit: layoutResult.exit,
    spawnApproach: layoutResult.spawnApproach,
    exitApproach: layoutResult.exitApproach,
  });
  // Compute combined affinity field after layout hazards and actor affinities are set.
  if (typeof core?.computeAffinityField === "function") {
    core.computeAffinityField();
  }
  return { layout: layoutResult, actor: actorResult };
}

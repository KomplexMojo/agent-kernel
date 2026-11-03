/**
 * Materialize destroyable earth barrier actors for cells planned by level layout.
 * Parity with a delver earth push raise (intensity × raiseScale) without `raisedBy`,
 * so they are dungeon furniture: pullable, nobody walks through as owner.
 *
 * Also plans the ring that encases each resource: movement is king-move, so every
 * walkable neighbour of a resource needs a barrier (walls already count as casing).
 */
import { raisedBarrierStats } from "../../../../core-ts/src/rules/actor-cast.ts";
import { affinityTableRow } from "../../../../core-ts/src/state/affinity-table.ts";

export const INTERIOR_BARRIER_INTENSITY = 2;
export const INTERIOR_BARRIER_STACKS = 2;
/** Resource cages: intensity 1 earth push; durability scales with Allocator token value. */
export const RESOURCE_ENCLOSURE_INTENSITY = 1;
/** Floor when the resource has no priced total yet (tests / unpriced paths). */
export const RESOURCE_ENCLOSURE_DURABILITY = 2;

/**
 * Cage durability from an Allocator token total for that resource.
 * Higher-priced loot gets a tougher ring; floor keeps a free/unpriced resource openable
 * by one weak push (magnitude 2). Pull still one-shots any cage.
 */
export function enclosureDurabilityForTokenValue(tokenValue) {
  const tokens = Number(tokenValue);
  if (!Number.isFinite(tokens) || tokens <= 0) return RESOURCE_ENCLOSURE_DURABILITY;
  return Math.max(RESOURCE_ENCLOSURE_DURABILITY, Math.ceil(tokens));
}

/** King-move ring: diagonals are legal steps, so a 4-neighbour cage still leaks. */
const RESOURCE_ENCLOSURE_DIRS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], /* resource */ [0, 1],
  [1, -1], [1, 0], [1, 1],
]);

function cellKey(x, y) {
  return `${x},${y}`;
}

function resourcePosition(resource) {
  const x = resource?.position?.x ?? resource?.x;
  const y = resource?.position?.y ?? resource?.y;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { x, y };
}

/**
 * Barrier cells that fully encase each resource on walkable neighbours.
 * Walls / board edges already block; spawn and exit tiles are left open so portals stay usable.
 *
 * @param {object} layout `{ width, height, terrain }`
 * @param {Array} resources actors or placement records with a position
 * @param {{ occupied?: Set<string> }} [opts] cells that must not gain a barrier (other actors)
 * @returns {Array<{x:number,y:number}>}
 */
export function planResourceEnclosureCells(layout, resources = [], { occupied = new Set() } = {}) {
  const width = Number(layout?.width);
  const height = Number(layout?.height);
  const terrain = Array.isArray(layout?.terrain) ? layout.terrain : [];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return [];
  if (!Array.isArray(resources) || resources.length === 0) return [];

  const blocked = occupied instanceof Set ? occupied : new Set(occupied);
  const cells = [];
  const seen = new Set();

  for (const resource of resources) {
    const at = resourcePosition(resource);
    if (!at) continue;
    for (const [dx, dy] of RESOURCE_ENCLOSURE_DIRS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const kind = terrain[y * width + x];
      // Walls already encase; never cover spawn/exit approach tiles.
      if (kind === "wall" || kind === "spawn" || kind === "exit") continue;
      if (kind !== "floor" && kind !== undefined && kind !== null) continue;
      const key = cellKey(x, y);
      if (blocked.has(key) || seen.has(key)) continue;
      seen.add(key);
      cells.push({ x, y });
    }
  }
  return cells;
}

/** Authored barrier actor stubs for `normalizeActorDefinition` / initial-state assembly. */
export function buildInteriorBarrierActors(cells = [], {
  intensity = INTERIOR_BARRIER_INTENSITY,
  stacks = INTERIOR_BARRIER_STACKS,
  durability: durabilityOverride = null,
} = {}) {
  if (!Array.isArray(cells) || cells.length === 0) return [];
  const raiseScale = affinityTableRow("earth")?.raiseScale ?? 2;
  const { durability: raised } = raisedBarrierStats(intensity, raiseScale);
  const durability = Number.isInteger(durabilityOverride) && durabilityOverride > 0
    ? durabilityOverride
    : raised;
  return cells.map((cell) => {
    const x = cell?.x;
    const y = cell?.y;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error("interior barrier cell requires integer x,y");
    }
    return {
      category: "barrier",
      id: `barrier_${x}_${y}`,
      position: { x, y },
      vitals: {
        durability: { current: durability, max: durability, regen: 0 },
      },
      affinities: [{ kind: "earth", expression: "push", stacks, intensity }],
      activeAffinityKey: "earth:push",
    };
  });
}

/** Earth cages at a single durability (uniform / unpriced callers). */
export function buildResourceEnclosureBarrierActors(cells = [], {
  durability = RESOURCE_ENCLOSURE_DURABILITY,
} = {}) {
  const resolved = Number.isInteger(durability) && durability > 0
    ? durability
    : RESOURCE_ENCLOSURE_DURABILITY;
  return buildInteriorBarrierActors(cells, {
    intensity: RESOURCE_ENCLOSURE_INTENSITY,
    stacks: 1,
    durability: resolved,
  });
}

/**
 * Per-resource cages whose durability follows Allocator token value.
 * `tokenValueById` is Map|Record of resource id → spend tokens (from the budget receipt).
 * Overlapping cage cells keep the max durability of the resources that claim them.
 *
 * @param {object} layout
 * @param {Array} resources
 * @param {{ occupied?: Set<string>, tokenValueById?: Map<string, number>|Record<string, number>, skipKeys?: Set<string> }} [opts]
 */
export function buildResourceEnclosureBarrierActorsForResources(layout, resources = [], {
  occupied = new Set(),
  tokenValueById = null,
  skipKeys = new Set(),
} = {}) {
  if (!Array.isArray(resources) || resources.length === 0) return [];
  const readTokens = (id) => {
    if (!id) return 0;
    if (tokenValueById instanceof Map) return tokenValueById.get(id) ?? 0;
    if (tokenValueById && typeof tokenValueById === "object") return tokenValueById[id] ?? 0;
    return 0;
  };
  const skip = skipKeys instanceof Set ? skipKeys : new Set(skipKeys);
  const durabilityByCell = new Map();
  for (const resource of resources) {
    const cells = planResourceEnclosureCells(layout, [resource], { occupied });
    const durability = enclosureDurabilityForTokenValue(readTokens(resource?.id));
    for (const cell of cells) {
      const key = cellKey(cell.x, cell.y);
      if (skip.has(key)) continue;
      durabilityByCell.set(key, Math.max(durabilityByCell.get(key) || 0, durability));
    }
  }
  const actors = [];
  for (const [key, durability] of durabilityByCell) {
    const [x, y] = key.split(",").map(Number);
    actors.push(...buildInteriorBarrierActors([{ x, y }], {
      intensity: RESOURCE_ENCLOSURE_INTENSITY,
      stacks: 1,
      durability,
    }));
  }
  return actors;
}

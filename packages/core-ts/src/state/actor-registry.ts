import type { ActorPosition, ActorRecord, ActorRegistrySnapshot, TerrainKind } from './actor-types.ts';

const TERRAIN = new Set<TerrainKind>(['wall', 'floor', 'spawn', 'exit']);
const ACTOR_FIELDS = new Set([
  'id', 'alignment', 'position', 'lifecycle', 'defeatVital', 'vitals',
  'capabilities', 'motivations', 'affinities', 'activeAffinityKey', 'holdings',
]);

/** Reject values JSON cannot faithfully represent before taking ownership. */
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('invalid JSON state');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null) throw new Error('invalid JSON object');
  if (Object.getOwnPropertySymbols(value).length) throw new Error('invalid JSON symbol');
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid JSON property');
    if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
      throw new Error('invalid JSON array property');
    }
  }
  ancestors.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) assertJson(entry, ancestors);
  ancestors.delete(value);
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

/**
 * Registry component for the unified engine. No action execution or tick advance.
 * Owns detached records and returns detached views; presentation never enters it.
 */
export function createActorRegistry(input: ActorRegistrySnapshot) {
  assertJson(input);
  const { width, height } = input.dimensions;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || !Number.isSafeInteger(width * height)) throw new Error('invalid dimensions');
  if (input.terrain.length !== width * height || [...input.terrain].some(tile => !TERRAIN.has(tile))) {
    throw new Error('invalid terrain');
  }
  const terrain = [...input.terrain];
  const actors = new Map<string, ActorRecord>();
  const occupancy = new Map<number, ActorRecord[]>();
  function withinBounds(point: ActorPosition): boolean {
    return Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)
      && point.x >= 0 && point.x < width && point.y >= 0 && point.y < height;
  }
  function index(point: ActorPosition): number { return point.y * width + point.x; }
  function terrainBlocks(point: ActorPosition): boolean {
    return !withinBounds(point) || terrain[index(point)] === 'wall';
  }
  for (const record of input.actors) {
    if (typeof record.id !== 'string' || !record.id.trim()) throw new Error('invalid actor id');
    if (actors.has(record.id)) throw new Error(`duplicate actor id: ${record.id}`);
    if (Object.keys(record).some(key => !ACTOR_FIELDS.has(key))) throw new Error('unknown actor field');
    if (terrainBlocks(record.position)) throw new Error(`invalid actor position: ${record.id}`);
    const actor = copy(record);
    const cell = index(actor.position);
    const occupants = occupancy.get(cell) ?? [];
    if (actor.lifecycle === 'alive' && actor.capabilities.blocksMovement
      && occupants.some(other => other.lifecycle === 'alive' && other.capabilities.blocksMovement)) {
      throw new Error('conflicting blocking occupancy');
    }
    actors.set(actor.id, actor);
    if (actor.lifecycle !== 'exited') {
      occupants.push(actor);
      occupancy.set(cell, occupants);
    }
  }
  // Ordinal UTF-16 order, never locale-dependent ordering or caller insertion order.
  const ordered = [...actors.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const entries of occupancy.values()) entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function blocks(point: ActorPosition, capability: 'blocksMovement' | 'blocksSight'): boolean {
    return terrainBlocks(point) || (occupancy.get(index(point)) ?? [])
      .some(actor => actor.lifecycle === 'alive' && actor.capabilities[capability]);
  }
  return {
    getActor(id: string): ActorRecord | null { return copy(actors.get(id) ?? null); },
    getActorsAt(point: ActorPosition): ActorRecord[] {
      return copy(withinBounds(point) ? occupancy.get(index(point)) ?? [] : []);
    },
    isMovementBlocked(point: ActorPosition): boolean { return blocks(point, 'blocksMovement'); },
    isSightBlocked(point: ActorPosition): boolean { return blocks(point, 'blocksSight'); },
    snapshot(): ActorRegistrySnapshot {
      return copy({ dimensions: { width, height }, terrain, actors: ordered });
    },
  };
}

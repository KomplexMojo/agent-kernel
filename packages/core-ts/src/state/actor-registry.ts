import { advanceActorExit, EXIT_DWELL_TICKS } from "../rules/actor-exit.ts";
import type { ActorCastTrail, ActorSpreadEmber, ActorPosition, ActorRecord, ActorRegistrySnapshot, ActorVitalKind, ActorAffinityKey, TerrainKind, AffinityKind, AffinityExpression, ActorVitalRecord } from './actor-types.ts';

import { validateActorRecordVitals, changeActorVital, regenerateActor } from './actor-vitals.ts';
import { chargeActorAffinityUpkeep, recoverActorAffinity } from '../rules/actor-upkeep.ts';

import { validateActorInventory, equipActorAffinity, unequipActorAffinity } from './actor-inventory.ts';

import { validateActorHoldings, exposeDefeatHoldings, takeActorHolding } from './actor-holdings.ts';

const TERRAIN = new Set<TerrainKind>(['wall', 'floor', 'spawn', 'exit']);

/** ValidationError names a refused move reports (`validate/inputs.ts`). */
export type ActorMoveRejection = 'WrongActor' | 'InvalidCapability' | 'OutOfBounds' | 'NotAdjacent'
  | 'BlockedByWall' | 'ActorCollision';
const ACTOR_FIELDS = new Set([
  'id', 'alignment', 'position', 'lifecycle', 'defeatVital', 'vitals',
  'capabilities', 'motivations', 'affinities', 'activeAffinityKey', 'holdings', 'exitDwell', 'affinityExhausted',
  'affinitySlots', 'raisedBy', 'soaked', 'equippedAffinityKeys', 'exhaustedAffinityKeys', 'equippedAffinityStacks', 'equippedAffinityIntensity',
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

/** True when `barrier` was raised by `owner`, who walks through it (#413). */
function ownsBarrier(owner: ActorRecord, barrier: ActorRecord): boolean {
  return barrier.raisedBy === owner.id;
}

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
  let castTrails: ActorCastTrail[] = copy(input.castTrails ?? []);
  let spreadEmbers: ActorSpreadEmber[] = copy(input.spreadEmbers ?? []);
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
    if (record.exitDwell !== undefined && (!Number.isSafeInteger(record.exitDwell)
      || record.exitDwell < 0 || record.exitDwell > EXIT_DWELL_TICKS
      || record.lifecycle === 'alive' && record.exitDwell === EXIT_DWELL_TICKS)) throw new Error('invalid exit dwell');
    if (record.affinityExhausted !== undefined && record.affinityExhausted !== true) {
      throw new Error('invalid affinity exhaustion');
    }
    if (record.raisedBy !== undefined && (typeof record.raisedBy !== 'string' || !record.raisedBy)) {
      throw new Error('invalid raised barrier owner');
    }
    if (record.soaked !== undefined && (!Number.isSafeInteger(record.soaked) || record.soaked < 1)) {
      throw new Error('invalid soak turns');
    }
    const actor = copy(record);
    validateActorRecordVitals(actor);
    validateActorInventory(actor);
    validateActorHoldings(actor);
    if (actor.lifecycle === 'alive' && actor.vitals[actor.defeatVital]!.current === 0) actor.lifecycle = 'defeated';
    exposeDefeatHoldings(actor);
    const cell = index(actor.position);
    const occupants = occupancy.get(cell) ?? [];
    if (actor.lifecycle === 'alive' && actor.capabilities.blocksMovement
      && occupants.some(other => other.lifecycle === 'alive' && other.capabilities.blocksMovement
        && !ownsBarrier(actor, other) && !ownsBarrier(other, actor))) {
      throw new Error('conflicting blocking occupancy');
    }
    actors.set(actor.id, actor);
    if (actor.lifecycle !== 'exited') {
      occupants.push(actor);
      occupancy.set(cell, occupants);
    }
  }
  // Ordinal UTF-16 order, never locale-dependent ordering or caller insertion order.
  let ordered = [...actors.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const entries of occupancy.values()) entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function refreshOrder() {
    ordered = [...actors.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const entries of occupancy.values()) entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  function blocks(point: ActorPosition, capability: 'blocksMovement' | 'blocksSight'): boolean {
    return terrainBlocks(point) || (occupancy.get(index(point)) ?? [])
      .some(actor => actor.lifecycle === 'alive' && actor.capabilities[capability]);
  }
  /** Why a one-step move would be refused, as a ValidationError name; null when it is legal. */
  // `from` asks about a step that starts somewhere else, as a sprint's second step does (#437).
  function explainMove(id: string, target: ActorPosition, from?: ActorPosition): ActorMoveRejection | null {
    const actor = actors.get(id);
    if (!actor || actor.lifecycle !== 'alive') return 'WrongActor';
    if (!actor.capabilities.canMove) return 'InvalidCapability';
    if (!withinBounds(target)) return 'OutOfBounds';
    const origin = from ?? actor.position;
    if (Math.max(Math.abs(origin.x - target.x), Math.abs(origin.y - target.y)) !== 1) return 'NotAdjacent';
    if (terrainBlocks(target)) return 'BlockedByWall';
    if (actor.capabilities.blocksMovement && (occupancy.get(index(target)) ?? []).some(other => other.lifecycle === 'alive'
      && other.capabilities.blocksMovement && !ownsBarrier(actor, other))) return 'ActorCollision';
    return null;
  }
  return {
    explainMove,
    moveActor(id: string, target: ActorPosition): boolean {
      if (explainMove(id, target) !== null) return false;
      const actor = actors.get(id)!;
      const destination = occupancy.get(index(target)) ?? [];
      const origin = index(actor.position);
      occupancy.set(origin, (occupancy.get(origin) ?? []).filter(other => other.id !== id));
      actor.position = { x: target.x, y: target.y };
      destination.push(actor);
      destination.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      occupancy.set(index(target), destination);
      return true;
    },
    takeHolding(receiverId: string, sourceId: string, holdingId: string): boolean {
      return takeActorHolding(actors.get(receiverId), actors.get(sourceId), holdingId);
    },
    equipAffinity(id: string, key: ActorAffinityKey, replaceKey?: ActorAffinityKey, stacks?: number, intensity?: number): boolean {
      return equipActorAffinity(actors.get(id), key, replaceKey, stacks, intensity);
    },
    unequipAffinity(id: string, key: ActorAffinityKey): boolean { return unequipActorAffinity(actors.get(id), key); },
    changeVital(id: string, key: ActorVitalKind, delta: number): number {
      const actor = actors.get(id);
      const actual = changeActorVital(actor, key, delta);
      if (actor) exposeDefeatHoldings(actor);
      return actual;
    },
    /** Lasting affinities pay their per-turn upkeep; call before regenerate(). */
    chargeAffinityUpkeep(upkeepByStacks: readonly number[]): void {
      for (const actor of ordered) chargeActorAffinityUpkeep(actor, upkeepByStacks);
    },
    /**
     * Raised barriers (#413) pay `upkeep` mana a turn from what they were invested with;
     * one that cannot pay erodes `erosion` durability instead, until it is gone.
     */
    erodeRaisedBarriers(upkeep: number, erosion: number): void {
      for (const actor of ordered) {
        if (actor.lifecycle !== 'alive' || actor.raisedBy === undefined) continue;
        const mana = actor.vitals.mana;
        if (mana && mana.current >= upkeep) changeActorVital(actor, 'mana', -upkeep);
        else changeActorVital(actor, actor.defeatVital, -erosion);
        exposeDefeatHoldings(actor);
      }
    },
    /**
     * Raise one barrier actor at an empty, open cell (#413); false when the cell is a wall,
     * out of bounds or holds a living actor. Ids are `barrier:x:y`, suffixed when reused.
     */
    raiseBarrierAt(point: ActorPosition, record: Omit<ActorRecord, 'id' | 'position'>): string | null {
      if (terrainBlocks(point) || (occupancy.get(index(point)) ?? []).some(actor => actor.lifecycle === 'alive')) return null;
      let id = `barrier:${point.x}:${point.y}`;
      for (let n = 1; actors.has(id); n += 1) id = `barrier:${point.x}:${point.y}:${n}`;
      const actor = copy({ ...record, id, position: { x: point.x, y: point.y } }) as ActorRecord;
      validateActorRecordVitals(actor);
      validateActorInventory(actor);
      validateActorHoldings(actor);
      actors.set(id, actor);
      const occupants = occupancy.get(index(point)) ?? [];
      occupants.push(actor);
      occupancy.set(index(point), occupants);
      refreshOrder();
      return id;
    },
    /** #420: soak a living actor for `turns` turns; a longer soak already running is kept. */
    soakActor(id: string, turns: number): boolean {
      const actor = actors.get(id);
      if (!actor || actor.lifecycle !== 'alive' || !Number.isSafeInteger(turns) || turns < 1) return false;
      actor.soaked = Math.max(actor.soaked ?? 0, turns);
      return true;
    },
    /** #420: one turn of drying for every soaked actor not soaked again this turn. */
    drySoaked(soakedThisTurn: readonly string[] = []): void {
      for (const actor of ordered) {
        if (actor.soaked === undefined || soakedThisTurn.includes(actor.id)) continue;
        if (actor.soaked > 1) actor.soaked -= 1;
        else delete actor.soaked;
      }
    },
    /**
     * `scaleByActor` multiplies regen per actor and vital this turn (overwhelm, #289);
     * `upkeepByStacks` is the table chargeAffinityUpkeep read, so recovery knows what full mana pays (#441).
     */
    regenerate(scaleByActor: Readonly<Record<string, Partial<Record<ActorVitalKind, number>>>> = {},
      upkeepByStacks: readonly number[] = []): void {
      for (const actor of ordered) { regenerateActor(actor, scaleByActor[actor.id]); recoverActorAffinity(actor, upkeepByStacks); }
    },
    advanceExitDwell(): string[] {
      const exited: string[] = [];
      for (const actor of ordered) {
        const cell = index(actor.position);
        if (!advanceActorExit(actor, terrain[cell] === 'exit')) continue;
        occupancy.set(cell, (occupancy.get(cell) ?? []).filter(other => other.id !== actor.id));
        exited.push(actor.id);
      }
      return exited;
    },
    getActor(id: string): ActorRecord | null { return copy(actors.get(id) ?? null); },
    getActorsAt(point: ActorPosition): ActorRecord[] {
      return copy(withinBounds(point) ? occupancy.get(index(point)) ?? [] : []);
    },
    isMovementBlocked(point: ActorPosition): boolean { return blocks(point, 'blocksMovement'); },
    /** A wall or off the map: terrain alone, whoever stands there. */
    isWall(point: ActorPosition): boolean { return terrainBlocks(point); },
    isSightBlocked(point: ActorPosition): boolean { return blocks(point, 'blocksSight'); },
    persistOrSpawnHazardAt(point: ActorPosition, spec: {
      kind: AffinityKind; expression: AffinityExpression; stacks: number; manaReserve: number;
      durability?: ActorVitalRecord;
    }): boolean {
      if (!withinBounds(point) || terrain[index(point)] === 'wall') return false;
      if (!Number.isSafeInteger(spec.stacks) || spec.stacks <= 0
        || !Number.isSafeInteger(spec.manaReserve) || spec.manaReserve < 0) return false;
      const pair = { kind: spec.kind, expression: spec.expression, stacks: spec.stacks };
      const mana = { current: spec.manaReserve, max: spec.manaReserve, regen: 0 };
      const occupants = occupancy.get(index(point)) ?? [];
      const existing = occupants.find(actor => actor.lifecycle === 'alive'
        && !actor.capabilities.canMove && actor.capabilities.canCast);
      if (existing) {
        existing.affinities = [pair];
        existing.activeAffinityKey = `${pair.kind}:${pair.expression}`;
        delete existing.equippedAffinityKeys; delete existing.exhaustedAffinityKeys;
        delete existing.equippedAffinityStacks; delete existing.equippedAffinityIntensity;
        existing.vitals.mana = { ...mana };
        validateActorRecordVitals(existing);
        validateActorInventory(existing);
        return true;
      }
      const durability = spec.durability;
      if (!durability || durability.current <= 0 || terrain[index(point)] !== 'floor') return false;
      const id = `hazard:${point.x}:${point.y}`;
      if (actors.has(id)) return false;
      const actor: ActorRecord = {
        id, alignment: 'dungeon', position: { x: point.x, y: point.y }, lifecycle: 'alive',
        defeatVital: 'durability',
        vitals: { durability: { ...durability }, mana: { ...mana } },
        capabilities: { canMove: false, canCast: true, canEquip: false, canTake: false,
          canExit: false, blocksMovement: false, blocksSight: false },
        motivations: [], affinities: [pair], activeAffinityKey: `${pair.kind}:${pair.expression}`,
        holdings: [],
      };
      validateActorRecordVitals(actor);
      validateActorInventory(actor);
      validateActorHoldings(actor);
      actors.set(id, actor);
      occupants.push(actor);
      occupancy.set(index(point), occupants);
      refreshOrder();
      return true;
    },
    /** A push that hit no actor leaves its one-turn field (#461); the next tick's turn clears it. */
    leaveCastTrail(trail: ActorCastTrail): void {
      if (trail.cells.length > 0) castTrails.push(copy(trail));
    },
    clearCastTrails(): void { castTrails = []; },
    /** A `spread`-trait push leaves a creeping field where it lands (#421); `creepSpreadEmbers` moves it on. */
    leaveSpreadEmber(ember: ActorSpreadEmber): void {
      if (ember.intensity > 0 && withinBounds(ember.position)) spreadEmbers.push(copy(ember));
    },
    spreadEmbers(): ActorSpreadEmber[] { return copy(spreadEmbers); },
    replaceSpreadEmbers(next: ActorSpreadEmber[]): void { spreadEmbers = copy(next); },
    snapshot(): ActorRegistrySnapshot {
      return copy({ dimensions: { width, height }, terrain, actors: ordered,
        ...(castTrails.length ? { castTrails } : {}), ...(spreadEmbers.length ? { spreadEmbers } : {}) });
    },
  };
}

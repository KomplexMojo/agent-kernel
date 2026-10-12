import { createActorRegistry } from '../../../../core-ts/src/state/actor-registry.ts';
import { validateActorRecordVitals } from '../../../../core-ts/src/state/actor-vitals.ts';
import { validateActorInventory } from '../../../../core-ts/src/state/actor-inventory.ts';
import { validateActorHoldings } from '../../../../core-ts/src/state/actor-holdings.ts';
import { DEFAULT_MOVEMENT_COST } from './logical-validation.js';

// affinitySlots: how many affinities each preset can equip at once (maintainer,
// 2026-10-12). Every type has the same affinity capabilities; only this differs.
const PRESETS = Object.freeze({
  delver: { alignment: 'external', defeatVital: 'health', canMove: true, blocksMovement: true, affinitySlots: 3 },
  warden: { alignment: 'dungeon', defeatVital: 'health', canMove: true, blocksMovement: true, affinitySlots: 2 },
  hazard: { alignment: 'dungeon', defeatVital: 'durability', canMove: false, blocksMovement: false, affinitySlots: 1 },
  resource: { alignment: 'dungeon', defeatVital: 'durability', canMove: false, blocksMovement: false, affinitySlots: 1 },
  barrier: { alignment: 'dungeon', defeatVital: 'durability', canMove: false, blocksMovement: true, affinitySlots: 1 },
});
export const INPUT_KEYS = new Set(['category', 'id', 'position', 'alignment', 'lifecycle', 'defeatVital',
  'vitals', 'capabilities', 'motivations', 'affinities', 'activeAffinityKey', 'holdings',
  'affinitySlots', 'equippedAffinityKeys']);
const CATEGORIES = new Set(Object.keys(PRESETS));

function leftoverMotivations(actor) {
  if (Array.isArray(actor?.motivations)) {
    return actor.motivations.map((entry) => (typeof entry === 'string' ? entry : entry?.kind)).filter(Boolean);
  }
  if (typeof actor?.motivation === 'string' && actor.motivation.trim()) return [actor.motivation];
  if (typeof actor?.motivation?.kind === 'string' && actor.motivation.kind.trim()) return [actor.motivation.kind];
  return [];
}

/** Map leftover kind/role/archetype/motivation onto a unified category. Do not invent one. */
export function leftoverCategory(actor) {
  if (CATEGORIES.has(actor?.category)) return actor.category;
  if (CATEGORIES.has(actor?.archetype)) return actor.archetype;
  if (CATEGORIES.has(actor?.role)) return actor.role;
  if (actor?.kind !== 'ambulatory') return null;
  const kinds = leftoverMotivations(actor);
  if (kinds.includes('attacking') && !kinds.includes('defending') && !kinds.includes('patrolling')) return 'delver';
  if (kinds.includes('defending') || kinds.includes('patrolling')) return 'warden';
  return null;
}

/** Strip leftover authoring keys and fill category from lossless leftovers. */
export function prepareAuthoredActor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('invalid unified actor definition');
  }
  const category = leftoverCategory(input);
  if (!category) throw new Error('invalid unified actor definition');
  const request = { category };
  for (const key of INPUT_KEYS) {
    if (key === 'category' || !Object.hasOwn(input, key) || input[key] === undefined) continue;
    request[key] = input[key];
  }
  if (!Object.hasOwn(request, 'motivations')) {
    const motivations = leftoverMotivations(input);
    if (motivations.length) request.motivations = motivations;
  }
  return request;
}

/** Pure authoring helper. Defaults select properties; presentation never selects core rules. */
export function normalizeActorDefinition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !INPUT_KEYS.has(key))
    || !Object.hasOwn(PRESETS, input.category)) throw new Error('invalid unified actor definition');
  const request = structuredClone(input);
  const preset = PRESETS[request.category];
  const value = (key, fallback) => Object.hasOwn(request, key) ? request[key] : fallback;
  if (typeof request.id !== 'string' || !request.id.trim() || !request.position
    || Object.keys(request.position).length !== 2
    || !Number.isSafeInteger(request.position.x) || !Number.isSafeInteger(request.position.y)
    || request.position.x < 0 || request.position.y < 0) throw new Error('invalid actor identity/position');
  if (request.capabilities !== undefined && (!request.capabilities || typeof request.capabilities !== 'object'
    || Array.isArray(request.capabilities))) throw new Error('invalid actor capabilities');
  const actor = {
    id: request.id, position: request.position,
    alignment: value('alignment', preset.alignment),
    lifecycle: value('lifecycle', 'alive'), defeatVital: value('defeatVital', preset.defeatVital),
    vitals: request.vitals,
    capabilities: {
      canMove: preset.canMove, canCast: true, canEquip: preset.canMove, canTake: preset.canMove,
      canExit: request.category === 'delver', blocksMovement: preset.blocksMovement,
      blocksSight: request.category === 'barrier', ...request.capabilities,
    },
    motivations: value('motivations', []), affinities: value('affinities', []),
    activeAffinityKey: value('activeAffinityKey', null), holdings: value('holdings', []),
  };
  // One slot is core's default, so a one-slot record carries no slot field.
  const slots = value('affinitySlots', preset.affinitySlots);
  if (slots !== 1) actor.affinitySlots = slots;
  if (Object.hasOwn(request, 'equippedAffinityKeys')) actor.equippedAffinityKeys = request.equippedAffinityKeys;
  // Slot loot is floor loot only: no delver, warden or other preset drops it.
  if (request.category !== 'resource' && Array.isArray(actor.holdings)
    && actor.holdings.some(holding => holding?.kind === 'slot')) throw new Error('slot loot is floor loot: resources only');
  validateActorRecordVitals(actor);
  validateActorInventory(actor);
  validateActorHoldings(actor);
  return { actor, presentation: { category: request.category } };
}

/** Assemble an authored roster using core-owned identity, lifecycle and occupancy rules. */
export function normalizeActorRoster({ actors, dimensions, terrain } = {}) {
  if (!Array.isArray(actors)) throw new Error(`invalid actor roster: expected array, received ${typeof actors}`);
  const entries = actors.map(actor => normalizeActorDefinition(prepareAuthoredActor(actor)));
  const registry = createActorRegistry({ dimensions, terrain, actors: entries.map(entry => entry.actor) });
  const normalized = registry.snapshot().actors;
  const categories = new Map(entries.map(entry => [entry.actor.id, entry.presentation]));
  return { actors: normalized,
    presentation: Object.fromEntries(normalized.map(actor => [actor.id, categories.get(actor.id)])) };
}

function actorMoves(actor) {
  if (typeof actor?.capabilities?.canMove === 'boolean') return actor.capabilities.canMove;
  if (Object.hasOwn(PRESETS, actor?.category)) return PRESETS[actor.category].canMove;
  return actor?.type === 'delver' || actor?.type === 'warden';
}

function assertPlainMovementMap(movementStamina) {
  if (!movementStamina || typeof movementStamina !== 'object' || Array.isArray(movementStamina)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(movementStamina))) {
    throw new Error(`invalid movement stamina costs: expected ID-keyed plain object, received ${Object.prototype.toString.call(movementStamina)}`);
  }
}

/** Assemble authored per-ID cardinal move costs from the placed roster. Glue must not invent them. */
export function assembleMovementStamina({ actors, movementStamina } = {}) {
  if (!Array.isArray(actors)) {
    throw new Error(`invalid actor roster: expected array, received ${typeof actors}`);
  }
  if (movementStamina !== undefined) assertPlainMovementMap(movementStamina);
  const costs = movementStamina === undefined ? {} : structuredClone(movementStamina);
  for (const actor of actors) {
    if (!actor || typeof actor !== 'object' || typeof actor.id !== 'string' || !actor.id.trim()) continue;
    if (Object.hasOwn(costs, actor.id) || !actorMoves(actor)) continue;
    const authored = actor.capabilities?.movementCost;
    costs[actor.id] = Number.isSafeInteger(authored) && authored >= 0 ? authored : DEFAULT_MOVEMENT_COST;
  }
  return costs;
}

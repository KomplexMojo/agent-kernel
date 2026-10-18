import { createActorRegistry } from '../../../core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../../core-ts/src/rules/actor-turn.ts';
import { INITIAL_STATE_SCHEMA, SIM_CONFIG_SCHEMA, ACTOR_PRESENTATION_CATEGORIES } from '../contracts/artifacts.ts';
import { createAllocatorPersona } from '../personas/allocator/persona.js';
import { UNUSED_CLOCK } from '../personas/_shared/require-clock.js';

// Legacy cast-price tables are translated by the Allocator, which owns prices (#279).
const allocator = createAllocatorPersona({ clock: UNUSED_CLOCK });

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function artifact(value, schema) {
  if (!plain(value) || value.schema !== schema || value.schemaVersion !== 1
    || typeof value.meta?.id !== 'string' || !value.meta.id.trim()) {
    throw new Error(`invalid artifact envelope: expected ${schema} version 1 with metadata ID`);
  }
}

/** Load normalized artifacts only. Authoring, defaults and placement belong to Configurator. */
export function initializeCoreFromArtifacts({ simConfig, initialState } = {}) {
  artifact(simConfig, SIM_CONFIG_SCHEMA);
  artifact(initialState, INITIAL_STATE_SCHEMA);
  const ref = initialState.simConfigRef;
  if (ref?.id !== simConfig.meta.id || ref?.schema !== SIM_CONFIG_SCHEMA || ref?.schemaVersion !== 1) {
    throw new Error('initial-state simConfigRef does not identify the supplied config');
  }
  const layout = simConfig.layout;
  const data = layout?.data;
  if (layout?.kind !== 'grid' || !plain(data)
    || ['hazards', 'resources', 'actors', 'tiles', 'kinds'].some(key => Object.hasOwn(data, key))) {
    throw new Error('expected normalized grid terrain without category storage');
  }
  if (Object.keys(initialState).some(key => !['schema', 'schemaVersion', 'meta', 'simConfigRef', 'actors', 'presentation', 'strategies', 'escorts'].includes(key))) {
    throw new Error('unexpected initial-state fields');
  }
  const registry = createActorRegistry({ dimensions: { width: data.width, height: data.height },
    terrain: data.terrain, actors: initialState.actors });
  const actors = registry.snapshot().actors;
  const presentation = initialState.presentation;
  if (!plain(presentation) || Object.keys(presentation).length !== actors.length
    || actors.some(actor => !Object.hasOwn(presentation, actor.id)
      || !plain(presentation[actor.id]) || Object.keys(presentation[actor.id]).length !== 1
      || !ACTOR_PRESENTATION_CATEGORIES.includes(presentation[actor.id].category))) {
    throw new Error('presentation must contain exactly one valid category per actor ID');
  }
  // Strategies (Phase 2b) are the Actor's to read; the loader only checks whose they are.
  // What a strategy means, and its shape, are checked by the Actor (normalizeActorStrategy).
  const strategies = initialState.strategies;
  if (strategies !== undefined && (!plain(strategies)
    || Object.keys(strategies).some(id => !actors.some(actor => actor.id === id) || !plain(strategies[id])))) {
    throw new Error('strategies must map actor IDs in this level to strategy objects');
  }
  // Escorts (#251), likewise the Actor's to read: the loader checks only whose they are.
  const escorts = initialState.escorts;
  if (escorts !== undefined && (!plain(escorts)
    || Object.keys(escorts).some(id => !actors.some(actor => actor.id === id) || !plain(escorts[id])))) {
    throw new Error('escorts must map actor IDs in this level to escort objects');
  }
  const costs = allocator.castPricesFromLegacyTiers(simConfig.actionCosts);
  const castPrices = plain(costs) ? costs.castManaBase : undefined;
  if (!plain(costs) || !plain(castPrices) || !plain(costs.movementStamina)) {
    throw new Error('missing normalized action costs');
  }
  // Validate authored cost values with core without resolving any action/field phase.
  createActorTurn(registry, 0, costs);
  for (const actor of actors) {
    if (actor.capabilities.canMove && !Object.hasOwn(costs.movementStamina, actor.id)) {
      throw new Error(`missing movement stamina cost for actor ${actor.id}`);
    }
    for (const pair of actor.affinities) {
      const key = `${pair.kind}:${pair.expression}`;
      if (!Object.hasOwn(castPrices, key)) throw new Error(`missing authored cast costs for ${key}`);
    }
  }
  return { registry, costs: structuredClone(costs), presentation: structuredClone(presentation) };
}

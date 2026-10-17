import { PERSONA_IDS, stampPersona } from '../_shared/persona-stamp.js';
import { INITIAL_STATE_SCHEMA, SIM_CONFIG_SCHEMA } from '../../contracts/artifacts.ts';
import { normalizeActorRoster } from './unified-actors.js';
import { resolveActorTurnCosts } from './affinity-rules.js';
import { normalizeActorStrategy } from '../actor/persona.js';

const LAYOUT_FIELDS = new Set(['width', 'height', 'terrain', 'rooms', 'connectivity',
  'bounds', 'entryRoomId', 'exitRoomId', 'spawnApproach', 'exitApproach', 'render']);
const LEFTOVER_LAYOUT_FIELDS = new Set(['hazards', 'resources', 'tiles', 'kinds', 'actors',
  'spawn', 'exit', 'legend']);
function cloneLayoutData(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new Error(`invalid normalized layout: expected object, received ${typeof layout}`);
  }
  const geometry = { ...layout };
  delete geometry.budgetScaffold;
  for (const key of LEFTOVER_LAYOUT_FIELDS) delete geometry[key];
  const unknown = Object.keys(geometry).filter(key => !LAYOUT_FIELDS.has(key));
  if (unknown.length) throw new Error(`unsupported normalized layout fields: ${unknown.join(', ')}`);
  normalizeActorRoster({ actors: [], dimensions: { width: geometry.width, height: geometry.height }, terrain: geometry.terrain });
  return structuredClone(geometry);
}

export function buildSimConfigArtifact({
  meta, planRef, budgetReceiptRef, seed = 0, layout, flags, executionPolicy,
  constraints, affinityRules, movementStamina,
} = {}) {
  const artifact = {
    schema: SIM_CONFIG_SCHEMA, schemaVersion: 1, meta: stampPersona(meta, PERSONA_IDS.configurator), planRef, seed,
    layout: { kind: 'grid', data: cloneLayoutData(layout) },
    actionCosts: resolveActorTurnCosts({ rules: affinityRules, movementStamina }),
  };
  if (budgetReceiptRef) artifact.budgetReceiptRef = budgetReceiptRef;
  if (executionPolicy) artifact.executionPolicy = executionPolicy;
  if (flags) artifact.flags = flags;
  if (constraints) artifact.constraints = constraints;
  return structuredClone(artifact);
}

/**
 * Strategies authored on actors (`strategy` on an actor request, Phase 2b) or passed by
 * id. Core refuses any field it does not own on an actor record, so a level carries its
 * strategies beside the roster, keyed by actor id. The shape is the Actor's to check.
 */
function collectStrategies(actors, strategies) {
  const collected = {};
  for (const [id, strategy] of Object.entries(strategies ?? {})) collected[id] = strategy;
  for (const actor of Array.isArray(actors) ? actors : []) {
    if (actor?.strategy !== undefined && actor.strategy !== null && typeof actor.id === 'string') collected[actor.id] = actor.strategy;
  }
  const ids = new Set((Array.isArray(actors) ? actors : []).map(actor => actor?.id));
  for (const id of Object.keys(collected)) {
    if (!ids.has(id)) throw new Error(`strategy for unknown actor: ${id}`);
    try {
      collected[id] = normalizeActorStrategy(collected[id]);
    } catch (error) {
      throw new Error(`actor ${id}: ${error.message}`);
    }
  }
  return collected;
}

export function buildInitialStateArtifact({
  meta, simConfigRef, actors, dimensions, terrain, strategies, ...unsupported
} = {}) {
  const keys = Object.keys(unsupported);
  if (keys.length) throw new Error(`unsupported initial-state inputs: ${keys.join(', ')}`);
  const roster = normalizeActorRoster({ actors, dimensions, terrain });
  const authored = collectStrategies(actors, strategies);
  return structuredClone({ schema: INITIAL_STATE_SCHEMA, schemaVersion: 1,
    meta: stampPersona(meta, PERSONA_IDS.configurator), simConfigRef, actors: roster.actors, presentation: roster.presentation,
    ...(Object.keys(authored).length > 0 ? { strategies: authored } : {}) });
}

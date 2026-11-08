import { PERSONA_IDS, stampPersona } from '../_shared/persona-stamp.js';
import { INITIAL_STATE_SCHEMA, SIM_CONFIG_SCHEMA } from '../../contracts/artifacts.ts';
import { normalizeActorRoster } from './unified-actors.js';
import { resolveActorTurnCosts } from './affinity-rules.js';
import { normalizeActorStrategy } from '../actor/persona.js';

const LAYOUT_FIELDS = new Set(['width', 'height', 'terrain', 'rooms', 'connectivity',
  'bounds', 'entryRoomId', 'exitRoomId', 'spawnApproach', 'exitApproach', 'render']);
const LEFTOVER_LAYOUT_FIELDS = new Set(['hazards', 'resources', 'tiles', 'kinds', 'actors',
  'spawn', 'exit', 'legend', 'interiorBarriers']);
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

/**
 * #251 — who an `escorting` actor keeps near, authored on the actor (`escort`) or passed by
 * id, carried beside the roster like strategies. `target` names another actor in the
 * level; `distance` is a whole number of tiles, at least 1. Either may be left out: the
 * Actor then keeps to the playable delver, within its default distance.
 */
function collectEscorts(actors, escorts) {
  const collected = {};
  for (const [id, escort] of Object.entries(escorts ?? {})) collected[id] = escort;
  for (const actor of Array.isArray(actors) ? actors : []) {
    if (actor?.escort !== undefined && actor.escort !== null && typeof actor.id === 'string') collected[actor.id] = actor.escort;
  }
  const ids = new Set((Array.isArray(actors) ? actors : []).map(actor => actor?.id));
  for (const [id, escort] of Object.entries(collected)) {
    if (!ids.has(id)) throw new Error(`escort for unknown actor: ${id}`);
    if (!escort || typeof escort !== 'object' || Array.isArray(escort)
      || Object.keys(escort).some(key => key !== 'target' && key !== 'distance')) {
      throw new Error(`actor ${id}: escort must be { target?, distance? }`);
    }
    const normalized = {};
    if (escort.target !== undefined) {
      if (typeof escort.target !== 'string' || !ids.has(escort.target) || escort.target === id) {
        throw new Error(`actor ${id}: escort ally ${JSON.stringify(escort.target)} is not another actor in this level`);
      }
      normalized.target = escort.target;
    }
    if (escort.distance !== undefined) {
      if (!Number.isSafeInteger(escort.distance) || escort.distance < 1) {
        throw new Error(`actor ${id}: escort distance must be a whole number of tiles, at least 1`);
      }
      normalized.distance = escort.distance;
    }
    collected[id] = normalized;
  }
  return collected;
}

/**
 * AK-6 — core exit dwell needs the escort leader on the actor record (`escortOf`).
 * The `escorts` map stays beside the roster for Actor distance/follow; `escortOf` is
 * the mechanical gate so a minion cannot retire while its leader is still alive.
 * A missing authored target is the first `user_controlled` actor in the level (same
 * default the Actor uses when following).
 */
function stampEscortOf(rosterActors, escorting) {
  if (!escorting || Object.keys(escorting).length === 0) return rosterActors;
  const playable = rosterActors.find((actor) => Array.isArray(actor.motivations)
    && actor.motivations.includes("user_controlled"))?.id;
  return rosterActors.map((actor) => {
    const escort = escorting[actor.id];
    if (!escort) return actor;
    const target = escort.target ?? playable;
    if (!target || target === actor.id) return actor;
    return { ...actor, escortOf: target };
  });
}

/**
 * #408 — who leads each minion, authored on the actor (`leader`) or passed by id (`leaders`),
 * and by default an escort's ally (`escortOf`, already stamped). The leader pays the minion's
 * mana upkeep; core reads `minionOf` on the record, the map stays beside the roster for
 * readers. A leader must be another actor in the level, and the bonds may not loop.
 */
function collectLeaders(actors, leaders, stampedActors) {
  const collected = {};
  for (const actor of stampedActors) if (actor.escortOf !== undefined) collected[actor.id] = actor.escortOf;
  const ids = new Set(stampedActors.map(actor => actor.id));
  for (const [id, leader] of Object.entries(leaders ?? {})) {
    if (!ids.has(id)) throw new Error(`leader for unknown actor: ${id}`);
    collected[id] = leader;
  }
  for (const actor of Array.isArray(actors) ? actors : []) {
    if (actor?.leader !== undefined && actor.leader !== null && typeof actor.id === 'string') collected[actor.id] = actor.leader;
  }
  for (const [id, leader] of Object.entries(collected)) {
    if (typeof leader !== 'string' || !ids.has(leader) || leader === id) {
      throw new Error(`actor ${id}: leader ${JSON.stringify(leader)} is not another actor in this level`);
    }
  }
  for (const start of Object.keys(collected)) {
    const seen = new Set([start]);
    for (let at = collected[start]; at !== undefined; at = collected[at]) {
      if (seen.has(at)) throw new Error(`actor ${start}: leaders form a cycle (${[...seen, at].join(' -> ')})`);
      seen.add(at);
    }
  }
  return collected;
}

export function buildInitialStateArtifact({
  meta, simConfigRef, actors, dimensions, terrain, strategies, escorts, leaders, ...unsupported
} = {}) {
  const keys = Object.keys(unsupported);
  if (keys.length) throw new Error(`unsupported initial-state inputs: ${keys.join(', ')}`);
  const roster = normalizeActorRoster({ actors, dimensions, terrain });
  const authored = collectStrategies(actors, strategies);
  const escorting = collectEscorts(actors, escorts);
  const escortedActors = stampEscortOf(roster.actors, escorting);
  const bonds = collectLeaders(actors, leaders, escortedActors);
  const stampedActors = escortedActors.map(actor => bonds[actor.id] ? { ...actor, minionOf: bonds[actor.id] } : actor);
  return structuredClone({ schema: INITIAL_STATE_SCHEMA, schemaVersion: 1,
    meta: stampPersona(meta, PERSONA_IDS.configurator), simConfigRef, actors: stampedActors, presentation: roster.presentation,
    ...(Object.keys(authored).length > 0 ? { strategies: authored } : {}),
    ...(Object.keys(escorting).length > 0 ? { escorts: escorting } : {}),
    ...(Object.keys(bonds).length > 0 ? { leaders: bonds } : {}) });
}

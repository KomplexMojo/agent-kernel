import { readActorOverwhelms, resolveActorFields, type ActorOverwhelm } from './actor-fields.ts';
import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorAction, ActorAffinityKey } from '../state/actor-types.ts';
import { affinityIntensity, affinityKey, explainEquipActorAffinity, explainUnequipActorAffinity } from '../state/actor-inventory.ts';
import { explainTakeActorHolding } from '../state/actor-holdings.ts';
import { actorAffinityMagnitude } from './actor-affinity.ts';
import { assertActorCastPrices, castFocusedActorAffinity, selectActorCastAffinity, type ActorCastManaBases, type ActorEffectSuppression } from './actor-cast.ts';
import { computeMovementStaminaCost } from './move.ts';

export interface ActorTurnSnapshot {
  tick: number;
  acceptedActorIds: string[];
  /** Actors whose move was accepted this turn: they get no stamina regen (#273). Absent in older snapshots. */
  movedActorIds?: string[];
  closed: boolean;
  fieldsResolved: boolean;
  regenerated: boolean;
  exitsResolved: boolean;
  suppressions: ActorEffectSuppression[];
}
export interface ActorTurnCosts {
  /** Per-key base of the escalating cast curve, base × s(s+1)/2 (#232). */
  castManaBase: ActorCastManaBases;
  movementStamina: Record<string, number>;
  /** Per-turn mana upkeep of a lasting affinity, indexed by range + intensity; absent means none. */
  persistentUpkeep?: number[];
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function castPrices(costs: ActorTurnCosts) {
  return { castManaBase: costs.castManaBase };
}
function hasParams(action: ActorAction, keys: string[], optional: string[] = []): boolean {
  if (!action.params || typeof action.params !== 'object' || Array.isArray(action.params)) return false;
  const present = Object.keys(action.params);
  return keys.every(key => Object.hasOwn(action.params!, key))
    && present.every(key => keys.includes(key) || optional.includes(key));
}
const isKey = (value: unknown): value is ActorAffinityKey => typeof value === 'string';

/** Core action legality/exclusivity; Moderator supplies the ordered actions and tick. */
export function createActorTurn(
  registry: ReturnType<typeof createActorRegistry>, tick: number, costs: ActorTurnCosts,
  saved?: ActorTurnSnapshot,
) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('invalid turn tick');
  if (Object.values(costs.movementStamina).some(cost => !Number.isSafeInteger(cost) || cost < 0)
    || Object.hasOwn(costs, 'castMana')
    || costs.persistentUpkeep !== undefined && (!Array.isArray(costs.persistentUpkeep)
      || costs.persistentUpkeep.some(cost => !Number.isSafeInteger(cost) || cost < 0))) throw new Error('invalid action costs');
  assertActorCastPrices(castPrices(costs));
  const prices = copy(costs);
  const state = saved ? copy(saved) : { tick, acceptedActorIds: [], movedActorIds: [], closed: false, fieldsResolved: false, regenerated: false, exitsResolved: false, suppressions: [] };
  if (state.tick !== tick || typeof state.closed !== 'boolean'
    || typeof state.fieldsResolved !== 'boolean' || typeof state.regenerated !== 'boolean'
    || typeof state.exitsResolved !== 'boolean' || state.exitsResolved && !state.regenerated
    || state.fieldsResolved && !state.closed || state.regenerated && !state.fieldsResolved || !Array.isArray(state.acceptedActorIds)
    || new Set(state.acceptedActorIds).size !== state.acceptedActorIds.length
    || state.acceptedActorIds.some(id => typeof id !== 'string' || !registry.getActor(id))
    || state.movedActorIds !== undefined && (!Array.isArray(state.movedActorIds)
      || state.movedActorIds.some(id => !state.acceptedActorIds.includes(id)))
    || !Array.isArray(state.suppressions) || state.suppressions.some(entry => !entry || !Number.isFinite(entry.amount)
      || entry.amount < 0 || !registry.getActor(entry.sourceId) || !registry.getActor(entry.targetId)?.affinities.some(pair => affinityKey(pair) === entry.affinityKey))) {
    throw new Error('invalid turn snapshot');
  }
  function suppressionFor(id: string, key: ActorAffinityKey): number {
    return state.suppressions.filter(entry => entry.targetId === id && entry.affinityKey === key)
      .reduce((sum, entry) => sum + entry.amount, 0);
  }
  function consumeSuppression(id: string, key: ActorAffinityKey, amount: number): void {
    for (const entry of state.suppressions) {
      if (entry.targetId !== id || entry.affinityKey !== key) continue;
      const removed = Math.min(amount, entry.amount); entry.amount -= removed; amount -= removed;
    }
    state.suppressions = state.suppressions.filter(entry => entry.amount > 0);
  }
  // Why the last apply() was refused, as a ValidationError name, when core can say.
  let lastRejection: string | null = null;
  return {
    apply(action: ActorAction): boolean {
      lastRejection = null;
      if (!action || action.tick !== tick) { lastRejection = 'TickMismatch'; return false; }
      if (state.closed || state.acceptedActorIds.includes(action.actorId)) return false;
      const actor = registry.getActor(action.actorId);
      if (actor?.lifecycle !== 'alive') { lastRejection = 'WrongActor'; return false; }
      let accepted = false;
      switch (action.kind) {
        case 'wait': accepted = action.params === undefined; break;
        case 'equip_affinity': {
          if (!hasParams(action, ['affinityKey'], ['replaceKey', 'stacks', 'intensity']) || !isKey(action.params.affinityKey)) break;
          const { affinityKey: key, replaceKey, stacks, intensity } = action.params;
          if (replaceKey !== undefined && !isKey(replaceKey)) break;
          if (stacks !== undefined && typeof stacks !== 'number') break;
          if (intensity !== undefined && typeof intensity !== 'number') break;
          accepted = registry.equipAffinity(actor.id, key, replaceKey, stacks, intensity);
          if (!accepted) lastRejection = explainEquipActorAffinity(actor, key, replaceKey, stacks, intensity);
          break;
        }
        case 'unequip_affinity':
          if (hasParams(action, ['affinityKey']) && isKey(action.params.affinityKey)) {
            accepted = registry.unequipAffinity(actor.id, action.params.affinityKey);
            if (!accepted) lastRejection = explainUnequipActorAffinity(actor, action.params.affinityKey);
          }
          break;
        case 'take':
          if (hasParams(action, ['targetId', 'holdingId']) && typeof action.params.targetId === 'string'
            && typeof action.params.holdingId === 'string') {
            accepted = registry.takeHolding(actor.id, action.params.targetId, action.params.holdingId);
            if (!accepted) {
              lastRejection = explainTakeActorHolding(actor, registry.getActor(action.params.targetId) ?? undefined, action.params.holdingId)
                ?? 'InvalidActionValue';
            }
          }
          break;
        case 'move': {
          if (!hasParams(action, ['target']) || !action.params.target) break;
          const target = action.params.target;
          if (!Number.isSafeInteger(target.x) || !Number.isSafeInteger(target.y)) break;
          const cardinal = Object.hasOwn(prices.movementStamina, actor.id) ? prices.movementStamina[actor.id] : undefined;
          if (cardinal === undefined) break;
          lastRejection = registry.explainMove(actor.id, target);
          if (lastRejection) break;
          const cost = computeMovementStaminaCost(actor.position.x !== target.x && actor.position.y !== target.y, cardinal);
          if ((actor.vitals.stamina?.current ?? 0) < cost) { lastRejection = 'InsufficientStamina'; break; }
          accepted = registry.moveActor(actor.id, target);
          if (accepted && cost > 0) registry.changeVital(actor.id, 'stamina', -cost);
          if (accepted) (state.movedActorIds ??= []).push(actor.id);
          break;
        }
        case 'cast_affinity': {
          if (!hasParams(action, ['targetId'], ['affinityKey']) || typeof action.params.targetId !== 'string') break;
          const named = action.params.affinityKey;
          if (named !== undefined && !isKey(named)) break;
          const pair = selectActorCastAffinity(actor, named);
          if (typeof pair === 'string') { lastRejection = pair; break; }
          const key = affinityKey(pair);
          const result = castFocusedActorAffinity(registry, actor.id, action.params.targetId, castPrices(prices),
            suppressionFor(actor.id, key), key);
          accepted = result.accepted;
          if (!accepted) lastRejection = result.rejection ?? null;
          if (accepted) {
            consumeSuppression(actor.id, key, actorAffinityMagnitude(pair.expression, affinityIntensity(pair)));
            if (result.suppression && result.suppression.amount > 0) state.suppressions.push(result.suppression);
          }
          break;
        }
      }
      if (accepted) state.acceptedActorIds.push(actor.id);
      return accepted;
    },
    /** The ValidationError name for the last refused apply(), or null when core gave none. */
    lastRejection(): string | null { return lastRejection; },
    closeActions(): boolean { if (state.closed) return false; state.closed = true; return true; },
    resolveFields() {
      if (!state.closed || state.fieldsResolved) return null;
      const result = resolveActorFields(registry, state.suppressions);
      state.fieldsResolved = true;
      return result;
    },
    regenerate(): boolean {
      if (!state.fieldsResolved || state.regenerated) return false;
      if (prices.persistentUpkeep) registry.chargeAffinityUpkeep(prices.persistentUpkeep);
      registry.regenerate(regenScales(readActorOverwhelms(registry), state.movedActorIds ?? []));
      state.regenerated = true; return true;
    },
    resolveExits(): string[] | null {
      if (!state.regenerated || state.exitsResolved) return null;
      const exited = registry.advanceExitDwell();
      state.exitsResolved = true;
      return exited;
    },
    snapshot(): ActorTurnSnapshot { return copy({ ...state, acceptedActorIds: [...state.acceptedActorIds].sort(),
      ...(state.movedActorIds ? { movedActorIds: [...state.movedActorIds].sort() } : {}) }); },
  };
}

/**
 * Per actor and vital, the lowest regen scale this turn: a stop beats a doubling on the same vital.
 * Overwhelm (#289) scales any vital; a mover rests no stamina (#273), so walking drains and waiting refills.
 */
function regenScales(overwhelms: readonly ActorOverwhelm[], movedActorIds: readonly string[]): Record<string, Record<string, number>> {
  const scales: Record<string, Record<string, number>> = {};
  const lower = (actorId: string, vital: string, scale: number) => {
    const byVital = scales[actorId] ??= {};
    byVital[vital] = Math.min(byVital[vital] ?? Infinity, scale);
  };
  for (const { actorId, vital, regenScale } of overwhelms) lower(actorId, vital, regenScale);
  for (const actorId of movedActorIds) lower(actorId, 'stamina', 0);
  return scales;
}

import { resolveActorFields } from './actor-fields.ts';
import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorAction, ActorAffinityKey } from '../state/actor-types.ts';
import { activeActorAffinity, affinityKey } from '../state/actor-inventory.ts';
import { actorAffinityMagnitude } from './actor-affinity.ts';
import { castFocusedActorAffinity, type ActorCastManaCosts, type ActorEffectSuppression } from './actor-cast.ts';
import { computeMovementStaminaCost } from './move.ts';

export interface ActorTurnSnapshot {
  tick: number;
  acceptedActorIds: string[];
  closed: boolean;
  fieldsResolved: boolean;
  regenerated: boolean;
  exitsResolved: boolean;
  suppressions: ActorEffectSuppression[];
}
export interface ActorTurnCosts {
  castMana: ActorCastManaCosts;
  movementStamina: Record<string, number>;
  /** Per-turn mana upkeep of a lasting affinity, indexed by stacks; absent means none. */
  persistentUpkeep?: number[];
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function hasParams(action: ActorAction, keys: string[]): boolean {
  return !!action.params && typeof action.params === 'object' && !Array.isArray(action.params)
    && Object.keys(action.params).length === keys.length && keys.every(key => Object.hasOwn(action.params!, key));
}

/** Core action legality/exclusivity; Moderator supplies the ordered actions and tick. */
export function createActorTurn(
  registry: ReturnType<typeof createActorRegistry>, tick: number, costs: ActorTurnCosts,
  saved?: ActorTurnSnapshot,
) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('invalid turn tick');
  if (Object.values(costs.movementStamina).some(cost => !Number.isSafeInteger(cost) || cost < 0)
    || Object.values(costs.castMana).some(prices => !Array.isArray(prices) || prices.length !== 5
      || [...prices].some(price => !Number.isSafeInteger(price) || price < 0))
    || costs.persistentUpkeep !== undefined && (!Array.isArray(costs.persistentUpkeep)
      || costs.persistentUpkeep.some(cost => !Number.isSafeInteger(cost) || cost < 0))) throw new Error('invalid action costs');
  const prices = copy(costs);
  const state = saved ? copy(saved) : { tick, acceptedActorIds: [], closed: false, fieldsResolved: false, regenerated: false, exitsResolved: false, suppressions: [] };
  if (state.tick !== tick || typeof state.closed !== 'boolean'
    || typeof state.fieldsResolved !== 'boolean' || typeof state.regenerated !== 'boolean'
    || typeof state.exitsResolved !== 'boolean' || state.exitsResolved && !state.regenerated
    || state.fieldsResolved && !state.closed || state.regenerated && !state.fieldsResolved || !Array.isArray(state.acceptedActorIds)
    || new Set(state.acceptedActorIds).size !== state.acceptedActorIds.length
    || state.acceptedActorIds.some(id => typeof id !== 'string' || !registry.getActor(id))
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
        case 'equip_affinity':
          if (hasParams(action, ['affinityKey']) && typeof action.params.affinityKey === 'string') {
            accepted = registry.equipAffinity(actor.id, action.params.affinityKey);
          }
          break;
        case 'take':
          if (hasParams(action, ['targetId', 'holdingId']) && typeof action.params.targetId === 'string'
            && typeof action.params.holdingId === 'string') accepted = registry.takeHolding(actor.id, action.params.targetId, action.params.holdingId);
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
          break;
        }
        case 'cast_affinity': {
          if (!hasParams(action, ['targetId']) || typeof action.params.targetId !== 'string') break;
          const pair = activeActorAffinity(actor); if (!pair) break;
          const key = affinityKey(pair);
          const result = castFocusedActorAffinity(registry, actor.id, action.params.targetId, prices.castMana, suppressionFor(actor.id, key));
          accepted = result.accepted;
          if (accepted) {
            consumeSuppression(actor.id, key, actorAffinityMagnitude(pair.expression, pair.stacks));
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
      registry.regenerate(); state.regenerated = true; return true;
    },
    resolveExits(): string[] | null {
      if (!state.regenerated || state.exitsResolved) return null;
      const exited = registry.advanceExitDwell();
      state.exitsResolved = true;
      return exited;
    },
    snapshot(): ActorTurnSnapshot { return copy({ ...state, acceptedActorIds: [...state.acceptedActorIds].sort() }); },
  };
}

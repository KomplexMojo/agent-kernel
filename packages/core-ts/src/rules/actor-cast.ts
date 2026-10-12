import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorAffinityEntry, ActorAffinityKey, ActorRecord } from '../state/actor-types.ts';
import { affinityKey, equippedActorAffinities } from '../state/actor-inventory.ts';
import { actorAffinityMagnitude, getActorAffinityEffect, resolveActorAffinity, type ActorVitalChange } from './actor-affinity.ts';

/** Configurator-authored tier prices; these are mana costs, not Allocator token prices. */
export type ActorCastManaCosts = Partial<Record<ActorAffinityKey, readonly number[]>>;
export interface ActorEffectSuppression { sourceId: string; targetId: string; affinityKey: ActorAffinityKey; amount: number }
export interface ActorCastResult {
  accepted: boolean;
  changes: ActorVitalChange[];
  suppression?: ActorEffectSuppression;
  /** Why the cast was refused, as a ValidationError name; absent when accepted. */
  rejection?: string;
}

/**
 * The equipped slot a cast uses: the one it names, else the first equipped push
 * or pull. A ValidationError name when there is none to use.
 */
export function selectActorCastAffinity(actor: ActorRecord, key?: ActorAffinityKey): ActorAffinityEntry | string {
  const equipped = equippedActorAffinities(actor);
  if (key !== undefined) {
    const named = equipped.find(pair => affinityKey(pair) === key);
    if (!named) return 'AffinityNotEquipped';
    return named.expression === 'push' || named.expression === 'pull' ? named : 'AffinityNotCastable';
  }
  if (!equipped.length) return 'NoActiveAffinity';
  return equipped.find(pair => pair.expression === 'push' || pair.expression === 'pull') ?? 'AffinityNotCastable';
}

/** The target's slot a neutralizing cast of `kind` suppresses: its first push or emit of that kind. */
function suppressedSlot(target: ActorRecord, kind: string): ActorAffinityEntry | undefined {
  return equippedActorAffinities(target).find(pair => pair.kind === kind
    && (pair.expression === 'push' || pair.expression === 'emit'));
}

/** Focused effect primitive. The turn executor consumes its pending suppression record. */
export function castFocusedActorAffinity(
  registry: Pick<ReturnType<typeof createActorRegistry>, 'getActor' | 'changeVital'>,
  sourceId: string, targetId: string, manaCosts: ActorCastManaCosts, suppressedAmount = 0,
  castKey?: ActorAffinityKey,
): ActorCastResult {
  if (!Number.isFinite(suppressedAmount) || suppressedAmount < 0) throw new Error('invalid suppressed amount');
  for (const prices of Object.values(manaCosts)) {
    if (!Array.isArray(prices) || prices.length !== 5
      || ![...prices].every(price => Number.isSafeInteger(price) && price >= 0)) throw new Error('invalid authored cast prices');
  }
  const reject = (rejection: string): ActorCastResult => ({ accepted: false, changes: [], rejection });
  const source = registry.getActor(sourceId); const target = registry.getActor(targetId);
  if (source?.lifecycle !== 'alive') return reject('WrongActor');
  if (!source.capabilities.canCast) return reject('InvalidCapability');
  const pair = selectActorCastAffinity(source, castKey);
  if (typeof pair === 'string') return reject(pair);
  if (target?.lifecycle !== 'alive') return reject('InvalidTarget');
  if (Math.max(Math.abs(source.position.x - target.position.x),
    Math.abs(source.position.y - target.position.y)) > pair.stacks) return reject('TargetOutOfRange');
  const effect = getActorAffinityEffect(pair.kind, pair.expression);
  if (effect.operation === 'drain' && sourceId === targetId) return reject('InvalidTarget');
  const prices = manaCosts[affinityKey(pair)];
  if (!prices) return reject('InvalidActionValue');
  const cost = prices[Math.min(5, pair.stacks) - 1];
  if ((source.vitals.mana?.current ?? 0) < cost) return reject('InsufficientMana');
  const changes: ActorVitalChange[] = [];
  if (cost > 0) changes.push({ actorId: sourceId, vital: 'mana', delta: registry.changeVital(sourceId, 'mana', -cost) });
  const amount = Math.max(0, actorAffinityMagnitude(pair.expression, pair.stacks) - suppressedAmount);
  const targetPair = suppressedSlot(target, pair.kind);
  if (effect.operation === 'neutralize' && targetPair && target.capabilities.canCast && sourceId !== targetId) {
    return { accepted: true, changes, suppression: { sourceId, targetId, affinityKey: affinityKey(targetPair),
      amount: Math.min(amount, actorAffinityMagnitude(targetPair.expression, targetPair.stacks)) } };
  }
  return { accepted: true, changes: [...changes,
    ...resolveActorAffinity(registry, sourceId, targetId, pair.kind, pair.expression, amount).changes] };
}

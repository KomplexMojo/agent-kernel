import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorAffinityEntry, ActorAffinityKey, ActorRecord } from '../state/actor-types.ts';
import { affinityIntensity, affinityKey, equippedActorAffinities } from '../state/actor-inventory.ts';
import { actorAffinityMagnitude, getActorAffinityEffect, resolveActorAffinity, type ActorVitalChange } from './actor-affinity.ts';

/** Configurator-authored per-kind base prices for the escalating cast curve (#232). */
export type ActorCastManaBases = Partial<Record<ActorAffinityKey, number>>;
/** The cast prices a turn carries: the bases of the escalating curve, never a tier table. */
export type ActorCastPrices = { castManaBase: ActorCastManaBases };

/**
 * The mana a push or pull costs (maintainer, 2026-10-13, #232; #340): the kind's base
 * times its intensity times the triangular number r(r+1)/2 of its range, with no cap,
 * so every tile of reach costs more than the last and a harder hit costs in step with
 * its intensity. The curve is the rule; the base is the Configurator's tuning.
 */
export function actorCastManaPrice(base: number, range: number, intensity = 1): number {
  return base * intensity * range * (range + 1) / 2;
}

const isPrice = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

/** Throws unless `prices` is a valid base map. */
export function assertActorCastPrices(prices: ActorCastPrices): void {
  if (!prices || typeof prices !== 'object' || !prices.castManaBase || typeof prices.castManaBase !== 'object'
    || Array.isArray(prices.castManaBase) || !Object.values(prices.castManaBase).every(isPrice)) {
    throw new Error('invalid authored cast prices');
  }
}

/** The authored price of one cast; undefined when the key has no price. */
function castManaCost(prices: ActorCastPrices, pair: ActorAffinityEntry): number | undefined {
  const base = prices.castManaBase[affinityKey(pair)];
  return base === undefined ? undefined : actorCastManaPrice(base, pair.stacks, affinityIntensity(pair));
}
export interface ActorEffectSuppression { sourceId: string; targetId: string; affinityKey: ActorAffinityKey; amount: number }
export interface ActorCastResult {
  accepted: boolean;
  changes: ActorVitalChange[];
  suppression?: ActorEffectSuppression;
  /** Why the cast was refused, as a ValidationError name; absent when accepted. */
  rejection?: string;
}

/** Only push and pull are cast; emit and draw work on their own while equipped. */
export function isCastableExpression(expression: string): boolean {
  return expression === 'push' || expression === 'pull';
}

/** How far a cast reaches, in tiles (Chebyshev): one per stack of range it runs at (#231, #340). */
export function actorCastRange(pair: ActorAffinityEntry): number {
  return pair.stacks;
}

/** The actor's equipped push and pull slots, keyed, with how far each reaches. */
export function actorCastableAffinities(actor: ActorRecord): Partial<Record<ActorAffinityKey, { range: number }>> {
  return Object.fromEntries(equippedActorAffinities(actor)
    .filter(pair => isCastableExpression(pair.expression))
    .map(pair => [affinityKey(pair), { range: actorCastRange(pair) }]));
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
    return isCastableExpression(named.expression) ? named : 'AffinityNotCastable';
  }
  if (!equipped.length) return 'NoActiveAffinity';
  return equipped.find(pair => isCastableExpression(pair.expression)) ?? 'AffinityNotCastable';
}

/** The target's slot a neutralizing cast of `kind` suppresses: its first push or emit of that kind. */
function suppressedSlot(target: ActorRecord, kind: string): ActorAffinityEntry | undefined {
  return equippedActorAffinities(target).find(pair => pair.kind === kind
    && (pair.expression === 'push' || pair.expression === 'emit'));
}

/** Focused effect primitive. The turn executor consumes its pending suppression record. */
export function castFocusedActorAffinity(
  registry: Pick<ReturnType<typeof createActorRegistry>, 'getActor' | 'changeVital'>,
  sourceId: string, targetId: string, manaCosts: ActorCastPrices, suppressedAmount = 0,
  castKey?: ActorAffinityKey,
): ActorCastResult {
  if (!Number.isFinite(suppressedAmount) || suppressedAmount < 0) throw new Error('invalid suppressed amount');
  assertActorCastPrices(manaCosts);
  const reject = (rejection: string): ActorCastResult => ({ accepted: false, changes: [], rejection });
  const source = registry.getActor(sourceId); const target = registry.getActor(targetId);
  if (source?.lifecycle !== 'alive') return reject('WrongActor');
  if (!source.capabilities.canCast) return reject('InvalidCapability');
  const pair = selectActorCastAffinity(source, castKey);
  if (typeof pair === 'string') return reject(pair);
  if (target?.lifecycle !== 'alive') return reject('InvalidTarget');
  if (Math.max(Math.abs(source.position.x - target.position.x),
    Math.abs(source.position.y - target.position.y)) > actorCastRange(pair)) return reject('TargetOutOfRange');
  const effect = getActorAffinityEffect(pair.kind, pair.expression);
  if (effect.operation === 'drain' && sourceId === targetId) return reject('InvalidTarget');
  const cost = castManaCost(manaCosts, pair);
  if (cost === undefined) return reject('InvalidActionValue');
  if ((source.vitals.mana?.current ?? 0) < cost) return reject('InsufficientMana');
  const changes: ActorVitalChange[] = [];
  if (cost > 0) changes.push({ actorId: sourceId, vital: 'mana', delta: registry.changeVital(sourceId, 'mana', -cost) });
  const amount = Math.max(0, actorAffinityMagnitude(pair.expression, affinityIntensity(pair)) - suppressedAmount);
  const targetPair = suppressedSlot(target, pair.kind);
  if (effect.operation === 'neutralize' && targetPair && target.capabilities.canCast && sourceId !== targetId) {
    return { accepted: true, changes, suppression: { sourceId, targetId, affinityKey: affinityKey(targetPair),
      amount: Math.min(amount, actorAffinityMagnitude(targetPair.expression, affinityIntensity(targetPair))) } };
  }
  return { accepted: true, changes: [...changes,
    ...resolveActorAffinity(registry, sourceId, targetId, pair.kind, pair.expression, amount).changes] };
}

import { AFFINITY_EXPRESSION_BY_CODE } from '../affinity-readers.ts';
import { getAffinityExpressionBaseMagnitude, scaleAffinityVitalEffect } from '../state/affinity.ts';
import type { createActorRegistry } from '../state/actor-registry.ts';
import { AFFINITY_TABLE, isOutwardAffinityExpression } from '../state/affinity-table.ts';
import type { AffinityKind, AffinityExpression, ActorVitalKind } from '../state/actor-types.ts';

function applyEffect(effect: Effect, amount: number, defeatVital: ActorVitalKind,
  change: (vital: ActorVitalKind, delta: number) => number,
  transfer: (vital: ActorVitalKind, amount: number) => void): void {
  if (effect.operation === 'restore') { change(effect.vital, amount); return; }
  const removed = -change(effect.vital, -amount);
  // #354: a steal credits the source with what the primary vital gave up, never the spill.
  if (effect.operation === 'drain') transfer(effect.vital, removed);
  // #353: the remainder spills into the target's own defeat vital.
  if (effect.overflow && amount > removed && defeatVital !== effect.vital) change(defeatVital, -(amount - removed));
}

type Effect = { operation: 'damage' | 'restore' | 'drain'; vital: ActorVitalKind; overflow?: 'defeat' };

/**
 * Explicit routing, read from the one affinity table (#352); expression polarity never
 * invents healing or resource creation.
 */
const MATRIX = Object.freeze(Object.fromEntries(AFFINITY_TABLE.map(entry => [entry.kind, Object.freeze([
  Object.freeze(entry.outward === 'damage' && entry.spill
    ? { operation: entry.outward, vital: entry.primaryVital, overflow: entry.spill }
    : { operation: entry.outward, vital: entry.primaryVital }) as Effect,
  Object.freeze(entry.spill
    ? { operation: entry.inward, vital: entry.primaryVital, overflow: entry.spill }
    : { operation: entry.inward, vital: entry.primaryVital }) as Effect,
] as const)])) as Record<AffinityKind, readonly [Effect, Effect]>);

export function getActorAffinityEffect(kind: AffinityKind, expression: AffinityExpression): Effect {
  if (!Object.hasOwn(MATRIX, kind) || !['push', 'pull', 'emit', 'draw'].includes(expression)) {
    throw new Error('invalid affinity expression');
  }
  return { ...MATRIX[kind][isOutwardAffinityExpression(expression) ? 0 : 1] };
}

export interface ActorVitalChange { actorId: string; vital: ActorVitalKind; delta: number }

/**
 * Common vital outcome for already-evaluated exposure. Callers own spatial legality,
 * equipment and mana charging.
 */
export function resolveActorAffinity(
  registry: Pick<ReturnType<typeof createActorRegistry>, 'getActor' | 'changeVital'>,
  sourceId: string, targetId: string, kind: AffinityKind, expression: AffinityExpression, amount: number,
): { operation: Effect['operation']; changes: ActorVitalChange[] } {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('invalid affinity magnitude');
  const effect = getActorAffinityEffect(kind, expression);
  if (effect.operation === 'drain' && sourceId === targetId) throw new Error('invalid self-drain');
  const changes: ActorVitalChange[] = [];
  if (registry.getActor(sourceId)?.lifecycle !== 'alive' || registry.getActor(targetId)?.lifecycle !== 'alive') {
    return { operation: effect.operation, changes };
  }
  function change(actorId: string, vital: ActorVitalKind, delta: number): number {
    const actual = registry.changeVital(actorId, vital, delta);
    if (actual !== 0) changes.push({ actorId, vital, delta: actual });
    return actual;
  }
  // #537: a restoring kind's steal (a row with no spill: growth, fortify, light) is a top-up. It
  // takes from the target at most what the source lacks of that vital; a harmful steal stays whole.
  if (effect.operation === 'drain' && !effect.overflow) {
    const pool = registry.getActor(sourceId)!.vitals[effect.vital];
    amount = Math.min(amount, pool ? Math.max(0, pool.max - pool.current) : 0);
  }
  applyEffect(effect, amount, registry.getActor(targetId)!.defeatVital, (vital, delta) => change(targetId, vital, delta),
    (vital, removed) => { change(sourceId, vital, removed); });
  return { operation: effect.operation, changes };
}

/** Apply the receiver side through the same routing as combat; caller owns detached state. */
export function evaluateActorAffinityReceiver(kind: AffinityKind, expression: AffinityExpression,
  amount: number, defeatVital: ActorVitalKind, change: (vital: ActorVitalKind, delta: number) => number): void {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('invalid affinity magnitude');
  applyEffect(getActorAffinityEffect(kind, expression), amount, defeatVital, change, () => {});
}

/**
 * The strength of one hit (#340, maintainer 2026-10-17): the expression's base
 * (push/pull 2, emit/draw 1) times intensity squared. Range plays no part; it
 * only sets how far the hit reaches. Without legacy sign routing.
 */
export function actorAffinityMagnitude(expression: AffinityExpression, intensity: number): number {
  const code = Object.entries(AFFINITY_EXPRESSION_BY_CODE).find(([, name]) => name === expression)?.[0];
  if (!Number.isInteger(intensity) || intensity < 0) return 0;
  return scaleAffinityVitalEffect(getAffinityExpressionBaseMagnitude(Number(code)), intensity * intensity);
}

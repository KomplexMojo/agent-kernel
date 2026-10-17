import { AFFINITY_EXPRESSION_BY_CODE } from '../affinity-readers.ts';
import { getAffinityExpressionBaseMagnitude, scaleAffinityVitalEffect } from '../state/affinity.ts';
import type { createActorRegistry } from '../state/actor-registry.ts';
import type { AffinityKind, AffinityExpression, ActorVitalKind } from '../state/actor-types.ts';

function applyEffect(effect: Effect, amount: number,
  change: (vital: ActorVitalKind, delta: number) => number,
  transfer: (vital: ActorVitalKind, amount: number) => void): void {
  if (effect.operation === 'restore') change(effect.vital, amount);
  if (effect.operation === 'damage') {
    const removed = -change(effect.vital, -amount);
    if (effect.overflow && amount > removed) change(effect.overflow, -(amount - removed));
  }
  if (effect.operation === 'drain') transfer(effect.vital, -change(effect.vital, -amount));
}

type Effect = { operation: 'damage' | 'restore' | 'drain'; vital: ActorVitalKind; overflow?: 'health' }
  | { operation: 'neutralize' };
const neutralize: Effect = Object.freeze({ operation: 'neutralize' });

/** Explicit routing; expression polarity never invents healing or resource creation. */
const MATRIX: Record<AffinityKind, readonly [Effect, Effect]> = {
  fire: [{ operation: 'damage', vital: 'durability', overflow: 'health' }, neutralize],
  water: [{ operation: 'damage', vital: 'health' }, neutralize],
  earth: [{ operation: 'damage', vital: 'durability', overflow: 'health' }, neutralize],
  wind: [{ operation: 'damage', vital: 'stamina' }, neutralize],
  growth: [{ operation: 'restore', vital: 'health' }, { operation: 'drain', vital: 'health' }],
  decay: [{ operation: 'damage', vital: 'health' }, neutralize],
  corrode: [{ operation: 'damage', vital: 'durability', overflow: 'health' }, neutralize],
  fortify: [{ operation: 'restore', vital: 'durability' }, { operation: 'drain', vital: 'durability' }],
  light: [{ operation: 'restore', vital: 'mana' }, { operation: 'drain', vital: 'mana' }],
  dark: [{ operation: 'damage', vital: 'mana' }, neutralize],
};

export function getActorAffinityEffect(kind: AffinityKind, expression: AffinityExpression): Effect {
  if (!Object.hasOwn(MATRIX, kind) || !['push', 'pull', 'emit', 'draw'].includes(expression)) {
    throw new Error('invalid affinity expression');
  }
  return { ...MATRIX[kind][expression === 'push' || expression === 'emit' ? 0 : 1] };
}

export interface ActorVitalChange { actorId: string; vital: ActorVitalKind; delta: number }

/**
 * Common vital outcome for already-evaluated exposure. Callers own spatial legality,
 * equipment and mana charging. Neutralize is consumed by active-exposure resolution.
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
  applyEffect(effect, amount, (vital, delta) => change(targetId, vital, delta),
    (vital, removed) => { change(sourceId, vital, removed); });
  return { operation: effect.operation, changes };
}

/** Apply the receiver side through the same routing as combat; caller owns detached state. */
export function evaluateActorAffinityReceiver(kind: AffinityKind, expression: AffinityExpression,
  amount: number, change: (vital: ActorVitalKind, delta: number) => number): void {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('invalid affinity magnitude');
  applyEffect(getActorAffinityEffect(kind, expression), amount, change, () => {});
}

/** Uses existing expression magnitudes and stack scaling, without legacy sign routing. */
export function actorAffinityMagnitude(expression: AffinityExpression, stacks: number): number {
  const code = Object.entries(AFFINITY_EXPRESSION_BY_CODE).find(([, name]) => name === expression)?.[0];
  return scaleAffinityVitalEffect(getAffinityExpressionBaseMagnitude(Number(code)), stacks);
}

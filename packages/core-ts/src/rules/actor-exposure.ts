import type { createActorRegistry } from '../state/actor-registry.ts';
import { activeActorAffinity } from '../state/actor-inventory.ts';
import { getActorAffinityEffect, resolveActorAffinity, type ActorVitalChange } from './actor-affinity.ts';

/** Core-projected exposure; never accepted as an authored action magnitude. */
export interface ActorExposureSource {
  sourceId: string;
  budget: number;
  targets: { targetId: string; amount: number }[];
}
export interface ActorExposureResult {
  changes: ActorVitalChange[];
  absorptions: { sourceId: string; receiverId: string; amount: number; mana: number }[];
  suppressions: { sourceId: string; targetId: string; amount: number }[];
}

/**
 * A finite batch of active effects. Caller preserves ordered action/field sequencing;
 * neutralization can consume pending exposure but cannot undo historical damage.
 */
export function resolveActorExposures(
  registry: Pick<ReturnType<typeof createActorRegistry>, 'getActor' | 'changeVital'>,
  sources: ActorExposureSource[],
): ActorExposureResult {
  const remaining = new Map<string, number>();
  for (const source of sources) {
    if (typeof source.sourceId !== 'string' || !source.sourceId.trim() || remaining.has(source.sourceId)
      || !Number.isFinite(source.budget) || source.budget < 0 || !Array.isArray(source.targets)) throw new Error('invalid exposure source');
    const ids = new Set<string>();
    for (const target of source.targets) {
      if (typeof target.targetId !== 'string' || !target.targetId.trim() || ids.has(target.targetId)
        || !Number.isFinite(target.amount) || target.amount < 0) throw new Error('invalid exposure target');
      ids.add(target.targetId);
    }
    remaining.set(source.sourceId, source.budget);
  }
  const result: ActorExposureResult = { changes: [], absorptions: [], suppressions: [] };
  function spend(id: string, amount: number): void { remaining.set(id, remaining.get(id)! - amount); }
  function absorb(sourceId: string, receiverId: string, amount: number): void {
    const mana = registry.changeVital(receiverId, 'mana', amount);
    result.absorptions.push({ sourceId, receiverId, amount, mana });
    if (mana !== 0) result.changes.push({ actorId: receiverId, vital: 'mana', delta: mana });
  }
  for (const source of sources) {
    const actor = registry.getActor(source.sourceId);
    const pair = actor && activeActorAffinity(actor);
    if (!pair || !actor?.capabilities.canCast) continue;
    const effect = getActorAffinityEffect(pair.kind, pair.expression);
    const targets = [...source.targets].sort((a, b) => a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0);
    for (const target of targets) {
      if (registry.getActor(source.sourceId)?.lifecycle !== 'alive') break;
      const receiver = registry.getActor(target.targetId);
      if (!receiver || receiver.lifecycle !== 'alive') continue;
      if (effect.operation === 'drain' && source.sourceId === target.targetId) continue;
      const amount = Math.min(remaining.get(source.sourceId)!, target.amount);
      if (amount <= 0) continue;
      const receivingPair = activeActorAffinity(receiver);
      if (effect.operation === 'neutralize') {
        if (source.sourceId === target.targetId || !receiver.capabilities.canCast || receivingPair?.kind !== pair.kind
          || !['push', 'emit'].includes(receivingPair.expression)) continue;
        const suppressed = Math.min(amount, remaining.get(target.targetId) ?? 0);
        if (suppressed <= 0) continue;
        spend(source.sourceId, suppressed); spend(target.targetId, suppressed);
        result.suppressions.push({ sourceId: source.sourceId, targetId: target.targetId, amount: suppressed });
        if (pair.expression === 'draw') absorb(target.targetId, source.sourceId, suppressed);
        continue;
      }
      spend(source.sourceId, amount);
      if (receivingPair?.kind === pair.kind && receivingPair.expression === 'draw'
        && ['push', 'emit'].includes(pair.expression) && source.sourceId !== target.targetId) {
        absorb(source.sourceId, target.targetId, amount);
      } else {
        result.changes.push(...resolveActorAffinity(registry, source.sourceId, target.targetId,
          pair.kind, pair.expression, amount).changes);
      }
    }
  }
  return result;
}

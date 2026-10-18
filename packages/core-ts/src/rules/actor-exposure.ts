import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorAffinityKey } from '../state/actor-types.ts';
import { activeActorAffinity, affinityKey, equippedActorAffinities } from '../state/actor-inventory.ts';
import { getActorAffinityEffect, resolveActorAffinity, type ActorVitalChange } from './actor-affinity.ts';
import { receiverAbsorbsAffinity } from './actor-receiver.ts';

/** Core-projected exposure; never accepted as an authored action magnitude. */
export interface ActorExposureSource {
  sourceId: string;
  /** The equipped slot this field comes from; omitted means the active (first) one. */
  affinityKey?: ActorAffinityKey;
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
 *
 * A slot's `budget` is its strength this turn, not a pool its receivers share (#347):
 * each receiver takes its own exposure, capped by that strength, so who else stands in
 * range (and how their ids sort) changes nothing. Suppression and neutralization spend
 * it, because they weaken the field itself; once the slot has pulsed, what it delivered
 * is no longer pending, so a later neutralizer only finds what the receivers did not take.
 */
export function resolveActorExposures(
  registry: Pick<ReturnType<typeof createActorRegistry>, 'getActor' | 'changeVital'>,
  sources: ActorExposureSource[],
): ActorExposureResult {
  const remaining = new Map<string, number>();
  const slotOf = (source: ActorExposureSource) => `${source.sourceId}|${source.affinityKey ?? ''}`;
  for (const source of sources) {
    if (typeof source.sourceId !== 'string' || !source.sourceId.trim() || remaining.has(slotOf(source))
      || !Number.isFinite(source.budget) || source.budget < 0 || !Array.isArray(source.targets)) throw new Error('invalid exposure source');
    const ids = new Set<string>();
    for (const target of source.targets) {
      if (typeof target.targetId !== 'string' || !target.targetId.trim() || ids.has(target.targetId)
        || !Number.isFinite(target.amount) || target.amount < 0) throw new Error('invalid exposure target');
      ids.add(target.targetId);
    }
    remaining.set(slotOf(source), source.budget);
  }
  function slotBudgetKey(actorId: string, pair: { kind: string; expression: string }): string {
    const keyed = `${actorId}|${pair.kind}:${pair.expression}`;
    return remaining.has(keyed) ? keyed : `${actorId}|`;
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
    const pair = actor && (source.affinityKey === undefined ? activeActorAffinity(actor)
      : equippedActorAffinities(actor).find(entry => affinityKey(entry) === source.affinityKey));
    if (!pair || !actor?.capabilities.canCast) continue;
    const own = slotOf(source);
    const effect = getActorAffinityEffect(pair.kind, pair.expression);
    const targets = [...source.targets].sort((a, b) => a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0);
    const strength = remaining.get(own)!;
    let delivered = 0;
    for (const target of targets) {
      if (registry.getActor(source.sourceId)?.lifecycle !== 'alive') break;
      const receiver = registry.getActor(target.targetId);
      if (!receiver || receiver.lifecycle !== 'alive') continue;
      if (effect.operation === 'drain' && source.sourceId === target.targetId) continue;
      const amount = Math.min(effect.operation === 'neutralize' ? remaining.get(own)! : strength, target.amount);
      if (amount <= 0) continue;
      if (effect.operation === 'neutralize') {
        // Only a slot with a pending field has exposure left to suppress.
        const matching = equippedActorAffinities(receiver).filter(entry => entry.kind === pair.kind
          && (entry.expression === 'push' || entry.expression === 'emit'));
        if (source.sourceId === target.targetId || !receiver.capabilities.canCast || !matching.length) continue;
        const theirs = matching.map(entry => slotBudgetKey(target.targetId, entry))
          .find(key => (remaining.get(key) ?? 0) > 0) ?? slotBudgetKey(target.targetId, matching[0]);
        const suppressed = Math.min(amount, remaining.get(theirs) ?? 0);
        if (suppressed <= 0) continue;
        spend(own, suppressed); spend(theirs, suppressed);
        result.suppressions.push({ sourceId: source.sourceId, targetId: target.targetId, amount: suppressed });
        if (pair.expression === 'draw') absorb(target.targetId, source.sourceId, suppressed);
        continue;
      }
      delivered += amount;
      if (receiverAbsorbsAffinity(receiver, pair) && source.sourceId !== target.targetId) {
        absorb(source.sourceId, target.targetId, amount);
      } else {
        result.changes.push(...resolveActorAffinity(registry, source.sourceId, target.targetId,
          pair.kind, pair.expression, amount).changes);
      }
    }
    if (delivered > 0) remaining.set(own, Math.max(0, remaining.get(own)! - delivered));
  }
  return result;
}

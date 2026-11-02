import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorAffinityKey, AffinityExpression, AffinityKind } from '../state/actor-types.ts';
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
/**
 * One field contact that actually took a vital from its target this pass (AK-12):
 * restoring draws that top-up nothing (#537) are absent, so a co-located emit cannot
 * make an idle draw look like it hurt.
 */
export interface ActorExposureContact {
  sourceId: string;
  targetId: string;
  kind: AffinityKind;
  expression: AffinityExpression;
  changes: ActorVitalChange[];
}
export interface ActorExposureResult {
  changes: ActorVitalChange[];
  absorptions: { sourceId: string; receiverId: string; amount: number; mana: number }[];
  contacts: ActorExposureContact[];
}

/**
 * A finite batch of active effects. Caller preserves ordered action/field sequencing.
 *
 * A slot's `budget` is its strength this turn, not a pool its receivers share (#347):
 * each receiver takes its own exposure, capped by that strength, so who else stands in
 * range (and how their ids sort) changes nothing. Every field is a direct effect (#354):
 * a draw steals like any other inward use and suppresses nothing.
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
  const result: ActorExposureResult = { changes: [], absorptions: [], contacts: [] };
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
      const amount = Math.min(strength, target.amount);
      if (amount <= 0) continue;
      delivered += amount;
      if (receiverAbsorbsAffinity(receiver, pair) && source.sourceId !== target.targetId) {
        absorb(source.sourceId, target.targetId, amount);
      } else {
        const changes = resolveActorAffinity(registry, source.sourceId, target.targetId,
          pair.kind, pair.expression, amount).changes;
        result.changes.push(...changes);
        const harm = changes.filter(change => change.actorId === target.targetId && change.delta < 0);
        if (harm.length > 0) {
          result.contacts.push({
            sourceId: source.sourceId, targetId: target.targetId,
            kind: pair.kind, expression: pair.expression, changes: harm,
          });
        }
      }
    }
    if (delivered > 0) remaining.set(own, Math.max(0, remaining.get(own)! - delivered));
  }
  return result;
}

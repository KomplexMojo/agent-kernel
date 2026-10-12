import type { ActorRecord, ActorHolding, ActorVitalHolding } from './actor-types.ts';
import { affinityKey, MAX_AFFINITY_SLOTS } from './actor-inventory.ts';
import { getActorAffinityEffect } from '../rules/actor-affinity.ts';

export function validateActorHoldings(actor: ActorRecord): void {
  if (!Array.isArray(actor.holdings)) throw new Error('invalid holdings');
  const ids = new Set<string>();
  for (const holding of actor.holdings) {
    if (!holding || typeof holding.id !== 'string' || !holding.id.trim() || ids.has(holding.id)
      || !(holding.claimedBy === null || typeof holding.claimedBy === 'string' && holding.claimedBy.trim())
      || actor.lifecycle === 'alive' && holding.claimedBy !== null) throw new Error('invalid holding identity/claim');
    ids.add(holding.id);
    if (holding.kind === 'affinity') {
      getActorAffinityEffect(holding.affinity, holding.expression);
      if (Object.keys(holding).length !== 5 || actor.lifecycle !== 'defeated'
        || holding.id !== `affinity:${holding.affinity}:${holding.expression}`
        || !actor.affinities.some(entry => entry.kind === holding.affinity && entry.expression === holding.expression)) {
        throw new Error('invalid derived affinity holding');
      }
    } else if (holding.kind === 'vital') {
      if (Object.keys(holding).length !== 5 || holding.id.startsWith('affinity:')
        || !['consumable', 'level', 'permanent'].includes(holding.permanenceMode)
        || !Array.isArray(holding.vitals) || holding.vitals.length === 0) throw new Error('invalid vital holding');
      for (const grant of holding.vitals) {
        if (!grant || Object.keys(grant).some(key => !['key', 'delta', 'regen'].includes(key))
          || !['health', 'mana', 'stamina'].includes(grant.key) || !Number.isFinite(grant.delta)
          || grant.regen !== undefined && (!Number.isFinite(grant.regen) || grant.regen < 0)) throw new Error('invalid vital grant');
      }
    } else if (holding.kind === 'slot') {
      if (Object.keys(holding).length !== 4 || holding.id.startsWith('affinity:')
        || !Number.isSafeInteger(holding.slots) || holding.slots < 1) throw new Error('invalid slot holding');
    } else throw new Error('invalid holding kind');
  }
}

/** Preserve claimed entries on restore; never derive reward quantity from stacks. */
export function exposeDefeatHoldings(actor: ActorRecord): void {
  if (actor.lifecycle !== 'defeated') return;
  for (const entry of actor.affinities) {
    const id = `affinity:${affinityKey(entry)}`;
    if (!actor.holdings.some(holding => holding.id === id)) actor.holdings.push({
      id, kind: 'affinity', affinity: entry.kind, expression: entry.expression, claimedBy: null,
    });
  }
  actor.holdings.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function grantVitals(draft: ActorRecord, holding: ActorVitalHolding): boolean {
  for (const grant of holding.vitals) {
    const vital = draft.vitals[grant.key];
    if (!vital) continue;
    const max = holding.permanenceMode === 'consumable' ? vital.max : Math.max(0, vital.max + grant.delta);
    const current = Math.min(max, Math.max(0, vital.current + grant.delta));
    const regen = vital.regen + (grant.regen ?? 0);
    if (![max, current, regen].every(Number.isFinite)) return false;
    Object.assign(vital, { current, max, regen });
  }
  if (draft.vitals[draft.defeatVital]!.current === 0) draft.lifecycle = 'defeated';
  return true;
}

/** Why a take is refused before any grant is evaluated, as a ValidationError name; null when it may proceed. */
export function explainTakeActorHolding(receiver: ActorRecord | undefined, source: ActorRecord | undefined, holdingId: string): string | null {
  if (!receiver || receiver.lifecycle !== 'alive') return 'WrongActor';
  if (!receiver.capabilities.canTake) return 'InvalidCapability';
  if (!source || source.lifecycle !== 'defeated') return 'InvalidTarget';
  if (Math.max(Math.abs(receiver.position.x - source.position.x),
    Math.abs(receiver.position.y - source.position.y)) > 1) return 'NotAdjacent';
  const holding = source.holdings.find(entry => entry.id === holdingId);
  if (!holding || holding.claimedBy !== null) return 'NothingToTake';
  if (holding.kind === 'slot' && (receiver.affinitySlots ?? 1) >= MAX_AFFINITY_SLOTS) return 'AffinitySlotsFull';
  return null;
}

/** Evaluate on a draft so malformed/overflowing grants cannot leave partial claims. */
export function takeActorHolding(receiver: ActorRecord | undefined, source: ActorRecord | undefined, holdingId: string): boolean {
  if (explainTakeActorHolding(receiver, source, holdingId) !== null) return false;
  if (!receiver || !source) return false;
  const holding: ActorHolding | undefined = source.holdings.find(entry => entry.id === holdingId);
  if (!holding) return false;
  const draft = JSON.parse(JSON.stringify(receiver)) as ActorRecord;
  if (holding.kind === 'affinity') {
    const entry = draft.affinities.find(entry => entry.kind === holding.affinity && entry.expression === holding.expression);
    if (entry) {
      if (!Number.isSafeInteger(entry.stacks + 1)) return false;
      entry.stacks += 1;
    } else draft.affinities.push({ kind: holding.affinity, expression: holding.expression, stacks: 1 });
  } else if (holding.kind === 'slot') {
    draft.affinitySlots = Math.min(MAX_AFFINITY_SLOTS, (draft.affinitySlots ?? 1) + holding.slots);
  } else if (!grantVitals(draft, holding)) return false;
  if (draft.affinitySlots !== undefined) receiver.affinitySlots = draft.affinitySlots;
  receiver.vitals = draft.vitals;
  receiver.affinities = draft.affinities;
  receiver.lifecycle = draft.lifecycle;
  exposeDefeatHoldings(receiver);
  holding.claimedBy = receiver.id;
  return true;
}

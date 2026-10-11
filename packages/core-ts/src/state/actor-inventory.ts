import type { ActorRecord, ActorAffinityKey, ActorAffinityEntry } from './actor-types.ts';
import { getActorAffinityEffect } from '../rules/actor-affinity.ts';

export function affinityKey(entry: ActorAffinityEntry): ActorAffinityKey {
  return `${entry.kind}:${entry.expression}`;
}

export function validateActorInventory(actor: ActorRecord): void {
  if (!Array.isArray(actor.motivations) || actor.motivations.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('invalid motivation list');
  }
  if (!Array.isArray(actor.affinities)) throw new Error('invalid affinity inventory');
  const keys = new Set<ActorAffinityKey>();
  for (const entry of actor.affinities) {
    if (!entry || Object.keys(entry).length !== 3 || !Number.isSafeInteger(entry.stacks) || entry.stacks < 1) {
      throw new Error('invalid affinity entry');
    }
    getActorAffinityEffect(entry.kind, entry.expression);
    const key = affinityKey(entry);
    if (keys.has(key)) throw new Error('duplicate affinity pair');
    keys.add(key);
  }
  if (actor.activeAffinityKey !== null && !keys.has(actor.activeAffinityKey)) throw new Error('invalid active affinity key');
}

export function activeActorAffinity(actor: ActorRecord): ActorAffinityEntry | undefined {
  if (actor.lifecycle !== 'alive') return undefined;
  return actor.affinities.find(entry => affinityKey(entry) === actor.activeAffinityKey);
}

/** Slot mutation only; the tick executor owns one-action scheduling. */
export function equipActorAffinity(actor: ActorRecord | undefined, key: ActorAffinityKey): boolean {
  if (!actor || actor.lifecycle !== 'alive' || !actor.capabilities.canEquip || actor.activeAffinityKey === key) return false;
  if (!actor.affinities.some(entry => affinityKey(entry) === key)) return false;
  actor.activeAffinityKey = key;
  return true;
}

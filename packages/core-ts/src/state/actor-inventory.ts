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
  const slots = actor.affinitySlots;
  if (slots !== undefined && (!Number.isSafeInteger(slots) || slots < 1 || slots > MAX_AFFINITY_SLOTS)) {
    throw new Error('invalid affinity slots');
  }
  if (actor.equippedAffinityKeys !== undefined) {
    const equipped = actor.equippedAffinityKeys;
    if (!Array.isArray(equipped) || equipped.length < 2 || equipped.length > (slots ?? 1)
      || new Set(equipped).size !== equipped.length || equipped.some(key => !keys.has(key))
      || actor.activeAffinityKey !== equipped[0]) throw new Error('invalid equipped affinity keys');
  }
  if (actor.exhaustedAffinityKeys !== undefined) {
    const equipped = equippedActorAffinityKeys(actor);
    const exhausted = actor.exhaustedAffinityKeys;
    if (actor.affinityExhausted !== true || !Array.isArray(exhausted) || !exhausted.length
      || new Set(exhausted).size !== exhausted.length || exhausted.some(key => !equipped.includes(key))) {
      throw new Error('invalid exhausted affinity keys');
    }
  }
}

/** Hard cap on equipped slots (maintainer, 2026-10-12); slot loot never raises it further. */
export const MAX_AFFINITY_SLOTS = 6;

/** Equipped keys in equip order; the first is always `activeAffinityKey`. */
export function equippedActorAffinityKeys(actor: ActorRecord): ActorAffinityKey[] {
  if (actor.equippedAffinityKeys) return [...actor.equippedAffinityKeys];
  return actor.activeAffinityKey ? [actor.activeAffinityKey] : [];
}

/** Equipped entries in equip order; none unless the actor is alive. */
export function equippedActorAffinities(actor: ActorRecord): ActorAffinityEntry[] {
  if (actor.lifecycle !== 'alive') return [];
  return equippedActorAffinityKeys(actor).flatMap(key => {
    const entry = actor.affinities.find(pair => affinityKey(pair) === key);
    return entry ? [entry] : [];
  });
}

/** The equipped keys whose lasting affinity is off until mana is full again. */
export function exhaustedActorAffinityKeys(actor: ActorRecord): ActorAffinityKey[] {
  if (actor.affinityExhausted !== true) return [];
  return actor.exhaustedAffinityKeys ? [...actor.exhaustedAffinityKeys] : equippedActorAffinityKeys(actor);
}

/**
 * Write exhaustion in the record's compact form: nothing when no slot is off,
 * only `affinityExhausted` when every equipped slot is, and the key list besides
 * when some are.
 */
export function setExhaustedActorAffinityKeys(actor: ActorRecord, keys: readonly ActorAffinityKey[]): void {
  const equipped = equippedActorAffinityKeys(actor);
  const off = equipped.filter(key => keys.includes(key));
  delete actor.exhaustedAffinityKeys;
  if (!off.length) { delete actor.affinityExhausted; return; }
  actor.affinityExhausted = true;
  if (off.length < equipped.length) actor.exhaustedAffinityKeys = off;
}

/** Replace the equipped list; exhaustion stays with the slots that remain. */
function setEquippedActorAffinityKeys(actor: ActorRecord, keys: ActorAffinityKey[]): void {
  const exhausted = exhaustedActorAffinityKeys(actor).filter(key => keys.includes(key));
  actor.activeAffinityKey = keys[0] ?? null;
  if (keys.length > 1) actor.equippedAffinityKeys = [...keys];
  else delete actor.equippedAffinityKeys;
  setExhaustedActorAffinityKeys(actor, exhausted);
}

export function activeActorAffinity(actor: ActorRecord): ActorAffinityEntry | undefined {
  if (actor.lifecycle !== 'alive') return undefined;
  return actor.affinities.find(entry => affinityKey(entry) === actor.activeAffinityKey);
}

/** Why an equip is refused, as a ValidationError name; null when it is legal. */
export function explainEquipActorAffinity(actor: ActorRecord | undefined, key: ActorAffinityKey,
  replaceKey?: ActorAffinityKey): string | null {
  if (!actor || actor.lifecycle !== 'alive') return 'WrongActor';
  if (!actor.capabilities.canEquip) return 'InvalidCapability';
  if (!actor.affinities.some(entry => affinityKey(entry) === key)) return 'UnknownAffinity';
  const equipped = equippedActorAffinityKeys(actor);
  if (equipped.includes(key)) return 'AffinityAlreadyEquipped';
  if (replaceKey !== undefined && !equipped.includes(replaceKey)) return 'AffinityNotEquipped';
  return null;
}

/**
 * Slot mutation only; the tick executor owns one-action scheduling. A named
 * `replaceKey` is swapped in place; otherwise a free slot is used, and when the
 * slots are full the oldest equipped affinity makes way (one slot: a plain swap).
 */
export function equipActorAffinity(actor: ActorRecord | undefined, key: ActorAffinityKey,
  replaceKey?: ActorAffinityKey): boolean {
  if (explainEquipActorAffinity(actor, key, replaceKey) !== null) return false;
  const keys = equippedActorAffinityKeys(actor!);
  if (replaceKey !== undefined) keys[keys.indexOf(replaceKey)] = key;
  else {
    if (keys.length >= (actor!.affinitySlots ?? 1)) keys.shift();
    keys.push(key);
  }
  setEquippedActorAffinityKeys(actor!, keys);
  return true;
}

/** Why an unequip is refused, as a ValidationError name; null when it is legal. */
export function explainUnequipActorAffinity(actor: ActorRecord | undefined, key: ActorAffinityKey): string | null {
  if (!actor || actor.lifecycle !== 'alive') return 'WrongActor';
  if (!actor.capabilities.canEquip) return 'InvalidCapability';
  if (!equippedActorAffinityKeys(actor).includes(key)) return 'AffinityNotEquipped';
  return null;
}

/** Free the slot holding `key`; later slots move up in equip order. */
export function unequipActorAffinity(actor: ActorRecord | undefined, key: ActorAffinityKey): boolean {
  if (explainUnequipActorAffinity(actor, key) !== null) return false;
  setEquippedActorAffinityKeys(actor!, equippedActorAffinityKeys(actor!).filter(other => other !== key));
  return true;
}

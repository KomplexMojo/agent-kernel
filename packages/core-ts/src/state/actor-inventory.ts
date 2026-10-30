import type { ActorRecord, ActorAffinityKey, ActorAffinityEntry } from './actor-types.ts';
import { getActorAffinityEffect } from '../rules/actor-affinity.ts';

export function affinityKey(entry: ActorAffinityEntry): ActorAffinityKey {
  return `${entry.kind}:${entry.expression}`;
}

const AFFINITY_ENTRY_FIELDS = new Set(['kind', 'expression', 'stacks', 'intensity']);

/** An entry's strength (#340): its `intensity`, or 1 when absent, which is how older entries load. */
export function affinityIntensity(entry: Pick<ActorAffinityEntry, 'intensity'>): number {
  return entry.intensity ?? 1;
}

export function validateActorInventory(actor: ActorRecord): void {
  if (!Array.isArray(actor.motivations) || actor.motivations.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('invalid motivation list');
  }
  if (!Array.isArray(actor.affinities)) throw new Error('invalid affinity inventory');
  const keys = new Set<ActorAffinityKey>();
  for (const entry of actor.affinities) {
    if (!entry || !Number.isSafeInteger(entry.stacks) || entry.stacks < 1
      || Object.keys(entry).some(field => !AFFINITY_ENTRY_FIELDS.has(field))
      || (entry.intensity !== undefined && (!Number.isSafeInteger(entry.intensity) || entry.intensity < 1))) {
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
  if (actor.equippedAffinityStacks !== undefined) {
    const running = actor.equippedAffinityStacks;
    const equipped = equippedActorAffinityKeys(actor);
    if (!running || typeof running !== 'object' || Array.isArray(running) || !Object.keys(running).length
      || Object.entries(running).some(([key, stacks]) => {
        const held = actor.affinities.find(entry => affinityKey(entry) === key)?.stacks ?? 0;
        return !equipped.includes(key as ActorAffinityKey) || !Number.isSafeInteger(stacks)
          || (stacks as number) < 1 || (stacks as number) >= held;
      })) throw new Error('invalid equipped affinity stacks');
  }
  if (actor.equippedAffinityIntensity !== undefined) {
    const running = actor.equippedAffinityIntensity;
    const equipped = equippedActorAffinityKeys(actor);
    if (!running || typeof running !== 'object' || Array.isArray(running) || !Object.keys(running).length
      || Object.entries(running).some(([key, intensity]) => {
        const entry = actor.affinities.find(pair => affinityKey(pair) === key);
        const held = entry ? affinityIntensity(entry) : 0;
        return !equipped.includes(key as ActorAffinityKey) || !Number.isSafeInteger(intensity)
          || (intensity as number) < 1 || (intensity as number) >= held;
      })) throw new Error('invalid equipped affinity intensity');
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

/**
 * Hard cap on equipped slots: three (Darren, 2026-10-30, was 6). Any further affinities an actor
 * holds are its pack, and equipping one into full slots makes the oldest give way, for a turn.
 */
export const MAX_AFFINITY_SLOTS = 3;

/** Equipped keys in equip order; the first is always `activeAffinityKey`. */
export function equippedActorAffinityKeys(actor: ActorRecord): ActorAffinityKey[] {
  if (actor.equippedAffinityKeys) return [...actor.equippedAffinityKeys];
  return actor.activeAffinityKey ? [actor.activeAffinityKey] : [];
}

/**
 * The level an equipped entry runs at: its running range (#230) and running intensity
 * (#345), each else all it holds.
 */
function runningEntry(actor: ActorRecord, entry: ActorAffinityEntry): ActorAffinityEntry {
  const stacks = actor.equippedAffinityStacks?.[affinityKey(entry)];
  const intensity = actor.equippedAffinityIntensity?.[affinityKey(entry)];
  if (stacks === undefined && intensity === undefined) return entry;
  return { ...entry, ...(stacks === undefined ? {} : { stacks }), ...(intensity === undefined ? {} : { intensity }) };
}

/** Equipped entries in equip order, at the stacks they run at; none unless the actor is alive. */
export function equippedActorAffinities(actor: ActorRecord): ActorAffinityEntry[] {
  if (actor.lifecycle !== 'alive') return [];
  return equippedActorAffinityKeys(actor).flatMap(key => {
    const entry = actor.affinities.find(pair => affinityKey(pair) === key);
    return entry ? [runningEntry(actor, entry)] : [];
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
  const kept = (running: Partial<Record<ActorAffinityKey, number>> | undefined) =>
    Object.fromEntries(Object.entries(running ?? {}).filter(([key]) => keys.includes(key as ActorAffinityKey)));
  setRunning(actor, 'equippedAffinityStacks', kept(actor.equippedAffinityStacks));
  setRunning(actor, 'equippedAffinityIntensity', kept(actor.equippedAffinityIntensity));
}

function setRunning(actor: ActorRecord, field: 'equippedAffinityStacks' | 'equippedAffinityIntensity',
  running: Partial<Record<ActorAffinityKey, number>>): void {
  if (Object.keys(running).length) actor[field] = running;
  else delete actor[field];
}

export function activeActorAffinity(actor: ActorRecord): ActorAffinityEntry | undefined {
  if (actor.lifecycle !== 'alive') return undefined;
  const entry = actor.affinities.find(pair => affinityKey(pair) === actor.activeAffinityKey);
  return entry && runningEntry(actor, entry);
}

/** Why an equip is refused, as a ValidationError name; null when it is legal. */
export function explainEquipActorAffinity(actor: ActorRecord | undefined, key: ActorAffinityKey,
  replaceKey?: ActorAffinityKey, stacks?: number, intensity?: number): string | null {
  if (!actor || actor.lifecycle !== 'alive') return 'WrongActor';
  if (!actor.capabilities.canEquip) return 'InvalidCapability';
  const held = actor.affinities.find(entry => affinityKey(entry) === key);
  if (!held) return 'UnknownAffinity';
  if (stacks !== undefined && (!Number.isSafeInteger(stacks) || stacks < 1 || stacks > held.stacks)) {
    return 'InvalidAffinityStacks';
  }
  if (intensity !== undefined && (!Number.isSafeInteger(intensity) || intensity < 1 || intensity > affinityIntensity(held))) {
    return 'InvalidAffinityIntensity';
  }
  const equipped = equippedActorAffinityKeys(actor);
  // An equipped key may be re-equipped at another level (#230, #345); at the same level it is a no-op.
  if (equipped.includes(key)) {
    const now = runningEntry(actor, held);
    const same = (stacks ?? held.stacks) === now.stacks && (intensity ?? affinityIntensity(held)) === affinityIntensity(now);
    return same ? 'AffinityAlreadyEquipped' : null;
  }
  if (replaceKey !== undefined && !equipped.includes(replaceKey)) return 'AffinityNotEquipped';
  return null;
}

/**
 * Slot mutation only; the tick executor owns one-action scheduling. A named
 * `replaceKey` is swapped in place; otherwise a free slot is used, and when the
 * slots are full the oldest equipped affinity makes way (one slot: a plain swap).
 */
export function equipActorAffinity(actor: ActorRecord | undefined, key: ActorAffinityKey,
  replaceKey?: ActorAffinityKey, stacks?: number, intensity?: number): boolean {
  if (explainEquipActorAffinity(actor, key, replaceKey, stacks, intensity) !== null) return false;
  const keys = equippedActorAffinityKeys(actor!);
  if (!keys.includes(key)) {
    if (replaceKey !== undefined) keys[keys.indexOf(replaceKey)] = key;
    else {
      if (keys.length >= (actor!.affinitySlots ?? 1)) keys.shift();
      keys.push(key);
    }
    setEquippedActorAffinityKeys(actor!, keys);
  }
  // The running levels: below what is held they are recorded; at full they are not (#230, #345).
  const held = actor!.affinities.find(entry => affinityKey(entry) === key)!;
  const record = (field: 'equippedAffinityStacks' | 'equippedAffinityIntensity', value: number | undefined, full: number) => {
    const running = { ...(actor![field] ?? {}) };
    if (value !== undefined && value < full) running[key] = value;
    else delete running[key];
    setRunning(actor!, field, running);
  };
  record('equippedAffinityStacks', stacks, held.stacks);
  record('equippedAffinityIntensity', intensity, affinityIntensity(held));
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

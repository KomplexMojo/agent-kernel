import type { ActorRecord, ActorVitalKind } from './actor-types.ts';

const VITALS: readonly ActorVitalKind[] = ['health', 'durability', 'mana', 'stamina'];
const CAPABILITIES = ['canMove', 'canCast', 'canEquip', 'canTake', 'canExit', 'blocksMovement', 'blocksSight'];

/** Validate loaded mechanical state before it can affect occupancy or rules. */
export function validateActorRecordVitals(actor: ActorRecord): void {
  if (!['external', 'dungeon'].includes(actor.alignment)) throw new Error('invalid alignment');
  if (!['alive', 'defeated', 'exited'].includes(actor.lifecycle)) throw new Error('invalid lifecycle');
  if (!actor.capabilities || Object.keys(actor.capabilities).length !== CAPABILITIES.length
    || CAPABILITIES.some(key => typeof (actor.capabilities as unknown as Record<string, unknown>)[key] !== 'boolean')) {
    throw new Error('invalid capabilities');
  }
  if (!['health', 'durability'].includes(actor.defeatVital)
    || !actor.vitals || !Object.hasOwn(actor.vitals, actor.defeatVital)) throw new Error('invalid defeat vital');
  for (const [key, vital] of Object.entries(actor.vitals)) {
    if (!VITALS.includes(key as ActorVitalKind) || !vital || Object.keys(vital).length !== 3
      || ![vital.current, vital.max, vital.regen].every(value => Number.isFinite(value) && value >= 0)
      || vital.current > vital.max) throw new Error('invalid vital record');
  }
  if (actor.lifecycle === 'defeated' && actor.vitals[actor.defeatVital]!.current !== 0) {
    throw new Error('defeated actor has positive defeat vital');
  }
}

/** Internal mutation primitive: actual signed delta, never revival or pool creation. */
export function changeActorVital(actor: ActorRecord | undefined, key: ActorVitalKind, delta: number): number {
  if (!VITALS.includes(key) || !Number.isFinite(delta)) throw new Error('invalid vital change');
  if (!actor || actor.lifecycle !== 'alive') return 0;
  const vital = actor.vitals[key];
  if (!vital) return 0;
  const before = vital.current;
  vital.current = Math.max(0, Math.min(vital.max, before + delta));
  if (actor.vitals[actor.defeatVital]!.current === 0) actor.lifecycle = 'defeated';
  return vital.current - before;
}

/** One turn of regen; `scale` multiplies a vital's regen this turn (overwhelm, #289; 1 when absent). */
export function regenerateActor(actor: ActorRecord, scale: Partial<Record<ActorVitalKind, number>> = {}): void {
  if (actor.lifecycle !== 'alive') return;
  for (const key of VITALS) changeActorVital(actor, key, (actor.vitals[key]?.regen ?? 0) * (scale[key] ?? 1));
}

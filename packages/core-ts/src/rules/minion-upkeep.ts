import type { ActorRecord } from '../state/actor-types.ts';
import { changeActorVital } from '../state/actor-vitals.ts';

/**
 * #408 (Darren, 2026-10-24): minions cost their leader mana, not stamina. Each turn, after
 * affinity upkeep, a living leader pays `upkeep` mana for each living minion bound to it
 * (`minionOf`) whose bond holds, in id order. One it cannot pay lapses (`bondLapsed`): the
 * minion takes no orders and runs its own motivations, and its leader pays nothing for it,
 * until the leader's mana is full again (the drained-affinity rule). It is never destroyed.
 * The amount is the Allocator's, handed in; core invents none.
 */
export function chargeMinionUpkeep(ordered: readonly ActorRecord[],
  actorOf: (id: string) => ActorRecord | undefined, upkeep: number): void {
  if (!Number.isSafeInteger(upkeep) || upkeep <= 0) return;
  for (const minion of ordered) {
    if (minion.lifecycle !== 'alive' || minion.minionOf === undefined || minion.bondLapsed) continue;
    const leader = actorOf(minion.minionOf);
    if (!leader || leader.lifecycle !== 'alive') continue;
    if ((leader.vitals.mana?.current ?? 0) >= upkeep) changeActorVital(leader, 'mana', -upkeep);
    else minion.bondLapsed = true;
  }
}

/** After regeneration: a lapsed bond holds again once its living leader's mana is full. */
export function restoreMinionBonds(ordered: readonly ActorRecord[],
  actorOf: (id: string) => ActorRecord | undefined): void {
  for (const minion of ordered) {
    if (!minion.bondLapsed || minion.minionOf === undefined) continue;
    const leader = actorOf(minion.minionOf);
    const mana = leader?.vitals.mana;
    if (!leader || leader.lifecycle !== 'alive' || !mana || mana.max <= 0 || mana.current < mana.max) continue;
    delete minion.bondLapsed;
  }
}

/** The minions bound to `leaderId`, in id order: each one's upkeep and whether its bond holds. */
export function minionBonds(actors: readonly ActorRecord[], leaderId: string, upkeep: number): {
  id: string; upkeep: number; lapsed: boolean;
}[] {
  return actors.filter(actor => actor.minionOf === leaderId && actor.lifecycle === 'alive')
    .map(actor => actor.id).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    .map(id => ({ id, upkeep, lapsed: actors.find(actor => actor.id === id)!.bondLapsed === true }));
}

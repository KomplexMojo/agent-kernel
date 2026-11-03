import type { ActorLifecycle, ActorRecord } from '../state/actor-types.ts';

/** Consecutive end-of-tick visits; existing maintainer rule is two ticks. */
export const EXIT_DWELL_TICKS = 2;

/**
 * True when this actor escorts a leader who is still on the level. AK-6: retiring
 * while that leader remains alive drops the escort for no game value, so exit dwell
 * must not complete.
 */
export function escortLeaderStillAlive(
  actor: ActorRecord,
  lifecycleOf: (id: string) => ActorLifecycle | undefined,
): boolean {
  if (actor.escortOf === undefined) return false;
  return lifecycleOf(actor.escortOf) === 'alive';
}

/** Return true only on the transition; the registry releases occupancy. */
export function advanceActorExit(
  actor: ActorRecord,
  onExit: boolean,
  lifecycleOf: (id: string) => ActorLifecycle | undefined = () => undefined,
): boolean {
  if (actor.lifecycle !== 'alive') return false;
  if (!actor.capabilities.canExit || !onExit || escortLeaderStillAlive(actor, lifecycleOf)) {
    if (actor.exitDwell !== undefined) actor.exitDwell = 0;
    return false;
  }
  actor.exitDwell = (actor.exitDwell ?? 0) + 1;
  if (actor.exitDwell < EXIT_DWELL_TICKS) return false;
  actor.lifecycle = 'exited';
  return true;
}

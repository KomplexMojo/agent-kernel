import type { ActorRecord } from '../state/actor-types.ts';

/** Consecutive end-of-tick visits; existing maintainer rule is two ticks. */
export const EXIT_DWELL_TICKS = 2;

/** Return true only on the transition; the registry releases occupancy. */
export function advanceActorExit(actor: ActorRecord, onExit: boolean): boolean {
  if (actor.lifecycle !== 'alive') return false;
  if (!actor.capabilities.canExit || !onExit) {
    if (actor.exitDwell !== undefined) actor.exitDwell = 0;
    return false;
  }
  actor.exitDwell = (actor.exitDwell ?? 0) + 1;
  if (actor.exitDwell < EXIT_DWELL_TICKS) return false;
  actor.lifecycle = 'exited';
  return true;
}

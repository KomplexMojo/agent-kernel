/**
 * run-viewer.js — a recorded run, tick by tick, in the play session's view shape.
 *
 * `createPlaySession` drives a live game; this reads a run that already happened
 * (`ak run`'s tick frames) so the same UI (`packages/ui-ascii`) can show it. Every
 * `apply` tick frame carries the actor registry as core left it at the end of that
 * tick (`emittedSnapshot.view.registry`), so a tick's view is that recorded
 * snapshot drawn through `buildPlayView`. Nothing is re-simulated or re-decided
 * here: it reads what the run wrote down.
 *
 * Tick 0 is the level as loaded. A run recorded without registry snapshots
 * (older runs, hand-written frames) falls back to the level's starting snapshot
 * with each accepted move's recorded `params.target` applied: positions only,
 * since that is all such frames record.
 *
 * There is no fog: a viewer watches the whole run, not one actor's sight. The
 * HUD centres on one actor, chosen as the play session chooses its player.
 */
import { initializeCoreFromArtifacts } from "./core-setup.mjs";
import { buildPlayView, defaultPlayerActorId, playLegend, playStatus } from "./play-session.js";

/**
 * @param {object} args
 * @param {object} args.simConfig     the run's SimConfigArtifact
 * @param {object} args.initialState  the run's InitialStateArtifact
 * @param {object[]} [args.frames]    the run's tick frames (`tick-frames.json`)
 * @param {string} [args.playerActorId] the actor the HUD centres on
 */
export function createRunViewer({ simConfig, initialState, frames = [], playerActorId } = {}) {
  if (!simConfig || !initialState) {
    throw new Error("createRunViewer: simConfig and initialState are required");
  }
  const loaded = initializeCoreFromArtifacts({ simConfig, initialState });
  const initial = loaded.registry.snapshot();
  const presentation = loaded.presentation || {};
  const legend = playLegend(simConfig);
  const playerId = playerActorId ?? defaultPlayerActorId(initialState);
  if (playerId !== undefined && !initial.actors.some((actor) => actor.id === playerId)) {
    throw new Error(`createRunViewer: playerActorId "${playerId}" is not an actor in this level`);
  }

  const recorded = (Array.isArray(frames) ? frames : []).filter((frame) => Number.isInteger(frame?.tick));
  const maxTick = recorded.reduce((max, frame) => Math.max(max, frame.tick), 0);
  // tick -> { snapshot, exited } for each tick the run recorded a registry for.
  const snapshots = new Map();
  for (const frame of recorded) {
    const view = frame.emittedSnapshot?.view;
    if (view?.registry) {
      snapshots.set(frame.tick, { snapshot: view.registry, exited: view.exitedActorIds || [] });
    }
  }

  // Older runs: the starting snapshot with accepted moves' recorded targets applied.
  function replayPositions(tick) {
    const actors = initial.actors.map((actor) => ({ ...actor, position: { ...actor.position } }));
    for (const frame of recorded) {
      if (frame.tick > tick) break;
      for (const action of Array.isArray(frame.acceptedActions) ? frame.acceptedActions : []) {
        const to = action?.params?.target;
        if (action?.kind !== "move" || !Number.isInteger(to?.x) || !Number.isInteger(to?.y)) continue;
        const actor = actors.find((entry) => entry.id === action.actorId);
        if (actor) actor.position = { x: to.x, y: to.y };
      }
    }
    return { snapshot: { ...initial, actors }, exited: [] };
  }

  function stateAt(tick) {
    if (tick === 0) return { snapshot: initial, exited: [] };
    if (snapshots.size === 0) return replayPositions(tick);
    // The latest recorded snapshot at or before this tick.
    for (let t = tick; t > 0; t -= 1) {
      if (snapshots.has(t)) return snapshots.get(t);
    }
    return { snapshot: initial, exited: [] };
  }

  function view(tick = 0) {
    if (!Number.isInteger(tick) || tick < 0 || tick > maxTick) {
      throw new Error(`createRunViewer: tick must be an integer from 0 to ${maxTick}, got ${tick}`);
    }
    const { snapshot, exited } = stateAt(tick);
    const status = playStatus({ snapshot, playerId, exited: exited.includes(playerId), tick });
    return buildPlayView({ snapshot, presentation, legend, playerId, tick, status });
  }

  return { view, maxTick, playerActorId: playerId };
}

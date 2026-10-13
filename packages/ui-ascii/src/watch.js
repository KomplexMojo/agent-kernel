/**
 * Watching a recorded run: keys step through its ticks and each tick is drawn
 * with the game's own screen. Which actor the HUD follows and what the board
 * holds at a tick are the runtime run viewer's (`runner/run-viewer.js`); this
 * only keeps the tick cursor and the help toggle.
 */
import { createRunViewer } from "../../runtime/src/runner/run-viewer.js";
import { WATCH_HELP_LINES, WATCH_INTENT } from "./keymap.js";
import { renderScreen } from "./screen.js";

/** What happened to the actor the HUD follows, in the game's words. */
function watchStatusLine(view, maxTick, actorId) {
  if (view.status.exited) return `${actorId} has left the level.`;
  if (view.status.defeated) return `${actorId} was defeated.`;
  if (view.status.atExit) return `${actorId} is at the exit.`;
  return view.tick === maxTick ? "End of the recorded run." : "";
}

/**
 * @param {object} args
 * @param {{name: string, simConfig: object, initialState: object, frames: object[]}} args.run
 * @param {number} [args.tick]  the tick to open at (default 0)
 * @param {boolean} [args.showHelp] start with the key help shown (default)
 * @param {Function} [args.createViewer] injectable for tests
 */
export function createWatch({ run, tick = 0, showHelp: initialHelp = true, createViewer = createRunViewer } = {}) {
  if (!run) throw new Error("createWatch: a recorded run is required");
  const viewer = createViewer({ simConfig: run.simConfig, initialState: run.initialState, frames: run.frames });
  if (!Number.isInteger(tick) || tick < 0 || tick > viewer.maxTick) {
    throw new Error(`--tick must be from 0 to ${viewer.maxTick} for this run, got ${tick}`);
  }
  let cursor = tick;
  let showHelp = initialHelp;

  function handle(intent) {
    switch (intent?.type) {
      case WATCH_INTENT.NEXT: cursor = Math.min(viewer.maxTick, cursor + 1); break;
      case WATCH_INTENT.PREVIOUS: cursor = Math.max(0, cursor - 1); break;
      case WATCH_INTENT.FIRST: cursor = 0; break;
      case WATCH_INTENT.LAST: cursor = viewer.maxTick; break;
      case WATCH_INTENT.HELP: showHelp = !showHelp; break;
      case WATCH_INTENT.QUIT: return { quit: true };
      default: break;
    }
    return { quit: false };
  }

  function screen({ color = false } = {}) {
    const view = viewer.view(cursor);
    const following = view.player ? `   Following ${view.player.id} (@)` : "";
    return renderScreen({
      view,
      levelName: run.name,
      title: `agent-kernel run — ${run.name}`,
      tickLine: `Tick ${cursor} of ${viewer.maxTick}${following}`,
      message: watchStatusLine(view, viewer.maxTick, viewer.playerActorId) || "Watching a recorded run.",
      showHelp,
      helpLines: WATCH_HELP_LINES,
      hints: false,
      color,
    });
  }

  function state() {
    return { tick: cursor, maxTick: viewer.maxTick, level: run.name, status: viewer.view(cursor).status };
  }

  return { handle, screen, state };
}

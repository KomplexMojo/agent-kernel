/**
 * The game controller: turns intents into play-session calls and tracks
 * presentation state (which level, how many moves, the last message). No
 * terminal IO and no rules — `cli.mjs` owns the terminal, the runtime play
 * session owns the simulation.
 */
import { createPlaySession, PLAY_STATUS } from "../../runtime/src/runner/play-session.js";
import { INTENT } from "./keymap.js";
import { renderScreen } from "./screen.js";

/** Friendlier words for core's rejection codes; the raw name is the fallback. */
const REJECTION_MESSAGES = Object.freeze({
  BlockedByWall: "A wall blocks the way.",
  ActorCollision: "Something is in the way.",
  OutOfBounds: "You cannot leave the map that way.",
  InsufficientStamina: "Too tired to move. Wait (.) to recover.",
});

function rejectionMessage(reason) {
  return REJECTION_MESSAGES[reason] || `Move rejected (${reason}).`;
}

/**
 * @param {object} args
 * @param {Array<{name: string, simConfig: object, initialState: object}>} args.levels
 * @param {number} [args.startIndex]
 * @param {Function} [args.createSession] injectable for tests
 */
export function createGame({ levels, startIndex = 0, createSession = createPlaySession } = {}) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("createGame: at least one level is required");
  }
  let levelIndex = Math.max(0, Math.min(levels.length - 1, startIndex));
  let session = null;
  let moves = 0;
  let message = "";
  let showHelp = true;
  let finished = false;

  function startLevel(index) {
    levelIndex = index;
    const level = levels[levelIndex];
    session = createSession({ simConfig: level.simConfig, initialState: level.initialState });
    moves = 0;
    message = "";
  }

  startLevel(levelIndex);

  function handle(intent) {
    if (!intent) return { quit: false };
    message = "";
    switch (intent.type) {
      case INTENT.QUIT:
        return { quit: true };
      case INTENT.HELP:
        showHelp = !showHelp;
        break;
      case INTENT.RESTART:
        finished = false;
        startLevel(levelIndex);
        break;
      case INTENT.NEXT_LEVEL:
        if (session.status() !== PLAY_STATUS.ESCAPED) break;
        if (levelIndex + 1 < levels.length) {
          startLevel(levelIndex + 1);
        } else {
          finished = true;
          message = "That was the last level. Press r to replay it or q to quit.";
        }
        break;
      case INTENT.WAIT:
        if (session.status() !== PLAY_STATUS.ESCAPED) {
          session.wait();
          moves += 1;
        }
        break;
      case INTENT.MOVE: {
        const result = session.move(intent.direction);
        if (result.accepted) {
          moves += 1;
        } else if (result.reason !== "escaped" && result.status !== PLAY_STATUS.AT_EXIT) {
          // At the exit the status line already says how to step through.
          message = rejectionMessage(result.reason);
        }
        break;
      }
      default:
        break;
    }
    return { quit: false };
  }

  function screen({ color = false } = {}) {
    return renderScreen({
      view: session.view(),
      levelName: levels[levelIndex].name,
      levelIndex,
      levelCount: levels.length,
      moves,
      message,
      showHelp,
      color,
    });
  }

  function state() {
    return {
      levelIndex,
      levelName: levels[levelIndex].name,
      moves,
      status: session.status(),
      finished,
      message,
    };
  }

  return { handle, screen, state };
}

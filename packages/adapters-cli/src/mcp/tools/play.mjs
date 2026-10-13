import { booleanSchema, buildArgv, createTool, integerSchema, pathSchema, stringSchema } from "./shared.mjs";

const playSpec = [
  { key: "runId", flag: "from-run" },
  { key: "dir" },
  { key: "simConfig", flag: "sim-config" },
  { key: "initialState", flag: "initial-state" },
  { key: "level" },
  { key: "keys" },
  { key: "color", boolean: true },
  { key: "record" },
  { key: "replay" },
  { key: "watch", boolean: true },
  { key: "tick" },
];

// Fog is on unless the caller says `fog: false`, so the flag is the negation.
const fogArgs = (args) => (args.fog === false ? ["--no-fog"] : []);

export const playTools = [
  createTool({
    name: "ak_play_ascii",
    description:
      "Show a level in the agent-kernel ASCII terminal UI (packages/ui-ascii), and optionally play moves in it, or watch a recorded run in it. "
      + "Use it right after ak_create (or ak_configure/ak_run) to display what was made: pass that call's runId, or its outDir as dir. "
      + "Returns { screen, status, turns, launch }. Show `screen` to the user verbatim in a code block, and give `launch`: "
      + "the command that opens the interactive, coloured game in their own terminal. "
      + "`keys` plays moves first: w/a/s/d or h/j/k/l move, y/u/b/n move diagonally, '.' waits (stepping through the exit E takes one wait on the tile before it), r restarts. "
      + "Each call replays from the start, so pass the whole key history to continue a game, or pass `record` to save the played commands and `replay` to re-run a saved game before `keys`. "
      + "`watch: true` shows the run an ak_run call recorded instead (its runId, or its outDir as dir) at `tick`, every actor in place, as { screen, tick, maxTick, status, launch }. "
      + "Board: @ is the player (when watching, the actor the HUD follows), D/W other delvers and wardens, H traps (hazards), B barriers, # wall, . floor, S spawn, E exit, ? not yet seen. "
      + "Fog of war is on when playing: only what the player can see (or remembers) is drawn, and actors and traps only when in sight now. The player sees only what @ sees, so show the fogged screen; fog: false is a debug view for checking a level's layout, not for play. A watched run has no fog.",
    command: "play",
    inputSchema: {
      properties: {
        runId: stringSchema("Run id of an earlier ak_create/ak_configure/ak_run call in this session (or under artifacts/runs/<runId>). With watch, an ak_run call's run id."),
        dir: pathSchema("A directory holding sim-config.json and initial-state.json, such as an ak_create outDir. With watch, an ak_run outDir."),
        simConfig: pathSchema("SimConfig artifact path (with initialState)."),
        initialState: pathSchema("InitialState artifact path (with simConfig)."),
        level: stringSchema("A bundled ui-ascii level by name (packages/ui-ascii/levels). Omit to start at the first."),
        keys: stringSchema("Keys to play before returning the screen, e.g. \"ddss.\". Omit for the starting board. With watch: '.' or 'l' steps a tick forward, ',' or 'h' back, '[' and ']' jump to the first and last tick."),
        color: booleanSchema("Include 24-bit ANSI colour in `screen` (only useful where escape codes render)."),
        fog: booleanSchema("Fog of war (default true): the player sees only what @ sees. false is a debug view of the whole level."),
        record: pathSchema("Save the played commands to this path as a CapturedInputArtifact."),
        replay: pathSchema("Re-run a game saved with record on its level first, then apply keys."),
        watch: booleanSchema("Watch the run an ak_run call recorded (runId or dir) instead of playing a level."),
        tick: integerSchema("With watch: the tick to show (default 0).", { minimum: 0 }),
      },
    },
    buildArgs: (args) => [...buildArgv(args, playSpec), ...fogArgs(args), "--json"],
  }),
];

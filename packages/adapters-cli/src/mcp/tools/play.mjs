import { booleanSchema, buildArgv, createTool, pathSchema, stringSchema } from "./shared.mjs";

const playSpec = [
  { key: "runId", flag: "from-run" },
  { key: "dir" },
  { key: "simConfig", flag: "sim-config" },
  { key: "initialState", flag: "initial-state" },
  { key: "level" },
  { key: "keys" },
  { key: "color", boolean: true },
];

// Fog is on unless the caller says `fog: false`, so the flag is the negation.
const fogArgs = (args) => (args.fog === false ? ["--no-fog"] : []);

export const playTools = [
  createTool({
    name: "ak_play_ascii",
    description:
      "Show a level in the agent-kernel ASCII terminal UI (packages/ui-ascii), and optionally play moves in it. "
      + "Use it right after ak_create (or ak_configure/ak_run) to display what was made: pass that call's runId, or its outDir as dir. "
      + "Returns { screen, status, turns, launch }. Show `screen` to the user verbatim in a code block, and give `launch`: "
      + "the command that opens the interactive, coloured game in their own terminal. "
      + "`keys` plays moves first: w/a/s/d or h/j/k/l move, y/u/b/n move diagonally, '.' waits (stepping through the exit E takes one wait on the tile before it), r restarts. "
      + "Each call replays from the start, so pass the whole key history to continue a game. "
      + "Board: @ is the player, D/W other delvers and wardens, H traps (hazards), # wall, . floor, S spawn, E exit, ? not yet seen. "
      + "Fog of war is on: only what the player can see (or remembers) is drawn, and actors and traps only when in sight now. Pass fog: false to show the whole level, e.g. to show the user what ak_create made.",
    command: "play",
    inputSchema: {
      properties: {
        runId: stringSchema("Run id of an earlier ak_create/ak_configure/ak_run call in this session (or under artifacts/runs/<runId>)."),
        dir: pathSchema("A directory holding sim-config.json and initial-state.json, such as an ak_create outDir."),
        simConfig: pathSchema("SimConfig artifact path (with initialState)."),
        initialState: pathSchema("InitialState artifact path (with simConfig)."),
        level: stringSchema("A bundled ui-ascii level by name: first-steps, long-way-round, warden-hall, water-traps."),
        keys: stringSchema("Keys to play before returning the screen, e.g. \"ddss.\". Omit for the starting board."),
        color: booleanSchema("Include 24-bit ANSI colour in `screen` (only useful where escape codes render)."),
        fog: booleanSchema("Fog of war (default true). false shows the whole level, with every actor and trap."),
      },
    },
    buildArgs: (args) => [...buildArgv(args, playSpec), ...fogArgs(args), "--json"],
  }),
];

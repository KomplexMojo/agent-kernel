import { booleanSchema, buildArgv, createTool, integerSchema, pathSchema, stringSchema } from "./shared.mjs";

// A live game (`ak play-session`): one file per session name, replayed and saved on every call.
const sessionSpec = [{ key: "session" }];
const saveSpec = [{ key: "save" }];
const saveProperty = pathSchema("Also copy the game to this file after the call (e.g. artifacts/games/<name>.json); ak_play_start with load reopens it.");
const levelSpec = [
  { key: "runId", flag: "from-run" },
  { key: "dir" },
  { key: "simConfig", flag: "sim-config" },
  { key: "initialState", flag: "initial-state" },
  { key: "level" },
];
const actingSpec = [
  { key: "actor" },
  { key: "commands", format: (value) => JSON.stringify(value) },
  { key: "keys" },
];

const SESSION_RESULT = "Returns { screen, status, turns, active, party, orders?, inSight, hud, results? }: show `screen` verbatim in a code block. "
  + "`active` is the seated actor; `party` lists every playable (user_controlled) actor with its label (D1, D2, ...), position, motivations and status; "
  + "`orders` lists every actor following a strategy: the goal it is on (`doing`, `goal` of `goals`) and its status (active, searching: target out of sight, stalled: with a reason, done, ignored: its thinking motivation does not reach the strategy); "
  + "`inSight` lists every other actor and trap the seated actor sees now, each with a label (W1, H2, ...) you and the player can use instead of its id, and its motivations (the stack that explains how it acts). "
  + "Fog of war is on: report only what the screen and inSight show.";

const sessionProperty = stringSchema("The game's name (default \"game\"). One game per name; it is saved to artifacts/play-sessions/<name>.json after every call, so it survives a restart.");
const actingProperties = {
  actor: stringSchema("Seat this party member first (its id or label, e.g. D2). Free: no turn passes. Only actors authored user_controlled can be seated."),
  commands: {
    type: "array",
    description: "Commands to play in order, before keys. Each is { kind, params?, actorId? } with kind move (params.direction: north|south|east|west|northeast|northwest|southeast|southwest; params.sprint true takes two tiles in one turn for more stamina), wait, "
      + "equip_affinity (params.affinityKey \"kind:expression\", optional params.stacks (range) and params.intensity to run it below what it holds), unequip_affinity (params.affinityKey), cast_affinity (params.targetId, or params.target {x,y} for a tile: it travels the line and hits the first actor or wall, a push that meets nobody leaving a one-turn field on its path; optional params.affinityKey), raise_barrier (params.target {x,y}: an equipped push raises a line of barriers into empty tiles; optional params.affinityKey) "
      + "or take (params.targetId, params.holdingId); or { kind: \"switch\", actorId } to change the seat. actorId commands that party member without seating it. Ids may be labels (W1). "
      + "Every command except switch is one turn for the whole level, refused or not.",
    items: { type: "object", additionalProperties: true },
  },
  keys: stringSchema("Keys to play after commands, as in ak_play_ascii: w/a/s/d or h/j/k/l move, y/u/b/n diagonals, upper case (or x before a move) sprints two tiles, '.' waits, g takes loot. Each acting key is one turn."),
};

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
  createTool({
    name: "ak_play_start",
    description: "Start a live game on a level and keep it between calls, for playing turn by turn (then ak_play_act). "
      + "Name the level as for ak_play_ascii: an ak_create call's runId, its outDir as dir, simConfig + initialState, or a bundled level. "
      + "The seated actor is the first one authored user_controlled. Optional actor/commands/keys are played straight away. A name already running must be ended first. "
      + SESSION_RESULT,
    command: "play-session",
    inputSchema: {
      properties: {
        session: sessionProperty,
        runId: stringSchema("Run id of an earlier ak_create/ak_configure/ak_run call (or under artifacts/runs/<runId>)."),
        dir: pathSchema("A directory holding sim-config.json and initial-state.json, such as an ak_create outDir."),
        simConfig: pathSchema("SimConfig artifact path (with initialState)."),
        initialState: pathSchema("InitialState artifact path (with simConfig)."),
        level: stringSchema("A bundled ui-ascii level by name."),
        load: pathSchema("Begin from a game saved with save, in place of a level: it names its own level."),
        ...actingProperties,
      },
    },
    buildArgs: (args) => ["start", ...buildArgv(args, [...sessionSpec, ...levelSpec, { key: "load" }, ...actingSpec])],
  }),
  createTool({
    name: "ak_play_act",
    description: "Play turns in a live game started with ak_play_start: optional actor (seat change, free), then commands, then keys, then the game is saved. "
      + "For natural-language orders, translate them into commands or keys a few turns at a time and stop to report when something new comes into sight or a vital drops. "
      + SESSION_RESULT,
    command: "play-session",
    inputSchema: { properties: { session: sessionProperty, ...actingProperties, save: saveProperty } },
    buildArgs: (args) => ["act", ...buildArgv(args, [...sessionSpec, ...actingSpec, ...saveSpec])],
  }),
  createTool({
    name: "ak_play_view",
    description: "Show a live game's board without playing anything; with save, also copy the game to a file. " + SESSION_RESULT,
    command: "play-session",
    inputSchema: { properties: { session: sessionProperty, save: saveProperty } },
    buildArgs: (args) => ["view", ...buildArgv(args, [...sessionSpec, ...saveSpec])],
  }),
  createTool({
    name: "ak_play_switch",
    description: "Seat another party member in a live game (an actor authored user_controlled, by id or label such as D2). Free: no turn passes, and fog follows the new seat. "
      + "A companion, warden or trap cannot be seated (results say not_playable). " + SESSION_RESULT,
    command: "play-session",
    inputSchema: {
      properties: {
        session: sessionProperty,
        actor: stringSchema("The party member to seat: its id or label (D2)."),
      },
      required: ["actor"],
    },
    buildArgs: (args) => ["switch", ...buildArgv(args, [...sessionSpec, { key: "actor" }])],
  }),
  createTool({
    name: "ak_play_order",
    description: "Give a party member or a companion (a friendly actor on the seated actor's side) a new strategy in a live game: standing orders it follows on its own turns. "
      + "It replaces the actor's strategy and starts at the first goal. Giving the order is the seated actor's turn and taking it the ordered actor's, so one turn passes. "
      + "How much it follows depends on its thinking motivation: goal_oriented follows the goals, strategy_focused and user_controlled the tactics too; any other actor ignores it. "
      + "Results say not_yours for a hostile actor or one on your side that is not friendly, invalid_strategy with the reason for a malformed one. " + SESSION_RESULT,
    command: "play-session",
    inputSchema: {
      properties: {
        session: sessionProperty,
        actor: stringSchema("Who takes the order: an id or label (D3)."),
        strategy: {
          type: "object",
          additionalProperties: false,
          description: "{ goals, tactics? }. Goals run in order; ids may be labels. "
            + "reach {place: {x,y} | \"exit\"}; defeat {target}; take {target} (defeats it, then takes its loot); guard {target, radius=2}; "
            + "follow {target, distance=1}; lead {target, place=\"exit\", distance=3} (waits for the ally); hold {place, ticks}; survive {distance=3} (steps away from hostiles). "
            + "guard, follow and survive never finish. Tactics are checked before goals, first match wins: { when, do } with when "
            + "{vital: health|mana|stamina|durability, below: percent} | {hostileWithin: n} | {defeated: id} | {tickAtLeast: n}, "
            + "and do a command as in commands, { kind: \"retreat\" }, or a cast_affinity with params.targetId \"nearest_hostile\". "
            + "Actors see only what is lit: a goal whose target is out of sight leaves the turn to the actor's own motivations.",
          properties: {
            goals: { type: "array", items: { type: "object", additionalProperties: true } },
            tactics: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
      },
      required: ["actor", "strategy"],
    },
    buildArgs: (args) => ["order", ...buildArgv(args, [...sessionSpec, { key: "actor" },
      { key: "strategy", format: (value) => JSON.stringify(value) }])],
  }),
  createTool({
    name: "ak_play_advance",
    description: "Let a live game run several turns at once, for orders to play out: the seated actor follows its own strategy if it has one, else waits. "
      + "Stops after `ticks`, or earlier at `until`: orders_done (every actor's strategy is done, stalled or ignored) or contact (a hostile comes into a party member's sight). "
      + "Use it as a bounded autopilot only when the player asks you to play on. Results give { ticks, stoppedBy }. " + SESSION_RESULT,
    command: "play-session",
    inputSchema: {
      properties: {
        session: sessionProperty,
        ticks: integerSchema("At most this many turns (default 1, or 50 with until)."),
        until: { type: "string", enum: ["orders_done", "contact"], description: "Stop early at this." },
      },
    },
    buildArgs: (args) => ["advance", ...buildArgv(args, [...sessionSpec, { key: "ticks" }, { key: "until" }])],
  }),
  createTool({
    name: "ak_play_end",
    description: "End a live game: returns its final board and removes its live file. Pass save to keep a copy first. "
      + SESSION_RESULT,
    command: "play-session",
    inputSchema: { properties: { session: sessionProperty, save: saveProperty } },
    buildArgs: (args) => ["end", ...buildArgv(args, [...sessionSpec, ...saveSpec])],
  }),
];

---
name: game-master
description: Use when the user wants to play, set up, watch or talk about the agent-kernel ASCII game (levels, delvers, wardens, traps, affinities, a run) through this session rather than change its code. Holds the house rules and the tool map the /game- commands follow.
---

# Game master for the agent-kernel ASCII game

You are the game's front end, like `packages/ui-ascii`: you turn what the player says into
`ak_*` MCP calls and show what comes back. You are not the rules engine.

## House rules

- **The engine decides.** Rules, prices, legality and outcomes come from `ak` (the MCP tools or
  the CLI). Never state a price, a cost or an outcome yourself, and never refuse or talk the
  player out of a move or a setup. If they ask for something odd (opposite emits at once, a
  delver with no route out), do it; affinity interactions and the engine decide what happens,
  and you report it.
- **Affinity-agnostic.** Every affinity is a peer. Never default to, favour or theme examples
  around one. When you need the list, ask the engine (below) and rotate your examples.
- **Levels come from `ak_create`.** The Configurator lays out rooms joined by corridors and
  places everything. Never draw or hand-write a map.
- **Playable vs companion.** Only an actor whose motivations include `user_controlled` is the
  player's to command; a level may hold several (the party). A companion is an actor on the
  player's side authored `friendly`: it acts on its own motivations, keeps with its allies, and
  takes orders. Any other delver is on the player's side but takes no orders; wardens and hazards
  are the level's. Author companions with `friendly` (e.g. `motivation=exploring+friendly+goal_oriented`).
- **Thinking motivations act without orders.** `reflexive` steps out of a field that harms it;
  `goal_oriented` picks a goal from its other motivations (defeat a hostile in sight when
  attacking, reach the exit when exploring) and sticks to it; `strategy_focused` picks the same
  way but re-plans each turn. An order or level strategy replaces the picked goal.
- **Names.** Every actor in a live game has a short label (`D1`, `W2`, `H3`) in `party` and
  `inSight`. Use labels when you talk about the board and in commands; the player can too.
- **Show, don't retell.** Put `screen` in a code block verbatim. Add one or two lines of what
  changed (a cast, damage, loot, the exit) from `status` and the screen, not a replay of it.
- **Check the right field.** A dry run answers `ok: true` whenever the check ran; `valid` and
  `errors` say whether the inputs pass. `ak_solve` says `solved`. Read those, not `ok`.

## Asking the engine

- **Legal values** (affinities, motivations, expressions, room sizes): call `ak_create` with
  `dryRun: true` and a value you know is wrong; `errors` names every legal choice. Do this
  instead of listing values from memory.
- **Spec grammar** for `room`, `delver`, `warden`, `hazard`, `resource`, `floorTile`:
  `packages/adapters-cli/README.md`, section `create` / `configure`. Read it before authoring
  anything beyond the basics. `text` on `ak_create` is only a label; it authors nothing.
- **What a run holds:** `ak_show {runId}` (actors, rooms, artifacts, spend).

## Tool map

| Player wants | Call |
|---|---|
| A new level | `ak_create` with spec objects and a `runId`, then `ak_play_ascii {runId}` |
| To play | `ak_play_start {runId}` once, then `ak_play_act {commands?, keys?}` a few turns at a time; `ak_play_view` to look |
| To play another party member | `ak_play_switch {actor: "D2"}` (free), or `actorId` on a command |
| To give a companion or party member orders | `ak_play_order {actor: "D3", strategy: {goals, tactics?}}` (one turn) |
| To let orders play out | `ak_play_advance {ticks, until: "orders_done" \| "contact"}` |
| To save / resume | `ak_play_view {save: path}` / `ak_play_start {load: path}` |
| To stop | `ak_play_end` (pass `save` to keep it) |
| A one-off look or scripted keys | `ak_play_ascii {runId, keys}` (stateless: each call replays from the start) |
| To watch the level play itself | `ak_run {fromRun, ticks, runId}`, then `ak_play_ascii {runId, watch: true, tick}` |
| Two plays compared | `ak_diff {runA, runB}` |
| The story of a run | `ak_narrate {tickFrames, initialState}`, `ak_inspect {tickFrames}` |
| The live, coloured game | the `launch` command `ak_play_ascii` returns, run in their own terminal |
| A status line with the seated actor's vitals | tell the player they can opt in: `"statusLine": { "type": "command", "command": "node scripts/game/statusline.mjs" }` in `.claude/settings.local.json` |

## Keys (`ak_play_ascii` `keys`)

`w a s d` or `h j k l` move · `y u b n` diagonals · `.` waits one tick · `r` restarts.
`i` opens affinities (`1`-`9` equip/unequip, Tab highlight, `+`/`-` range, `]`/`[` intensity) · `f` aims at the
nearest actor in sight (Tab next, Enter casts) · `1`-`9` aims with that slot · `g` takes loot.
Stepping onto the exit's approach tile puts the player at the exit; one more `.` steps through.
Every acting key is a turn, a blocked move included. The full table is in
`packages/ui-ascii/README.md`.

`Tab` (outside a list) plays the next party member. Over MCP, prefer `commands` to keys for
anything aimed: `{ kind: "cast_affinity", params: { targetId: "W1" } }`.

Affinities read `fire push r6 ×2`: range 6 (how far it reaches), intensity 2 (its strength; a
hit is base × intensity²). A slot run lower shows running/held, e.g. `r2/6 ×1/2`. Specs write
the same pair as `kind:expression:range[:intensity]`, intensity 1 when left out.

Board: `@` the seated actor, `D` other delvers, `W` wardens, `H` traps, `B` barriers, `#` wall,
`.` floor, `S` spawn, `E` exit, `?` not yet seen. Fog is on; `fog: false` is a debug view for
checking a layout, never for play.

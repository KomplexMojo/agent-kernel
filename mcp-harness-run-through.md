# MCP harness run-through — open issues & handoff context

**Status (2026-09-01):** first pass, actively growing. The maintainer asked to drive `agent-kernel`
end-to-end through the `agent-kernel-cli` MCP server from inside a Claude Code harness (Bash +
Browser-pane tools), have results display back in that harness, and file every piece of friction hit
along the way as a standalone `gh issue`, immediately, as it's found — per
`AGENTS.md → Working agreement`. This document is the handoff artifact: a running summary of every
issue opened from this activity plus enough standalone context (repro steps, root cause, evidence,
code locations) that **a different agent with no memory of this session can pick any one issue up and
fix it without re-deriving anything above what's written here.**

**This document does not itself fix anything.** Issues found here are filed to GitHub and logged below
as they're identified; resolving them is explicitly out of scope for the session that finds them —
that's separate work, for whoever (or whichever session) picks an issue off the list.

**Audience:** an agent with no memory of the session that produced it.
**Source of evidence:** live MCP tool calls (`ak_create`, `ak_run`, `ak_push_to_ui`, `ak_show_state`,
`ak_tick_forward`, `ak_show`, `ak_runs_list`) against `packages/adapters-cli/src/mcp/server.mjs` on
branch `chore/mcp-session-run-through` (parent `main` @ `9611ad7`), plus reads of
`packages/adapters-cli/src/tick-session.mjs` and `packages/adapters-cli/src/mcp/README.md`, and one
root-cause pass with Serena's semantic tools (see finding 5).

**Session goal, restated:** run the app via MCP tools only (no shelling out to `ak.mjs` directly for
the app-driving steps), get a visual/state result rendered inside the Claude Code harness (Browser
pane or an inline image), and file each piece of friction as a standalone `gh issue`, back-linked to
this file.

---

## Open issues (start here)

| # | Title | Status | Blocking? | Context |
|---|---|---|---|---|
| [#142](https://github.com/KomplexMojo/agent-kernel/issues/142) | `ak_push_to_ui`'s sandbox WebSocket bridge is unreachable from a sandboxed MCP-driving harness | Open | No — `ak_show_state`/`ak_tick_forward` are a working substitute | Finding 1 |
| [#143](https://github.com/KomplexMojo/agent-kernel/issues/143) | `ak_show_state`/`ak_tick_forward`/`ak_tick_backward` resolve runs from a different root than `ak_create`/`ak_run`/`ak_show` | Open | No — workaround: pass `outDir=artifacts/runs/<runId>/<command>` explicitly | Finding 2 |
| [#144](https://github.com/KomplexMojo/agent-kernel/issues/144) | `ak_show_state`'s `image` visualization mode blows the MCP tool-result size limit | Open | No — `ascii` mode works | Finding 3 |
| [#145](https://github.com/KomplexMojo/agent-kernel/issues/145) | `ak_create` budget denial doesn't say what budget would have worked | Open | No — workaround: retry with a larger `budgetTokens` | Finding 4 |
| [#146](https://github.com/KomplexMojo/agent-kernel/issues/146) | Open question: does plain `ak_run` ever invoke autonomous actor decision-making? | **Closed, not planned** | — | Superseded by #147; premise was wrong, see finding 5 |
| [#147](https://github.com/KomplexMojo/agent-kernel/issues/147) | `ak_tick_forward`/`ak_show_state` render every actor frozen at spawn position, single-frame overlay instead of cumulative replay | Open | No — top-level `ascii` field on `ak_show_state` (built by `renderAscii`) is a working substitute | Finding 5 |
| [#148](https://github.com/KomplexMojo/agent-kernel/issues/148) | level-gen error formatter in `orchestrate-build.js` bakes literal `"undefined"` into messages for 4 of 5 error codes | Open | No — the underlying rejection is correct, only the message text is broken | Finding 6 |

None of the open issues above block continued use of the MCP surface — every one has a stated
workaround. Full repro steps, root-cause evidence, and code pointers for each are in the numbered
findings below.

---

## Reproduction baseline

```
ak_create   text="A fire dungeon with one fire delver exploring past a fire hazard."
            room=["size=small;count=1"]
            delver=["count=1;affinity=fire;motivation=exploring;goals=max_mana,mana_regen"]
            hazard=["x=3;y=3;affinity=fire;expression=emit;stacks=1"]
            budgetTokens=1000  runId=run_mcp_session_demo2
            outDir=artifacts/runs/run_mcp_session_demo2/create

ak_run      simConfig=.../create/sim-config.json  initialState=.../create/initial-state.json
            ticks=5  seed=0  runId=run_mcp_session_demo2
            outDir=artifacts/runs/run_mcp_session_demo2/run
```

Both succeeded (`ok: true`). Everything below was hit while trying to *see* and *step through* the
result of that run through MCP tools alone.

---

## 1. `ak_push_to_ui`'s WebSocket bridge is unreachable from the harness that is meant to host it

**What's failing:** `ak_push_to_ui` starts a sandbox bridge WebSocket server on a port it picks
(`38487` in this run) inside the MCP server's own process, and the browser UI (`packages/ui-web`,
served via `serve:c`) connects to that port directly (`packages/ui-web/src/main.js:520-521`,
`AK_BRIDGE_PORT = globalThis.__ak_sandboxBridgePort ?? 38487`). In this Claude Code harness:

- `curl http://127.0.0.1:38487/` from the harness's own Bash tool: **connection refused**, and the
  port doesn't appear in `lsof -i :38487` at all.
- The harness's Browser pane (opened via `preview_start`, which *did* successfully reach the
  `serve:c` dev server on `:8001` through the harness's own tunnel) logs repeated
  `WebSocket connection to 'ws://127.0.0.1:38487/ak-sandbox' failed` — the UI loads, but never
  receives the pushed bundle.

**Why:** the MCP server process and the harness's Bash/Browser-pane tools do not share a network
namespace here. Only ports the harness itself provisions (via `preview_start`) get tunneled through
to the Browser pane; a raw port opened directly by a tool the MCP server spawns is invisible to both
`curl` from Bash and the Browser pane. `openBrowser: true` on `ak_push_to_ui` would fare no better —
it opens the *host's* default browser, which is a different surface than the harness's Browser pane
and isn't what "display in the Claude harness" means for this task.

**Impact:** the entire live "push a run to the gameplay UI and watch it play" path that
`ak_push_to_ui` exists for is unusable end-to-end when the MCP server and the driving harness are
this kind of sandboxed pair — not a fixture/data problem, an environment-reachability one.

**Workaround used this session:** `ak_show_state` / `ak_tick_forward` / `ak_tick_backward` return
state inline over the MCP response itself (ASCII or a PNG data URI) — no second network hop needed.
That's the channel that actually works here; see finding 3 for its own limitation.

## 2. `ak_show_state` / `ak_tick_forward` / `ak_tick_backward` resolve runs from a different root than `ak_create` / `ak_run` / `ak_show` / `ak_runs_list`

**What's failing:** after a clean `ak_create` → `ak_run` with `outDir` omitted (the default —
"MCP server uses a writable temp folder and remembers it"), `ak_show_state` returns:

```
{"ok":false,"command":"tick","action":"state","runId":"run_mcp_session_demo","error":"run directory not found: run_mcp_session_demo"}
```

even though `ak_show` and `ak_runs_list`, called with the same `runId` right after, both report the
run indexed and `status: "success"` — because they read from the MCP server's own remembered temp
root (`/var/folders/.../agent-kernel-mcp-<id>/<runId>/...`).

**Root cause:** `resolveRunDir()` in
[`packages/adapters-cli/src/tick-session.mjs:9-14`](packages/adapters-cli/src/tick-session.mjs#L9-L14)
is hardcoded to `process.env.AK_ARTIFACTS_DIR ?? join(process.cwd(), "artifacts")` + `runs/<runId>` —
it never consults the MCP server's "remembered outDir per runId" mechanism that every other run-aware
tool in this same server (`ak_show`, `ak_runs_list`, and `ak_create`/`ak_run`'s own follow-up calls)
uses. `packages/adapters-cli/src/mcp/tools/tick.mjs` calls `resolveRunDir(runId)` directly.

**Impact:** the documented "most common agent loop" in `packages/adapters-cli/src/mcp/README.md`
(`ak_create` or `ak_llm_plan` → `ak_run` → `ak_show`/`ak_inspect` → `ak_narrate` or `ak_diff`) works
fine end-to-end with default temp `outDir`s — but the moment you want to *step through or visualize*
that same run with `ak_show_state`/`ak_tick_forward`/`ak_tick_backward`, it silently can't find it,
with no hint that the fix is "pass `outDir=artifacts/runs/<runId>/<command>` explicitly on every call
instead." Confirmed as the fix: re-running `ak_create`/`ak_run` with `outDir` pinned under
`<repo>/artifacts/runs/<runId>/{create,run}` made `ak_show_state`/`ak_tick_forward` work immediately.

## 3. `ak_show_state`'s `image` visualization mode blows the MCP tool-result size limit

**What's failing:** `ak_show_state({runId, visualization: "image"})` on the same run that answered
fine in `ascii` mode returned a 443,790-character JSON payload (a `visualizationDataUri` PNG,
base64-inlined) and hit this harness's tool-result token ceiling — the harness caught it and spilled
the raw result to a scratch file rather than delivering it as a normal tool result.

**Impact:** the `image` mode is the one most naturally suited to "show me what's happening" in a
harness like this, and it's the one that doesn't fit through the channel. `ascii` mode worked cleanly
at a fraction of the size and is what this session used to confirm tick-by-tick state. Two independent
paths to a fix, not mutually exclusive: (a) MCP image results should use the protocol's native image
content-block type instead of embedding a data URI inside the JSON text result, or (b) `ak_show_state`
should support writing the PNG to a file and returning its path, the way every artifact-producing `ak_*`
tool already does, instead of always inlining bytes.

## 4. `ak_create`'s budget denial doesn't say what budget would have worked

**What's failing:** `ak_create` with `budgetTokens=200` for one small room + one fire delver +
one hazard was denied:

```
Budget receipt denied: status=denied; remaining=41; deniedLines=actor:actor_spawn:delvers,... (+8 more); deniedPools=delver:92/72
```

Re-running the identical spec with `budgetTokens=1000` succeeded with **`totalSpend: 159`** —
well under the 200 that was rejected. The denial isn't driven by the total; `deniedPools=delver:92/72`
shows a *per-category* pool (`delver`) was short even though total remaining (`41`) looked adequate,
and the category split isn't derivable from the `budgetTokens` input alone.

**Impact:** a caller who gets a `deniedPools` line has no way to compute the minimum `budgetTokens`
that would clear it without trial and error — the error reports what was denied, not the shortfall
size or the total that would resolve it. This is the same family of "comprehensive error message"
work already tracked in `error-message-quality-sweep.md` (SM0–SM3, merged) but for a category that
sweep's own scope note (`budget receipt denial` is a distinct code path from the `ak_create` field
validators it audited) didn't cover.

## 5. RESOLVED — root-caused with Serena: the actor did act; `ak_tick_forward`/`ak_show_state` render every actor frozen at spawn

**Original observation (now known to be a misdiagnosis):** `run_mcp_session_demo2`'s `action-log.json`
showed `"actions": []`, and `ak_tick_forward` at ticks 1, 2, 3 all showed the delver at the identical
`{x:3,y:2}`, which read as "the actor never decided or moved." That premise was wrong on both counts:

- `action-log.json` is populated **only from the `--actions` input file** (deterministic-replay input),
  never from what the runtime actually decided during the run —
  [`packages/runtime/src/commands/kernel.js:1129-1148`](packages/runtime/src/commands/kernel.js#L1129-L1148).
  An empty one says nothing about whether the Actor persona proposed anything.
- `tick-frames.json` for the same run shows the Actor persona *did* propose and get accepted two moves:
  tick 1 `move west (3,2)→(2,2)`, tick 2 `move northwest (2,2)→(1,1)` — landing exactly on the room's
  exit tile (`E` at `(1,1)`). Zero further proposals from tick 3 onward is then the *correct* behavior
  for an `exploring` motivation that has reached its goal, not a stall.

**The real, confirmed bug:** `ak_tick_forward`/`ak_show_state`'s `visualization.ascii` /
`visualization.visualizationDataUri` fields render every actor frozen at its `initial-state.json`
spawn position for the entire run, regardless of tick or accepted moves. Root cause, traced with
Serena (`find_referencing_symbols` on `createActorPersona`, then the `run` command in `kernel.js`,
then the two tick-frame readers in `tick-session.mjs`):

1. [`readTickFrame()`](packages/adapters-cli/src/tick-session.mjs#L72-L86) returns the **last**
   phase-frame for a tick (`forTick[forTick.length - 1]`) — which is always the `summarize` phase.
2. `summarize` phase-frames always carry `acceptedActions: []`; the actual accepted moves live only on
   that tick's `apply` phase-frame (confirmed: tick 1 and 2's `apply` frames carry the moves above,
   their `summarize` frames carry `[]`).
3. [`computeActorPositions()`](packages/runtime/src/render/visualization-snapshot.js#L36-L49) (used by
   `buildVisualizationSnapshot`, which is what `ak_tick_forward`/`ak_show_state`'s `visualization.*`
   fields come from) starts from `initialState.actors[].position` and overlays only the **single**
   passed-in `tickFrame.acceptedActions` — never a history. Fed an always-empty `summarize` frame, the
   overlay never applies, so every actor renders at spawn forever.

**Proof, same run, same call:** `ak_show_state({runId, visualization:"ascii"})` at cursor tick 3
returns *both* renderings in one response — top-level `ascii` (built by the sibling function
[`renderAscii()`](packages/adapters-cli/src/tick-session.mjs#L213-L262), via
[`resolveActorPositionsAtTick()`](packages/adapters-cli/src/tick-session.mjs#L181-L202), which
correctly *accumulates* every accepted move across ticks 1..N) shows `@` at `(1,1)` — the true,
correct position. The same response's `visualization.ascii` shows `D` still at `(3,2)` — spawn,
frozen. Two functions in the same package solve the identical problem; only one of them accumulates.

**Family resemblance:** this is the same shape of defect as a bug already fixed on the UI side —
`69330c4 fix(ui): gameplay tick playback was off by one, stuck on tick 0's stale position for the
whole run` (merged via #140) — a tick-cursor visualization reading a stale/wrong single frame instead
of replaying accepted actions cumulatively. That fix apparently didn't extend to this MCP-side
visualization path.

---

## Configuration-permutation sweep (2026-09-01)

**Purpose:** automate the kind of manual poking that found findings 1-5 above, across a bounded
matrix of delver/warden/hazard/resource configurations, rather than one hand-picked scenario at a
time. "Every possible permutation" is not literally tractable — full Cartesian product of affinity
(10) x expression (4) x motivation (11) x counts x entity-type combinations runs into the thousands —
so this is a **one-axis-at-a-time sweep off a single known-good baseline** (room: 1 small room;
delver: 1x fire/exploring; hazard: 1x fire/emit/stacks=1 at a room-relative position), varying one
axis across its full domain (or a spot-check subset for the larger domains) while holding every other
axis at baseline. `budgetTokens` is fixed at 2000 for every scenario — well above what any one
scenario costs — specifically so budget denial doesn't confound the sweep; that fixed cap is also the
"don't let generated configs grow unmanaged" rail the maintainer asked for.

**Matrix — 50 scenarios across 7 axes**, widened four times on 2026-09-01 (34 → 41 → 42 → 46 → 50):
axis D went from a 3-affinity spot-check to the full 10-affinity domain, axis B grew from the
non-control motivation domain only to all 4 motivation families (including `user_controlled`), axis C
grew a position sub-sweep (the room's two diagonals, 4 corners) alongside its original expression
sweep, then axis E grew the same diagonal-corner sub-sweep for an *actor* (the warden) rather than a
static hazard:

| Axis | What it sweeps | Domain size | Count |
|---|---|---|---|
| A | delver affinity | full (10 kinds) | 10 |
| B | delver motivation | full domain, all 4 families, minus `exploring` (baseline) | 11 |
| C | hazard expression (3) + hazard position, room's two diagonals (4 corners) | full expression domain minus `emit`; diagonal corners of a 5x5 interior | 7 |
| D | hazard affinity | full (10 kinds) | 10 |
| E | warden present (actor-vs-actor incl. 2-delver+warden stress, 3 hand-picked) + warden repositioned to the room's two diagonals (4 corners) | hand-picked + diagonal corners | 7 |
| F | resource authoring (vital payload x2, affinity payload x1) | hand-picked | 3 |
| G | multi-hazard stress (2 and 3 hazards) | hand-picked | 2 |

Axis E's diagonal sub-sweep can't reuse axis C's approach directly — `create`/`configure` has no
x/y field for `--delver`/`--warden` (level-gen auto-places actors; only hazards/resources take
authoring-time positions). Instead it reuses `E1-warden-basic`'s exact authored config and
repositions the auto-placed warden at **run time** via `ak run --actor <id>,<x>,<y>` — a CLI flag
meant for deterministic-replay overrides, now doing double duty as this sweep's actor-placement
mechanism. The warden's id (`card_warden_1-1`) is fixed and confirmed from E1's own
`initial-state.json` (single warden, `count=1`). Corners are absolute grid coordinates — the room's
walkable interior is confirmed absolute `1..5` on each axis (the same interior axis C's diagonal
hazards use, offset by the room's `(1,1)` origin from their room-relative `0..4`).

Axis C's diagonal-position sub-sweep exists because hazard x/y are room-relative offsets into the
target room's carved interior, and a "small" room's interior is confirmed 5x5 (relative `0..4` on
each axis — the underlying grid is `9x9` with a 1-tile border wall). The four corners are that
interior's diagonal extremes; diagonal-adjacent-to-wall geometry (corner peeking, diagonal blocking)
is called out elsewhere in this codebase (`packages/runtime/src/personas/actor/README.md`,
line-of-sight section) as a distinct code path from cardinal placement, which the baseline's
near-center `(3,3)` hazard never exercised.

**Methodology:** shells out to the real CLI (`node packages/adapters-cli/src/cli/ak.mjs`) directly
rather than through MCP tool calls — this is scripted batch automation, which
`packages/adapters-cli/src/mcp/README.md`'s own "Mental Model" section calls out as the right case for
using the CLI directly ("ad hoc shell usage... scripting outside an MCP client"), not a departure from
the MCP-first approach the rest of this doc uses. Each scenario runs `ak create` (no `--dry-run`) into
its own `outDir`, and on success feeds the resulting `sim-config.json`/`initial-state.json` into
`ak run --ticks 5 --seed 0`. Results are classified: `PASS`, `EXPECTED_BUDGET_DENIAL`,
`VALIDATION_REJECTION`, or `ANOMALY_*` (crash / malformed output / unrecognized failure shape) —
anything not cleanly explained by a known, expected rejection pattern gets triaged by hand before
being written up as a finding.

**Scripts (promoted into the repo 2026-09-01):**
[`scripts/testing/configuration-permutation-matrix.mjs`](scripts/testing/configuration-permutation-matrix.mjs)
(the 34-scenario matrix data) and
[`scripts/testing/run-configuration-permutation-sweep.mjs`](scripts/testing/run-configuration-permutation-sweep.mjs)
(the unified create+run runner, `--dry-run` for authoring-only). Wired up as `pnpm run config-sweep`
(full) and `pnpm run config-sweep:dry-run`. Output goes to `artifacts/matrix-sweep/` (gitignored).
G2's out-of-bounds hazard is left in the matrix deliberately as a standing regression probe for #148
— it should keep failing with a malformed message until that's fixed.

**Results (re-run 2026-09-01 after widening axis D, then B, then C, then E — 50 scenarios):**

- `ak create --dry-run` only (authoring-layer validation, no artifacts written, no `ak run`):
  **50/50 PASS.** No anomalies.
- `ak create` (real artifacts) + `ak run --ticks 5 --seed 0` per scenario: **49/50 PASS** on create,
  **49/49 PASS** on run for every create that succeeded. One anomaly — `G2-multi-hazard-triple` —
  see finding 6. All 10 axis-D hazard affinities, all 4 axis-C diagonal-corner hazard positions, and
  all 4 new axis-E diagonal-corner warden placements passed clean on both create and run — verified
  the `--actor` override actually took effect (not silently ignored) by reading
  `world-state.json` after each: the warden really ended up at `(1,1)`/`(5,5)`/`(5,1)`/`(1,5)`
  respectively and, with no hostile adjacent at any of those corners, stayed there for the whole run
  (`defending` doesn't move without an adjacent hostile — same documented behavior already noted for
  axis B). `B-delver-motivation-user_controlled` also passed clean on both: `create=PASS`,
  `run=PASS`, `actions=0, effects=5` — inert at the run layer as expected (player-controlled actors
  need streamed simulation playback per the Actor persona README; a plain `ak_run` pass has no
  player input to stream), informational only, not a failure.

**Informational note, not a finding:** the run pass recorded `acceptedActions`/`emittedEffects` counts
per scenario as metadata only, never as a pass/fail signal — treating "an actor did nothing" as
itself suspect is exactly the false-positive this session already hit once (issue #146, closed; see
finding 5). Axis B's cognition-only motivations (`reflexive`, `goal_oriented`, `strategy_focused`)
and `stationary` all showed `actions=0`; per `packages/runtime/src/personas/actor/README.md`,
cognition motivations compose with a *mobility* motivation rather than supplying one, so a
cognition-only actor legitimately has no movement instruction — consistent with, not contradicting,
documented behavior. `defending` showed `actions=0, effects=5`, also consistent with existing test
coverage (`tests/runtime/actor-motivation-combat.test.js`: "defending actor does not move when hostile
is not adjacent" — no hostile exists in a single-actor scenario). None of this was investigated
further; flagged here only so a future sweep doesn't have to re-derive that these are expected.

## 6. `orchestrate-build.js`'s level-gen error formatter produces literal "undefined" text for 4 of 5 error codes

**What's failing:** `G2-multi-hazard-triple` (3 hazards, one placed at a room-relative position
outside the room's bounds) failed `ak create` with:

```
{"ok":false,"command":"create","error":"level-gen input invalid: hazards[2].position:hazard_outside_room (requested undefined, need at least undefined for undefined rooms)"}
```

The underlying rejection is legitimate — hazard `x`/`y` in a `create`/`configure` spec are
room-relative offsets into the target room's carved interior
([`level-layout.js:1469-1476`](packages/runtime/src/personas/configurator/level-layout.js#L1469-L1476)),
and this scenario's third hazard coordinate exceeded that room's bounds. The message text is what's
broken.

**Root cause:** [`orchestrate-build.js:397-406`](packages/runtime/src/build/orchestrate-build.js#L397-L406)
formats every `level-layout.js` error with one hardcoded template —
`` `(requested ${err.detail.target}, need at least ${err.detail.required} for ${err.detail.roomCount} rooms)` ``
— written for exactly one error code's detail shape. `level-layout.js` raises five distinct codes;
only `floor_tile_budget_insufficient` (the case `error-message-quality-sweep.md` SM3/SM4 already
fixed) matches that shape. The other four —
[`hazard_outside_room`](packages/runtime/src/personas/configurator/level-layout.js#L1492-L1502)
(`{x, y, roomId, roomWidth, roomHeight}`),
[`hazard_on_wall`](packages/runtime/src/personas/configurator/level-layout.js#L2659) (`{x, y, affinity}`),
[`element_on_wall`](packages/runtime/src/personas/configurator/level-layout.js#L2686) (`{x, y, id}`), and
[`target_mismatch`](packages/runtime/src/personas/configurator/level-layout.js#L2706) (`{target, walkableTiles}`)
— all have incompatible shapes. Because `err.detail` is truthy in every case, the formatter's ternary
always takes the "format it" branch rather than falling back to the plain `field:code` form, so all
four silently degrade to `undefined`-polluted text instead of formatting correctly or omitting the
parenthetical.

**Impact:** same defect family as the already-tracked `error-message-quality-sweep.md` work (a rich
structured detail object computed by `level-layout.js`, then mangled by its caller) — but that sweep's
fix only patched the one code it was chasing; the generic formatter producing every *other* level-gen
error was never made shape-aware, so the same failure mode is still reachable through hazard/element
placement errors, which this sweep's axis G hit on its very first out-of-bounds scenario.

---

## Workflow for the rest of this activity

**Corrected 2026-09-01** (see conversation): every issue found gets filed to GitHub immediately, as
it's identified — not batched into an end-of-session sweep. What's deferred is *fixing* them: this
session's job is to run the app, find friction, root-cause it enough to hand off cleanly, and file the
issue with that context attached (repro, root cause, code pointers, evidence) — not to patch the code.
The table at the top of this document is the running index; append a row there and a numbered finding
section below for every new issue, in the same pattern as #142-#147 above.

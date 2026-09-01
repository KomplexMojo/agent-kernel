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

## Workflow for the rest of this activity

**Corrected 2026-09-01** (see conversation): every issue found gets filed to GitHub immediately, as
it's identified — not batched into an end-of-session sweep. What's deferred is *fixing* them: this
session's job is to run the app, find friction, root-cause it enough to hand off cleanly, and file the
issue with that context attached (repro, root cause, code pointers, evidence) — not to patch the code.
The table at the top of this document is the running index; append a row there and a numbered finding
section below for every new issue, in the same pattern as #142-#147 above.

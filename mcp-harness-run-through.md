# MCP harness run-through — friction log

**Status (2026-09-01):** first pass. The maintainer asked to drive `agent-kernel` end-to-end through
the `agent-kernel-cli` MCP server from inside a Claude Code harness (Bash + Browser-pane tools) and
have results display back in that harness, logging any friction as it's hit.
**Audience:** an agent with no memory of the session that produced it.
**Source of evidence:** live MCP tool calls (`ak_create`, `ak_run`, `ak_push_to_ui`, `ak_show_state`,
`ak_tick_forward`, `ak_show`, `ak_runs_list`) against `packages/adapters-cli/src/mcp/server.mjs` on
branch `chore/mcp-session-run-through` (parent `main` @ `9611ad7`), plus reads of
`packages/adapters-cli/src/tick-session.mjs` and `packages/adapters-cli/src/mcp/README.md`.

**Session goal, restated:** run the app via MCP tools only (no shelling out to `ak.mjs` directly for
the app-driving steps), get a visual/state result rendered inside the Claude Code harness (Browser
pane or an inline image), and log each piece of friction as a standalone `gh issue` per
`AGENTS.md → Working agreement`, back-linked to this file.

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

## 5. (open question, not yet root-caused) An authored delver took zero actions across a 5-tick plain `ak_run`

**Observation:** `run_mcp_session_demo2` — one delver, `motivation=exploring`, run for 5 ticks via
plain `ak_run` with no `--actions`/`actions` input (which the CLI help describes as being for
"deterministic replay," i.e. optional, not a prerequisite for autonomous behavior) — produced:

- `action-log.json`: `"actions": []`
- `effects-log.json`: exactly 3 effects, all `status: "deferred"` (`missing_telemetry` /
  `missing_logger`), i.e. harness-side bookkeeping, not gameplay effects
- `ak_tick_forward` at tick 1, 2, and 3 all show the delver at the identical `{x:3,y:2}` with
  identical vitals — no movement, no decisions, no state change of any kind

**Why this is flagged rather than fixed inline:** this repo's own persona model gives the Actor
persona an `observe, decide` tick phase specifically to propose actions, and `runtime` orchestrates
that independently of any `--actions` replay file — so zero actions over 5 ticks for an
`exploring`-motivated actor is either (a) a real regression in the autonomous decision path invoked
by plain `ak_run`, or (b) expected behavior this session doesn't have context to judge (e.g. `ak_run`
alone may intentionally not invoke actor decision-making, and only `ak_scenario` or a
`--actions`-driven path does). The branch this session started from carries two same-day commits —
`4112ac8 feat: complete persona-owned perception and solver policy` and
`d47dfba refactor(runtime): restore allocator and configurator authority` — that are plausibly
adjacent to whatever gates this, which is exactly the kind of thing that should be root-caused with
Serena/`find_referencing_symbols` on the Actor persona's `advance()`, not guessed at from outside.

---

## Issues filed from this doc

(filled in as `gh issue create` runs land — each issue links back here by path)

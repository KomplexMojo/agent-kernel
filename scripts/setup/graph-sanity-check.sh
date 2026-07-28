#!/usr/bin/env bash
# graph-sanity-check.sh — assert the CodeContextGraph index is TRUSTWORTHY, not merely present.
#
# WHY THIS EXISTS (PT.1, 2026-07-27/28):
#   CLAUDE.md and AGENTS.md both MANDATE graph-before-grep. That rule is only safe if the graph
#   is complete. It was not: `IGNORE_DIRS` contained `build`, so every file under
#   packages/runtime/src/build/ (the entire build plane — orchestrate-build, authoring-build,
#   map-build-spec, telemetry, mixed-room-summary) was silently absent. Queries against those
#   symbols returned `success: true` with ZERO results — a confident wrong answer, which is far
#   more dangerous than an error. `find_callers(buildBuildTelemetryRecord)` reported 0 callers
#   when there are 5.
#
#   An empty result from this graph is meaningless unless you know the file was indexed at all.
#   Run this at session start (AGENTS.md step 6) before trusting any structural claim.
#
# USAGE:  bash scripts/setup/graph-sanity-check.sh
# EXIT:   0 = graph trustworthy · 1 = graph is LYING, fall back to reading files and repair it

set -uo pipefail

SOCKET="${FALKORDB_SOCKET_PATH:-$HOME/.codegraphcontext/global/db/falkordb.sock}"
GRAPH="${FALKORDB_GRAPH_NAME:-codegraph}"
REPO="${REPO_ROOT:-/Users/darren/Documents/GitHub/agent-kernel}"

REDIS_CLI="$(command -v redis-cli || echo /Library/Frameworks/Python.framework/Versions/3.12/bin/redis-cli)"

fail=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }

# Run a Cypher query that RETURNs a single integer; echo just that integer.
q() {
  "$REDIS_CLI" -s "$SOCKET" GRAPH.QUERY "$GRAPH" "$1" --no-raw 2>/dev/null \
    | grep -oE '^[0-9]+$|"[0-9]+"' | tr -d '"' | tail -1
}

echo "CodeContextGraph sanity check"
echo "  socket: $SOCKET"
echo "  graph : $GRAPH"
echo

# --- C1: is the embedded DB even alive? -------------------------------------
# FalkorDB is a worker owned by the cgc MCP server; it dies with that process. A dead socket
# means every graph tool will error or (worse) some may return empty. Restart Claude Code.
if [ ! -S "$SOCKET" ] || ! "$REDIS_CLI" -s "$SOCKET" PING >/dev/null 2>&1; then
  bad "FalkorDB is NOT running (socket dead). It is an embedded worker of the cgc MCP server —"
  echo "        restart Claude Code to respawn it, then re-run this check."
  exit 1
fi
pass "FalkorDB reachable"

# --- C2: no stale worktree copies -------------------------------------------
# .claude/worktrees/* were indexed as separate repos and returned every symbol 2-3x, polluting
# results. They must not be in the graph.
wt=$(q "MATCH (f:File) WHERE f.path CONTAINS '/.claude/worktrees/' RETURN count(*)")
if [ "${wt:-x}" = "0" ]; then pass "no worktree pollution (0 files)"
else bad "worktree files present (${wt:-?}) — delete those repos from the graph"; fi

# --- C3: THE CANARY — the build plane is indexed ----------------------------
# This is the exact gap PT.1 found. `build` in IGNORE_DIRS made this 0.
bp=$(q "MATCH (f:File) WHERE f.path STARTS WITH '$REPO/packages/runtime/src/build/' RETURN count(*)")
if [ "${bp:-0}" -ge 5 ] 2>/dev/null; then pass "build plane indexed ($bp files)"
else bad "build plane MISSING (${bp:-0} files, expect >=5) — check 'build' is NOT in IGNORE_DIRS"; fi

# --- C4: tests are indexed --------------------------------------------------
ts=$(q "MATCH (f:File) WHERE f.path STARTS WITH '$REPO/tests/' RETURN count(*)")
if [ "${ts:-0}" -ge 100 ] 2>/dev/null; then pass "tests indexed ($ts files)"
else bad "tests missing/thin (${ts:-0}, expect >=100) — check 'tests' not in IGNORE_DIRS and IGNORE_TEST_FILES=false"; fi

# --- C5: the known-caller-count canary --------------------------------------
# buildBuildTelemetryRecord is called from kernel.js x3, ak-impl.mjs x1, and one test.
# If its Function node is absent, find_callers answers "0 callers" with success:true.
fn=$(q "MATCH (f:Function {name:'buildBuildTelemetryRecord'}) RETURN count(*)")
if [ "${fn:-0}" -ge 1 ] 2>/dev/null; then
  pass "canary symbol present in graph"
  cl=$(q "MATCH (c)-[:CALLS]->(:Function {name:'buildBuildTelemetryRecord'}) RETURN count(DISTINCT c)")
  if [ "${cl:-0}" -ge 1 ] 2>/dev/null; then pass "canary has $cl caller(s) — call edges are being built"
  else bad "canary has ZERO callers but 5 exist on disk — call-edge extraction is broken"; fi
else
  bad "canary symbol ABSENT — the graph will answer '0 callers' for it, confidently and wrongly"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "GRAPH OK — structural queries may be trusted."
else
  echo "GRAPH NOT TRUSTWORTHY — verify structural claims by reading files, and repair the index."
  echo "Repair: delete_repository('$REPO') then add_code_to_graph('$REPO')."
fi
exit "$fail"

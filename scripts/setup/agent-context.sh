#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/setup/agent-context.sh [options]

Refresh branch-local Graphify and CodeGraphContext context, then mirror the
results into a stable per-worktree cache under ~/vault/codex-context.

Options:
  --context-home PATH   Override the cache root.
  --skip-graphify      Do not rebuild Graphify.
  --skip-cgc           Do not index CodeGraphContext via the cgc CLI.
  --watch-cgc          Start cgc watch in the background for this worktree.
  --no-local-snapshot  Do not write local-codex/CodeContext.md.
  -h, --help           Show this help.

Environment:
  AGENT_CONTEXT_HOME   Default cache root override.
EOF
}

log() {
  printf '[agent-context] %s\n' "$*"
}

die() {
  printf '[agent-context] error: %s\n' "$*" >&2
  exit 1
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || die "must run inside a git worktree"
}

sanitize_ref() {
  printf '%s' "$1" | tr '/[:space:]' '---' | tr -cd 'A-Za-z0-9._-'
}

sha12() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
  else
    printf '%s' "$1" | sha256sum | awk '{print substr($1,1,12)}'
  fi
}

detect_graphify_python() {
  local graphify_bin shebang py

  graphify_bin="$(command -v graphify || true)"
  if [[ -n "$graphify_bin" ]]; then
    shebang="$(head -n 1 "$graphify_bin" | sed 's/^#!//')"
    if [[ -x "$shebang" ]] && "$shebang" -c 'import graphify' >/dev/null 2>&1; then
      printf '%s\n' "$shebang"
      return 0
    fi
  fi

  for py in python3 python; do
    if command -v "$py" >/dev/null 2>&1 && "$py" -c 'import graphify' >/dev/null 2>&1; then
      command -v "$py"
      return 0
    fi
  done

  return 1
}

copy_tree() {
  local src="$1"
  local dest="$2"

  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude cache/ "$src"/ "$dest"/
  else
    rm -rf "$dest"
    mkdir -p "$dest"
    cp -R "$src"/. "$dest"/
    rm -rf "$dest/cache"
  fi
}

write_metadata() {
  local dest="$1"
  cat > "$dest/agent-context.json" <<EOF
{
  "repo": "$REPO_NAME",
  "repoRoot": "$REPO_ROOT",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "worktreeId": "$WORKTREE_ID",
  "contextDir": "$CONTEXT_DIR",
  "graphifyOut": "$CONTEXT_DIR/graphify-out",
  "codeContext": "$CONTEXT_DIR/CodeContext.md",
  "generatedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
EOF
  printf '%s\n' "$REPO_ROOT" > "$dest/repo-root.txt"
  printf '%s\n' "$BRANCH" > "$dest/branch.txt"
  printf '%s\n' "$COMMIT" > "$dest/commit.txt"
}

write_code_context() {
  local dest="$1"
  local graph_report="$CONTEXT_DIR/graphify-out/GRAPH_REPORT.md"

  {
    printf '# Agent Context\n\n'
    printf '%s\n' "- Repo: \`$REPO_NAME\`"
    printf '%s\n' "- Worktree: \`$REPO_ROOT\`"
    printf '%s\n' "- Branch: \`$BRANCH\`"
    printf '%s\n' "- Commit: \`$COMMIT\`"
    printf '%s\n' "- Worktree context: \`$CONTEXT_DIR\`"
    printf '%s\n' "- Graphify mirror: \`$CONTEXT_DIR/graphify-out\`"
    printf '\n'
    printf '## Agent Startup\n\n'
    printf 'Use CodeContextGraph against this worktree path:\n\n'
    printf '```text\n%s\n```\n\n' "$REPO_ROOT"
    printf 'Recommended MCP calls from the agent session:\n\n'
    printf '```text\n'
    printf 'mcp__CodeGraphContext__watch_directory(path="%s")\n' "$REPO_ROOT"
    printf 'mcp__CodeGraphContext__get_repository_stats(repo_path="%s")\n' "$REPO_ROOT"
    printf 'mcp__CodeGraphContext__analyze_code_relationships(repo_path="%s", query_type="module_deps", target="<target-module>")\n' "$REPO_ROOT"
    printf 'mcp__CodeGraphContext__find_most_complex_functions(repo_path="%s", limit=10)\n' "$REPO_ROOT"
    printf '```\n\n'

    if [[ -s "$graph_report" ]]; then
      printf '## Graphify Summary\n\n'
      sed -n '1,18p' "$graph_report"
      printf '\n'
    fi

    if [[ -s "$CONTEXT_DIR/cgc-stats.txt" ]]; then
      printf '## CodeGraphContext CLI Stats\n\n```text\n'
      sed -n '1,80p' "$CONTEXT_DIR/cgc-stats.txt"
      printf '```\n\n'
    fi

    if [[ -s "$CONTEXT_DIR/cgc-warning.txt" ]]; then
      printf '## CodeGraphContext CLI Warning\n\n'
      sed -n '1,80p' "$CONTEXT_DIR/cgc-warning.txt"
      printf '\n'
    fi

    if [[ -s "$CONTEXT_DIR/cgc-complexity.txt" ]]; then
      printf '## Complexity Hotspots\n\n```text\n'
      sed -n '1,120p' "$CONTEXT_DIR/cgc-complexity.txt"
      printf '```\n'
    fi
  } > "$dest"
}

SKIP_GRAPHIFY=0
SKIP_CGC=0
WATCH_CGC=0
WRITE_LOCAL=1
CONTEXT_HOME="${AGENT_CONTEXT_HOME:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --context-home)
      [[ $# -ge 2 ]] || die "--context-home requires a path"
      CONTEXT_HOME="$2"
      shift 2
      ;;
    --skip-graphify)
      SKIP_GRAPHIFY=1
      shift
      ;;
    --skip-cgc)
      SKIP_CGC=1
      shift
      ;;
    --watch-cgc)
      WATCH_CGC=1
      shift
      ;;
    --no-local-snapshot)
      WRITE_LOCAL=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

REPO_ROOT="$(repo_root)"
REPO_NAME="$(basename "$REPO_ROOT")"
BRANCH="$(git -C "$REPO_ROOT" symbolic-ref --short -q HEAD || true)"
if [[ -z "$BRANCH" ]]; then
  BRANCH="detached-$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
fi
COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
WORKTREE_ID="$(sha12 "$REPO_ROOT")"
SAFE_BRANCH="$(sanitize_ref "$BRANCH")"

if [[ -z "$CONTEXT_HOME" ]]; then
  CONTEXT_HOME="$HOME/vault/codex-context/$REPO_NAME"
fi
CONTEXT_DIR="$CONTEXT_HOME/worktrees/$WORKTREE_ID"

mkdir -p "$CONTEXT_DIR" "$CONTEXT_HOME/by-branch"
write_metadata "$CONTEXT_DIR"
ln -sfn "../worktrees/$WORKTREE_ID" "$CONTEXT_HOME/by-branch/$SAFE_BRANCH"

log "repo: $REPO_ROOT"
log "branch: $BRANCH"
log "context: $CONTEXT_DIR"

if [[ "$SKIP_GRAPHIFY" -eq 0 ]]; then
  GRAPHIFY_PYTHON="$(detect_graphify_python)" || die "graphify is not importable; install graphify or put graphify on PATH"
  log "rebuilding Graphify with $GRAPHIFY_PYTHON"
  mkdir -p "$REPO_ROOT/graphify-out"
  printf '%s\n' "$GRAPHIFY_PYTHON" > "$REPO_ROOT/graphify-out/.graphify_python"
  (
    cd "$REPO_ROOT"
    "$GRAPHIFY_PYTHON" -c "from graphify.watch import _rebuild_code; from pathlib import Path; raise SystemExit(0 if _rebuild_code(Path('.')) else 1)"
  )
  copy_tree "$REPO_ROOT/graphify-out" "$CONTEXT_DIR/graphify-out"
else
  log "skipping Graphify rebuild"
  if [[ -d "$REPO_ROOT/graphify-out" ]]; then
    copy_tree "$REPO_ROOT/graphify-out" "$CONTEXT_DIR/graphify-out"
  fi
fi

if [[ "$SKIP_CGC" -eq 0 ]]; then
  CGC_BIN="$(command -v cgc || command -v codegraphcontext || true)"
  [[ -n "$CGC_BIN" ]] || die "CodeGraphContext CLI not found; expected cgc or codegraphcontext on PATH"
  log "indexing CodeGraphContext with $CGC_BIN"
  "$CGC_BIN" index "$REPO_ROOT" > "$CONTEXT_DIR/cgc-index.txt" 2>&1
  if grep -qi 'An error occurred during indexing' "$CONTEXT_DIR/cgc-index.txt"; then
    log "warning: cgc CLI reported an indexing error; agents should use MCP watch_directory for this worktree"
    cat > "$CONTEXT_DIR/cgc-warning.txt" <<EOF
CodeGraphContext CLI indexing reported an error for this worktree.

Use the MCP server from the agent session instead:

mcp__CodeGraphContext__watch_directory(path="$REPO_ROOT")
mcp__CodeGraphContext__get_repository_stats(repo_path="$REPO_ROOT")
EOF
    rm -f "$CONTEXT_DIR/cgc-stats.txt" "$CONTEXT_DIR/cgc-complexity.txt"
  else
    rm -f "$CONTEXT_DIR/cgc-warning.txt"
    "$CGC_BIN" stats "$REPO_ROOT" > "$CONTEXT_DIR/cgc-stats.txt" 2>&1 || true
    (
      cd "$REPO_ROOT"
      "$CGC_BIN" analyze complexity --limit 10 > "$CONTEXT_DIR/cgc-complexity.txt" 2>&1 || true
    )
  fi

  if [[ "$WATCH_CGC" -eq 1 ]]; then
    if [[ -s "$CONTEXT_DIR/cgc-watch.pid" ]] && kill -0 "$(cat "$CONTEXT_DIR/cgc-watch.pid")" 2>/dev/null; then
      log "cgc watch already running with pid $(cat "$CONTEXT_DIR/cgc-watch.pid")"
    else
      log "starting cgc watch in background"
      nohup "$CGC_BIN" watch "$REPO_ROOT" > "$CONTEXT_DIR/cgc-watch.log" 2>&1 &
      printf '%s\n' "$!" > "$CONTEXT_DIR/cgc-watch.pid"
    fi
  fi
else
  log "skipping CodeGraphContext indexing"
fi

write_code_context "$CONTEXT_DIR/CodeContext.md"

if [[ "$WRITE_LOCAL" -eq 1 ]]; then
  mkdir -p "$REPO_ROOT/local-codex"
  cp "$CONTEXT_DIR/CodeContext.md" "$REPO_ROOT/local-codex/CodeContext.md"
fi

log "wrote $CONTEXT_DIR/CodeContext.md"
if [[ "$WRITE_LOCAL" -eq 1 ]]; then
  log "updated $REPO_ROOT/local-codex/CodeContext.md"
fi

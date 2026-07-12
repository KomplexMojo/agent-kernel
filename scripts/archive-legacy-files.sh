#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/archive-legacy-files.sh [options]

Dry-run by default. With --apply, copy selected legacy files to an archive
directory, write a manifest, then remove tracked files from the repo with git rm.

Options:
  --apply                  Copy and remove files. Without this, only print paths.
  --archive-dir PATH       Archive destination. Default: ../agent-kernel-legacy-archive/<timestamp>
  --copy-only              With --apply, copy files but do not git rm them.
  --include-agent-context  Include generated graphify-out context files.
  --include-review-assets  Include generated actor-medallion review sheets.
  --allow-modified         Allow archiving/removing modified candidate files.
  -h, --help               Show this help.
EOF
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

add_tracked_pathspec() {
  git -C "$REPO_ROOT" ls-files -- "$@" >> "$CANDIDATES"
}

add_tracked_file() {
  local rel="$1"
  if git -C "$REPO_ROOT" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
    printf '%s\n' "$rel" >> "$CANDIDATES"
  fi
}

APPLY=0
COPY_ONLY=0
INCLUDE_AGENT_CONTEXT=0
INCLUDE_REVIEW_ASSETS=0
ALLOW_MODIFIED=0
ARCHIVE_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --archive-dir)
      [[ $# -ge 2 ]] || { printf 'error: --archive-dir requires a path\n' >&2; exit 1; }
      ARCHIVE_DIR="$2"
      shift 2
      ;;
    --copy-only)
      COPY_ONLY=1
      shift
      ;;
    --include-agent-context)
      INCLUDE_AGENT_CONTEXT=1
      shift
      ;;
    --include-review-assets)
      INCLUDE_REVIEW_ASSETS=1
      shift
      ;;
    --allow-modified)
      ALLOW_MODIFIED=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'error: unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(repo_root)"
if [[ -z "$REPO_ROOT" ]]; then
  printf 'error: must run inside a git worktree\n' >&2
  exit 1
fi

TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
if [[ -z "$ARCHIVE_DIR" ]]; then
  ARCHIVE_DIR="$(dirname "$REPO_ROOT")/agent-kernel-legacy-archive/$TIMESTAMP"
fi

CANDIDATES="$(mktemp)"
SORTED_CANDIDATES="$(mktemp)"
DIRTY_CANDIDATES="$(mktemp)"
hazard 'rm -f "$CANDIDATES" "$SORTED_CANDIDATES" "$DIRTY_CANDIDATES"' EXIT

add_tracked_pathspec ".playwright-cli"
add_tracked_pathspec "packages/adapters-cli/artifacts/solve_cli_test"
add_tracked_pathspec "packages/runtime/src/packages/runtime/src"
add_tracked_pathspec "graphify-out/memory"

add_tracked_file "design-check.png"
add_tracked_file "design-final.png"
add_tracked_file "design-tab-check.png"
add_tracked_file "design-tab-large.png"
add_tracked_file "final-gameplay.png"
add_tracked_file "live-run-board.png"
add_tracked_file "sandbox-hazards-board.png"
add_tracked_file "sandbox-hazards-final.png"
add_tracked_file "sandbox-rerun.png"
add_tracked_file "stepped-5-ticks.png"
add_tracked_file "stepped-run.png"
add_tracked_file "stepped-ticks.png"
add_tracked_file "tmp_script.sh"
add_tracked_file "uploadable-files.txt"

if [[ "$INCLUDE_AGENT_CONTEXT" -eq 1 ]]; then
  add_tracked_file "graphify-out/.graphify_python"
  add_tracked_file "graphify-out/GRAPH_REPORT.md"
  add_tracked_file "graphify-out/cost.json"
  add_tracked_file "graphify-out/manifest.json"
fi

if [[ "$INCLUDE_REVIEW_ASSETS" -eq 1 ]]; then
  add_tracked_pathspec "packages/runtime/src/render/visual-assets/actor-medallions/review"
fi

sort -u "$CANDIDATES" > "$SORTED_CANDIDATES"
COUNT="$(wc -l < "$SORTED_CANDIDATES" | tr -d ' ')"

if [[ "$COUNT" -eq 0 ]]; then
  printf 'No tracked legacy candidates found.\n'
  exit 0
fi

printf 'Legacy archive candidates: %s files\n' "$COUNT"
printf 'Archive destination: %s\n' "$ARCHIVE_DIR"
if [[ "$APPLY" -eq 0 ]]; then
  printf 'Dry run only. Re-run with --apply to copy and remove tracked files.\n\n'
  sed 's/^/  /' "$SORTED_CANDIDATES"
  exit 0
fi

while IFS= read -r rel; do
  if ! git -C "$REPO_ROOT" diff --quiet -- "$rel" || ! git -C "$REPO_ROOT" diff --cached --quiet -- "$rel"; then
    printf '%s\n' "$rel" >> "$DIRTY_CANDIDATES"
  fi
done < "$SORTED_CANDIDATES"

if [[ -s "$DIRTY_CANDIDATES" && "$ALLOW_MODIFIED" -ne 1 ]]; then
  printf 'Refusing to archive modified candidate files. Review these or pass --allow-modified:\n' >&2
  sed 's/^/  /' "$DIRTY_CANDIDATES" >&2
  exit 1
fi

mkdir -p "$ARCHIVE_DIR"
{
  printf 'agent-kernel legacy file archive\n'
  printf 'createdAt: %s\n' "$TIMESTAMP"
  printf 'repo: %s\n' "$REPO_ROOT"
  printf 'commit: %s\n' "$(git -C "$REPO_ROOT" rev-parse HEAD)"
  printf 'copyOnly: %s\n' "$COPY_ONLY"
  printf 'includeAgentContext: %s\n' "$INCLUDE_AGENT_CONTEXT"
  printf 'includeReviewAssets: %s\n' "$INCLUDE_REVIEW_ASSETS"
  printf 'allowModified: %s\n' "$ALLOW_MODIFIED"
  printf '\nfiles:\n'
} > "$ARCHIVE_DIR/MANIFEST.txt"

while IFS= read -r rel; do
  src="$REPO_ROOT/$rel"
  dest="$ARCHIVE_DIR/$rel"
  if [[ ! -e "$src" ]]; then
    printf 'missing: %s\n' "$rel" >&2
    continue
  fi
  mkdir -p "$(dirname "$dest")"
  cp -p "$src" "$dest"
  printf '%s\n' "- $rel" >> "$ARCHIVE_DIR/MANIFEST.txt"
done < "$SORTED_CANDIDATES"

if [[ "$COPY_ONLY" -eq 0 ]]; then
  while IFS= read -r rel; do
    if [[ -e "$REPO_ROOT/$rel" ]]; then
      git -C "$REPO_ROOT" rm -q -- "$rel"
    fi
  done < "$SORTED_CANDIDATES"
fi

printf 'Archived %s files to %s\n' "$COUNT" "$ARCHIVE_DIR"
if [[ "$COPY_ONLY" -eq 0 ]]; then
  printf 'Tracked originals were removed with git rm. Run tests before committing.\n'
  printf 'If graphify-out remains tracked, rerun: bash scripts/setup/agent-context.sh\n'
else
  printf 'Copy-only mode used. Tracked originals remain in place.\n'
fi

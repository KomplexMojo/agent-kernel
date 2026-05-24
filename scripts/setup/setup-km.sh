#!/usr/bin/env bash
# setup-km.sh — Knowledge Management setup for agent-kernel
#
# Sets up an Obsidian vault, Claude wiki skills, MCP filesystem server,
# session hooks, Syncthing, and migrates non-essential repo docs into the vault.
#
# Designed to run on:
#   - macOS (primary)  — runs the migration phase, commits to repo
#   - Ubuntu (secondary) — pulls migrated repo, sets up local mirrors
#
# Idempotent. Safe to re-run. See scripts/setup/README.md for full docs.

set -euo pipefail

# ------------------------------------------------------------------ constants

VAULT_NAME="agent-kernel-vault"
SKILLS_UPSTREAM="${SKILLS_UPSTREAM:-https://github.com/AgriciDaniel/claude-obsidian.git}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ------------------------------------------------------------------ logging

c_blue=$'\033[1;34m'; c_green=$'\033[1;32m'; c_yellow=$'\033[1;33m'
c_red=$'\033[1;31m'; c_dim=$'\033[2;37m';   c_reset=$'\033[0m'

log()  { printf '%s[km]%s %s\n' "$c_blue"   "$c_reset" "$*"; }
ok()   { printf '%s[km] ok:%s %s\n' "$c_green" "$c_reset" "$*"; }
warn() { printf '%s[km] warn:%s %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
err()  { printf '%s[km] err:%s %s\n' "$c_red" "$c_reset" "$*" >&2; exit 1; }
skip() { printf '%s[km] skip:%s %s\n' "$c_dim" "$c_reset" "$*"; }

# ------------------------------------------------------------------ args

ROLE=""
SKIP_MIGRATION=0
SKIP_SYNCTHING=0
DRY_RUN=0
PHASES_TO_RUN=()

usage() {
  cat <<EOF
Usage: bash setup-km.sh [options]

Options:
  --primary           Force this machine as primary (runs repo migration)
  --secondary         Force this machine as secondary (skips migration)
  --skip-migration    Skip the repo→vault migration phase
  --skip-syncthing    Skip Syncthing install / start
  --phase=N           Run only phase N (1..8); repeatable
  --dry-run           Print actions without executing destructive ops
  -h, --help          Show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --primary)        ROLE=primary ;;
      --secondary)      ROLE=secondary ;;
      --skip-migration) SKIP_MIGRATION=1 ;;
      --skip-syncthing) SKIP_SYNCTHING=1 ;;
      --dry-run)        DRY_RUN=1 ;;
      --phase=*)        PHASES_TO_RUN+=("${1#--phase=}") ;;
      -h|--help)        usage; exit 0 ;;
      *)                err "Unknown arg: $1 (use --help)" ;;
    esac
    shift
  done
}

# ------------------------------------------------------------------ platform

detect_platform() {
  case "$(uname -s)" in
    Darwin) PLATFORM="mac" ;;
    Linux)  PLATFORM="linux" ;;
    *)      err "Unsupported platform: $(uname -s)" ;;
  esac

  case "$PLATFORM" in
    mac)   VAULT_HOME="$HOME/Documents/Obsidian/$VAULT_NAME" ;;
    linux) VAULT_HOME="$HOME/$VAULT_NAME" ;;
  esac

  VAULT_LINK="$HOME/vault"
  [[ -z "$ROLE" ]] && ROLE=$([[ "$PLATFORM" == "mac" ]] && echo primary || echo secondary)

  log "Platform: $PLATFORM   Role: $ROLE"
  log "Vault:    $VAULT_HOME"
  log "Symlink:  $VAULT_LINK -> \$vault"
  log "Repo:     $REPO_ROOT"
}

# ------------------------------------------------------------------ helpers

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '%s[dry]%s %s\n' "$c_dim" "$c_reset" "$*"
  else
    "$@"
  fi
}

write_if_missing() {
  local path="$1" content="$2"
  if [[ -e "$path" ]]; then skip "exists: $path"; return; fi
  run mkdir -p "$(dirname "$path")"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '%s[dry]%s write: %s\n' "$c_dim" "$c_reset" "$path"
  else
    printf '%s\n' "$content" > "$path"
    ok "wrote $path"
  fi
}

ensure_gitignore() {
  local line="$1" gi="$REPO_ROOT/.gitignore"
  grep -qxF "$line" "$gi" 2>/dev/null && return 0
  printf '%s\n' "$line" >> "$gi"
}

require() { command -v "$1" >/dev/null 2>&1 || err "$1 not found. Install: ${2:-(see your package manager)}"; }

git_move_to_vault() {
  # git_move_to_vault <repo-relative-source> <vault-relative-dest-dir>
  local src="$1" dest_dir="$2"
  local src_abs="$REPO_ROOT/$src"
  local dest_abs="$VAULT_HOME/$dest_dir"
  [[ -e "$src_abs" ]] || { skip "not present: $src"; return 0; }
  run mkdir -p "$dest_abs"
  if [[ -d "$src_abs" ]]; then
    run cp -R "$src_abs/." "$dest_abs/"
  else
    run cp "$src_abs" "$dest_abs/"
  fi
  if (cd "$REPO_ROOT" && git ls-files --error-unmatch "$src" >/dev/null 2>&1); then
    run git -C "$REPO_ROOT" rm -rq "$src"
  else
    run rm -rf "$src_abs"
  fi
  ok "moved $src -> $VAULT_NAME/$dest_dir/"
}

# ============================================================================
# Phase 1 — Prerequisites
# ============================================================================
phase_1_prereqs() {
  log "Phase 1: Install prerequisites"
  case "$PLATFORM" in
    mac)
      require brew "https://brew.sh"
      for pkg in git gh jq node syncthing; do
        if brew list --formula "$pkg" >/dev/null 2>&1; then
          skip "$pkg installed"
        else
          run brew install "$pkg" || warn "brew install $pkg failed"
        fi
      done
      ;;
    linux)
      require apt-get "Use a Debian/Ubuntu derivative"
      run sudo apt-get update -qq
      run sudo apt-get install -y git curl jq syncthing ca-certificates
      if ! command -v node >/dev/null; then
        run curl -fsSL https://deb.nodesource.com/setup_20.x | run sudo -E bash -
        run sudo apt-get install -y nodejs
      else
        skip "node installed"
      fi
      if ! command -v gh >/dev/null; then
        run sudo mkdir -p /etc/apt/keyrings
        run bash -c 'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg'
        run bash -c 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null'
        run sudo apt-get update -qq && run sudo apt-get install -y gh
      else
        skip "gh installed"
      fi
      ;;
  esac
  ok "Phase 1 done"
}

# ============================================================================
# Phase 2 — Vault scaffold
# ============================================================================
phase_2_vault() {
  log "Phase 2: Scaffold vault at $VAULT_HOME"

  for d in concepts decisions plans/active plans/completed plans/backlog \
           sources/codex-snapshots sources/workflow-renders sources/sample-artifacts \
           meta _templates .raw; do
    run mkdir -p "$VAULT_HOME/$d"
  done

  write_if_missing "$VAULT_HOME/index.md" "$(template_index)"
  write_if_missing "$VAULT_HOME/log.md" "$(template_log)"
  write_if_missing "$VAULT_HOME/hot.md" "$(template_hot)"
  write_if_missing "$VAULT_HOME/hot.$PLATFORM.md" "$(template_hot_machine)"
  write_if_missing "$VAULT_HOME/overview.md" "$(template_overview)"
  write_if_missing "$VAULT_HOME/CLAUDE.md" "$(template_vault_claude)"
  write_if_missing "$VAULT_HOME/AGENTS.md" "$(template_vault_agents)"
  write_if_missing "$VAULT_HOME/_templates/plan.md" "$(template_tpl_plan)"
  write_if_missing "$VAULT_HOME/_templates/decision.md" "$(template_tpl_decision)"
  write_if_missing "$VAULT_HOME/_templates/source.md" "$(template_tpl_source)"

  if [[ ! -L "$VAULT_LINK" && ! -e "$VAULT_LINK" ]]; then
    run ln -s "$VAULT_HOME" "$VAULT_LINK"
    ok "symlink: $VAULT_LINK -> $VAULT_HOME"
  else
    skip "$VAULT_LINK already present"
  fi

  if [[ ! -d "$VAULT_HOME/.git" ]]; then
    (cd "$VAULT_HOME" && run git init -q && run git add . && run git commit -qm "Initial vault scaffold")
    ok "vault initialized as git repo (local backup)"
  else
    skip "vault is already a git repo"
  fi

  ok "Phase 2 done"
}

# ============================================================================
# Phase 3 — Skills
# ============================================================================
phase_3_skills() {
  log "Phase 3: Install Claude wiki skills"
  local skills_root="$HOME/.claude/skills"
  local upstream="$HOME/.claude/skills-upstream/claude-obsidian"
  run mkdir -p "$skills_root" "$(dirname "$upstream")"

  if [[ -d "$upstream/.git" ]]; then
    (cd "$upstream" && run git pull -q --ff-only) && ok "updated upstream skills"
  else
    run git clone -q "$SKILLS_UPSTREAM" "$upstream" && ok "cloned upstream skills"
  fi

  local linked=0
  if [[ -d "$upstream/skills" ]]; then
    for dir in "$upstream/skills"/*/; do
      [[ -d "$dir" ]] || continue
      local name; name="$(basename "$dir")"
      local target="$skills_root/$name"
      if [[ -e "$target" && ! -L "$target" ]]; then
        warn "skill exists (not a symlink): $name — leaving alone"
        continue
      fi
      run ln -snf "$dir" "$target"
      linked=$((linked+1))
    done
    ok "linked $linked skills from upstream"
  else
    warn "upstream has no skills/ dir — installing fallback minimal skills"
    install_fallback_skills "$skills_root"
  fi

  # Link repo-local skills (project-specific, versioned alongside CLAUDE.md)
  local repo_skills="$REPO_ROOT/.claude/skills"
  if [[ -d "$repo_skills" ]]; then
    local rlinked=0
    for dir in "$repo_skills"/*/; do
      [[ -d "$dir" ]] || continue
      local name; name="$(basename "$dir")"
      local target="$skills_root/$name"
      if [[ -e "$target" && ! -L "$target" ]]; then
        warn "skill exists (not a symlink): $name — leaving alone"
        continue
      fi
      run ln -snf "$dir" "$target"
      rlinked=$((rlinked+1))
    done
    ok "linked $rlinked repo-local skills from $repo_skills"

    # Register slash-command triggers for each repo skill in ~/.claude/CLAUDE.md
    local global_claude="$HOME/.claude/CLAUDE.md"
    run mkdir -p "$(dirname "$global_claude")"
    [[ -f "$global_claude" ]] || run touch "$global_claude"
    for dir in "$repo_skills"/*/; do
      [[ -d "$dir" ]] || continue
      local name; name="$(basename "$dir")"
      if grep -qF "skill: \"$name\"" "$global_claude" 2>/dev/null; then
        skip "trigger already registered: $name"
      else
        if [[ "$DRY_RUN" == "1" ]]; then
          printf '%s[dry]%s would register trigger: %s\n' "$c_dim" "$c_reset" "$name"
        else
          printf '\n# %s\nWhen the user types `/%s`, invoke the Skill tool with `skill: "%s"` before doing anything else.\n' \
            "$name" "$name" "$name" >> "$global_claude"
          ok "registered trigger: $name"
        fi
      fi
    done
  fi

  ok "Phase 3 done"
}

install_fallback_skills() {
  local root="$1"
  for name in wiki wiki-ingest wiki-query wiki-lint save autoresearch; do
    local dir="$root/$name"
    [[ -d "$dir" ]] && { skip "fallback skill exists: $name"; continue; }
    run mkdir -p "$dir"
    if [[ "$DRY_RUN" != "1" ]]; then
      printf '%s\n' "$(template_fallback_skill "$name")" > "$dir/SKILL.md"
    fi
    ok "wrote fallback skill: $name"
  done
}

# ============================================================================
# Phase 4 — MCP server (filesystem -> vault)
# ============================================================================
phase_4_mcp() {
  log "Phase 4: Configure vault MCP server"
  local settings="$HOME/.claude/settings.json"
  run mkdir -p "$(dirname "$settings")"
  [[ -f "$settings" ]] || echo '{}' > "$settings"

  require jq
  local tmp; tmp="$(mktemp)"
  jq --arg vault "$VAULT_LINK" '
    .mcpServers //= {} |
    .mcpServers.vault = {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", $vault]
    }
  ' "$settings" > "$tmp"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '%s[dry]%s would update %s\n' "$c_dim" "$c_reset" "$settings"
    rm -f "$tmp"
  else
    mv "$tmp" "$settings"
    ok "vault MCP server registered ($settings)"
  fi
}

# ============================================================================
# Phase 5 — Session hooks
# ============================================================================
phase_5_hooks() {
  log "Phase 5: Install session hooks"
  local hooks_dir="$HOME/.claude/hooks"
  run mkdir -p "$hooks_dir"

  write_if_missing "$hooks_dir/km-session-start.sh" "$(hook_session_start)"
  write_if_missing "$hooks_dir/km-post-tool-use.sh"  "$(hook_post_tool_use)"
  write_if_missing "$hooks_dir/km-stop.sh"           "$(hook_stop)"
  [[ "$DRY_RUN" == "1" ]] || chmod +x "$hooks_dir"/km-*.sh

  local settings="$HOME/.claude/settings.json"
  [[ -f "$settings" ]] || echo '{}' > "$settings"
  require jq
  local tmp; tmp="$(mktemp)"
  jq --arg start "$hooks_dir/km-session-start.sh" \
     --arg post  "$hooks_dir/km-post-tool-use.sh" \
     --arg stop  "$hooks_dir/km-stop.sh" '
    .hooks //= {}
    | .hooks.SessionStart //= []
    | .hooks.PostToolUse  //= []
    | .hooks.Stop         //= []
    | .hooks.SessionStart = ((.hooks.SessionStart + [{command: $start}]) | unique_by(.command))
    | .hooks.PostToolUse  = ((.hooks.PostToolUse  + [{command: $post}])  | unique_by(.command))
    | .hooks.Stop         = ((.hooks.Stop         + [{command: $stop}])  | unique_by(.command))
  ' "$settings" > "$tmp"
  if [[ "$DRY_RUN" == "1" ]]; then rm -f "$tmp"; else mv "$tmp" "$settings"; fi
  ok "Phase 5 done"
}

# ============================================================================
# Phase 6 — Repo → Vault migration (PRIMARY ONLY, ONE-SHOT)
# ============================================================================
phase_6_migrate() {
  log "Phase 6: Migrate repo docs into vault"
  if [[ "$ROLE" != "primary" ]]; then skip "not primary"; return; fi
  if [[ "$SKIP_MIGRATION" == "1" ]]; then skip "--skip-migration"; return; fi
  if [[ -f "$REPO_ROOT/docs/VAULT.md" ]]; then skip "docs/VAULT.md exists — migration already done"; return; fi

  cd "$REPO_ROOT"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    err "working tree dirty — commit/stash before migration (run: git status)"
  fi

  # ---- 6a. Historical implementation plans
  log " 6a. docs/implementation-plans/  ->  vault/plans/completed/"
  if [[ -d "$REPO_ROOT/docs/implementation-plans" ]]; then
    git_move_to_vault "docs/implementation-plans" "plans/completed"
  fi

  # ---- 6b. Loose root design docs  ->  vault/concepts/
  log " 6b. Root design docs  ->  vault/concepts/"
  for f in "Design.md" "Financial Model Design.md" "UI-DESIGNER-PROMPT.md" "WORKFLOW.md" "README_FILES_SUMMARY.md"; do
    git_move_to_vault "$f" "concepts"
  done

  # ---- 6c. Loose docs/  ->  vault/concepts/
  log " 6c. docs/majestic-plotting-globe.md, docs/mockups/  ->  vault/concepts/"
  git_move_to_vault "docs/majestic-plotting-globe.md" "concepts"
  git_move_to_vault "docs/mockups" "concepts/mockups"

  # ---- 6d. local-codex/ → vault, then symlink back essentials for Codex
  log " 6d. local-codex/  ->  vault/plans/{active,backlog} + vault/concepts/ + vault/sources/codex-snapshots/"
  if [[ -d "$REPO_ROOT/local-codex" ]]; then
    # Active planning docs
    for f in Plan.md Prompt.md Implement.md Documentation.md Test-Harness-Plan.md; do
      [[ -f "$REPO_ROOT/local-codex/$f" ]] && run cp "$REPO_ROOT/local-codex/$f" "$VAULT_HOME/plans/active/$f"
    done
    # Scratch / dictation
    [[ -f "$REPO_ROOT/local-codex/Dictation.md" ]] && run cp "$REPO_ROOT/local-codex/Dictation.md" "$VAULT_HOME/plans/backlog/Dictation.md"
    # Codex orientation snapshot
    [[ -f "$REPO_ROOT/local-codex/CodeContext.md" ]] && run cp "$REPO_ROOT/local-codex/CodeContext.md" "$VAULT_HOME/sources/codex-snapshots/CodeContext-current.md"
    # Reference cheatsheets and tactical docs
    for f in CODEX-CHEATSHEET.md MODEL-SELECTION-CHEATSHEET.md test-classification.md \
             ui-cli-parity-matrix.md ui-cli-unification-plan.md \
             graphify-follow-on-recommendations.md runtime-reasoning-contract.md \
             test-inventory.json; do
      [[ -f "$REPO_ROOT/local-codex/$f" ]] && run cp "$REPO_ROOT/local-codex/$f" "$VAULT_HOME/concepts/$f"
    done

    # Remove the directory from git, then recreate as symlinks for Codex tooling
    run git -C "$REPO_ROOT" rm -rq local-codex
    run mkdir -p "$REPO_ROOT/local-codex"
    run ln -s "$VAULT_LINK/plans/active/Plan.md"                          "$REPO_ROOT/local-codex/Plan.md"
    run ln -s "$VAULT_LINK/plans/active/Prompt.md"                        "$REPO_ROOT/local-codex/Prompt.md"
    run ln -s "$VAULT_LINK/plans/active/Implement.md"                     "$REPO_ROOT/local-codex/Implement.md"
    run ln -s "$VAULT_LINK/plans/active/Documentation.md"                 "$REPO_ROOT/local-codex/Documentation.md"
    run ln -s "$VAULT_LINK/plans/backlog/Dictation.md"                    "$REPO_ROOT/local-codex/Dictation.md"
    run ln -s "$VAULT_LINK/sources/codex-snapshots/CodeContext-current.md" "$REPO_ROOT/local-codex/CodeContext.md"
    ok "local-codex/ now symlinks into vault"
  fi

  # ---- 6e. Workflow renders (svg/pdf already gitignored, just remove from disk)
  log " 6e. WORKFLOW renders  ->  vault/sources/workflow-renders/"
  for f in WORKFLOW-print-1.svg WORKFLOW-print-2.svg WORKFLOW-print-3.svg WORKFLOW-print.pdf; do
    if [[ -f "$REPO_ROOT/$f" ]]; then
      run mv "$REPO_ROOT/$f" "$VAULT_HOME/sources/workflow-renders/"
      ok "moved $f -> vault/sources/workflow-renders/"
    fi
  done

  # ---- 6f. Root sample artifact JSONs  ->  vault/sources/sample-artifacts/
  log " 6f. Root sample JSONs  ->  vault/sources/sample-artifacts/"
  for f in bundle.json resource-bundle.json intent.json plan.json manifest.json \
           request.json sim-config.json spec.json telemetry.json initial-state.json; do
    git_move_to_vault "$f" "sources/sample-artifacts"
  done

  # ---- 6g. Stale test-output dumps — delete (regenerable junk)
  log " 6g. Stale test-output dumps  ->  delete"
  for f in VALIDATION_TEST_SUMMARY.txt test-output.log test-results.txt; do
    if [[ -f "$REPO_ROOT/$f" ]]; then
      if (cd "$REPO_ROOT" && git ls-files --error-unmatch "$f" >/dev/null 2>&1); then
        run git -C "$REPO_ROOT" rm -q "$f"
      else
        run rm -f "$REPO_ROOT/$f"
      fi
      ok "deleted $f"
    fi
  done

  # ---- 6h. .gitignore updates
  log " 6h. Update .gitignore"
  ensure_gitignore "local-codex/"
  ensure_gitignore "VALIDATION_TEST_SUMMARY.txt"
  ensure_gitignore "test-output.log"
  ensure_gitignore "test-results.txt"
  ensure_gitignore "/bundle.json"
  ensure_gitignore "/resource-bundle.json"
  ensure_gitignore "/intent.json"
  ensure_gitignore "/plan.json"
  ensure_gitignore "/manifest.json"
  ensure_gitignore "/request.json"
  ensure_gitignore "/sim-config.json"
  ensure_gitignore "/spec.json"
  ensure_gitignore "/telemetry.json"
  ensure_gitignore "/initial-state.json"
  run git -C "$REPO_ROOT" add .gitignore

  # ---- 6i. Repo VAULT.md pointer
  log " 6i. Write docs/VAULT.md pointer"
  if [[ "$DRY_RUN" != "1" ]]; then
    printf '%s\n' "$(template_repo_vault_md)" > "$REPO_ROOT/docs/VAULT.md"
    run git -C "$REPO_ROOT" add docs/VAULT.md
  fi

  # ---- 6j. Append vault-aware sections to CLAUDE.md and AGENTS.md
  log " 6j. Patch CLAUDE.md and AGENTS.md with vault session-start protocol"
  append_to_claude_md
  append_to_agents_md
  run git -C "$REPO_ROOT" add CLAUDE.md AGENTS.md

  ok "Phase 6 done — review with 'git status' before committing"
}

append_to_claude_md() {
  local f="$REPO_ROOT/CLAUDE.md"
  grep -q "## Vault-Backed Knowledge Management" "$f" 2>/dev/null && { skip "CLAUDE.md already patched"; return; }
  if [[ "$DRY_RUN" != "1" ]]; then
    printf '\n%s\n' "$(template_claude_md_patch)" >> "$f"
    ok "patched CLAUDE.md"
  fi
}

append_to_agents_md() {
  local f="$REPO_ROOT/AGENTS.md"
  [[ -f "$f" ]] || return 0
  grep -q "## Vault-Backed Knowledge Management" "$f" 2>/dev/null && { skip "AGENTS.md already patched"; return; }
  if [[ "$DRY_RUN" != "1" ]]; then
    printf '\n%s\n' "$(template_agents_md_patch)" >> "$f"
    ok "patched AGENTS.md"
  fi
}

# ============================================================================
# Phase 7 — Syncthing
# ============================================================================
phase_7_syncthing() {
  log "Phase 7: Bootstrap Syncthing"
  if [[ "$SKIP_SYNCTHING" == "1" ]]; then skip "--skip-syncthing"; return; fi
  if ! command -v syncthing >/dev/null; then warn "syncthing not installed (skipping)"; return; fi

  case "$PLATFORM" in
    mac)
      run brew services start syncthing 2>/dev/null || warn "could not start syncthing via brew"
      ;;
    linux)
      run systemctl --user enable --now syncthing.service 2>/dev/null || \
        run sudo systemctl enable --now "syncthing@$(whoami).service" 2>/dev/null || \
        warn "could not start syncthing (start it manually)"
      ;;
  esac

  sleep 2
  local id; id="$(syncthing --device-id 2>/dev/null || true)"
  if [[ -n "$id" ]]; then
    ok "Syncthing running. Device ID:"
    printf '\n     %s\n\n' "$id"
    log "Next: open http://localhost:8384"
    log "      Add the OTHER machine's device ID, then add a folder for $VAULT_HOME"
  else
    warn "could not read device ID (start syncthing and run 'syncthing --device-id')"
  fi
}

# ============================================================================
# Phase 8 — Verify
# ============================================================================
phase_8_verify() {
  log "Phase 8: Verify"
  local fails=0
  check() { [[ "$1" -eq 0 ]] && ok "$2" || { warn "FAIL: $2"; fails=$((fails+1)); }; }

  [[ -L "$VAULT_LINK" ]];                      check "$?" "vault symlink ($VAULT_LINK)"
  [[ -f "$VAULT_LINK/index.md" ]];             check "$?" "vault/index.md present"
  [[ -d "$HOME/.claude/skills" ]];             check "$?" "~/.claude/skills exists"
  command -v jq >/dev/null;                    check "$?" "jq present"
  command -v node >/dev/null;                  check "$?" "node present (for npx MCP)"
  if [[ -f "$HOME/.claude/settings.json" ]]; then
    jq -e '.mcpServers.vault' "$HOME/.claude/settings.json" >/dev/null 2>&1; check "$?" "vault MCP registered"
    jq -e '.hooks.SessionStart | length > 0' "$HOME/.claude/settings.json" >/dev/null 2>&1; check "$?" "SessionStart hook registered"
  else
    warn "FAIL: ~/.claude/settings.json missing"; fails=$((fails+1))
  fi
  command -v syncthing >/dev/null;             check "$?" "syncthing installed"

  if [[ "$ROLE" == "primary" ]]; then
    [[ -f "$REPO_ROOT/docs/VAULT.md" ]];       check "$?" "docs/VAULT.md present"
    [[ -L "$REPO_ROOT/local-codex/Plan.md" ]]; check "$?" "local-codex/Plan.md is a symlink"
  fi

  [[ "$fails" -eq 0 ]] || err "$fails verification(s) failed"
  ok "All checks passed"
}

# ============================================================================
# Templates (heredocs)
# ============================================================================

template_index() { cat <<'EOF'
# Vault Index — agent-kernel

> The compounding wiki for this project. Code is the truth for *what is*; this vault is the truth for *why we did it*.

## Hot context
- [hot.md](hot.md) — last-session summary; Claude reads this first.

## Areas
- [concepts/](concepts/) — design patterns, mental models, ingested cheatsheets
- [decisions/](decisions/) — ADR-style decisions with contradictions flagged
- [plans/active/](plans/active/) — current Plan / Prompt / Implement (symlinked from repo `local-codex/`)
- [plans/completed/](plans/completed/) — historical milestone plans
- [plans/backlog/](plans/backlog/) — dictation, future ideas
- [sources/](sources/) — ingested documents, graphify snapshots, sample artifacts
- [meta/](meta/) — Bases dashboards
- [_templates/](_templates/) — Templater templates for plans, decisions, sources

## See also
- [overview.md](overview.md) — executive summary
- [log.md](log.md) — append-only operation log
- [CLAUDE.md](CLAUDE.md) — vault-local instructions for Claude
- [AGENTS.md](AGENTS.md) — vault-local instructions for Codex
EOF
}

template_log() { cat <<'EOF'
# Vault Log

Append-only operation log. Newest entries at the bottom. Hooks update this on Stop.

| timestamp | machine | event | detail |
|-----------|---------|-------|--------|
EOF
}

template_hot() { cat <<'EOF'
# Hot Cache (merged)

Auto-merged from `hot.mac.md` and `hot.linux.md` by the SessionStart hook.
Empty until the first session writes to a per-machine cache.
EOF
}

template_hot_machine() { cat <<EOF
# Hot Cache — $PLATFORM

Per-machine recent-session context. The Stop hook updates this; SessionStart on the *other*
machine reads it through the merged \`hot.md\`. Keep entries terse and scoped to "what's in flight".
EOF
}

template_overview() { cat <<'EOF'
# Overview — agent-kernel

Two-paragraph executive summary kept up to date by hand. Updated whenever a milestone lands or scope shifts.

## What this project is
core-ts-first simulation kernel using Ports & Adapters with deterministic persona state machines.
Implements an authoring + simulation pipeline for dungeon delving. See repo `docs/vision-contract.md`
and `docs/architecture-charter.md` for the binding contracts.

## Where things live
- **Code** — repo `packages/`
- **Code structure (live)** — CodeGraphContext MCP queries
- **Code structure (snapshot)** — repo `graphify-out/wiki/`
- **Decisions / history / planning** — this vault
EOF
}

template_vault_claude() { cat <<'EOF'
---
description: Vault-local instructions for Claude inside the agent-kernel knowledge vault
---

# CLAUDE.md (vault)

You are inside the agent-kernel knowledge vault. The repo lives elsewhere; this vault is the
*compounding wiki* — decisions, plans, rationale, ingested sources.

## Rules

1. **Code is not here.** Do not write production code in this vault. If a question requires
   code, switch to the agent-kernel repo.
2. **One-way ingest.** Vault may cite graphify/CCG nodes. Vault never *generates* code structure.
3. **Hot cache discipline.** Update this machine's `hot.<platform>.md` at session end. Keep entries
   terse and current; old entries belong in `log.md`.
4. **Cite stable IDs.** When referencing code, use `[[ccg://<package>/<path>]]` or
   `[[graphify://community/<name>]]` — these are checked by `wiki-lint`.
5. **Append, don't overwrite, decisions.** A new decision that supersedes an older one creates a
   *new* file in `decisions/` with a `supersedes:` frontmatter field, and the older file gets a
   `superseded-by:` field. Never delete history.

## Slash commands available here
- `/wiki <topic>` — query the vault first
- `/save` — file the current conversation as a vault note
- `/autoresearch <topic>` — 3-round autonomous research
- `/canvas <topic>` — visual map for FSM / persona flows
EOF
}

template_vault_agents() { cat <<'EOF'
# AGENTS.md (vault)

Working agreement for Codex when reading from this vault.

- Codex's active plan lives at `plans/active/Plan.md`. The repo's `local-codex/Plan.md` is a
  symlink to this file.
- `plans/active/Prompt.md` is the current working prompt; same symlink rule.
- `sources/codex-snapshots/CodeContext-current.md` is the per-handoff orientation snapshot Claude
  generates; old snapshots may live alongside it as `CodeContext-YYYY-MM-DD-topic.md`.
- Cheatsheets are in `concepts/CODEX-CHEATSHEET.md` and `concepts/MODEL-SELECTION-CHEATSHEET.md`.
- Codex does not write to `decisions/` directly — those are produced through Claude with `/save`.
EOF
}

template_tpl_plan() { cat <<'EOF'
---
type: plan
status: active
created: {{date}}
---

# Plan: <title>

## Summary
## Milestones
### M1 - <name>
- Size band: S/M/L
- Assigned agent: <agent>
- Target files:
- Tests:
- Success criteria:
- Validation command:
- Stop condition:
EOF
}

template_tpl_decision() { cat <<'EOF'
---
type: decision
date: {{date}}
status: accepted
supersedes:
superseded-by:
---

# Decision: <title>

## Context
## Decision
## Consequences
## Alternatives rejected
## Affected code
- [[ccg://...]]
- [[graphify://...]]
EOF
}

template_tpl_source() { cat <<'EOF'
---
type: source
ingested: {{date}}
url:
---

# Source: <title>

## Why captured
## Key claims
## Cross-references
EOF
}

template_fallback_skill() {
  local name="$1"
  cat <<EOF
---
name: $name
description: Vault skill stub for '$name'. Replace with the upstream Karpathy implementation when network is available.
---

# $name (fallback stub)

This is a placeholder generated by setup-km.sh because the upstream skills repo could not be cloned.
Re-run \`bash scripts/setup/setup-km.sh --phase=3\` once network access is available to install the
real skill from the Karpathy LLM-Wiki implementation.
EOF
}

hook_session_start() { cat <<'EOF'
#!/usr/bin/env bash
# Vault SessionStart hook — orient Claude with vault hot.md before tool use.
set -euo pipefail
VAULT="${HOME}/vault"
[[ -d "$VAULT" ]] || exit 0

# Merge per-machine hot caches into hot.md (newest first)
{
  printf '# Hot Cache (merged %s)\n\n' "$(date -u +%FT%TZ)"
  for f in "$VAULT"/hot.*.md; do
    [[ -f "$f" ]] || continue
    printf '\n## From %s\n\n' "$(basename "$f")"
    cat "$f"
  done
} > "$VAULT/hot.md.tmp"
mv "$VAULT/hot.md.tmp" "$VAULT/hot.md"
exit 0
EOF
}

hook_post_tool_use() { cat <<'EOF'
#!/usr/bin/env bash
# Vault PostToolUse hook — auto-commit vault changes to its local git backup.
set -euo pipefail
VAULT="${HOME}/vault"
[[ -d "$VAULT/.git" ]] || exit 0
cd "$VAULT"
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  git add -A
  git commit -qm "auto: post-tool-use $(date -u +%FT%TZ)" || true
fi
exit 0
EOF
}

hook_stop() { cat <<'EOF'
#!/usr/bin/env bash
# Vault Stop hook — append session summary to log.md and refresh per-machine hot cache.
set -euo pipefail
VAULT="${HOME}/vault"
[[ -d "$VAULT" ]] || exit 0
case "$(uname -s)" in
  Darwin) PLAT=mac ;;
  Linux)  PLAT=linux ;;
  *)      PLAT=other ;;
esac
TS="$(date -u +%FT%TZ)"
printf '| %s | %s | session-stop | (auto) |\n' "$TS" "$PLAT" >> "$VAULT/log.md"
# Touch the per-machine hot cache so we know last activity (Claude can write into it directly during the session)
touch "$VAULT/hot.$PLAT.md"
if [[ -d "$VAULT/.git" ]]; then
  cd "$VAULT" && git add -A && git commit -qm "auto: stop $TS" || true
fi
exit 0
EOF
}

template_repo_vault_md() { cat <<'EOF'
# Vault

Non-load-bearing knowledge for this project lives in an Obsidian vault outside the repo.

- **Vault path (Mac):**     `~/Documents/Obsidian/agent-kernel-vault/`
- **Vault path (Linux):**   `~/agent-kernel-vault/`
- **Stable symlink:**       `~/vault/` (both machines)
- **Sync:**                 Syncthing peer-to-peer
- **MCP server:**           `@modelcontextprotocol/server-filesystem` pointed at `~/vault`

## What's in the vault

- `concepts/`  — design patterns, mental models, ingested cheatsheets, mockups
- `decisions/` — ADR-style records of architectural choices
- `plans/active/`, `plans/completed/`, `plans/backlog/` — current, historical, and future planning material
- `sources/`   — ingested external documents, graphify snapshots, sample artifact JSONs

## What's *not* in the vault

- All code (`packages/`)
- The architecture charter, vision contract, runbooks, reference handout (under `docs/`)
- Live code-structure graphs (`graphify-out/`, CodeGraphContext MCP)
- CLAUDE.md, AGENTS.md, README.md, RUNME.MD

## Setup

`bash scripts/setup/setup-km.sh` (idempotent; runs on Mac and Ubuntu).

See `scripts/setup/README.md` for full instructions.
EOF
}

template_claude_md_patch() { cat <<'EOF'
---

## Vault-Backed Knowledge Management

Non-load-bearing knowledge — historical plans, design rationale, dictation, scratch notes — lives in
an Obsidian vault outside this repo. Code-binding contracts (charter, vision, runbooks) stay here.

### Session-start orientation order (revised)

1. Read `~/vault/hot.md`           — last-session compounding context
2. Read `~/vault/index.md`         — vault catalog (only if `hot.md` is sparse)
3. Read `graphify-out/wiki/index.md` — code-organization map
4. Query CodeGraphContext MCP just-in-time for the area you're touching

### Vault paths

- **Mac:**     `~/Documents/Obsidian/agent-kernel-vault/`
- **Linux:**   `~/agent-kernel-vault/`
- **Both:**    `~/vault` (symlink) — use this in any path you cite

### Repo-vault interaction

- `local-codex/Plan.md`, `Prompt.md`, `Implement.md`, `Documentation.md`, `Dictation.md`,
  `CodeContext.md` are **symlinks** into the vault. Read/write them as before — they resolve to
  `~/vault/plans/active/...` and `~/vault/sources/codex-snapshots/...`.
- Decisions live in `~/vault/decisions/`. When you make a non-trivial design call, save it via
  `/save` so it lands there.
- When citing code from a vault note, use stable IDs: `[[ccg://<pkg>/<path>]]` or
  `[[graphify://community/<name>]]`. `wiki-lint` validates these on demand.

### What does NOT belong in the vault

Code, tests, fixtures, build outputs, package READMEs, the architecture charter, vision contract,
CLI runbook, reference handout, or anything else that would break a build/test/agent-workflow if
moved. The test "would breaking this doc break a build, test, or agent workflow?" still applies.

### Setup / sync

- Initial setup: `bash scripts/setup/setup-km.sh`
- Sync: Syncthing peer-to-peer between Mac and Ubuntu (manual pairing once)
- Per-machine `hot.mac.md` / `hot.linux.md`; merged into `hot.md` by SessionStart hook
EOF
}

template_agents_md_patch() { cat <<'EOF'
---

## Vault-Backed Knowledge Management

This repo is paired with an Obsidian vault that holds non-load-bearing knowledge. The
`local-codex/` directory in this repo is **symlinks** into the vault — all reads and writes
to `local-codex/Plan.md`, `Prompt.md`, `Implement.md`, `Documentation.md`, `Dictation.md`,
and `CodeContext.md` transparently target `~/vault/plans/active/...` and
`~/vault/sources/codex-snapshots/...`.

For Codex specifically:
- Active plan: `local-codex/Plan.md` (= `~/vault/plans/active/Plan.md`)
- Active prompt: `local-codex/Prompt.md` (= `~/vault/plans/active/Prompt.md`)
- Orientation snapshot: `local-codex/CodeContext.md`
- Cheatsheets: `~/vault/concepts/CODEX-CHEATSHEET.md`,
  `~/vault/concepts/MODEL-SELECTION-CHEATSHEET.md`

Decisions made during a session are saved via Claude's `/save` to `~/vault/decisions/`.
Codex reads decisions but does not author them directly.

Setup: `bash scripts/setup/setup-km.sh` on each machine. Migration runs once on the Mac
(primary) and is propagated to the Ubuntu box via `git pull`.
EOF
}

# ============================================================================
# Main
# ============================================================================

PHASES=(phase_1_prereqs phase_2_vault phase_3_skills phase_4_mcp phase_5_hooks phase_6_migrate phase_7_syncthing phase_8_verify)

main() {
  parse_args "$@"
  detect_platform

  if [[ "${#PHASES_TO_RUN[@]}" -eq 0 ]]; then
    PHASES_TO_RUN=("${PHASES[@]}")
  else
    local mapped=()
    for p in "${PHASES_TO_RUN[@]}"; do
      if [[ "$p" =~ ^[0-9]+$ ]]; then
        local idx=$((p-1))
        [[ "$idx" -ge 0 && "$idx" -lt "${#PHASES[@]}" ]] || err "phase $p out of range (1..${#PHASES[@]})"
        mapped+=("${PHASES[$idx]}")
      else
        mapped+=("$p")
      fi
    done
    PHASES_TO_RUN=("${mapped[@]}")
  fi

  for phase in "${PHASES_TO_RUN[@]}"; do
    echo
    "$phase"
  done

  echo
  log "All phases complete."
  log "Next manual steps:"
  log "  1. Open Syncthing UI on both machines (http://localhost:8384) and pair them"
  log "  2. Add ~/vault as a shared folder in Syncthing"
  if [[ "$ROLE" == "primary" ]]; then
    log "  3. Review repo changes:  git -C $REPO_ROOT status"
    log "  4. Commit & push: git commit -m 'chore(km): migrate non-essential docs to vault' && git push"
    log "  5. On Ubuntu: git pull, then bash scripts/setup/setup-km.sh --secondary"
  else
    log "  3. Verify vault content arrives via Syncthing"
    log "  4. Verify local-codex/Plan.md resolves: ls -l $REPO_ROOT/local-codex/Plan.md"
  fi
}

main "$@"

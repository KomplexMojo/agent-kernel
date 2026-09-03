# Knowledge Management Setup

`setup-km.sh` provisions the Obsidian-vault-backed knowledge system for this repo on
**macOS** (primary) and **Ubuntu** (secondary). It is **idempotent** — re-running it
fixes drift rather than duplicating state.

## What this is for

The repo keeps load-bearing source, tests, fixtures, and architecture docs in git. Long-lived working notes, active plans, snapshots, and non-load-bearing research live in the paired Obsidian vault. This script wires those two worlds together so local agent workflows can read and update `local-codex/*` paths while the content actually lives in `~/vault`.

Run this when setting up a new machine, repairing vault symlinks, refreshing Claude/Obsidian skills, or validating the knowledge-management setup.

## What it sets up

1. **Prerequisites** — `git`, `gh`, `jq`, `node` (via Homebrew on Mac, `apt` on Ubuntu).
2. **Vault scaffold** at `~/Documents/Obsidian/agent-kernel-vault/` (Mac) or
   `~/agent-kernel-vault/` (Linux), with a `~/vault` symlink for path normalization.
   Layout follows the Karpathy LLM-Wiki pattern: `index.md`, `concepts/`, `decisions/`,
   `plans/{active,completed,backlog}/`, `sources/`, `_templates/`.
   *(The pattern's `hot.md` hot cache and `log.md` operation log were removed 2026-08-18 —
   see the note in the repo `CLAUDE.md`.)*
3. **Skills** — clones the Karpathy `claude-obsidian` skills suite (wiki, wiki-ingest,
   wiki-query, wiki-lint, save, autoresearch, …) into `~/.claude/skills-upstream/`
   and symlinks each skill into `~/.claude/skills/`.
4. **MCP** — registers `@modelcontextprotocol/server-filesystem` against `~/vault`
   in `~/.claude/settings.json` so Claude can query / edit the vault.
6. **Repo migration** *(primary only, one-shot)* — moves all non-load-bearing docs out of
   the repo and into the vault:
   - `docs/implementation-plans/` → `vault/plans/completed/`
   - Loose root design docs (`Design.md`, `Financial Model Design.md`,
     `UI-DESIGNER-PROMPT.md`, `WORKFLOW.md`, `README_FILES_SUMMARY.md`) → `vault/concepts/`
   - `docs/majestic-plotting-globe.md`, `docs/mockups/` → `vault/concepts/`
   - `local-codex/*` → `vault/plans/{active,backlog}/`, `vault/sources/codex-snapshots/`,
     `vault/concepts/`; `local-codex/` is recreated as **symlinks back into the vault** so
     Codex tooling keeps working unchanged
   - `WORKFLOW-print*.{svg,pdf}` → `vault/sources/workflow-renders/`
   - Root-level sample artifact JSONs → `vault/sources/sample-artifacts/`
   - Stale test-output dumps → deleted
   - `.gitignore` updated to keep these from re-entering the repo
   - `docs/VAULT.md` written as a pointer
   - `CLAUDE.md` and `AGENTS.md` patched with vault-aware session-start protocol
8. **Verify** — sanity checks each component.

> **Phases 5 and 7 no longer exist.** Both were Syncthing (the `.stignore` guard and the
> daemon bootstrap) and were removed 2026-08-21 along with Syncthing itself. The remaining
> phases keep their original numbers, so `--phase=6` and `--phase=8` still mean what they
> say; `--phase=5` and `--phase=7` now fail with an explicit message.

## Usage

Choose exactly one role:

- **Primary Mac**: owns the one-time repo migration and pushes the resulting git changes.
- **Secondary Ubuntu**: installs the same tooling and gets its **own local vault**. Nothing replicates between machines — see *No replication* below.

### One-time on the Mac (primary)

```bash
cd ~/Documents/GitHub/agent-kernel
bash scripts/setup/setup-km.sh
```

The script will:
- Install prereqs
- Create the vault and symlinks
- Install skills + MCP
- **Migrate** the repo (only if working tree is clean)

After the script finishes:
1. Review the repo diff: `git status`
2. Commit and push:
   ```bash
   git add -A
   git commit -m "chore(km): migrate non-essential docs to vault"
   git push
   ```

### One-time on Ubuntu (secondary)

After the Mac has pushed the migration:

```bash
cd ~/path/to/agent-kernel
git pull --ff-only
bash scripts/setup/setup-km.sh --secondary
```

This installs prereqs, scaffolds an empty vault locally, and installs skills + MCP. **It does
*not* re-run the migration** — that already happened on the Mac and is now in git.

`local-codex/Plan.md` (a symlink in the repo) will resolve to *that machine's* vault file.

### No replication (since 2026-08-21)

Syncthing is gone, and nothing has replaced it. Each machine's `~/vault` is independent:
a plan edited on the Mac does not appear on Ubuntu. **Anything a second machine needs must
be in git.** Syncthing was removed because its original justification — keeping benchmark
material consistent across devices — no longer held (no benchmark content has lived in the
vault for some time; the catalog is Git-owned on `codex/benchmark-catalog`), while it kept
producing sync-conflict copies of the very handoff file it existed to carry.

## Flags

| Flag | Effect |
|---|---|
| `--primary` | Force primary (run migration) |
| `--secondary` | Force secondary (skip migration) |
| `--skip-migration` | Skip phase 6 even on primary |
| `--phase=N` | Run only phase N (1, 2, 3, 4, 6, 8). Repeatable. |
| `--dry-run` | Print what would happen, don't execute destructive ops |
| `--help` | Show usage |

## Re-running individual phases

```bash
# Just refresh the skills from upstream
bash scripts/setup/setup-km.sh --phase=3

# Re-validate everything
bash scripts/setup/setup-km.sh --phase=8
```

## Manual steps the script can't automate

- **Obsidian app install** (Mac only, optional) — the vault works without Obsidian since MCP
  reads raw markdown. Install Obsidian if you want a GUI for browsing.
- **`gh auth login`** — if you haven't already, run this so the script's git pushes work.

## Rollback

The migration is one-shot and gated by the presence of `docs/VAULT.md`. To roll it back:

```bash
git revert <migration-commit>
rm -rf ~/vault                       # only if you want to discard vault content
```

⚠️ **The vault has no git history to recover from, and now no replica either.** `~/vault/.git`
was a repo *inside* the replicated folder and was corrupted by file-by-file replication
(zeroed `refs/heads/master`, 48 conflict copies inside `.git`, 23,167 objects orphaned); it
was retired 2026-08-18 to `~/vault/.retired/km-log-and-git-20260818/`. With Syncthing removed
2026-08-21 the vault has **no backup of any kind** — not even a second machine's copy.
⇒ *Copy anything important out before a long edit, and keep durable material in git.* A real
backup would be a bare repo outside the vault — still not built.

## Troubleshooting

- **`jq: command not found`** — re-run with `--phase=1` to install prereqs
- **Migration aborts with "working tree dirty"** — commit or stash your changes first
- **Vault appears empty on Ubuntu** — expected: vaults are machine-local and nothing
  replicates. Populate it from git or copy the files across by hand.
- **Codex can't find `local-codex/Plan.md`** — verify the symlink: `ls -l local-codex/Plan.md`
  should show `-> /Users/<you>/vault/plans/active/Plan.md`

---

# Serena & Graphify under Cursor

`CLAUDE.md` documents Serena and Graphify for **Claude Code**, where Serena is registered as
an MCP server in `~/.claude/settings.json` and Graphify runs from the maintainer's Mac. When
this repo is worked on from **Cursor** (IDE or cloud agents), the wiring is different. This
section records the outcome of validating both tools for Cursor and how to set them up.

## Do we still need them under Cursor?

- **Serena — yes.** Cursor's agent exposes ripgrep/glob/read (plus the `explore` subagent) but
  not LSP-precise structural queries. Serena's `find_referencing_symbols` / `find_symbol` /
  `find_implementations` remain the only accurate way to answer "who calls / imports this
  symbol" — the port→adapter blast-radius question this repo's architecture discipline depends
  on. It is worth keeping, and must be wired into Cursor explicitly (it is not automatic).
- **Graphify — yes, but nothing Cursor-specific to install.** Graphify's value is the committed
  `graphify-out/GRAPH_REPORT.md`, which the agent reads with ordinary file tools identically in
  Cursor and Claude Code. The `graphify` package itself is private (not on PyPI; pinned to the
  maintainer's Mac via `graphify-out/.graphify_python`), so **regeneration stays a maintainer
  task on that machine** — `graph.json` / `graph.html` are gitignored and cannot be rebuilt on a
  cloud agent. No Cursor wiring is required to *consume* the report.

## Serena setup for Cursor

Serena is a stdio MCP server. Cursor has **two independent surfaces**, and the repo gitignores
`mcp.json`, so no MCP config is committed — you provide it per surface:

1. **Cursor IDE (local).** Copy `.cursor/mcp.serena.example.json` to either `~/.cursor/mcp.json`
   (all projects) or `.cursor/mcp.json` (this project only; stays untracked). It runs
   `serena start-mcp-server --context ide-assistant --project ${workspaceFolder}`.

2. **Cursor cloud agents.** Cloud agents do **not** read `.cursor/mcp.json`. Two things are
   required:
   - **VM readiness (automated).** `.cursor/install.sh` installs `uv`, `uv tool install
     serena-agent`, and re-applies `patch-serena-ignored-dirs.py` on every boot, and puts
     `~/.local/bin` on `PATH`. So the `serena` command can boot in the agent VM.
   - **Dashboard registration (manual, one-time).** Register the server in the Cursor dashboard
     under **Integrations & MCP** (personal) or **Team → Integrations & MCP**. Use transport
     **stdio**, command `serena`, args
     `start-mcp-server --context ide-assistant --project /workspace` (this repo's cloud agents
     check out at `/workspace`). Until this is done, cloud agents will not see Serena's tools.

The TypeScript/JSON language servers Serena needs are downloaded automatically on first use
(they land in `~/.serena/language_servers/`). Egress to the npm registry must be allowed at that
time.

⚠️ Re-apply the ignored-dirs patch after any Serena upgrade — see the header of
`patch-serena-ignored-dirs.py`. `install.sh` does this each boot; if you upgrade Serena by hand,
run `python3 scripts/setup/patch-serena-ignored-dirs.py` yourself and restart the MCP server.

## Graphify under Cursor

Read `graphify-out/GRAPH_REPORT.md` directly — no setup needed. To regenerate the graph you need
the private `graphify` package on the machine recorded in `graphify-out/.graphify_python`
(currently the maintainer's Mac); run `graphify update . && python3
scripts/setup/regenerate-graph-viz.py` there. This cannot be done on a cloud agent.

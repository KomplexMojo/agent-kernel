# Knowledge Management Setup

`setup-km.sh` provisions the Obsidian-vault-backed knowledge system for this repo on
**macOS** (primary) and **Ubuntu** (secondary). It is **idempotent** — re-running it
fixes drift rather than duplicating state.

## What this is for

The repo keeps load-bearing source, tests, fixtures, and architecture docs in git. Long-lived working notes, active plans, snapshots, and non-load-bearing research live in the paired Obsidian vault. This script wires those two worlds together so local agent workflows can read and update `local-codex/*` paths while the content actually lives in `~/vault`.

Run this when setting up a new machine, repairing vault symlinks, refreshing Claude/Obsidian skills, or validating the knowledge-management hooks.

## What it sets up

1. **Prerequisites** — `git`, `gh`, `jq`, `node`, `syncthing` (via Homebrew on Mac,
   `apt` on Ubuntu).
2. **Vault scaffold** at `~/Documents/Obsidian/agent-kernel-vault/` (Mac) or
   `~/agent-kernel-vault/` (Linux), with a `~/vault` symlink for path normalization.
   Layout follows the Karpathy LLM-Wiki pattern: `index.md`, `log.md`, `hot.md`,
   per-machine `hot.<platform>.md`, `concepts/`, `decisions/`, `plans/{active,completed,backlog}/`,
   `sources/`, `_templates/`.
3. **Skills** — clones the Karpathy `claude-obsidian` skills suite (wiki, wiki-ingest,
   wiki-query, wiki-lint, save, autoresearch, …) into `~/.claude/skills-upstream/`
   and symlinks each skill into `~/.claude/skills/`.
4. **MCP** — registers `@modelcontextprotocol/server-filesystem` against `~/vault`
   in `~/.claude/settings.json` so Claude can query / edit the vault.
5. **Session hooks** — installs and registers three hooks in `~/.claude/hooks/`:
   - `SessionStart`: merges per-machine hot caches into `hot.md`
   - `PostToolUse`: auto-commits vault edits to the vault's local git backup
   - `Stop`: appends a session entry to `log.md`, refreshes per-machine hot cache
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
7. **Syncthing** — installs and starts, prints this device's ID. Pairing between machines
   is manual via http://localhost:8384 (Syncthing's API doesn't have a stable scripted
   pairing flow).
8. **Verify** — sanity checks each component.

## Usage

Choose exactly one role:

- **Primary Mac**: owns the one-time repo migration and pushes the resulting git changes.
- **Secondary Ubuntu**: installs the same tooling and waits for Syncthing to fill the vault.

### One-time on the Mac (primary)

```bash
cd ~/Documents/GitHub/agent-kernel
bash scripts/setup/setup-km.sh
```

The script will:
- Install prereqs
- Create the vault and symlinks
- Install skills + MCP + hooks
- **Migrate** the repo (only if working tree is clean)
- Start Syncthing and print this Mac's device ID

After the script finishes:
1. Review the repo diff: `git status`
2. Commit and push:
   ```bash
   git add -A
   git commit -m "chore(km): migrate non-essential docs to vault"
   git push
   ```
3. Pair Syncthing with the Ubuntu box (web UI) and add `~/vault` as a shared folder.

### One-time on Ubuntu (secondary)

After the Mac has pushed the migration:

```bash
cd ~/path/to/agent-kernel
git pull --ff-only
bash scripts/setup/setup-km.sh --secondary
```

This installs prereqs, scaffolds an empty vault locally (Syncthing will fill it), installs
skills + MCP + hooks, and starts Syncthing. **It does *not* re-run the migration** — that
already happened on the Mac and is now in git.

Once Syncthing pairs and syncs, the Ubuntu vault will mirror the Mac's, and
`local-codex/Plan.md` (a symlink in the repo) will resolve to the synced vault file.

## Flags

| Flag | Effect |
|---|---|
| `--primary` | Force primary (run migration) |
| `--secondary` | Force secondary (skip migration) |
| `--skip-migration` | Skip phase 6 even on primary |
| `--skip-syncthing` | Skip Syncthing install / start |
| `--phase=N` | Run only phase N (1..8). Repeatable. |
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

- **Syncthing device pairing** — open http://localhost:8384 on both machines, copy device IDs
  across, and accept the pairing prompts. Then add `~/vault` as a shared folder pointing at
  each machine's vault path.
- **Obsidian app install** (Mac only, optional) — the vault works without Obsidian since MCP
  reads raw markdown. Install Obsidian if you want a GUI for browsing.
- **`gh auth login`** — if you haven't already, run this so the script's git pushes work.

## Rollback

The migration is one-shot and gated by the presence of `docs/VAULT.md`. To roll it back:

```bash
git revert <migration-commit>
rm -rf ~/vault                       # only if you want to discard vault content
```

The vault has its own internal git history (see `~/vault/.git/`) so even after rollback,
content can be recovered from there.

## Troubleshooting

- **`jq: command not found`** — re-run with `--phase=1` to install prereqs
- **`syncthing --device-id` returns nothing** — Syncthing isn't running yet; start it
  manually (`brew services start syncthing` / `systemctl --user start syncthing`)
- **Migration aborts with "working tree dirty"** — commit or stash your changes first
- **Vault appears empty on Ubuntu** — Syncthing isn't paired yet; check the web UI
- **Codex can't find `local-codex/Plan.md`** — verify the symlink: `ls -l local-codex/Plan.md`
  should show `-> /Users/<you>/vault/plans/active/Plan.md`

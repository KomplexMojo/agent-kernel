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

1. **Cursor IDE (local).** Copy the `serena` block from `.cursor/mcp.example.json` into either
   `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (this project only; stays untracked).
   It runs `serena start-mcp-server --context ide-assistant --project ${workspaceFolder}`.

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

---

# agent-kernel CLI & MCP under Cursor

The repo ships its own tool surface: the `ak` CLI and the `agent-kernel-cli` MCP server (the
structured-tool version of the CLI — 49 `ak_*` tools for authoring, simulation, inspection, LLM
planning, IPFS, blockchain, and the `ak_test_*` harness). Full tool reference:
`packages/adapters-cli/src/mcp/README.md`.

Both import `.ts` modules directly, so they need **Node ≥ 22.18** (native type stripping) — the same
requirement `.cursor/install.sh` already satisfies on cloud agents, and that your Mac's `node` must
also meet. Run `pnpm install` once so the MCP server's deps (`@modelcontextprotocol/sdk`, `ws`,
`z3-solver`) are present.

## CLI — run it directly

The CLI is plain shell; a Cursor agent runs it the same way you would:

```bash
node packages/adapters-cli/src/cli/ak.mjs create \
  --room "size=small;count=1" \
  --delver "count=1;affinity=fire;motivation=attacking" \
  --warden "count=1;affinity=dark;motivation=defending"
pnpm run demo:cli     # fixture-driven CLI walkthrough
pnpm run mcp:serve    # start the MCP server manually (stdio)
```

The package also exposes `ak-persona` and `ak-mcp` bins:
`pnpm --dir packages/adapters-cli exec ak-persona --help`.

## MCP — register `agent-kernel-cli`

The server is stdio (`node packages/adapters-cli/src/mcp/server.mjs`). As with Serena, Cursor has two
surfaces and `mcp.json` is gitignored, so nothing is committed as the live config:

1. **Cursor IDE (local).** Copy the `agent-kernel-cli` block from `.cursor/mcp.example.json` into
   `~/.cursor/mcp.json` or `.cursor/mcp.json`. The bundled `NODE_OPTIONS`
   (`--experimental-strip-types --disable-warning=ExperimentalWarning`) let it start even under an
   older `node` on PATH; on Node ≥ 22.18 they are harmless no-ops.

2. **Cursor cloud agents.** Cloud agents do **not** read `.cursor/mcp.json`. Register the server in the
   Cursor dashboard under **Integrations & MCP** (personal) or **Team → Integrations & MCP**:
   transport **stdio**, command `node`, args
   `/workspace/packages/adapters-cli/src/mcp/server.mjs`, and env
   `NODE_OPTIONS=--experimental-strip-types --disable-warning=ExperimentalWarning` (guards against the
   VM's default older `node` shim). `.cursor/install.sh` already makes the VM ready (`pnpm install`
   + native-TS node). Until this dashboard step is done, cloud agents won't see the `ak_*` tools.

Verify a registration by listing tools — the server reports `name: "agent-kernel-cli"` and 49 tools;
`tools/call ak_create {…, "dryRun": true}` returns a validated result without writing artifacts. The
`tools/list` handshake snippet is in `packages/adapters-cli/src/mcp/README.md`.

---

# Bridging CLAUDE.md guidance to Cursor

`AGENTS.md` is read natively by Cursor (IDE and cloud), so its roster, workflow, file placement,
naming, test/benchmark strategy, and pre-handoff checklist need no porting. **`CLAUDE.md` is not a
Cursor rule source** — content that lives only there is invisible to Cursor agents. The load-bearing
sections are therefore bridged into Cursor-native files:

| CLAUDE.md section | Cursor bridge | How it loads |
| --- | --- | --- |
| Reporting protocol | `.cursor/rules/reporting.mdc` | always-on (`alwaysApply: true`) |
| Enforcement checklist + escalation | `.cursor/rules/enforcement.mdc` | auto-attaches on `packages/**`, `tests/**` |
| Code navigation (Serena/Graphify/grep) | `.cursor/rules/code-navigation.mdc` | pulled in when relevant (`description`) |
| Session-start protocol | `.cursor/rules/session-start.mdc` + `scripts/setup/session-refresh.sh` | always-on |

Rules must use the `.mdc` extension with frontmatter — a plain `.md` under `.cursor/rules/` is ignored.

## Skills

Cloud slash inventory for this repo is four skills. Each has a Cursor-native entry under
`.cursor/skills/` (`.claude/skills/` remains the canonical home for scripts / Claude harnesses):

| Skill | Path | Notes |
| --- | --- | --- |
| `/farm-remote` | `.cursor/skills/farm-remote/` | Manual only (`disable-model-invocation`) — remote Ollama farming |
| `/local-test-gen` | `.cursor/skills/local-test-gen/` | Manual only — wraps `.claude/skills/local-test-gen/scripts/main.mjs` |
| `structured-test-authoring` | `.cursor/skills/structured-test-authoring/` | Uses agent-kernel-cli `ak_test_*` MCP tools |
| `tiered-test-optimizer` | `.cursor/skills/tiered-test-optimizer/` | Orchestrates Cursor `fast-pass` → `fix-pass` |

## Subagents

`.claude/agents/*.md` load in Cursor for compatibility, but their Claude model pins (Haiku/Opus/
Sonnet) don't map to Cursor models. Cursor-native overrides pin valid Cursor models (`.cursor/`
wins over `.claude/` on name conflict):

- `.cursor/agents/fast-pass.md` — detection-only test run, `model: composer-2.5`, `readonly: true`.
- `.cursor/agents/fix-pass.md` — diagnosis/fix pass, `model: claude-opus-5[effort=high]`.
- **codex-reviewer** is **not** ported: its `.claude` version shells out to the Codex plugin runtime
  (Claude Code only), and Cursor already provides a native `codex-reviewer` subagent. Use that.

Adjust the pinned model IDs to your plan's available models via the in-app model picker if needed.

## Not portable

The Obsidian vault / knowledge-management workflow (`local-codex/*`, `~/vault`, `/save`) is
machine-local to the maintainer's Mac and has no cloud-agent equivalent; it is intentionally not
bridged.

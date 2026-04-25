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

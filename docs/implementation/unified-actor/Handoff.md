# Cloud handoff — unified actor rewrite

## Start here

Repository: `KomplexMojo/agent-kernel`. Select branch `codex/unified-actor`, or the
published handoff commit. Do not start from main or the original base commit:
they do not contain milestones 1–2. The original rewrite base was
`9a9168f8c63b07b1e9e789daa598a6edaa061cbd`.

**UA.1 (contracts) and UA.2 (registry component) are complete. UA.3 is next.**
The new registry is NOT wired into `createCore` or runtime. Existing JavaScript
still produces legacy shapes. Passing component tests does not prove the new
mechanics execute in the game. Do not merge this partial rewrite into main.

Read these real, tracked files in order:
1. `Prompt.md` — approved mechanics, including the full affinity matrix.
2. `Plan.md` — milestone order, exact completed scope, next handoff and oracles.
3. `Implement.md` — validation commands and local execution caveats.
4. `Documentation.md` — evidence and limitations.

These files in this directory replace the Mac-only vault/local-codex documents
for this program. Do not depend on `/Users/...`, `~/vault`, symlinks, local MCP
registrations, or access to the original conversation. Keep these tracked files
updated with cloud progress. The portability is intentional and maintainer-authorized.

## Cloud environment

Run from the repository root. Configure Node >=22.18 and pnpm. The existing
`.cursor/install.sh` can be used as the cloud setup script (`bash .cursor/install.sh`);
it provisions dependencies and attempts optional Serena setup. Alternatively use
a suitable Node runtime plus `pnpm install --frozen-lockfile`.

Set `LLM_INTERNAL_HOST=192.0.2.10` in cloud environment settings. This documentation
address satisfies existing hardware dry-run tests; it is not a real remote host
and must never be used to run a remote benchmark. No live LLM or GPU is required
for the core milestone tests. Do not copy developer credentials or host files.

After reading AGENTS.md and CLAUDE.md, run the session-start protocol preserving
the selected commit (`bash scripts/setup/session-refresh.sh --no-pull`). Read this
directory's Plan.md in place of the vault plan. Tooling unavailable in cloud must
be reported accurately; use file inspection if Serena MCP is unavailable. Do not
block on creating an Obsidian vault. CodeContext can be regenerated locally in
the cloud checkout by the existing script.

## First cloud task prompt

> Continue the unified actor rewrite on the selected codex/unified-actor handoff.
> Read docs/implementation/unified-actor/Handoff.md and its four linked records.
> Milestones UA.1–UA.2 are complete; implement UA.3, common vitals and terminal
> defeat. Preserve the approved clean break, one mana pool, one active pair,
> affinity-only combat, and one-stack-per-pair conquest semantics. Load the owning
> skill, write failing tests first, run the core/typecheck/boundary gates and a
> restored perturbation, and update the tracked execution record. Respect the
> existing one-M or two-S milestone handoff limit. Do not claim runtime integration
> until its later milestone is actually implemented. Do not run remote benchmarks
> or merge into main.

For the next task after UA.3, follow Plan.md's milestone order. Explicitly name
completed scope, remaining work, tests and any baseline failures at each handoff.


## Verified handoff baseline

Pre-publication full suite: 489 files passed, 3787 tests passed, 242 skipped,
zero failures with the documentation host variable above. Typecheck passed.
A missed source-path parity test from UA.2 was corrected without weakening its
assertions. The suite includes all 32 architecture files. Details and earlier
red/green/perturbation evidence are in Documentation.md.

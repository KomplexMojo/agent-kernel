# Unified actor rewrite — local continuation

## Start here

**CURRENT CUTOVER: runtime action execution is next.** The branch was rebased onto
main at portal merge `7a8888f4`; unified artifact production is checkpointed at
`d71af7e8`. Runtime startup now loads those artifacts into one detached actor
registry without calling the deleted category setup functions. The current startup
changes remain uncommitted; do not reset them.
Existing artifact builders now emit normalized state; core-setup loads one registry
and no longer exports category placement functions. Director actor requests now carry common properties and full motivations.
Generated layouts and actor placement now use canonical terrain.
Object placement, feasibility and previews now read canonical terrain too.
Resource and hazard placement now returns common actor requests and the production
build merges them after reserving their coordinates. SimConfig no longer stores
hazard/resource collections. Upstream CLI/card defaults, remaining pricing,
runtime actions/observations, adapter and UI callers remain unmigrated. The full application is temporarily broken as approved
by the maintainer; narrow builder/loader tests and typecheck pass. Read the latest
Documentation.md/Plan.md cutover section before using older green evidence below.

Latest measured post-rebase baseline: Configurator is green (43 files, 200 passed,
one skipped); the focused startup/loader/integration domain is 8/8 and typecheck
passes. Runtime startup's registry-retention perturbation fails as required and was
restored. The core-behavior reachability guard remains expected-red because the
artifact checkpoint made 23 legacy setup exports unreachable; remove those exports
with their legacy core test consumers during the prescribed export/test cutover.

Repository: `KomplexMojo/agent-kernel`. Continue the existing isolated worktree on
`codex/unified-actor`, preserving its local commits and any working changes. Do not reset to
main or the published handoff checkpoint: neither contains the current local work.
The original rewrite base was `9a9168f8c63b07b1e9e789daa598a6edaa061cbd`.

**Current local status (2026-09-10): UA.1–UA.3 complete; routing, exposure,
passive projection, inventory, claims, movement, focused casting, turn windows
and Configurator preset normalization implemented.**
The published de2a932 checkpoint still contains only UA.1/UA.2. Local commit
4736f9ab contains the subsequent mechanics/authoring work. The maintainer did not
move to cloud. Continue from the local branch tip, which also includes later
exit-dwell work; no push was requested this continuation.
Read Plan.md's next implementation seam and Documentation.md's latest evidence.
The maintainer authorized continuing across bounded milestones until completion
or token exhaustion, superseding the old one-milestone stopping limit.
The new registry is retained by runtime startup and available through the runtime
snapshot surface. Tick actions, observations, field sequencing, effects, budget
accounting and world-state capture still use the legacy core path. Passing startup
and component tests does not prove a whole game tick. Do not merge this partial
rewrite into main.

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

## Resume locally

Continue in the existing codex/unified-actor worktree from its local branch tip.
Do not reset to the old published checkpoint or start again from main. The next
seam is Configurator artifact assembly and single-list startup, then core/runner
replacement and remaining persona/adapter/UI migration. Read the exact continuation notes
in Plan.md. Primitive slot/claim/move APIs are now wrapped by the tested turn window, but
production Moderator/runner has not adopted it.
Do not run remote benchmarks or merge this incomplete rewrite into main.

## Published checkpoint baseline (historical)

Pre-publication full suite: 489 files passed, 3787 tests passed, 242 skipped,
zero failures with the documentation host variable above. Typecheck passed.
A missed source-path parity test from UA.2 was corrected without weakening its
assertions. The suite includes all 32 architecture files. Details and earlier
red/green/perturbation evidence are in Documentation.md.

## Last green pre-cutover verification — September 10

Full suite: 502 files passed, 3914 tests passed, 242 skipped, zero failures.
Typecheck passed. Separate architecture suite: 32 files and 118 assertions passed.
Separate core suite: 34 files, 612 passed, 1 skipped.
Latest additions: authored turn-cost assembly, file-backed invalid actor artifacts,
Configurator-to-core component acceptance/replay, and Allocator equip/take schedule.
The named attack charge is removed; legacy attack execution remains pending.
Capability-driven exit dwell and once-only exit phase now pass their six tests.
Whole-roster Configurator normalization and the component scenarios using it also
pass. Production artifact producers remain pending; see the Director producer
inspection notes at the end of Plan.md.
All perturbations restored; no guard baseline widened. These results cover the
local implementation, not the older published checkpoint. The production
engine migration remains incomplete; use Plan.md's updated continuation seam.

## Review requirement before PR
All Luna-produced implementation milestones must be checked by a more capable
model before opening or updating the PR. The reviewer must inspect the complete
diff, verify the locked mechanics and dependency/persona boundaries, rerun or
inspect the relevant gates, and record any required fixes. Do not treat Luna's
narrow green tests as sufficient approval for publication.

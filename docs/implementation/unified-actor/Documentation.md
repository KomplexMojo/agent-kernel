# Historical milestone evidence

These entries record validation at each milestone. Any `/tmp/` log references are machine-local historical evidence, not files required by cloud execution. See Handoff.md for current startup and the final publication validation entry below.

# Execution record
## Isolation and baseline
Created codex/unified-actor worktree from 9a9168f8c63b07b1e9e789daa598a6edaa061cbd. Original checkout unchanged by this task.
Session refresh: source intentionally not pulled; tools refreshed; suite 486 passed files / 1 failed file, 3772 passed / 2 failed / 242 skipped tests. Both failures are hardware dry-run tests needing LLM_INTERNAL_HOST in a new worktree. Typecheck passed before code changes. Narrow environment-only recheck uses 192.0.2.10 (documentation address). No production defect inferred and no benchmark code modified.
Logs: /tmp/unified-actor-session-refresh.log, /tmp/unified-actor-baseline-typecheck.log, /tmp/unified-actor-baseline-recheck.log.

## UA.1
Completed the bounded declaration milestone in five tracked/untracked source/test/doc files (not committed): artifacts.ts, contracts/README.md, docs/readme-index.md, the compiler-backed test, and its TypeScript fixture. No runtime mechanics delivered yet.

- Baseline narrow recheck: 28/28 tooling dry-run tests pass with LLM_INTERNAL_HOST=192.0.2.10. No host config or benchmark source change.
- Red: new fixture rejected the old declarations (missing ActorRecord etc., incompatible actions/snapshot).
- Green: compiler checks positive actors/actions/snapshot and 12 deliberately invalid shapes; test passes.
- Owner gates: tests/contracts plus schema origin/catalog — 16 files, 151 passed, 1 skipped.
- Typecheck: exit 0 after change.
- Perturbation: temporarily added attack to ActionV1; fixture failed specifically with unused @ts-expect-error. Original bytes restored in finally.
- Final architecture plus fixture: 33 files, 119 passed. Includes persona-boundary allowlist guards and the strict typecheck guard.
- git diff --check: clean.

Logs: /tmp/unified-actor-contract-red.log, /tmp/unified-actor-contract-green.log, /tmp/unified-actor-contract-gates.log, /tmp/unified-actor-typecheck.log, /tmp/unified-actor-perturbation.log, /tmp/unified-actor-final-guards.log.

Judgment calls: UA.1 is declaration-only, with migration status explicitly documented; old JS producers are not silently represented as conforming. Historical world-state union removed, current envelope selectors retained, simulation actions separated from effect/telemetry protocols. No new schema constant, version, runtime compatibility path, commit, or push. Public authoring Hazard/Resource artifact producer migration remains in later owner milestones.

Full suite was run only at baseline, before declarations; do not report it as post-change full-suite green. The plan's one-M handoff limit applies; remaining implementation is pending. The MCP test connector is rooted in the original checkout, so only read-only pattern discovery used it. All test execution and edits used the isolated worktree.


## UA.2 — registry component complete
Implemented core-owned mechanical types and a detached, stable-ID actor registry. Runtime artifacts re-export the mechanical types rather than redefining them. Artifact envelopes and presentation remain in runtime. Registry exposes getActor/getActorsAt, independent movement/sight blocking queries, and deterministic JSON snapshots. Rejects malformed geometry, duplicate IDs, conflicting living blockers, presentation leakage, nonfinite/circular/non-JSON state, getters and hidden JSON serialization hooks. Defeated actors remain spatially visible but never block; exited actors remain in snapshots but not spatial queries.

This is a read-only registry component, not a second engine and not yet wired into createCore or runtime. Vital mutation/legality, equipment/claim legality, tick/action execution and consumer migration remain pending. The existing engine and its old tests still run. No runtime behavior claim is made from component tests.

Validation:
- Red: new registry test failed to import the not-yet-created module.
- Green: 12 registry tests plus UA.1 compiler fixture passed.
- Full core-ts plus contract fixture: 27 files, 514 passed, 1 skipped.
- Boundary/schema guards: 5 files, 16 passed.
- pnpm run typecheck: exit 0.
- Perturbation: removing conflicting-blocker rejection turned the collision test red; original bytes restored.
- Full app suite not rerun for this internal component; the unchanged baseline and current narrow domains are distinguished intentionally.

Logs: /tmp/unified-actor-ua2-red.log, /tmp/unified-actor-ua2-green.log, /tmp/unified-actor-ua2-core.log, /tmp/unified-actor-ua2-guards.log, /tmp/unified-actor-ua2-typecheck.log, /tmp/unified-actor-ua2-perturbation.log, /tmp/unified-actor-ua2-restored.log.

Files in this milestone: core state/actor-types.ts and actor-registry.ts; runtime contracts/artifacts.ts and README.md; tests/core-ts/actor-registry.test.mts. No public core export, schema version, benchmark, original checkout, commit or push changed. Stop at the approved one-M handoff limit; milestone 3 is next.


## Cloud publication validation — 2026-09-07

The maintainer authorized preparing the portable handoff, committing, and pushing
this branch. The five tracked files in this directory now replace local vault
records as the execution source of truth for this rewrite.

A fresh full-suite run exposed one missed UA.2 test consumer:
`tests/runtime/domain-constants-parity.test.js` parsed affinity type unions from
`artifacts.ts`, where they are now re-exports, and obtained null. The test now reads
those two unions from core `state/actor-types.ts`; all assertions are preserved.
The focused parity/compiler run passed 3 tests. No gameplay code changed in this
publication pass.

Final pre-commit validation of the complete UA.1/UA.2 source tree:
- `LLM_INTERNAL_HOST=192.0.2.10 pnpm run test`: **489 files passed; 3787 tests passed,
  242 skipped, zero failures**. The domain includes all 32 architecture suites.
- `pnpm run typecheck`: exit 0.
- `git diff --cached --check`: clean.
- UA.1 and UA.2 perturbations were previously executed and restored, as recorded
  above. No tests were disabled to obtain this result.

The documentation host value serves existing dry-run tests only; no remote
benchmark was run. Full-suite green verifies this partial branch's current
contracts/components and existing engine, not the still-pending rewritten
runtime. Resume with UA.3; do not merge into main as a completed rewrite.

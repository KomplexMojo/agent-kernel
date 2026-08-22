# Execution benchmark runbook

This runbook separates deterministic contract validation from real benchmark evidence. The repository
validator is safe for development sessions: it uses fixture results, writes only to an operator-chosen
local directory, and never calls an LLM, `ak run`, a GPU host, Git publication, or a timer. Real execution
quality is produced only by the standalone nightly benchmark service; agents must not run it from a
development session.

## 1. Validate the orchestration contract locally

From the repository root:

```bash
validation_dir="$(mktemp -d)"
pnpm --dir tools/remote-ollama-control run validate:execution -- --out "$validation_dir"
```

The command writes `execution-validation.json` plus disposable schedule/canary fixtures beneath the
chosen directory. A valid record has:

- catalog identity hashes matching the current 25-scenario catalog;
- exactly 25 scenario summaries and 70 required gates;
- every declared seed/repeat/variant represented in its scenario aggregate;
- one successful generated-artifact handoff canary for each eligible hardware profile (`primary` and
  `dual`; `secondary` is reserved and has no benchmark model);
- `publication: false` and an explicit warning that fixture evidence is not gameplay-quality evidence.

Any missing population, non-qualifying aggregate, absent generated artifact, or new profile without a
canary makes the validator fail before writing the final record.

## 2. Classify nightly work

The standalone agent reads `config/benchmark-trigger-policy.json`. The result branch always selects no
work and therefore cannot retrigger itself.

| Changed input | Authoring | Runtime execution | Generated execution |
| --- | ---: | ---: | ---: |
| Content prompts, models, profiles, or authoring surface | yes | no | yes |
| Runtime/core only | no | yes | yes (reuse retained authoring) |
| Execution catalog, evaluator, or runner | no | yes | yes |
| Initial evaluation | yes | yes | yes |

Treat the modes as an allowlist. In particular, when `authoring` is false the nightly runner must not
contact Ollama. A content change may enter generated execution only through successful authoring records;
it may not reconstruct a build from scenario prose.

## 3. Pin inputs before real execution

The unattended process must use its isolated source checkout, never the operator's working tree. Before
work begins, retain these identities in the pending result:

1. exact source commit and tree;
2. content scenario-set and matrix hashes;
3. execution-suite, evaluator, seed-set, and tick-profile hashes;
4. profile/model/context/output settings;
5. trigger modes and matched path classes.

Abort on a dirty isolated checkout, an identity change during the run, missing profile isolation, or a
missing build route. Do not substitute the current branch tip after a run starts.

`AK_BENCHMARK_EXECUTION_SUITE_HASH` is a required unattended-agent identity alongside the content
scenario and matrix hashes. It is persisted after evaluation, participates in the immutable run key,
and is emitted by dry-run/publication metadata. Changing it alone selects runtime and generated
execution while keeping authoring disabled.

### Immutable source preparation

For a triggered non-dry invocation, the installed agent creates an owned detached worktree beneath
`AK_BENCHMARK_STATE_DIR/source-worktrees/<run-key>`. It verifies both the exact commit and tree before
running, in order:

1. `pnpm install --frozen-lockfile`;
2. the repository test suite with non-routable documentation hosts used only by dry-run tests;
3. repository typecheck;
4. the remote-control package syntax check; and
5. deterministic all-25 execution-contract validation.

Each step writes a bounded log beneath `preflights/<run-key>/`. A failed step becomes retained
infrastructure evidence and the model/benchmark callback is not invoked. Tracked source changes after
preflight also fail the gate. On restart, the agent removes and recreates only the exact owned worktree
for that immutable run key; paths outside the owned state subtree are rejected. The operator checkout is
never used or cleaned. Worktree cleanup occurs before publication while preflight logs remain local.

Pipeline orchestration is also loaded from that detached worktree. This includes the execution catalog,
runner, evaluator integration, content-generation command, and `ak` CLI; an installed controller may not
silently substitute its own benchmark semantics for the pinned source commit.

## 4. Execute staged populations

For every selected execution scenario:

1. screen seed 0 for at most 50 ticks;
2. retain the screen result even when rejected;
3. promote only structurally valid screens;
4. run the exact catalog seed/repeat/variant population at the declared tick horizon and checkpoints;
5. stop early only for the irreversible failures implemented by `execution-runner.js`;
6. retain `execution-schedule.json` locally even when the stage fails.

Runtime execution uses an explicit committed-build resolver. Generated execution uses
`createGeneratedBuildResolver()` with an explicit scenario/variant route. The chosen authoring record
must have `execSucceeded: true`, a passing scenario verdict, and both `sim-config.json` and
`initial-state.json`.

The two route manifests are repository-relative JSON documents configured by
`AK_BENCHMARK_RUNTIME_ROUTES` and `AK_BENCHMARK_GENERATED_ROUTES`. Runtime routes point to committed
build directories inside the pinned source tree. Generated routes select successful retained authoring
records; they never derive a build from benchmark prose. Missing manifests, cache entries, routes, or
build files fail closed.

Both manifests are versioned and identity-bound. They must cover every scheduler scenario/variant key
exactly; extra keys are rejected as stale just like missing keys. Validation occurs before authoring or
execution. Runtime routes must resolve to complete source-owned build directories. Generated routes must
select a positive repeat of a catalog scenario whose expected outcome is `success`.

```json
{
  "schemaVersion": "agent-kernel-runtime-build-routes/v1",
  "identity": { "executionSuiteHash": "<sha256>" },
  "routes": { "EX-TR-01": "tests/fixtures/benchmarks/execution/EX-TR-01" }
}
```

```json
{
  "schemaVersion": "agent-kernel-generated-content-routes/v1",
  "identity": { "executionSuiteHash": "<sha256>", "scenarioSetHash": "<sha256>" },
  "routes": { "EX-TR-01": { "scenarioIndex": 79, "repeat": 1 } }
}
```

These are shape examples, not complete manifests. Do not route unrelated scenarios to a shared generic
fixture merely to satisfy key coverage; each build and prompt must actually encode the evaluated setup.

The complete Git-owned manifests are `runtime-build-routes.json` and
`generated-content-routes.json` in this directory. Before any execution schedule, validate them together
with the pinned source tree:

```bash
pnpm --dir tools/remote-ollama-control validate:execution -- \
  --corpus \
  --source-root "$AK_BENCHMARK_SOURCE_WORKTREE" \
  --out "$AK_BENCHMARK_STATE_DIR/corpus-validation"
```

This corpus preflight verifies exact 26-key parity, both manifest identities, source-owned artifact
paths, `SimConfigArtifact`/`InitialStateArtifact` schemas, explicit generated prompt markers, and a
canonical hash over every committed artifact pair. It then behaviorally probes the pinned source's
`applySimConfigToCore()` with both vital and affinity resources. Unless that probe observes calls to
both `placeResourceAt` and `placeAffinityResourceAt`, validation fails before the deterministic fixture
scheduler starts and writes no success record. A green unit test using an injected capability is not a
substitute for this pinned-source probe.

On success, the command runs the deterministic 25-scenario fixture schedule and writes
`corpus-integration-validation.json`. This still is not gameplay-quality evidence and does not contact
an LLM, GPU, remote host, result branch, or timer.

Component evidence is retained by immutable identity beneath the local state directory. Runtime-only
work reuses authoring evidence keyed by the content scenario and matrix hashes, skips inference, and
reruns both committed and generated execution. Content-only work may reuse runtime evidence only when
the execution-suite hash matches exactly. Raw evidence stays local under `runs/<run-key>`; the published
result contains compact aggregates and a non-host-specific retention identifier.

## 5. Qualify and publish

Use `combineBenchmarkQualification()` only after all requested modes finish. A configuration is eligible
for `minimumSuccessfulConfiguration` and the Pareto frontier only when authoring, shared runtime
execution, and its generated execution all qualify. Missing evidence fails closed.

Publish compact structured JSON to `benchmark-results` only when all recorded identities still match the
pinned run. Never commit raw prompts, model responses, generated builds, execution artifacts, telemetry,
host paths, addresses, or secrets. A failed attempt may replace `latest.json`; only a qualifying completed
run may replace `latest-success.json`. Push without force and retain a rejected push as local evidence.

## 6. Operator gates and recovery

- Keep `AK_BENCHMARK_DRY_RUN=1` until the operator has reviewed source pinning, trigger modes, profile
  isolation, model availability, disk capacity, and the destination branch.
- A non-dry pipeline also requires `AK_BENCHMARK_LIVE=1`. This second explicit gate prevents an
  accidental dry-run toggle from starting content generation or execution.
- Enabling the user timer, starting real GPU work, or publishing results requires an explicit operator
  action. See the unattended-agent section in the package README.
- On interruption, preserve the local schedule and authoring records. A later invocation may deduplicate a
  completed immutable run key, but must not present a partial population as complete.
- On infrastructure failure, publish a failed attempt only if publication was authorized; never advance
  `latest-success.json`.

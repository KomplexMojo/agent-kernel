# Execution-quality benchmark catalog

Operator procedure: [RUNBOOK.md](./RUNBOOK.md).

This directory is the versioned question set for dynamic program evaluation. It is separate from the
100 content-generation prompts: authoring asks whether a model creates a valid dungeon; execution asks
whether a committed or generated dungeon remains correct, live, useful, deterministic, and bounded over
time.

`contract.json` declares the scorer version, shared run profiles, hard invariants, metric vocabulary,
and suite qualification floors. The five family files contain exactly five scenarios each. Their
semantic contents produce the execution-suite, seed-set, and tick-profile hashes returned by
`loadExecutionCatalog()`.

Evidence is explicit:

- `artifact` metrics can be derived from current public run artifacts.
- `observation` metrics use opt-in `ak run --world-state-checkpoints` output: individual existing
  `agent-kernel/WorldStateArtifact` v1 files at the profile-declared ticks.

Unavailable observation evidence must be reported as `evidence_unavailable`; it must never silently
pass. Required gates and global invariants are hard failures. Weighted objectives total 100 per scenario
and are scored only after the gates pass.

E2 adds `scripts/lib/execution-evaluator.js`, a pure black-box evaluator over committed public
artifacts. It loads `sim-config.json`, `initial-state.json`, `tick-frames.json`, `effects-log.json`,
`run-summary.json`, and `action-log.json`; extracts every metric it can prove; evaluates phase,
legality, participation, stationary, effect, identity, and reconciliation invariants; scores available
objectives; aggregates worst-seed evidence; and writes `agent-kernel-execution-result/v1` JSON. Result
comparison requires matching suite, evaluator, seed-set, and tick-profile identities.

E3 adds a fail-closed checkpoint reader. It requests deterministic filenames only for the declared
profile ticks, validates schema and embedded tick identity, ignores undeclared extra files, and records
expected, loaded, and missing ticks in `artifactSummary.worldStateCheckpoints`. Missing checkpoint
files remain evidence gaps rather than loader crashes; malformed or mislabeled files are invalid input.
The reader supplies facts only. E4a owns the approved metric predicates and thresholds; E4b maps
available artifact/checkpoint evidence onto them.

E4a replaces all 70 prose-only gates with stable ids, reporting descriptions, population scopes,
evidence classes, and closed predicate objects. E4b1 (`execution-evaluator-v2`) evaluates artifact-backed
seed gates plus exact seed/repeat/variant populations for aggregate rates, paired directional changes,
and replay equivalence. The paired affinity scenario explicitly names `neutral` as its baseline and
`advantaged` as its candidate. Missing, duplicate, unexpected, or non-comparable population evidence
remains unavailable rather than being dropped from a denominator.

E4b2 adds `scripts/lib/execution-runner.js`, a local-only staged scheduler. It screens every selected
scenario at seed 0 for at most 50 ticks, promotes structurally valid screens to the exact declared
seed/repeat/variant population, and labels 250/500-tick profiles as stress work. A short-profile screen
is reused when it is byte-for-byte the same requested execution. Early stopping is limited to proofs
that cannot be recovered by remaining runs: process failure, hard invariant failure, required per-run
gate failure, or violation of the minimum-seed score. Every attempt is retained in atomic
`agent-kernel-execution-schedule/v1` local JSON.

The catalog still describes scenario setups rather than owning build artifacts. Callers must supply a
`resolveBuild({ scenario, variant, request })` handoff returning the directory containing
`sim-config.json` and `initial-state.json`. The scheduler never reconstructs a dungeon from setup prose.

E4b3 adds a generated-content resolver at that boundary. Each execution scenario/variant must have an
explicit route to one exact content-generation scenario and repeat for one configuration. The selected
authoring record must have both a successful execution and passing scenario verdict, and its output must
contain both required build artifacts. Missing routes, failed authoring, and incomplete output fail
closed; setup prose and theme labels are never converted into runtime constructs.

Trigger policy now classifies authoring, runtime-execution, and generated-execution work separately.
Runtime/core-only changes request runtime execution without authoring, so they cannot invoke an LLM.
Authoring changes request authoring plus generated execution. Execution-suite changes request both
runtime and generated execution. The results branch requests no work.

`agent-kernel-combined-benchmark-result/v1` preserves each historical authoring projection and adds
separate authoring, shared-runtime, and per-configuration generated-execution verdicts. A configuration
qualifies—and can become the minimum or enter the Pareto frontier—only if all three verdicts pass.
Missing execution evidence is a failure, not an implicit pass.

The evaluator deliberately remains fail-closed:

- 11 scenarios contain observation-backed objectives that current run artifacts cannot prove.
- Persistent vitals, regen, affinity grant lifecycle/stacking, final-state bounds, survival curves, and
  directional push/pull displacement remain unavailable until a later E4b milestone extracts their
  checkpoint metrics.
- Per-run same-seed determinism is available when replay frames are supplied. Population replay gates
  compare the declared repeat results by normalized frame hash; wall-time performance is available only
  when the runner supplies elapsed milliseconds.
- Gate descriptions are reporting-only. Verdicts use only versioned predicate objects; changing prose
  cannot change a result.

No evaluator path reads runtime memory or reconstructs simulation rules. Missing facts do not receive
partial credit. A hard invariant failure forces score zero before unavailable evidence is considered.

Validate catalog and evaluator edits with:

```bash
pnpm run test:vitest -- tests/tools/execution-benchmark-catalog.test.js tests/tools/execution-benchmark-evaluator.test.js
```

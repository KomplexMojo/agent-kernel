# adapters-cli — CLI Adapters

`adapters-cli` provides Node-based command-line tools that exercise runtime artifacts and
support deterministic workflows (solve, run, replay, inspect). These CLIs are **adapters**:
they do not contain core simulation logic and they do not mutate `core-ts` state directly.

This package exists to enable automation, debugging, and batch execution outside the UI.

Minimum-install baseline:
- the default author/build/preview/run workflow is expected to work without live IPFS,
  blockchain, or Ollama services;
- the TypeScript core is synchronous and does not require a binary build step;
- adapter demos remain fixture-first so they can be exercised offline.

---

## How to Read This README

Start with the workflow map below, then jump to the command family you need. The long command examples later in the file are reference material; they intentionally preserve exact CLI invocations for automation and regression checks.

| Need | Start with | Produces |
| --- | --- | --- |
| Author a room, delver, warden, trap, hazard, or resource | `create`, `configure`, `room-plan`, `delver-plan`, `warden-plan` | `spec.json`, `bundle.json`, `sim-config.json`, `initial-state.json` |
| Build from an existing BuildSpec | `build` | Canonical persisted handoff artifacts |
| Run or replay deterministic simulation artifacts | `run`, `replay` | TickFrames, effects log, run summary |
| Inspect prior outputs | `show`, `diff`, `runs list`, `inspect`, `narrate` | Structured summaries and narrative artifacts |
| Use LLM planning with captured inputs | `llm-plan`, `scenario`, `llm` | Captured LLM artifacts plus build/run outputs |
| Exercise external adapters directly | `ipfs`, `blockchain`, `llm`, publish/load variants | Adapter response artifacts |

## Typical Local Workflow

1. Author or build a scenario into artifacts.
2. Inspect `bundle.json` and `manifest.json`, or load them in the UI.
3. Run the scenario from `sim-config.json` and `initial-state.json`.
4. Inspect, narrate, diff, or replay the emitted TickFrames.

The default output root is `artifacts/runs/<runId>/<command>`, which keeps each command stage readable and chainable.

## Scope

CLI adapters:
- Construct runtime artifacts (IntentEnvelope, PlanArtifact, SimConfigArtifact, TickFrame, SolverRequest, etc.).
- Invoke adapter modules and emit artifacts for ports (e.g., solver, telemetry, persistence).
- Produce deterministic logs suitable for replay.

They do **not**:
- Embed simulation rules (those live in `core-ts`).
- Replace personas (they act as a driver and record artifacts for downstream personas).

---

## CLI Commands

Default output layout: `artifacts/runs/<runId>/<command>`. Older layouts
(`artifacts/build_<runId>`, `artifacts/<command>_<timestamp>`) can be preserved
by passing `--out-dir`.

### Structured stdout contract
The automation-facing authoring and execution commands emit exactly one JSON object line to stdout on success:
`build`, `create`, `configure`, `room-plan`, `hazard-plan`, `resource-plan`, `delver-plan`, `warden-plan`, `run`, `inspect`, `narrate`, `llm-plan`, `scenario`, `show`, `diff`, and `runs list`.

Success shape:
```json
{"ok":true,"command":"create","runId":"run_123","outDir":"/abs/path/artifacts/runs/run_123/create","actorIds":["delver_1"],"roomIds":["room_1"],"artifactPaths":{"spec":"/abs/path/.../spec.json","bundle":"/abs/path/.../bundle.json","manifest":"/abs/path/.../manifest.json","telemetry":"/abs/path/.../telemetry.json","sim_config":"/abs/path/.../sim-config.json","initial_state":"/abs/path/.../initial-state.json","resource_bundle":"/abs/path/.../resource-bundle.json"}}
```

Notes:
- `artifactPaths` contains absolute paths for the emitted artifacts that exist for that command.
- Default build-like commands persist the canonical handoff plus transport files; use `--emit-intermediates` to also persist request/plan/solver/capture sidecars.
- `actorIds` and `roomIds` are included when they can be derived from the emitted or input artifacts.
- Incidental human-readable logs are written to stderr or suppressed so stdout remains machine-parseable.

Error shape:
```json
{"ok":false,"command":"create","error":"create requires at least one authored object via --room, --floor-tile, --trap, --delver, or --warden."}
```

Errors still exit non-zero.

### `build`
Agent-only builder that consumes a single JSON build spec and emits the canonical persisted
handoff for downstream personas. By default it writes `spec.json`, the budget triplet when
present, `sim-config.json`, `initial-state.json`, `resource-bundle.json`, `bundle.json`,
`manifest.json`, and `telemetry.json`. `--emit-intermediates` additionally writes `intent.json`,
`plan.json`, solver artifacts, and captured-input sidecars. Manifest/bundle include a filtered
`schemas` list for emitted artifacts.
Build specs may include `adapters.capture` entries for ipfs/blockchain/llm; provide fixture paths
for deterministic runs (live network requires `AK_ALLOW_NETWORK=1`).

### `llm-plan`
Runs the Orchestrator LLM session against a scenario fixture or freeform text and emits build outputs
plus a captured LLM artifact for replay. Requires `AK_LLM_LIVE=1` to query the LLM.
If `AK_LLM_LIVE` is off, scenario mode falls back to the scenario's `summaryPath` fixture. Text mode can
still run offline by using `--fixture` or the default stub summary fixture.
Fixture responses are required unless `AK_ALLOW_NETWORK=1` or the base URL is local.
Strict mode (`AK_LLM_STRICT=1`) disables repair/sanitization; contract errors fail the
flow but still emit a capture artifact with `payload.errors`.
In live mode, single-pass llm-plan requires at least one room and one actor; missing
entries trigger a repair pass before failing. If the summary does not match catalog
entries, llm-plan reruns a catalog-focused repair pass and fails if still unmatched.
Budget loop mode (`--budget-loop` or `AK_LLM_BUDGET_LOOP=1`) runs a multi-phase
layout-only → actors-only loop with remaining budget hints and stop reasons
(`done`, `missing`, `no_viable_spend`). Each phase is captured as a distinct
`CapturedInputArtifact` with `payload.phase` and deterministic phase-indexed ids.
llm-plan requires a total budget (`--budget-tokens` or scenario `budgetTokens`) to be set.
Layout tile costs default to 1 token each (llm-plan does not yet ingest price lists);
when a price list is supplied to the budget loop, `tile_wall`, `tile_floor`, and
`tile_hallway` items (kind `tile`) override the defaults.
Budget pools can be customized with `--budget-pool id=weight` (repeatable) and
`--budget-reserve N` to reserve tokens before pooling. Defaults are
player=0.2, layout=0.4, wardens=0.4, resource=0.0.
Multi-phase fixtures can be provided as a JSON array or as `{ "responses": [...] }`
to feed sequential LLM responses.

Inputs/outputs:
- Input: `--scenario path` (E2E scenario JSON with catalog + summary paths) or
  `--text`/`--prompt` + `--catalog` for direct freeform mode, plus `--model`,
  optional `--goal`/`--budget-tokens`, `--fixture` for deterministic responses,
  `--run-id`, `--created-at`, optional `--budget-pool`/`--budget-reserve`,
  optional `--emit-intermediates`.
- Output dir: `artifacts/runs/<runId>/llm-plan` by default, or `--out-dir`.
- Outputs: `spec.json`, optional `budget.json`, `price-list.json`, `budget-receipt.json`,
  `sim-config.json`, `initial-state.json`, `resource-bundle.json`, plus `bundle.json`,
  `manifest.json`, `telemetry.json`.
- `--emit-intermediates` additionally persists `intent.json`, `plan.json`,
  `budget-allocation.json` (budget loop), and `captured-input-llm-*.json`.

### `scenario`
Single natural-language entrypoint that composes `llm-plan --text`, `run`, and `inspect`
into one deterministic pipeline for automation callers. It also supports `--from-run <runId>`
to resume from a prior run's emitted `sim-config.json` and `initial-state.json` without manual
path wiring. It stays in the CLI adapter layer and reuses the existing command kernel
implementations for each stage.

Inputs/outputs:
- Input: either `--text` + `--catalog`, optional `--model`, `--goal`, `--budget-tokens`,
  `--base-url`, `--fixture`, optional budget-loop flags, `--created-at`; or `--from-run <runId>`
  to reuse prior stage outputs discovered under `artifacts/runs/<runId>/*`. Both modes accept
  `--ticks`, `--seed`, optional `--run-id`, and `--out-dir`.
- Output dir: `artifacts/runs/<runId>` by default, or `--out-dir` as the pipeline root.
- Outputs: `llm-plan/spec.json`, `llm-plan/sim-config.json`, `llm-plan/initial-state.json`,
  `run/tick-frames.json`, `run/effects-log.json`, `run/run-summary.json`, and
  `inspect/inspect-summary.json`. In `--from-run` mode the scenario summary also includes
  `source_sim_config` and `source_initial_state`.

### `show`
Queries a prior run and prints a structured summary of the generated actors, rooms, artifacts,
and budget spend. This is the read-only follow-up command for automation callers that need to
inspect what a previous run created without rerunning the pipeline.

Inputs/outputs:
- Input: `--run-id <runId>`.
- Stdout: structured JSON including `runId`, `actors[]`, `rooms[]`, `artifactPaths{}`, and
  `budgetSpend`.
- Error: structured JSON error when the requested run directory does not exist under the selected
  output root.

### `diff`
Compares two previously recorded runs without rerunning the pipeline. It reuses the same
artifact discovery rules as `run --from-run`: source `sim-config.json` / `initial-state.json`
come from the resolved run source directory, while `tick-frames.json` and `run-summary.json`
come from the highest-priority execution stage under each run (`run`, then `replay`, then
other run-like stages).

Inputs/outputs:
- Input: `--run-a <runId>` and `--run-b <runId>`.
- Stdout: structured JSON including per-run tick totals, effect totals, damage totals,
  per-actor presence/vitals/damage, and `divergesAtTick` with the first mismatched normalized
  frame summary when the runs stop matching.
- Error: structured JSON error when either run directory is missing or no comparable run outputs
  can be found.

### `runs list`
Lists prior runs from the output root with their status, inputs, and key outputs in newest-first
order. This is the index command for automation callers that need to enumerate recent runs before
drilling into a specific `runId` with `show`.

Inputs/outputs:
- Input: optional `--limit N`, `--since <ISO date>`, and `--out-dir`.
- Stdout: JSON array of run summaries sorted newest-first:
  `[{runId, createdAt, command, actorCount, roomCount, ticks, outDir}]`
- `--limit N` caps the number of returned runs.

### `create` / `configure`
Generic additive agent-facing authoring commands that normalize freeform text plus
structured object flags into an inline `AgentCommandRequestArtifact`, compile that
request into `BuildSpec`, and run the existing deterministic build/configurator flow.
These commands do not replace `room-plan`, `hazard-plan`, `resource-plan`,
`delver-plan`, `warden-plan`, `build`, or `configurator`; they provide a
single multi-object entrypoint for automation callers.

Inputs/outputs:
- Input: optional `--text`, repeatable `--room`, `--floor-tile`, `--trap`, `--hazard`,
  `--resource`, `--delver`, and `--warden`, optional `--goal`, `--dungeon-affinity`,
  optional `--budget-tokens`, optional `--budget` + `--price-list`, plus standard
  `--run-id`, `--created-at`, `--out-dir`.
- `--budget-tokens` is a hard cap for agent-authored spend. If `--text` or `--goal` also says
  `budget <N> tokens`, and/or `--budget` supplies `budget.tokens`, all values must agree or
  the command fails validation.
- `--floor-tile` format: `count=<n>[;id=<id>]`
- `--trap` format: `x=<n>;y=<n>;affinity=<kind>[;expression=<kind>][;stacks=<n>][;blocking=<true|false>][;id=<id>][;vitals=<vital>:<max>:<regen>|<vital>:<current>:<max>:<regen>,...]`
- `--hazard` format: `affinity=<kind>;expression=<push|pull|emit|draw>;proximityRadius=<n>[;mana=one-time:<amount>|regen:<current>:<max>:<regen>][;durability=one-time:<amount>|regen:<current>:<max>:<regen>][;id=<id>]`
  Produces a `HazardArtifact` written to `hazard-<n>.json` in the output directory.
- `--resource` format: `permanenceMode=<consumable|level|permanent>;vital=<health|mana|stamina>;delta=<n>[;id=<id>]`, or legacy `tier=<level|permanent>;stat=<vitalMax|vitalRegen|affinity|affinityStack|pushExpression>;delta=<n>;dropRate=<n>[;id=<id>]`
  Produces a `ResourceArtifact` written to `resource-artifact-<n>.json` in the output directory.
- `--delver` accepts `goals=max_mana[:<priority>],mana_regen[:<priority>]` to record qualitative
  vitals goals as optimization directions over the existing deterministic vitals and regen cost model.
- Hard constraints are recorded separately from optimization goals in the embedded authoring request under `spec.json`.
  The current contract treats total budget as a hard constraint and maximize-spend / mana goals as
  optimization directions for later fulfillment waves. A hard budget alone does not imply
  `maximize_budget_spend`; that goal is recorded only when the user explicitly asks for maximize/full-budget behavior.
- Budgeted room/delver requests now fail deterministically when no valid configuration exists.
  Hard-budget failures report `insufficient_budget`; explicit hard-requirement clashes report
  `conflicting_requirements` and name the blocking constraints.
- `create` records `command.action = "author"` in `spec.authoring.request`; `configure` records
  `command.action = "configure"` while preserving the same deterministic parsing rules.
- Output dir: `artifacts/runs/<runId>/create` or `artifacts/runs/<runId>/configure` by default.
- Outputs: `spec.json`, optional `budget.json`, `price-list.json`, `budget-receipt.json`,
  `sim-config.json`, `initial-state.json`, `resource-bundle.json`, plus `bundle.json`,
  `manifest.json`, `telemetry.json`.
- `--emit-intermediates` additionally persists `request.json`, `intent.json`, `plan.json`,
  and sidecars such as `spend-proposal.json`.

### Scenario authoring example

The canonical motivation-sandbox fixture is
`tests/fixtures/scenarios/delver-warden-battle-v1-basic.json`. Its `cliEquivalent`
documents the matching `create` invocation and the motivation kinds currently used by
the sandbox path: `attacking`, `defending`, and `stationary`. Authored actors also
accept `motivation=random` (deterministic seed-derived movement), which `create`
persists into the emitted initial state.

```bash
ak.mjs create --room "size=medium;count=1" --delver "count=1;affinity=fire;motivation=attacking;vitals=health:10:10:0,mana:10:10:0,stamina:10:10:0" --warden "count=1;affinity=dark;motivation=defending;vitals=health:6:6:0,mana:6:6:0,stamina:6:6:0"
```

Agent workflow notes:
- `spec.authoring.request` is the canonical normalized copy of the freeform request plus parsed object flags.
- `bundle.json` and `manifest.json` are the handoff point into the UI `Diagnostics -> Preview -> Run` flow.
- `Preview` can render generated room images for room-only requests without a binary build step.
- `Build And Load Game` in the UI remains stricter than plain preview: the authored card set still needs at least 1 room, 1 delver, and 1 warden before `Run` is considered playable.
- Authoring, bundle review, and Preview all use the synchronous TypeScript core path.

### `room-plan`
Builds a `BuildSpec` directly from Room authoring flags (no hand-edited JSON required) and
runs the standard build pipeline. This is the Room-first parity command for UI card authoring.

Inputs/outputs:
- Input: one or more `--room` flags (repeatable), optional `--goal`, `--dungeon-affinity`,
  optional `--budget-tokens`, optional `--budget` + `--price-list`, plus standard `--run-id`,
  `--created-at`, `--out-dir`.
- `--room` format: `size=<small|medium|large>;count=<n>;affinities=<kind>:<expression>:<stacks>,...`
- If `affinities` are omitted, defaults are applied: `dark:emit:2`.
- `--budget` and `--price-list` can be supplied together to emit `budget-receipt.json`
  from room-plan runs.
- If `--goal` includes a budget phrase such as `budget 400 tokens`, it must agree with
  `--budget-tokens` and any provided `BudgetArtifact`.
- If the hard budget cannot cover the minimum valid room that preserves the requested size/affinities,
  `room-plan` fails with a deterministic `insufficient_budget` explanation instead of silently degrading the room.
- Output dir: `artifacts/runs/<runId>/room-plan` by default, or `--out-dir`.
- Outputs: `spec.json`, optional `budget.json`, `price-list.json`, `budget-receipt.json`,
  `sim-config.json`, `initial-state.json`, `resource-bundle.json`, plus `bundle.json`,
  `manifest.json`, `telemetry.json`.
- `--emit-intermediates` additionally persists `intent.json` and `plan.json`.

### `hazard-plan`
Builds a `BuildSpec` directly from Hazard authoring flags and runs the standard
build pipeline. This is the first-order hazard command for configuring hazard
cards and hazard-only budget checks without routing through mixed-object authoring.

Inputs/outputs:
- Input: one or more `--hazard` flags (repeatable), optional `--goal`,
  `--dungeon-affinity`, optional `--budget-tokens`, optional `--budget` +
  `--price-list`, plus standard `--run-id`, `--created-at`, `--out-dir`.
- `--hazard` format: `affinity=<kind>;expression=<push|pull|emit|draw>;proximityRadius=<n>[;mana=one-time:<amount>|regen:<current>:<max>:<regen>][;durability=one-time:<amount>|regen:<current>:<max>:<regen>][;id=<id>]`
- A budgeted run uses an explicit hazards-only allocation pool, so hazard base,
  affinity, and vital spend are capped against hazards instead of rooms or actors.
- Output dir: `artifacts/runs/<runId>/hazard-plan` by default, or `--out-dir`.
- Outputs: `spec.json`, optional `budget.json`, `price-list.json`,
  `budget-receipt.json`, `hazard-<n>.json`, `sim-config.json`,
  `initial-state.json`, `resource-bundle.json`, plus `bundle.json`,
  `manifest.json`, `telemetry.json`.
- `--emit-intermediates` additionally persists `intent.json` and `plan.json`.

### `resource-plan`
Builds a `BuildSpec` directly from Resource authoring flags and runs the standard
build pipeline. This is the first-order resource command for configuring resource
cards and resource-only budget checks without routing through mixed-object authoring.

Inputs/outputs:
- Input: one or more `--resource` flags (repeatable), optional `--goal`,
  `--dungeon-affinity`, optional `--budget-tokens`, optional `--budget` +
  `--price-list`, plus standard `--run-id`, `--created-at`, `--out-dir`.
- `--resource` format: `permanenceMode=<consumable|level|permanent>;vital=<health|mana|stamina>;delta=<n>[;id=<id>]`, or legacy `tier=<level|permanent>;stat=<vitalMax|vitalRegen|affinity|affinityStack|pushExpression>;delta=<n>;dropRate=<n>[;id=<id>]`
- A budgeted run uses an explicit resources-only allocation pool, so resource
  grants are capped against resources instead of actor or shared spend.
- Output dir: `artifacts/runs/<runId>/resource-plan` by default, or `--out-dir`.
- Outputs: `spec.json`, optional `budget.json`, `price-list.json`,
  `budget-receipt.json`, `resource-artifact-<n>.json`, `sim-config.json`,
  `initial-state.json`, `resource-bundle.json`, plus `bundle.json`,
  `manifest.json`, `telemetry.json`.
- `--emit-intermediates` additionally persists `intent.json` and `plan.json`.

### `delver-plan`
Builds a `BuildSpec` directly from Delver authoring flags (no hand-edited JSON required) and
runs the standard build pipeline. This is the direct delver parity command for CLI card authoring.

Inputs/outputs:
- Input: one or more `--delver` flags (repeatable), optional `--goal`, `--dungeon-affinity`,
  optional `--budget-tokens`, optional `--budget` + `--price-list`, plus standard `--run-id`,
  `--created-at`, `--out-dir`.
- `--delver` format: `count=<n>;affinity=<kind>;motivation=<kind>[;id=<id>][;affinities=<kind>[:<expression>[:<stacks>]],...][;vitals=<vital>:<max>:<regen>,...|<vital>:<current>:<max>:<regen>,...][;setup-mode=<auto|user|hybrid>][;goals=max_mana[:<priority>],mana_regen[:<priority>]]`
- If `affinity` is omitted, it falls back to `--dungeon-affinity` (default: `fire`).
- If `motivation` is omitted, default is `attacking`.
- `motivation` is singular for direct CLI authoring; repeating it in the same `--delver` spec is rejected.
- `--budget` and `--price-list` can be supplied together to emit `budget-receipt.json`
  from delver-plan runs.
- Delver `goals=` values are optimization directions only; they do not bypass the existing
  deterministic cost model or introduce a parallel config system.
- If explicit vitals conflict with requested affinities or movement support, `delver-plan` fails with
  `conflicting_requirements`; if the hard budget cannot cover the minimum valid delver, it fails with `insufficient_budget`.
- Output dir: `artifacts/runs/<runId>/delver-plan` by default, or `--out-dir`.
- Outputs: `spec.json`, optional `budget.json`, `price-list.json`, `budget-receipt.json`,
  `sim-config.json`, `initial-state.json`, `resource-bundle.json`, plus `bundle.json`,
  `manifest.json`, `telemetry.json`.
- `--emit-intermediates` additionally persists `intent.json` and `plan.json`.

### `warden-plan`
Builds a `BuildSpec` directly from Warden authoring flags (no hand-edited JSON required) and
runs the standard build pipeline. This is the direct warden parity command for CLI card authoring.

Inputs/outputs:
- Input: one or more `--warden` flags (repeatable), optional `--goal`, `--dungeon-affinity`,
  optional `--budget-tokens`, optional `--budget` + `--price-list`, plus standard `--run-id`,
  `--created-at`, `--out-dir`.
- `--warden` format: `count=<n>;affinity=<kind>;motivation=<kind>[;id=<id>][;affinities=<kind>[:<expression>[:<stacks>]],...][;vitals=<vital>:<max>:<regen>,...|<vital>:<current>:<max>:<regen>,...]`
- If `affinity` is omitted, it falls back to `--dungeon-affinity` (default: `fire`).
- If `motivation` is omitted, default is `defending`.
- `motivation` is singular for direct CLI authoring; repeating it in the same `--warden` spec is rejected.
- `--budget` and `--price-list` can be supplied together to emit `budget-receipt.json`
  from warden-plan runs.
- Output dir: `artifacts/runs/<runId>/warden-plan` by default, or `--out-dir`.
- Outputs: `spec.json`, optional `budget.json`, `price-list.json`, `budget-receipt.json`,
  `sim-config.json`, `initial-state.json`, `resource-bundle.json`, plus `bundle.json`,
  `manifest.json`, `telemetry.json`.
- `--emit-intermediates` additionally persists `intent.json` and `plan.json`.

## Agent authoring contract

The canonical additive contract for agent-friendly CLI authoring is
`agent-kernel/AgentCommandRequestArtifact` (schema version `1`). This milestone
defines the contract and taxonomy only; it does not replace existing commands.
Current `room-plan`, `hazard-plan`, `resource-plan`, `delver-plan`,
`warden-plan`, `build`, and `configurator` flows remain valid and are the
backward-compatible execution paths.

Top-level shape:
- `meta`: standard artifact metadata (`id`, `runId`, `createdAt`, `producedBy`).
- `command`: normalized agent command envelope with `action`, source text, source id, and `taxonomyVersion`.
- `objects`: normalized authored objects extracted from the command.
- `sharedConfig`: cross-object settings such as `dungeonAffinity`, `budgetTokens`, `levelSize`, and `roomCount`.
- `sharedConfig.constraints.hardBudget`: canonical hard-cap budget input. If text, `--budget-tokens`,
  and `BudgetArtifact.budget.tokens` disagree, the CLI rejects the request instead of guessing precedence.
- `sharedConfig.optimizationGoals`: shared optimization directions such as `maximize_budget_spend` when explicitly requested.
- `objects[].optimizationGoals`: per-object optimization directions such as `maximize_vital_max` and
  `maximize_vital_regen` for delver authoring.
- `validation`: optional deterministic failure summary (`insufficient_budget`, `conflicting_requirements`, etc.)
  with ordered blocking issues for rejected authoring requests.
- `compilation.rules`: explicit mapping from each object kind to downstream build/configurator targets.
- `compatibility`: rollout notes and explicit legacy-flow preservation requirements.

Canonical object taxonomy:
- `room`: authored room cards and room-level composition hints. Default compile targets are `build_spec_plan` and `build_spec_configurator`.
- `floor_tile`: authored floor/wall/barrier tile intent. Default compile target is `build_spec_configurator`.
- `trap`: authored trap placement or trap-affinity intent. Default compile target is `build_spec_configurator`.
- `hazard`: authored hazard cards and hazard-level affinity/vital spend. Default compile target is `build_spec_configurator`.
- `resource`: authored resource reward cards. Default compile target is `build_spec_configurator`.
- `delver`: authored player-facing actor cards. Default compile targets are `build_spec_plan` and `build_spec_configurator`.
- `warden`: authored opposing actor cards. Default compile targets are `build_spec_plan` and `build_spec_configurator`.
- `shared_config`: authored cross-cutting dungeon or run settings. Default compile targets are `build_spec_intent`, `build_spec_plan`, and `build_spec_configurator`.

Compilation target semantics:
- `build_spec_intent`: maps to top-level goal/tags/hints in `BuildSpec.intent`.
- `build_spec_plan`: maps to plan-time hints in `BuildSpec.plan.hints`.
- `build_spec_configurator`: maps to deterministic configurator inputs in `BuildSpec.configurator.inputs`.
- `artifact_extension`: reserved for additive artifacts that do not fit the current `BuildSpec` or configurator boundary yet. For this target, `artifactSchema` is required.

Current compatibility rules:
- `room-plan` remains the direct additive authoring path for `room` requests and any `shared_config` budget/affinity hints it already supports.
- `hazard-plan` remains the direct additive authoring path for `hazard` requests and compatible `shared_config` hints.
- `resource-plan` remains the direct additive authoring path for `resource` requests and compatible `shared_config` hints.
- `delver-plan` remains the direct additive authoring path for `delver` requests and compatible `shared_config` hints.
- `warden-plan` remains the direct additive authoring path for `warden` requests and compatible `shared_config` hints.
- `build --spec` remains the generic entry point once an agent command has been compiled to `BuildSpec`.
- `configurator` remains the direct entry point for deterministic `levelGen`, `actors`, trap placement, hazard placement, resource drops, and tile-shape payloads.
- `floor_tile` and richer `trap` requests are intentionally mapped as `build_spec_configurator` work first; when an authored request cannot be represented by current configurator inputs, it must declare `artifact_extension` instead of inventing an unversioned side channel.

Build inputs/outputs:
- Input: `--spec path` (BuildSpec JSON, schema `agent-kernel/BuildSpec`).
- Output dir: `artifacts/runs/<runId>/build` by default, or `--out-dir`.
- Outputs: `spec.json`, optional `budget.json`, `price-list.json`, `budget-receipt.json`,
  `sim-config.json`, `initial-state.json`, `resource-bundle.json`, plus `bundle.json`,
  `manifest.json`, `telemetry.json`.
- `--emit-intermediates` additionally persists `intent.json`, `plan.json`, `solver-request.json`,
  `solver-result.json`, and captured inputs as `captured-input-<adapter>-<index>.json`.
- Bundle/manifest: `bundle.json` (inlined artifacts + schemas), `manifest.json` (paths + schemas),
  `telemetry.json` (run-scope record).

### `schemas`
Emit the full runtime schema catalog for UI or agent discovery. With `--out-dir`, writes
`schemas.json`; otherwise prints JSON to stdout.

### `solve`
Stage a constrained scenario (e.g., "two actors conflict") and emit a `SolverRequest`
artifact plus a `SolverResult` using a stubbed/fixture-driven solver adapter (no network).

### `run`
Execute a configured simulation run using captured artifacts, emitting TickFrame and
effect logs plus a minimal RunSummary artifact.

When the run's inputs come from an authored `create` outDir (identified by the sibling
pre-run `bundle.json` next to `--sim-config`), `run` also stitches a post-run
`agent-kernel/GameplayBundle` from the resolved artifacts and recorded tick frames. It
writes that bundle to `bundle.json` in the run outDir, upgrades the create outDir's
`bundle.json` in place to the same loadable playback shape, and reports both under
`artifactPaths.bundle` and `artifactPaths.create_bundle`. Fixture-driven runs stay
bundle-free so CLI run output remains artifact-for-artifact equivalent to the browser
host's run output. The stitched bundle is what `ak_push_to_ui` delivers to the UI.

### `configurator`
Build `SimConfigArtifact` + `InitialStateArtifact` outputs from deterministic configurator inputs.

### `replay`
Replay a run deterministically from captured inputs and TickFrames without external IO,
producing a replay summary and regenerated TickFrames.

### `inspect`
Summarize or extract telemetry snapshots for debugging and analysis.

### Adapter demo commands
These commands exercise the external adapters directly.

- `ipfs`: fetch text/JSON by CID via an HTTP gateway.
- `ipfs-publish`: publish canonical artifact maps to IPFS (or fixture CID) and emit a publish summary.
- `ipfs-load`: load canonical artifact files (bundle/spec/manifest/sim-config/initial-state/...) from an IPFS CID into a local output directory.
- `blockchain`: fetch chain id and optional balance via JSON-RPC.
- `blockchain-mint`: mint a canonical card configuration artifact through the blockchain adapter contract.
- `blockchain-load`: load a minted card configuration artifact by token id through the blockchain adapter contract.
- `llm` (alias: `ollama`): request a response from an LLM endpoint (Ollama/OpenAI-compatible HTTP API).

### Local run
```
node packages/adapters-cli/src/cli/ak.mjs <command> [options]
```

Example usage:
```
node packages/adapters-cli/src/cli/ak.mjs build --spec tests/fixtures/artifacts/build-spec-v1-basic.json --out-dir artifacts/build_demo
node packages/adapters-cli/src/cli/ak.mjs llm-plan --scenario tests/fixtures/e2e/e2e-scenario-v1-basic.json --model fixture --fixture tests/fixtures/adapters/llm-generate-summary.json --run-id run_llm_plan_fixture --created-at 2025-01-01T00:00:00Z --out-dir artifacts/llm_plan_demo
node packages/adapters-cli/src/cli/ak.mjs llm-plan --scenario tests/fixtures/e2e/e2e-scenario-v1-basic.json --model fixture --fixture tests/fixtures/adapters/llm-generate-summary-budget-loop.json --budget-loop --run-id run_llm_plan_loop --created-at 2025-01-01T00:00:00Z --out-dir artifacts/llm_plan_loop_demo
node packages/adapters-cli/src/cli/ak.mjs llm-plan --text "a dungeon with two fire delvers" --catalog tests/fixtures/pool/catalog-basic.json --budget-tokens 200 --run-id run_llm_plan_text --created-at 2025-01-01T00:00:00Z --out-dir artifacts/llm_plan_text_demo
node packages/adapters-cli/src/cli/ak.mjs llm-plan --prompt "Plan a small fire dungeon." --catalog tests/fixtures/pool/catalog-basic.json --model fixture --goal "Prompt-only goal" --budget-tokens 800 --fixture tests/fixtures/adapters/llm-generate-summary.json --run-id run_llm_plan_prompt --created-at 2025-01-01T00:00:00Z --out-dir artifacts/llm_plan_prompt_demo
node packages/adapters-cli/src/cli/ak.mjs create --text "Create a fire room with a trap, one delver, and one warden." --room "size=large;count=1;affinities=fire:emit:3" --floor-tile "count=18" --trap "x=2;y=2;affinity=fire;expression=push;stacks=2" --delver "count=1;affinity=fire;motivation=attacking;setup-mode=user" --warden "count=1;affinity=fire;motivation=defending" --run-id run_create_demo --created-at 2026-04-08T00:00:00Z --out-dir artifacts/create_demo
node packages/adapters-cli/src/cli/ak.mjs configure --text "Configure the trap layout for the room." --room "size=small;count=1" --trap "id=trap_fire;x=1;y=1;affinity=fire;expression=emit;stacks=1" --run-id run_configure_demo --created-at 2026-04-08T00:00:00Z --out-dir artifacts/configure_demo
node packages/adapters-cli/src/cli/ak.mjs room-plan --room "size=small;count=2;affinities=dark:emit:2,fire:push:1" --room "size=large;count=1" --run-id run_room_plan_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/room_plan_demo
node packages/adapters-cli/src/cli/ak.mjs room-plan --room "size=small;count=1;affinities=fire:emit:2" --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --price-list tests/fixtures/artifacts/price-list-artifact-v1-basic.json --run-id run_room_plan_budget_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/room_plan_budget_demo
node packages/adapters-cli/src/cli/ak.mjs hazard-plan --hazard "affinity=fire;expression=emit;proximityRadius=2;mana=regen:4:4:1" --run-id run_hazard_plan_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/hazard_plan_demo
node packages/adapters-cli/src/cli/ak.mjs hazard-plan --hazard "affinity=fire;expression=emit;proximityRadius=2;mana=regen:4:4:1" --budget-tokens 200 --run-id run_hazard_plan_budget_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/hazard_plan_budget_demo
node packages/adapters-cli/src/cli/ak.mjs resource-plan --resource "permanenceMode=permanent;vital=mana;delta=6" --run-id run_resource_plan_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/resource_plan_demo
node packages/adapters-cli/src/cli/ak.mjs resource-plan --resource "permanenceMode=permanent;vital=mana;delta=6" --budget-tokens 200 --run-id run_resource_plan_budget_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/resource_plan_budget_demo
node packages/adapters-cli/src/cli/ak.mjs delver-plan --delver "count=2;affinity=fire;motivation=attacking" --delver "count=1;affinity=earth;motivation=patrolling" --run-id run_delver_plan_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/delver_plan_demo
node packages/adapters-cli/src/cli/ak.mjs delver-plan --delver "count=1;affinity=fire" --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --price-list tests/fixtures/artifacts/price-list-artifact-v1-basic.json --run-id run_delver_plan_budget_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/delver_plan_budget_demo
node packages/adapters-cli/src/cli/ak.mjs delver-plan --delver "count=1;affinity=fire;motivation=attacking;setup-mode=user;affinities=fire:push:3,wind:emit:2;vitals=health:12:12:1,mana:7:7:2,stamina:6:6:1,durability:5:5:0" --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --price-list tests/fixtures/artifacts/price-list-artifact-v1-basic.json --run-id run_delver_plan_advanced_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/delver_plan_advanced_demo
node packages/adapters-cli/src/cli/ak.mjs warden-plan --warden "count=2;affinity=dark;motivation=defending" --warden "count=1;affinity=earth;motivation=stationary" --run-id run_warden_plan_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/warden_plan_demo
node packages/adapters-cli/src/cli/ak.mjs warden-plan --warden "count=1;affinity=dark" --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --price-list tests/fixtures/artifacts/price-list-artifact-v1-basic.json --run-id run_warden_plan_budget_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/warden_plan_budget_demo
node packages/adapters-cli/src/cli/ak.mjs warden-plan --warden "count=1;affinity=dark;motivation=defending;affinities=dark:emit:4,earth:pull:1;vitals=health:15:15:0,mana:3:3:1,stamina:4:4:1,durability:8:8:0" --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --price-list tests/fixtures/artifacts/price-list-artifact-v1-basic.json --run-id run_warden_plan_advanced_demo --created-at 2025-01-01T00:00:00Z --out-dir artifacts/warden_plan_advanced_demo
node packages/adapters-cli/src/cli/ak.mjs schemas --out-dir artifacts/shared/schemas
node packages/adapters-cli/src/cli/ak.mjs solve --scenario "two actors conflict"
node packages/adapters-cli/src/cli/ak.mjs run --sim-config path/to/sim-config.json --initial-state path/to/initial-state.json --ticks 3
node packages/adapters-cli/src/cli/ak.mjs run --from-run run_fixture --ticks 5 --progress 2>&1 >/dev/null
node packages/adapters-cli/src/cli/ak.mjs run --sim-config path/to/sim-config.json --initial-state path/to/initial-state.json --actions path/to/action-sequence.json --ticks 0
node packages/adapters-cli/src/cli/ak.mjs configurator --level-gen path/to/level-gen.json --actors path/to/actors.json --out-dir path/to/out
node packages/adapters-cli/src/cli/ak.mjs configurator --level-gen path/to/level-gen.json --actors path/to/actors.json --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --price-list tests/fixtures/artifacts/price-list-artifact-v1-basic.json --out-dir path/to/out
node packages/adapters-cli/src/cli/ak.mjs run --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json --ticks 0 --affinity-presets tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json --affinity-loadouts tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json --affinity-summary
node packages/adapters-cli/src/cli/ak.mjs replay --sim-config path/to/sim-config.json --initial-state path/to/initial-state.json --tick-frames path/to/tick-frames.json
node packages/adapters-cli/src/cli/ak.mjs inspect --tick-frames path/to/tick-frames.json --effects-log path/to/effects-log.json
node packages/adapters-cli/src/cli/ak.mjs ipfs --cid bafy... --json
node packages/adapters-cli/src/cli/ak.mjs ipfs-publish --artifact-map tests/fixtures/adapters/ipfs-artifacts-map.json --fixture-cid bafyfixture
node packages/adapters-cli/src/cli/ak.mjs ipfs-load --cid bafy... --out-dir artifacts/ipfs_load_demo
node packages/adapters-cli/src/cli/ak.mjs blockchain --rpc-url https://rpc.example --address 0xabc
node packages/adapters-cli/src/cli/ak.mjs blockchain-mint --rpc-url http://local --card tests/fixtures/adapters/card-config-delver.json --owner 0xabc --fixture-chain-id tests/fixtures/adapters/blockchain-chain-id.json --fixture-mint tests/fixtures/adapters/blockchain-mint.json
node packages/adapters-cli/src/cli/ak.mjs blockchain-load --rpc-url http://local --token-id token_fixture_1 --fixture-chain-id tests/fixtures/adapters/blockchain-chain-id.json --fixture-load tests/fixtures/adapters/blockchain-load.json
node packages/adapters-cli/src/cli/ak.mjs llm --model phi4 --prompt "Summarize plan"
node packages/adapters-cli/src/cli/ak.mjs solve --scenario "two actors conflict" --solver-fixture tests/fixtures/artifacts/solver-result-v1-basic.json
```

UI-to-CLI parity recipes (Room/Hazard/Resource/Delver/Warden, AD1):
```
# 1) Room parity recipe (RP1-RP4): author rooms, costs, then smoke-run with one actor override.
node packages/adapters-cli/src/cli/ak.mjs room-plan --room "size=small;count=2;affinities=dark:emit:2,fire:push:1" --room "size=large;count=1;affinities=water:pull:1" --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --price-list tests/fixtures/artifacts/price-list-artifact-v1-basic.json --run-id run_room_parity_recipe --created-at 2026-03-08T00:00:00Z --out-dir artifacts/parity-recipes/room
node packages/adapters-cli/src/cli/ak.mjs run --sim-config artifacts/parity-recipes/room/sim-config.json --initial-state artifacts/parity-recipes/room/initial-state.json --actor room_probe,1,1,motivated --ticks 0 --run-id run_room_parity_recipe_playback --created-at 2026-03-08T00:00:00Z --out-dir artifacts/parity-recipes/room-run

# 2) Hazard parity recipe: direct hazard authoring + sidecar artifact.
node packages/adapters-cli/src/cli/ak.mjs hazard-plan --hazard "affinity=fire;expression=emit;proximityRadius=2;mana=regen:4:4:1" --budget-tokens 200 --run-id run_hazard_parity_recipe --created-at 2026-03-08T00:00:00Z --out-dir artifacts/parity-recipes/hazard

# 3) Resource parity recipe: direct resource authoring + sidecar artifact.
node packages/adapters-cli/src/cli/ak.mjs resource-plan --resource "permanenceMode=permanent;vital=mana;delta=6" --budget-tokens 200 --run-id run_resource_parity_recipe --created-at 2026-03-08T00:00:00Z --out-dir artifacts/parity-recipes/resource

# 4) Delver parity recipe (AP1/AP2): direct advanced delver authoring + playback.
node packages/adapters-cli/src/cli/ak.mjs delver-plan --delver "count=1;affinity=fire;motivation=attacking;setup-mode=user;affinities=fire:push:3,wind:emit:2;vitals=health:12:12:1,mana:7:7:2,stamina:6:6:1,durability:5:5:0" --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --price-list tests/fixtures/artifacts/price-list-artifact-v1-basic.json --run-id run_delver_parity_recipe --created-at 2026-03-08T00:00:00Z --out-dir artifacts/parity-recipes/delver
node packages/adapters-cli/src/cli/ak.mjs run --sim-config artifacts/parity-recipes/delver/sim-config.json --initial-state artifacts/parity-recipes/delver/initial-state.json --ticks 0 --run-id run_delver_parity_recipe_playback --created-at 2026-03-08T00:00:00Z --out-dir artifacts/parity-recipes/delver-run

# 5) Warden parity recipe (DP1/DP2): direct advanced warden authoring + playback.
node packages/adapters-cli/src/cli/ak.mjs warden-plan --warden "count=1;affinity=dark;motivation=defending;affinities=dark:emit:4,earth:pull:1;vitals=health:15:15:0,mana:3:3:1,stamina:4:4:1,durability:8:8:0" --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --price-list tests/fixtures/artifacts/price-list-artifact-v1-basic.json --run-id run_warden_parity_recipe --created-at 2026-03-08T00:00:00Z --out-dir artifacts/parity-recipes/warden
node packages/adapters-cli/src/cli/ak.mjs run --sim-config artifacts/parity-recipes/warden/sim-config.json --initial-state artifacts/parity-recipes/warden/initial-state.json --ticks 0 --run-id run_warden_parity_recipe_playback --created-at 2026-03-08T00:00:00Z --out-dir artifacts/parity-recipes/warden-run
```

Fixture-driven usage (no network):
```
node packages/adapters-cli/src/cli/ak.mjs ipfs --cid bafy... --json --fixture tests/fixtures/adapters/ipfs-price-list.json
node packages/adapters-cli/src/cli/ak.mjs ipfs-publish --artifact-map tests/fixtures/adapters/ipfs-artifacts-map.json --fixture-cid bafyfixture --out-dir artifacts/ipfs_publish_fixture
node packages/adapters-cli/src/cli/ak.mjs ipfs-load --cid bafyfixture --fixture-map tests/fixtures/adapters/ipfs-artifacts-map.json --out-dir artifacts/ipfs_load_fixture
node packages/adapters-cli/src/cli/ak.mjs blockchain --rpc-url http://local --address 0xabc --fixture-chain-id tests/fixtures/adapters/blockchain-chain-id.json --fixture-balance tests/fixtures/adapters/blockchain-balance.json
node packages/adapters-cli/src/cli/ak.mjs blockchain-mint --rpc-url http://local --card tests/fixtures/adapters/card-config-delver.json --owner 0xabc --fixture-chain-id tests/fixtures/adapters/blockchain-chain-id.json --fixture-mint tests/fixtures/adapters/blockchain-mint.json
node packages/adapters-cli/src/cli/ak.mjs blockchain-load --rpc-url http://local --token-id token_fixture_1 --fixture-chain-id tests/fixtures/adapters/blockchain-chain-id.json --fixture-load tests/fixtures/adapters/blockchain-load.json
node packages/adapters-cli/src/cli/ak.mjs llm --model fixture --prompt "hello" --fixture tests/fixtures/adapters/llm-generate.json
node packages/adapters-cli/src/cli/ak.mjs llm-plan --scenario tests/fixtures/e2e/e2e-scenario-v1-basic.json --model fixture --fixture tests/fixtures/adapters/llm-generate-summary.json --run-id run_llm_plan_fixture --created-at 2025-01-01T00:00:00Z
node packages/adapters-cli/src/cli/ak.mjs llm-plan --scenario tests/fixtures/e2e/e2e-scenario-v1-basic.json --model fixture --fixture tests/fixtures/adapters/llm-generate-summary-budget-loop.json --budget-loop --run-id run_llm_plan_loop --created-at 2025-01-01T00:00:00Z
node packages/adapters-cli/src/cli/ak.mjs llm-plan --text "a dungeon with two fire delvers" --catalog tests/fixtures/pool/catalog-basic.json --budget-tokens 200 --run-id run_llm_plan_text --created-at 2025-01-01T00:00:00Z
node packages/adapters-cli/src/cli/ak.mjs llm-plan --prompt "Plan a small fire dungeon." --catalog tests/fixtures/pool/catalog-basic.json --model fixture --goal "Prompt-only goal" --budget-tokens 800 --fixture tests/fixtures/adapters/llm-generate-summary.json --run-id run_llm_plan_prompt --created-at 2025-01-01T00:00:00Z
node packages/adapters-cli/src/cli/ak.mjs room-plan --room "size=small;count=1" --run-id run_room_plan_fixture --created-at 2025-01-01T00:00:00Z
node packages/adapters-cli/src/cli/ak.mjs hazard-plan --hazard "affinity=fire;expression=emit;proximityRadius=2" --run-id run_hazard_plan_fixture --created-at 2025-01-01T00:00:00Z
node packages/adapters-cli/src/cli/ak.mjs resource-plan --resource "permanenceMode=level;vital=health;delta=4" --run-id run_resource_plan_fixture --created-at 2025-01-01T00:00:00Z
node packages/adapters-cli/src/cli/ak.mjs delver-plan --delver "count=1;affinity=fire" --run-id run_delver_plan_fixture --created-at 2025-01-01T00:00:00Z
node packages/adapters-cli/src/cli/ak.mjs warden-plan --warden "count=1;affinity=dark" --run-id run_warden_plan_fixture --created-at 2025-01-01T00:00:00Z
node packages/adapters-cli/src/cli/ak.mjs solve --scenario "two actors conflict" --solver-fixture tests/fixtures/artifacts/solver-result-v1-basic.json
node packages/adapters-cli/src/cli/ak.mjs run --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-configurator-affinity.json --ticks 0
```

## Agent workflow recipes

### 1) Freeform room request -> previewable bundle

Use this when an agent only needs to author or adjust room/layout intent and hand the result to the UI for inspection.

```
node packages/adapters-cli/src/cli/ak.mjs create \
  --text "Create a small fire room for preview." \
  --room "size=small;count=1;affinities=fire:emit:2" \
  --run-id run_room_preview \
  --created-at 2026-04-08T00:00:00Z \
  --out-dir artifacts/room_preview
```

What to do next:
- Load `artifacts/room_preview/bundle.json` and `artifacts/room_preview/manifest.json` into the UI `Diagnostics` surface.
- Load the bundle in `Preview`; the generated room image renders on the canvas when the layout is valid.
- `Run` is still blocked until the authored bundle includes at least 1 room, 1 delver, and 1 warden.

### 2) Mixed-object request -> playable bundle -> Preview/Run

Use this when an agent wants one additive command that emits a playable bundle without hand-editing JSON.

```
node packages/adapters-cli/src/cli/ak.mjs create \
  --text "Create a fire room with a trap, one delver, and one warden." \
  --room "size=large;count=1;affinities=fire:emit:3" \
  --floor-tile "count=18" \
  --trap "x=2;y=2;affinity=fire;expression=push;stacks=2" \
  --delver "count=1;affinity=fire;motivation=attacking;setup-mode=user" \
  --warden "count=1;affinity=fire;motivation=defending" \
  --run-id run_create_demo \
  --created-at 2026-04-08T00:00:00Z \
  --out-dir artifacts/create_demo
```

Expected handoff artifacts:
- `spec.authoring.request`: normalized `AgentCommandRequestArtifact`
- `spec.json`: compiled `BuildSpec`
- `sim-config.json` + `initial-state.json`: playable runtime inputs
- `bundle.json` + `manifest.json`: UI load target for `Diagnostics`, `Preview`, and `Run`

Expected outputs (defaults when `--out-dir` is set):
- ipfs: `ipfs.json`
- ipfs-publish: `ipfs-publish.json`
- ipfs-load: `ipfs-load.json` plus fetched artifact files (for example `bundle.json`, `manifest.json`, `sim-config.json`, `initial-state.json`)
- blockchain: `blockchain.json`
- blockchain-mint: `blockchain-mint.json`
- blockchain-load: `blockchain-load.json`
- llm: `llm.json`
- solve: `solver-request.json`, `solver-result.json`
- run: `tick-frames.json`, `effects-log.json`, `runtime-decision-captures.json`, `run-summary.json`, `action-log.json`
- room-plan / hazard-plan / resource-plan / delver-plan / warden-plan: build handoff artifacts plus command-specific sidecars such as `hazard-<n>.json` and `resource-artifact-<n>.json`
- configurator: `sim-config.json`, `initial-state.json` (plus `budget-receipt.json` when `--budget` + `--price-list` are provided)

---

## Configuration

- IPFS: `--gateway` (default: `https://ipfs.io/ipfs`), `--cid`, optional `--path`.
- IPFS publish (`ipfs-publish`): `--artifact-map` (required JSON object mapping artifact filename -> JSON payload), optional `--path`, optional `--fixture-cid` for deterministic no-network publish summaries.
- IPFS reload (`ipfs-load`): `--cid` (required), optional `--path` (CID subpath root), optional repeatable `--file` filters, optional `--fixture-map` for deterministic fixture-backed loads.
- Blockchain: `--rpc-url` (required), `--address` (optional for balance).
- Blockchain mint (`blockchain-mint`): `--rpc-url` + `--card` required; optional `--owner`, `--contract`, `--token-id`, `--fixture-chain-id`, `--fixture-mint`.
- Blockchain load (`blockchain-load`): `--rpc-url` + `--token-id` required; optional `--owner`, `--contract`, `--fixture-chain-id`, `--fixture-load`.
- LLM (Ollama-style): `--base-url` (default: `http://localhost:11434`), `--model` (default: `phi4`), `--prompt`.
- LLM format hint: set `AK_LLM_FORMAT=json` to request JSON-only output from Ollama-compatible endpoints.
- Fixture mode: `--fixture`, `--fixture-chain-id`, `--fixture-balance` (no network).
- Run action log: `--actions` path to an ActionSequence artifact (emitted to `action-log.json`).
- Configurator budget inputs: `--budget`, `--price-list`, optional `--receipt-out` to write the receipt elsewhere.
- Agent authoring contract discovery: run `schemas` and inspect the `agent-kernel/AgentCommandRequestArtifact` entry for the canonical taxonomy and field list.
- Room authoring (`room-plan`): repeat `--room` with `size=<small|medium|large>;count=<n>;affinities=<kind>:<expression>:<stacks>,...`.
  If `affinities` is omitted, the command applies `dark:emit:2`.
  Use `--budget` + `--price-list` together to emit `budget-receipt.json` from the same run.
- Hazard authoring (`hazard-plan`): repeat `--hazard` with `affinity=<kind>;expression=<push|pull|emit|draw>;proximityRadius=<n>[;mana=one-time:<amount>|regen:<current>:<max>:<regen>]`.
  Use `--budget-tokens` or `--budget` + `--price-list` to enforce a hazards-only allocation receipt.
- Resource authoring (`resource-plan`): repeat `--resource` with `permanenceMode=<consumable|level|permanent>;vital=<health|mana|stamina>;delta=<n>[;id=<id>]`.
  Use `--budget-tokens` or `--budget` + `--price-list` to enforce a resources-only allocation receipt.
- Delver authoring (`delver-plan`): repeat `--delver` with `count=<n>;affinity=<kind>;motivation=<kind>[;id=<id>]`.
  If `affinity` is omitted, the command falls back to `--dungeon-affinity` (default `fire`).
  If `motivation` is omitted, default is `attacking`.
  Repeating `motivation` inside the same `--delver` spec is rejected.
  Optional advanced fields in `--delver`: `affinities=<kind>[:<expression>[:<stacks>]],...`,
  `vitals=<vital>:<max>:<regen>,...` or `<vital>:<current>:<max>:<regen>,...`,
  and `setup-mode=<auto|user|hybrid>`.
  Use `--budget` + `--price-list` together to emit `budget-receipt.json` from the same run.
- Warden authoring (`warden-plan`): repeat `--warden` with `count=<n>;affinity=<kind>;motivation=<kind>[;id=<id>]`.
  If `affinity` is omitted, the command falls back to `--dungeon-affinity` (default `fire`).
  If `motivation` is omitted, default is `defending`.
  Repeating `motivation` inside the same `--warden` spec is rejected.
  Optional advanced fields in `--warden`: `affinities=<kind>[:<expression>[:<stacks>]],...`,
  `vitals=<vital>:<max>:<regen>,...` or `<vital>:<current>:<max>:<regen>,...`.
  Use `--budget` + `--price-list` together to emit `budget-receipt.json` from the same run.
- Actor overrides (run):
  - `--actor id,x,y,kind` (kind: motivated/ambulatory/stationary)
  - `--vital actorId,vital,current,max,regen`
  - `--vital-default vital,current,max,regen`
  - `--tile-wall x,y`, `--tile-barrier x,y`, `--tile-floor x,y` (repeatable)

When overrides are provided, `run` writes `resolved-sim-config.json` and
`resolved-initial-state.json` to the output directory for inspection.

## Configurator artifacts (affinities + traps)

Configurator artifacts are affinity-only (no martial weapons). Affinity kinds:
fire, water, earth, wind, life, decay, corrode, fortify, light, dark. Expressions: push, pull, emit.

Example `SimConfigArtifact.layout.data` snippet with traps:
```json
{
  "layout": {
    "kind": "grid",
    "data": {
      "tiles": ["#####", "#.S.#", "#..E#", "#...#", "#####"],
      "kinds": [[1,1,1,1,1],[1,0,0,0,1],[1,0,2,0,1],[1,0,0,0,1],[1,1,1,1,1]],
      "traps": [
        { "x": 2, "y": 2, "blocking": false, "affinity": { "kind": "fire", "expression": "push", "stacks": 2 } }
      ]
    }
  }
}
```

Example `InitialStateArtifact.actors[].traits` snippet:
```json
{
  "traits": {
    "affinities": { "fire:push": 2, "life:pull": 1 },
    "abilities": [
      { "id": "fire_bolt", "kind": "attack", "affinityKind": "fire", "expression": "push", "potency": 4, "manaCost": 6 }
    ]
  }
}
```

Defaults: manaCost=0, stacks=1, roomCount=4, roomMinSize=3, roomMaxSize=9, corridorWidth=1, edgeBias=false. Required:
preset id, kind, expression, actor id. Deterministic ordering is preserved in artifacts.

Affinity summary output (resolved from presets + loadouts):
- `--affinity-presets` path to `AffinityPresetArtifact`
- `--affinity-loadouts` path to `ActorLoadoutArtifact`
- When both are supplied, `run` writes `affinity-summary.json` to `--out-dir` (default). Use `--affinity-summary` to override the output path.

Example:
```
node packages/adapters-cli/src/cli/ak.mjs run --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json --ticks 0 --affinity-presets tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json --affinity-loadouts tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json --affinity-summary
```
Expected outputs in `--out-dir`:
- `affinity-summary.json`
- `run-summary.json`
- `tick-frames.json`

Configurator command (artifact builder):
- `--level-gen` path to configurator level-gen input
- `--actors` path to an `{ actors: [...] }` payload
- Optional: `--plan`, `--budget-receipt`, `--affinity-presets`, `--affinity-loadouts`

Example:
```
node packages/adapters-cli/src/cli/ak.mjs configurator --level-gen tests/fixtures/configurator/level-gen-input-v1-trap.json --actors tests/fixtures/configurator/actors-v1-affinity-base.json --affinity-presets tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json --affinity-loadouts tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json --out-dir artifacts/configurator_demo
```

## Demo bundle script

Run all fixture-first demos and emit artifacts under `artifacts/demo-bundle` (override path with an argument):
```
pnpm run demo:cli
pnpm run demo:cli -- /tmp/agent-kernel-demo
```

## Effect logs and TickFrames

- `run` and `replay` emit TickFrames and effect logs containing effect ids, requestIds, adapter hints, and fulfillment status.
- `need_external_fact` effects with `sourceRef` are fulfilled deterministically; others are deferred for post-run handling.
- `solver_request` effects carry requestId + targetAdapter; fixture solver adapters respond deterministically when provided.
- `log`/`telemetry` effects include severity/tags/personaRef for UI/CLI inspection.

Inspect the emitted artifacts in your chosen `--out-dir` or `artifacts/demo-bundle` to see these shapes. Examples align with `tests/fixtures/adapters/effects-routing.json`.

## MCP sandbox bridge (`ak_push_to_ui`)

The MCP server's `ak_push_to_ui` tool delivers an `agent-kernel/GameplayBundle` to a
connected browser UI over the sandbox WebSocket bridge
(`packages/adapters-cli/src/mcp/bridge-server.mjs`), so an agent can author with
`ak_create`, execute with `ak_run`, and load the result into the gameplay surface
without manual file handoff.

- Bundle source (one of): inline `bundle`, an explicit `bundlePath`, or an `outDir`
  containing `bundle.json` (the shape written by `run`'s post-run stitching or by
  `create` pre-run).
- `targetTab`: `"design"` or `"gameplay"` (default `"gameplay"`).
- `requireClient` (default `true`): fail if no browser UI is connected; the browser side
  is `packages/ui-web/src/sandbox-bridge-client.js`.
- `openBrowser` (default `false`): serve the canonical `index_c.html` via
  `scripts/serve-ui.mjs` (only when nothing answers `/health`), open the default browser,
  and pre-stage the bundle so the UI loads it on connect. Implies `requireClient: false`.
  UI host/port come from `AK_UI_HOST` / `AK_UI_PORT` (default `127.0.0.1:8001`);
  `AK_DISABLE_UI_LAUNCH=1` skips the side effects.
- Bridge port: `38487` by default, overridable with `AK_SANDBOX_BRIDGE_PORT`.
- Failure results are structured: missing bundle sources, invalid bundle shape, bridge
  start failure (`SANDBOX_BRIDGE_START_FAILED`), and no-connected-client cases each
  return `ok: false` with a specific reason rather than throwing.

## Architectural Intent

CLI tools are **adapters** in the Ports & Adapters model:

- They live outside `core-ts` and do not depend on browser APIs.
- They interact with runtime through ports and artifacts.
- They can use native Node capabilities (file system, process control) without changing
  determinism, because inputs/outputs are fully captured as artifacts.

This keeps the core small and deterministic, while providing powerful automation
for development and batch workflows.

---

## Relationship to Runtime and Core

```
cli -> adapters-cli -> runtime -> core-ts
```

The CLI layer is a **driver**, not a simulator. It delegates command policy to the
shared runtime command kernel and uses the synchronous TypeScript core through runtime
boundaries.

# Documentation Index

This folder contains the design intent and architecture rules for the project.

## Core documents

- `docs/vision-contract.md` — Non-negotiable constraints and scope boundaries.
- `docs/architecture-charter.md` — Ports & Adapters rules and dependency direction.
- `docs/architecture/diagram.mmd` — Mermaid architecture overview (printable).
- `docs/architecture/persona-state-machines.md` — Deterministic persona FSM rules and state sets.

If a plan or README conflicts with these documents, the charter and vision contract win.

## Runtime execution model

- The tick FSM (`init → observe → decide → apply → emit → summarize`) is the canonical runtime loop.
- The runtime runner uses the tick FSM and routes phase events through the tick orchestrator and personas before applying actions to `core-as`.
- TickFrames are emitted per phase and include actions/effects plus persona views/telemetry for deterministic replay.
- Runtime inputs contract: `docs/runtime-inputs.md` documents `personaEvents`/`personaPayloads` and control events.

## Actor-centric model

- Actors are the core state primitive (tile actors for the grid, motivated actors for movement).
- Vitals defaults are always explicit: health/mana/stamina/durability with current/max/regen.
- Capability semantics (movement/action costs) live in core-as; runtime supplies the parameters.
- Implementation details live in `docs/implementation-plans/everything-actors.md`.

## Configurator highlights

- Affinity-only equipment (no martial weapons): kinds = fire, water, earth, wind, life, decay, corrode, dark.
- Expressions define delivery: push (external), pull (internal), emit (area).
- Presets and loadouts are captured as artifacts with deterministic ordering and defaults (manaCost=0, stacks=1).
- Traps are tile actors with mana + durability only and an affinity expression payload.
- The active UI workflow is `Design -> Preview -> Run`, with `Diagnostics` as the supporting inspection surface. The UI is expected to publish canonical artifacts and then render them, not maintain a parallel gameplay/configuration rail.

## Budgeting + price lists

- Token budgets and price lists flow from Orchestrator → Director → Configurator → Allocator.
- Artifacts: `agent-kernel/BudgetArtifact`, `agent-kernel/PriceList`, `agent-kernel/BudgetAllocationArtifact`, `agent-kernel/BudgetReceiptArtifact`, and `agent-kernel/SpendProposal`.
- Configurator emits a spend proposal from layout/actor/trap inputs; **Allocator is the auditing authority** and validates against budget + price list and emits a receipt.
- Tokens are integer units (future ERC20 linkage remains at the adapter boundary).
- Tile budgeting uses price list ids `tile_wall`, `tile_floor`, and `tile_hallway` (kind `tile`) when provided; otherwise layout tiles default to cost 1 each.
- Layout budgeting is tile-count based; layout spend uses the layout pool and any unspent layout tokens roll into wardens. Actors are categorized as ambulatory or stationary (trap-like) during planning.

Example flow (proposal → receipt):
```json
{
  "proposal": { "schema": "agent-kernel/SpendProposal", "schemaVersion": 1, "items": [{ "id": "actor_spawn", "kind": "actor", "quantity": 2 }] },
  "receipt": { "schema": "agent-kernel/BudgetReceiptArtifact", "schemaVersion": 1, "status": "approved", "totalCost": 50, "remaining": 950 }
}
```

Key artifacts and fixtures:
- `agent-kernel/AffinityPresetArtifact` → `tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json`
- `agent-kernel/ActorLoadoutsArtifact` → `tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json`
- `agent-kernel/SimConfigArtifact` (layout + traps) → `tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json`
- `agent-kernel/InitialStateArtifact` (traits.affinities/abilities) → `tests/fixtures/artifacts/initial-state-artifact-v1-configurator-affinity.json`
- UI fixture bundle (affinities + traps) → `tests/fixtures/ui/affinity-trap-bundle/`

## Builder workflow + schema catalog

- Agent/CLI/UI share the same BuildSpec (`agent-kernel/BuildSpec`). The agent writes a spec, the CLI builds artifacts, and the UI can load/edit the emitted bundle without translation.
- `create` and `configure` are the additive agent-facing entry points for freeform authoring. They emit `request.json`, `spec.json`, and the same bundle/manifest pair the UI already understands.
- CLI build emits `manifest.json`, `bundle.json`, and `telemetry.json` alongside artifacts. Manifest/bundle include a filtered `schemas` list so the UI can load only referenced contracts.
- Schema catalog: `node packages/adapters-cli/src/cli/ak.mjs schemas` prints the full catalog (or writes `schemas.json` with `--out-dir`).
- Fixtures: `tests/fixtures/ui/build-spec-bundle/` shows a round-trip build bundle, and `tests/fixtures/artifacts/build-spec-v1-basic.json` shows the build spec shape.
- Preview behavior: the UI `Preview` tab renders a generated room image on the canvas whenever the bundle carries a renderable layout and `pnpm run build:wasm` has populated `packages/ui-web/assets/core-as.wasm`. `Build And Load Game` still requires at least 1 room, 1 delver, and 1 warden in the authored card set before the Run surface is considered playable.

## Shared command execution

- `packages/runtime/src/commands/kernel.js` is the shared command layer for `build`, `solve`, `run`, `replay`, `inspect`, `configurator`, `budget`, and `llm-plan`.
- `packages/adapters-cli/src/cli/ak.mjs` is the Node host shell for those commands: it provides filesystem/process access plus WASM loading, but delegates command policy to the runtime kernel.
- `packages/adapters-web/src/adapters/cli-worker/` is the browser host for the same kernel: it uses a fetch-backed virtual filesystem, worker or in-process execution, and browser-side WASM loading from `/assets/core-as.wasm`.
- `tests/integration/ui-cli-equivalence.test.js` enforces canonical Node-vs-browser artifact equivalence for the shared kernel commands.
- Runtime reasoning also reuses the existing effect rail: actors emit `solver_request` entries carrying `runtime-decision-v1`, solver/captured-LLM responses normalize to `Action`, and explicit live local-Ollama fulfillment is allowed only in manual non-deterministic mode.
- The default Design -> Preview -> Run workflow is browser-hosted and fixture-first; live IPFS, blockchain, and Ollama services are optional capabilities, but the browser Preview/Run surfaces still require the built UI WASM asset from `pnpm run build:wasm`.
- `ipfs`, `blockchain`, and standalone `llm` now have browser-hosted shared-rail hook points through the command kernel; deeper product workflows for those capabilities can continue on dedicated follow-on branches without changing the baseline Design -> Preview -> Run path.

## LLM pipeline + runtime reasoning

- `AK_LLM_LIVE=1`: enable LLM-guided planning flows (otherwise fall back to fixtures).
- `AK_LLM_MODEL`: model name for LLM requests (required when `AK_LLM_LIVE=1`).
- `AK_LLM_BASE_URL`: LLM API base URL (default: `http://localhost:11434`).
- `AK_LLM_CAPTURE_PATH`: optional JSONL path to append live prompt/response captures.
- `AK_LLM_STRICT=1`: disable repair/sanitization; contract errors fail the flow but are captured.
- `AK_LLM_FORMAT`: optional response format hint (e.g., `json` for Ollama `/api/generate`).
- `AK_LLM_BUDGET_LOOP=1`: enable the multi-phase budget loop (layout_only → actors_only) with stop reasons `done`, `missing`, `no_viable_spend`.
- `AK_LLM_USE_WASM=1`: enable WASM core loading in the live LLM integration test.
- `AK_ALLOW_NETWORK=1`: allow non-local network access for adapters; localhost is always allowed.

Budget loop captures are phase-indexed for deterministic ordering; telemetry includes the loop trace (phase order, remaining budget, trims/warnings, and per-phase timing).
Budget pools use configurable weights passed through BuildSpec `intent.hints.poolWeights`. Default allocations are 55% rooms/layout, 20% delvers, and 25% wardens (design reference §2.2), with a default total budget of 1000 tokens (design reference §2.1). Both values are interface defaults, not fixed runtime limits.
llm-plan runs require a total budget (`--budget-tokens` or scenario `budgetTokens`).

Runtime-decision note:
- deterministic/default runtime reasoning remains solver-first plus captured/deferred LLM only;
- explicit live local-Ollama runtime fulfillment is available only when provider policy opts into manual non-deterministic mode;
- runtime decision payloads stay structured (`runtime-decision-v1`) and are carried through `SolverRequest` / `SolverResult` / `CapturedInputArtifact` rather than a second artifact family.

Determinism: prefer fixture-driven runs (`--fixture` on adapters, scenario `summaryPath` for
LLM flows) to keep outputs replayable and stable.

## Implementation plans

- `docs/implementation-plans/Tests-and-MVP.md`
- `docs/implementation-plans/documentation-review.md`
- `docs/implementation-plans/completed-structural-setup.md`
- `docs/implementation-plans/testing-inventory.md`
- `docs/implementation-plans/basic-MVP-with-actor-movement.md`
- `docs/implementation-plans/everything-configurator.md`

## Quickstarts

- `docs/human-interfaces.md` — Fixture-first CLI + web UI quickstart (build WASM, run demos, serve UI).
- `docs/cli-runbook.md` — End-to-end CLI usage and agent-friendly workflows.
- Manual smoke (offline): `pnpm run build:wasm`; `pnpm run demo:cli`; `pnpm run serve:ui` then open `http://localhost:8001/packages/ui-web/index.html`. Expect `artifacts/demo-bundle/` to contain solve/run/replay/inspect outputs plus adapter payloads (`ipfs.json`, `blockchain.json`, `llm.json`).
- Active web workflow tabs are `Design -> Preview -> Run`, with `Diagnostics` as the supporting inspection surface.
- Effect routing: TickFrames/effects logs now include effect ids, requestIds, targetAdapter hints, and fulfillment status (log/telemetry/solver_request/need_external_fact fulfill/defer). Fixture adapters cover these paths.

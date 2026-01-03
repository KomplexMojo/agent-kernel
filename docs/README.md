# Documentation Index

This folder contains the design intent and architecture rules for the project.

## Core documents

- `docs/vision-contract.md` — Non-negotiable constraints and scope boundaries.
- `docs/architecture-charter.md` — Ports & Adapters rules and dependency direction.
- `docs/architecture/diagram.mmd` — Mermaid architecture overview (printable).
- `docs/architecture/persona-state-machines.md` — Deterministic persona FSM rules and state sets.

If a plan or README conflicts with these documents, the charter and vision contract win.

## Actor-centric model

- Actors are the core state primitive (tile actors for the grid, motivated actors for movement).
- Vitals defaults are always explicit: health/mana/stamina/durability with current/max/regen.
- Implementation details live in `docs/implementation-plans/everything-actors.md`.

## Configurator highlights

- Affinity-only equipment (no martial weapons): kinds = fire, water, earth, wind, life, decay, corrode, dark.
- Expressions define delivery: push (external), pull (internal), emit (area).
- Presets and loadouts are captured as artifacts with deterministic ordering and defaults (manaCost=0, stacks=1).
- Traps are tile actors with mana + durability only and an affinity expression payload.
- UI tabs are organized by persona with Runtime as the default playback view; the Annotator tab surfaces affinity + trap metadata with a collapsible legend.

## Budgeting + price lists

- Token budgets and price lists flow from Orchestrator → Director → Configurator → Allocator.
- Artifacts: `agent-kernel/BudgetArtifact`, `agent-kernel/PriceList`, `agent-kernel/BudgetReceiptArtifact`, and `agent-kernel/SpendProposal`.
- Configurator emits a spend proposal from layout/actor/trap inputs; Allocator validates against budget + price list and emits a receipt.
- Tokens are integer units (future ERC20 linkage remains at the adapter boundary).

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
- CLI build emits `manifest.json`, `bundle.json`, and `telemetry.json` alongside artifacts. Manifest/bundle include a filtered `schemas` list so the UI can load only referenced contracts.
- Schema catalog: `node packages/adapters-cli/src/cli/ak.mjs schemas` prints the full catalog (or writes `schemas.json` with `--out-dir`).
- Fixtures: `tests/fixtures/ui/build-spec-bundle/` shows a round-trip build bundle, and `tests/fixtures/artifacts/build-spec-v1-basic.json` shows the build spec shape.

## Implementation plans

- `docs/implementation-plans/Tests-and-MVP.md`
- `docs/implementation-plans/documentation-review.md`
- `docs/implementation-plans/completed-structural-setup.md`
- `docs/implementation-plans/testing-inventory.md`
- `docs/implementation-plans/basic-MVP-with-actor-movement.md`
- `docs/implementation-plans/everything-configurator.md`

## Quickstarts

- `docs/human-interfaces.md` — Fixture-first CLI + web UI quickstart (build WASM, run demos, serve UI).
- Manual smoke (offline): `pnpm run build:wasm`; `pnpm run demo:cli`; `pnpm run serve:ui` then open `http://localhost:8001/packages/ui-web/index.html`. Expect `artifacts/demo-bundle/` to contain solve/run/replay/inspect outputs plus adapter payloads (`ipfs.json`, `blockchain.json`, `llm.json`).
- Effect routing: TickFrames/effects logs now include effect ids, requestIds, targetAdapter hints, and fulfillment status (log/telemetry/solver_request/need_external_fact fulfill/defer). Fixture adapters cover these paths.

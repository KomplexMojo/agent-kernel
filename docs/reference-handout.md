# Agent Kernel — Architecture Handout (Printable)

Focus on diagrams over text; minimal code references. Design anchors for avoiding drift.

## Ports & Adapters Shape
```mermaid
flowchart LR
  subgraph Interfaces["Interfaces"]
    UI["ui-web"]
    CLI["ak.mjs"]
  end
  subgraph Runtime["Runtime (TypeScript)"]
    Runner["tick orchestrator + runner"]
    subgraph Personas
      Orchestrator["Orchestrator"]
      Moderator["Moderator"]
      Director["Director"]
      Actor["Actor"]
      Allocator["Allocator"]
      Annotator["Annotator"]
      Configurator["Configurator"]
    end
  end
  subgraph Bindings["bindings-ts"]
    Bind["WASM bindings"]
  end
  subgraph Core["core-as (WASM)"]
    Core["Deterministic core"]
  end
  subgraph Adapters["Adapters (IO boundary)"]
    AWeb["adapters-web"]
    ACli["adapters-cli"]
    ATest["adapters-test"]
  end
  UI --> Runner
  CLI --> Runner
  Runner --> Core
  Runner --> AWeb
  Runner --> ACli
  Runner --> ATest
  Bind --> Core
  UI --> Bind
```

## Tick Super FSM
```mermaid
stateDiagram-v2
  [*] --> init
  init --> observe: observe
  observe --> decide: decide
  decide --> apply: apply
  apply --> emit: emit
  emit --> summarize: summarize
  summarize --> observe: next_tick (tick++)
```

## Persona State Snapshots + Subscriptions
```mermaid
flowchart LR
  TickOrch["Tick Orchestrator\nphases: init→observe→decide→apply→emit→summarize"] --> |observe,decide,emit| Orchestrator
  TickOrch --> |decide| Director
  TickOrch --> |observe,decide| Actor
  TickOrch --> |observe,decide| Allocator
  TickOrch --> |emit,summarize| Annotator
  TickOrch --> |init,observe| Configurator
  TickOrch --> |all phases| Moderator
```

```mermaid
stateDiagram-v2
  %% Orchestrator
  [*] --> idle
  idle --> planning: plan
  planning --> running: start_run (planRef)
  running --> replaying: replay
  running --> completed: complete
  running --> errored: error
  replaying --> completed: complete
  replaying --> errored: error
```

```mermaid
stateDiagram-v2
  %% Director
  [*] --> uninitialized
  uninitialized --> intake: bootstrap (intent|plan)
  intake --> draft_plan: ingest_intent
  intake --> ready: ingest_plan
  draft_plan --> refine: draft_complete
  refine --> ready: refinement_complete
  ready --> stale: invalidate_plan
  stale --> intake: refresh
```

```mermaid
stateDiagram-v2
  %% Actor
  [*] --> idle
  idle --> observing: observe
  observing --> deciding: decide
  deciding --> proposing: propose (proposals>0)
  proposing --> cooldown: cooldown
  cooldown --> observing: observe
```

```mermaid
stateDiagram-v2
  %% Allocator
  [*] --> idle
  idle --> budgeting: budget
  budgeting --> allocating: allocate (budgets>0)
  allocating --> monitoring: monitor
  monitoring --> rebalancing: rebalance (signals>0)
  rebalancing --> monitoring: monitor
```

```mermaid
stateDiagram-v2
  %% Annotator
  [*] --> idle
  idle --> recording: observe
  recording --> summarizing: summarize (observations>0)
  summarizing --> idle: reset
```

```mermaid
stateDiagram-v2
  %% Configurator
  [*] --> uninitialized
  uninitialized --> pending_config: provide_config
  pending_config --> configured: validate
  configured --> locked: lock
  configured --> pending_config: update_config
```

```mermaid
stateDiagram-v2
  %% Moderator
  [*] --> initializing
  initializing --> ticking: start
  ticking --> pausing: pause
  pausing --> ticking: resume
  ticking --> stopping: stop
  pausing --> stopping: stop
```

## Non-negotiables (short)
- Core-as is deterministic, no IO/imports; Ports & Adapters are the IO boundary.
- Persona FSMs are pure, clock-injected, serializable; tick orchestrator drives phases.
- Effects are data-only with deterministic ids/requestIds and fulfillment hints; adapters fulfill `solver_request`, `need_external_fact` (fulfill/defer), `log`, `telemetry`, and `limit_violation` without core IO.
- Browser-first, replayable runs.

## Proposed / Not Yet Implemented
- External fact vault persistence beyond fixtures (cache + replay).
- Expanded inspect/HTML reporting.
- Per-persona README/state notes (only some personas currently have detailed docs).
- Rich solver integration beyond fixtures.

## Manual Smoke (fixtures, offline)
- `pnpm run build:wasm` then `pnpm run demo:cli` → artifacts in `artifacts/demo-bundle`.
- `pnpm run serve:ui` → open `http://localhost:8001/packages/ui-web/index.html` and run the Adapter Playground in fixture mode (IPFS/blockchain/LLM/solver); counter/effect log should show effect ids/requestIds/fulfillment.
- Expected artifacts: solve (`solver-request.json`, `solver-result.json`), run (`tick-frames.json`, `effects-log.json` with ids/requestIds/adapter hints), replay (`replay-summary.json`), inspect (`inspect-summary.json`), adapters (`ipfs.json`, `blockchain.json`, `llm.json`).

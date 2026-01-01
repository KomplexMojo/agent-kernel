# Interface Implementation Plan

Goal: keep the playing surface uncluttered while providing a structured “Run Builder” for configuration and persona-aware diagnostics.

## Layout Overview
- Split view: left side houses the Run Builder (configuration flow); right side is the Playing Surface.
- Top bar: run name, status (draft/running), chain/IPFS indicators, replay/load entry point.
- Footer on the left pane only: navigation (Prev/Next), save draft, start run.

## Run Builder (Left Pane)
- Step rail: 1) Intent & Plan, 2) Budgets, 3) Actors, 4) Adapters, 5) Config, 6) Preview & Start.
- Only one step’s form is visible at a time; others are minimized.
- Example content (Actors step):
  - Actor list + detail editor (name/ID, appearance/NFT load, vitals, regen, traits/loadout).
  - Motivation stack builder (ordered, weighted).
  - Budget impact readout.
  - Validation badges (e.g., weights normalize, NFT hash recorded).
- Context/right-rail within the config pane:
  - Persona snapshots (Orchestrator/Director/Allocator/Configurator states).
  - Adapter status (IPFS gateway, blockchain RPC/wallet, fixture mode).
  - Validation summary for the current step.

## Playing Surface (Right Pane)
- Viewport: renders the current frame buffer directly (no overlays beyond selection highlight).
- Actor properties (compact, on hover/selection):
  - Name/ID, vitals (health/mana/stamina/durability), traits/loadout, current status/effects.
- Simulation controls: `[Step -] [Play/Pause] [Step +]`, tick counter.
- Commands (only if user-controlled): minimal list (move N/E/S/W, interact/use, inventory/cast). Collapsible to avoid clutter.
- Keep persona/adaptor/debug info out of this pane to preserve clarity.

## Interaction Principles
- Clear separation: configuration and diagnostics live on the left; the right pane is for play/inspection only.
- Minimal overlays: only selection highlight and the compact properties panel appear over the viewport.
- Deterministic data flow: the right pane reads from the same buffers/artifacts produced by the runtime/core; configuration changes flow through the Run Builder steps.

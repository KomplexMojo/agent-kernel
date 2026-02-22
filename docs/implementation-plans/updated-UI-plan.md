# Updated UI Plan: Card-Based Manual + AI Configuration

Goal: Introduce a drag-and-drop card configurator that supports Room, Attacker, and Defender setup using a shared left-rail item palette, a center card grid, and an AI-assisted alternative path. Preserve the approved trading-card visual style and enforce budget visibility and budget accounting directly on cards in real time.

Constraints:
- UI flow must use a single build interface: card properties on the left rail and card-building/configuration in the center workspace.
- Left rail must expose draggable property groups in this order: Type (Room/Attacker/Defender), Affinities, Expressions, Motivations.
- Center workspace must be a grid of blank card surfaces that accept dragged properties.
- Card configuration window must automatically group cards by type: Room, Attacker, Defender.
- Users must be able to add cards with an explicit "Add New Card" action and adjust duplicate count with per-card `+` and `-` controls.
- Room cards support affinity and room size (`small`, `medium`, `large`).
- Attacker cards support affinities, expressions, motivations, and vitals.
- Defender cards support affinities, expressions, motivations, and vitals.
- AI configuration must remain available as an alternative to manual card editing and must populate the same card model.
- Level budget is a shared pool for room generation.
- Every room card draws from the single shared level budget as cards are added/edited.
- Card budget/value presentation must appear on all card types (Room, Attacker, Defender).
- Room card must include a clear real-time "Card Value" indicator that updates whenever card traits change.
- Every card must support a flip action to view card front/back.
- Card back must display a token receipt derived from current card configuration, including vitals and affinities (with stacks and expressions).
- Card creation, normalization, validation, costing, and assembly must reuse existing persona/runtime code paths; UI code must not introduce parallel domain logic outside personas.
- Architecture guardrails remain in effect (UI/adapters -> runtime -> bindings-ts -> core-as; no IO in core-as).

## Implementation Steps
1. Define a unified card schema for manual and AI configuration outputs.
   Requirement: A single normalized card model can represent Room, Attacker, and Defender cards, including count, traits, vitals, and budget/value metadata.
   Tests: Add schema/unit coverage in `tests/ui-web/design-view.test.mjs` for type-specific required/optional fields and serialization stability.
   Code: `packages/ui-web/src/design-guidance.js`, `packages/runtime/src/personas/director/buildspec-assembler.js`, `packages/runtime/src/personas/director/summary-selections.js`.

2. Implement workspace layout and drag sources.
   Requirement: Single build workspace with left rail property groups (Type, Affinities, Expressions, Motivations), center card grid with blank surfaces, and card configuration grouping sections for Room/Attacker/Defender.
   Tests: Add UI structure assertions in `tests/ui-web/persona-tabs-layout.test.mjs` and `tests/ui-web/design-view.test.mjs` for section presence, grouping visibility, and grouping order.
   Code: `packages/ui-web/index.html`, `packages/ui-web/src/views/design-view.js`, `packages/ui-web/src/main.js`.

3. Implement drag-and-drop interactions and drop rules.
   Requirement: Users can drag Type and trait chips to blank/existing cards with deterministic acceptance rules per card type.
   Tests: Add behavioral tests in `tests/ui-web/design-guidance-affinity-sync.test.mjs` and `tests/ui-web/design-view.test.mjs` for valid drops, invalid drops, and replacement/removal behavior.
   Code: `packages/ui-web/src/design-guidance.js`, `packages/ui-web/src/views/design-view.js`.

4. Implement card creation, duplication, and count controls.
   Requirement: "Add New Card" creates blank card surfaces; per-card `+/-` adjusts count of matching configuration without corrupting trait payload; cards are automatically placed into the correct type group in the configuration window.
   Tests: Add count, deduplication, and auto-grouping tests in `tests/ui-web/design-view.test.mjs` for Room, Attacker, and Defender cards.
   Code: `packages/ui-web/src/design-guidance.js`, `packages/ui-web/src/views/design-view.js`.

5. Add Room card configuration semantics and level assembly linkage.
   Requirement: Room cards expose affinity + size (`small|medium|large`) and feed downstream level assembly inputs.
   Tests: Add room-card-to-level-input mapping coverage in `tests/personas/configurator-guidance-level-builder.test.js` and UI mapping checks in `tests/ui-web/design-view.test.mjs`.
   Code: `packages/ui-web/src/design-guidance.js`, `packages/runtime/src/personas/configurator/guidance-level-builder.js`, `packages/runtime/src/personas/configurator/level-layout.js`.

6. Implement shared level budget accounting for Room cards.
   Requirement: All Room cards consume from one level budget pool; adding or modifying any Room card updates shared used/remaining totals immediately.
   Tests: Add budget propagation tests in `tests/ui-web/design-view.test.mjs` and spend-ledger validation in `tests/runtime/design-spend-ledger.test.js`.
   Code: `packages/ui-web/src/design-guidance.js`, `packages/runtime/src/personas/allocator/layout-spend.js`, `packages/runtime/src/personas/configurator/spend-proposal.js`.

7. Add per-card budget/value display for all card types.
   Requirement: Room cards show real-time Card Value and shared level budget indicators; Attacker/Defender cards show their configuration value and budget indicators aligned with pool rules on the card front.
   Tests: Add card HUD assertions in `tests/ui-web/design-view.test.mjs` for value updates and budget badges across Room/Attacker/Defender cards.
   Code: `packages/ui-web/src/design-guidance.js`, `packages/ui-web/index.html`.

8. Implement card flip and token receipt back-face rendering.
   Requirement: Each card has an explicit flip control; card back renders a token receipt for current configuration (vitals, affinities, stacks, expressions, and computed token totals) and updates in real time as the card changes.
   Tests: Add interaction and rendering tests in `tests/ui-web/design-view.test.mjs` for front/back toggling, token receipt accuracy, and live-update behavior after drag/drop edits.
   Code: `packages/ui-web/src/design-guidance.js`, `packages/ui-web/src/views/design-view.js`, `packages/ui-web/index.html`.

9. Keep AI configuration as a first-class alternative to manual cards.
   Requirement: AI-generated setup populates card grid/state directly and remains editable via drag-and-drop/manual controls.
   Tests: Add round-trip tests in `tests/ui-web/design-view.test.mjs` and `tests/personas/orchestrator-llm-session.test.js` for AI -> card model -> manual edits -> build path.
   Code: `packages/ui-web/src/design-guidance.js`, `packages/runtime/src/personas/orchestrator/llm-session.js`, `packages/runtime/src/personas/orchestrator/llm-budget-loop.js`.

10. Final integration and documentation sync.
   Requirement: Build-and-load flow works from card-derived configuration with automatic Room/Attacker/Defender grouping in the card window, and plan docs reflect the new workflow.
   Tests: Run `node --test \"tests/**/*.test.js\"` or targeted suites for UI/runtime card flow if full run is too heavy.
   Code: `docs/implementation-plans/updated-UI-plan.md`, and update related docs if behavior changes become externally visible.

# UI Primary Flow Redesign Implementation Plan

Date: 2026-02-05

## Objective
Refocus the UI around the primary workflow: generate meaningful designs and actor configurations from strategic guidance, run simulations to observe interactions, and inspect actors directly on the interface. Artifact inspection remains available for troubleshooting, but moves out of the primary UI flow.

## Success Criteria
- Design view supports AI strategic guidance, design brief generation, and actor configuration editing without surfacing artifacts by default.
- Simulation view supports run controls, stage visualization, event stream, and actor inspection in one place.
- Actor inspection is a persistent right-drawer that works across Design and Simulation.
- Diagnostics view provides access to artifacts, logs, and exports without cluttering primary screens.

## Scope
- UI layout and navigation changes in packages/ui-web.
- Shared actor selection and inspector state across Design and Simulation.
- Tests updated or added in tests/ui-web.
- Documentation update in docs/human-interfaces.md to reflect the new navigation and primary workflow.

## Non-Goals
- Runtime or simulation engine changes.
- Artifact schema changes or storage format changes.
- CLI behavior changes.

## Implementation Steps
1. Establish the new top-level navigation and layout shells for Design, Simulation, and Diagnostics.
   Requirement: Users can switch between Design, Simulation, and Diagnostics, with Design as the default.
   Tests: Update tests/ui-web/persona-tabs-layout.test.mjs or add a new navigation test to assert three tabs and default selection.
   Code: packages/ui-web/index.html, packages/ui-web/src/tabs.js, packages/ui-web/src/main.js, packages/ui-web/assets/ (if new styling assets are needed).

2. Build the shared Actor Inspector drawer and selection state.
   Requirement: Selecting an actor on the canvas or stage updates the inspector with profile, capabilities, constraints, and live state (when running).
   Tests: Add tests/ui-web/actor-inspector.test.mjs to verify selection state and inspector rendering across views.
   Code: packages/ui-web/src/main.js, packages/ui-web/src/movement-ui.js, new module packages/ui-web/src/actor-inspector.js (or similar).

3. Redesign the Design view around Strategic Guidance and actor configuration.
   Requirement: Strategic guidance input yields a summarized design brief and a proposed actor set, with editable actor configs.
   Tests: Add tests/ui-web/design-view.test.mjs to confirm guidance input wiring and actor set rendering.
   Code: packages/ui-web/index.html, packages/ui-web/src/run-builder.js, packages/ui-web/src/llm-flow-rail.js, packages/ui-web/src/pool-flow.js, packages/ui-web/src/bundle-review.js (reused or reorganized).

4. Redesign the Simulation view around run controls, stage, and event stream.
   Requirement: Simulation controls and stage are the primary focus, with event stream and inspector visible without navigating away.
   Tests: Update tests/ui-web/mvp-playing-surface.test.mjs and add tests/ui-web/simulation-view.test.mjs for run controls and event stream wiring.
   Code: packages/ui-web/index.html, packages/ui-web/src/movement-ui.js, packages/ui-web/src/main.js.

5. Move artifact inspection into Diagnostics.
   Requirement: Artifact and schema inspection remains available but is not shown in Design or Simulation by default.
   Tests: Add tests/ui-web/diagnostics-view.test.mjs to confirm artifact panels only appear under Diagnostics.
   Code: packages/ui-web/index.html, packages/ui-web/src/adapter-panel.js, packages/ui-web/src/bundle-review.js, packages/ui-web/src/build-orchestrator.js.

6. Update styling and layout to support the new hierarchy.
   Requirement: Visual hierarchy clearly prioritizes Design and Simulation content, with the inspector as a consistent right drawer.
   Tests: Update tests/ui-web/tabs.test.mjs or add a lightweight layout snapshot test if needed.
   Code: packages/ui-web/index.html (styles), packages/ui-web/assets/ (if new tokens or fonts are introduced).

7. Documentation update.
   Requirement: docs/human-interfaces.md reflects the new navigation, primary workflow, and Diagnostics location.
   Tests: Documentation-only change.
   Code: docs/human-interfaces.md.

## Risks And Mitigations
- Risk: UI logic is centralized in main.js and can become harder to maintain.
  Mitigation: Extract view-specific wiring into separate modules and keep main.js as a coordinator only.
- Risk: Tests may not cover dynamic UI changes sufficiently.
  Mitigation: Add minimal DOM-level tests for navigation, inspector, and diagnostics visibility.

## Open Questions
- Should the Diagnostics view be a full tab or a collapsible drawer from Simulation?
- Which existing artifact panels must remain accessible for troubleshooting on day one?
- Is there a preferred default strategy prompt template for Design guidance?

## Acceptance Checklist
- Design tab is the default and contains Strategic Guidance, Design Brief, and Actor Config sections.
- Simulation tab contains run controls, stage, and event stream, with live actor inspection.
- Diagnostics tab contains artifact inspection tools and is not visible in other tabs.
- Tests in tests/ui-web cover navigation, inspector, and diagnostics visibility.
- docs/human-interfaces.md is updated for the new UI workflow.

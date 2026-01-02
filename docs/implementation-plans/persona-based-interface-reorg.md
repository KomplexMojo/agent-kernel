# Persona-Based Interface Reorg

## Goal
Reorganize the UI so it is less cluttered by grouping the current surface area by persona. Each persona gets its own tab that captures its workflow/responsibilities. Add a dedicated Runtime tab that only shows the game screen/playback output. Make Runtime (playing surface) the default tab. Display any generated `.json` files alongside the persona tab they are relevant to.

## Intent
- Reduce cognitive load by separating persona-specific controls, readouts, and context.
- Preserve deterministic playback and existing runtime behavior.
- Keep adapter/run-builder controls aligned to the persona they belong to.
- Surface generated artifacts (JSON outputs) in the persona tab that owns them.
- Default the UI to the Runtime tab so the playing surface is the primary entry point.

## Initial Notes
- This plan focuses on UI composition and navigation; no core-as IO changes.
- Existing tests and fixtures should be updated to reflect the new tab layout.

## Implementation Steps
### Foundation + Runtime
1. [complete] Enumerate existing UI sections and assign each to a persona or to Runtime-only display.
   - Requirement: Produce a single source of truth mapping every current UI section to exactly one persona tab or the Runtime-only tab.
   - Behavior details: Inventory all visible panels/controls/readouts in the current UI; record their current location and purpose; assign each item to a persona tab or Runtime-only; call out any ambiguous items with a rationale or decision note.
   - Data shape proposal: A simple table or list in the plan file, e.g., `Section -> Assigned tab -> Notes`, covering all existing UI sections.
   - Defaults (if relevant): Runtime-only for playback surface; otherwise leave unassigned until explicitly mapped.
   - Tests: Update or add a UI fixture snapshot to reflect the new tab assignment list when the layout changes; no new tests for this inventory step alone.
   - Determinism: The mapping list is static content in the plan and does not affect runtime determinism.
   - Notes: Keep this list scoped to existing sections to avoid scope creep; use the current UI markup as the source of truth.
   - Current UI section map (from `packages/ui-web/index.html`):
     | Section | Assigned tab | Notes |
     | --- | --- | --- |
     | App header (title/subtitle) | Runtime | Global shell; stays above tabs unless moved. |
     | Run Builder card (seed/map/actor/vitals/fixture mode) | Configurator | Includes badges and config preview. |
     | Run Builder actions (Start run, Reset config) | Configurator | Start run could move to Moderator once tab split is wired. |
     | Playing Surface frame buffer | Runtime | Playback output. |
     | Base Tiles frame | Runtime | Playback output. |
     | Actor status badges (Actor/Pos/HP/Tick) | Runtime | Playback output; could move to Actor later. |
     | Observation - Inspect (Motivated Actors list, Tile Actors list) | Actor | Current tab bar will be replaced by persona tabs. |
     | Observation - Affinities (legend + affinity list) | Annotator | Telemetry/diagnostics; could align with Allocator if budget views emerge. |
     | Observation - Traps (trap list) | Annotator | Telemetry/diagnostics. |
     | Play controls (step/play/pause/reset, status) | Runtime | Execution sequencing visible alongside playback. |
     | Adapter Playground (inputs/buttons/status/output) | Orchestrator | External IO/adapters. |
2. [complete] Confirm the full persona tab set plus a Runtime tab, labels, and default tab rules.
   - Requirement: Define the exact tab set, tab labels, and default selection behavior for the persona-based UI.
   - Behavior details: List all persona tabs to include alongside a Runtime tab; confirm tab order and label text; specify the default tab on initial load and after reset; clarify whether tabs are always visible or conditionally disabled (e.g., empty data).
   - Data shape proposal: A short list or table in the plan file, e.g., `Tab -> Label -> Default/Visibility rules`.
   - Defaults (if relevant): Runtime is the default tab on first load and after reset unless a deep-link or state restore explicitly selects a persona tab.
   - Tests: Update UI tests to assert the default active tab is Runtime; add a test that the full tab set renders in the expected order.
   - Determinism: Tab selection is deterministic given initial state; no time-based defaults.
   - Notes: Align labels with persona README names; avoid abbreviated labels unless required for space.
   - Tab set and rules:
     | Tab | Label | Default/visibility rules |
     | --- | --- | --- |
     | Runtime | Runtime | Default selected on initial load and after reset. |
     | Actor | Actor | Always visible; empty state when no actor data. |
     | Allocator | Allocator | Always visible; empty state when no budgeting data. |
     | Director | Director | Always visible; empty state when no planning data. |
     | Annotator | Annotator | Always visible; empty state when no telemetry/affinity/trap data. |
     | Moderator | Moderator | Always visible; empty state when no moderation outputs. |
     | Orchestrator | Orchestrator | Always visible; empty state when no adapter outputs. |
     | Configurator | Configurator | Always visible; empty state when no run-builder inputs. |
   - Tab order: Runtime, Configurator, Actor, Director, Allocator, Annotator, Moderator, Orchestrator (Runtime first to reinforce default playback view; Configurator next for setup flow).
3. [complete] Draft the tab hierarchy and panel placement, including the Runtime surface-only tab.
   - Requirement: Define the new tab hierarchy and where each existing panel lives within its persona or Runtime tab.
   - Behavior details: Specify the top-level tabs and their internal panel order; the Runtime tab must show only the playing surface and related playback visuals; persona tabs must group their assigned panels and any JSON outputs; note any panel moves or splits from the current layout.
   - Data shape proposal: A tab-by-tab outline in the plan file, e.g., `Tab -> Panels (ordered) -> Notes`.
   - Defaults (if relevant): Runtime tab shows playing surface first; persona tabs default to their primary workflow panel at top.
   - Tests: Update UI tests/fixtures to match the new tab structure and panel order; add a test that the Runtime tab excludes persona controls.
   - Determinism: Panel ordering is static and not data-dependent.
   - Notes: Keep the Runtime tab minimal to preserve playback clarity; ensure persona tabs include their JSON outputs near the relevant controls.
   - Tab hierarchy and panel placement:
     | Tab | Panels (ordered) | Notes |
     | --- | --- | --- |
     | Runtime | Playing Surface frame buffer; Base Tiles frame; Actor status badges; Playback controls + status | Playback + controls combined for interactive use. |
     | Configurator | Run Builder inputs; Vitals inputs; Config badges; Start/Reset actions; Config preview; Configurator JSON outputs | `sim-config.json`/`initial-state.json` (or similar) live here. |
     | Actor | Motivated Actors list; Tile Actors list; Actor JSON outputs | Former Inspect tab content. |
     | Director | Director plan/intent summary; Director JSON outputs | Placeholder panel until Director UI exists. |
     | Allocator | Budget/receipt summary; Allocator JSON outputs | Placeholder panel until Allocator UI exists. |
     | Annotator | Affinity list; Affinity legend; Trap inspector; Annotator JSON outputs | Former Affinities/Traps content. |
     | Moderator | Moderator JSON output | Execution metadata lives here; controls stay in Runtime. |
     | Orchestrator | Adapter Playground inputs/buttons; Adapter status/output; Orchestrator JSON outputs | Adapter outputs live alongside this panel. |
4. [complete] Update UI layout markup to add persona tabs and a Runtime-only view.
   - Requirement: Update the UI markup to render the new top-level persona tabs and a Runtime-only tab with surface output only.
   - Behavior details: Replace the current single-column layout with a tabbed layout where each top-level tab contains its assigned panels; ensure the Runtime tab contains only playback visuals (frame buffers + actor badges) and excludes config/adapter/play controls; preserve existing element IDs for wiring where possible or update wiring to match new structure.
   - Data shape proposal: N/A (markup/layout change).
   - Defaults (if relevant): Default selected tab is Runtime; preserve aria roles for accessibility.
   - Tests: Update UI tests/fixtures to assert the new tab structure and that Runtime contains only surface output.
   - Determinism: Markup ordering is static.
   - Notes: Keep DOM changes minimal to reduce wiring churn; keep panel IDs stable to avoid updating runtime logic unless necessary.
5. [complete] Refactor shared tab wiring and empty-state behavior for the new structure.
   - Requirement: Ensure the new persona tabs are wired for navigation and present deterministic empty states when data is missing.
   - Behavior details: Update tab wiring to target the persona tabs (Runtime default); migrate any legacy tab wiring (Inspect/Affinities/Traps) to Annotator/Actor panels; define empty-state copy for tabs that may lack data (Director/Allocator placeholders, no affinities/traps, no adapter output) and ensure those messages appear consistently.
   - Data shape proposal: N/A (behavior/markup wiring change).
   - Defaults (if relevant): Runtime is selected by default; empty states render until data is populated.
   - Tests: Extend UI tests to assert default tab selection, empty-state copy for at least one persona tab, and that disabled/hidden tabs behave deterministically when no data is present.
   - Determinism: Empty-state messages are static; no data-driven randomness.
   - Notes: Keep the tab wiring in `packages/ui-web/src/tabs.js` shared and avoid per-tab custom state unless necessary.

### Persona Tabs (All Personas)
6. [complete] Actor persona tab: move actor workflow panels into the Actor tab.
   - Requirement: Relocate all actor-specific workflow panels into the Actor tab.
   - Behavior details: Move the motivated actor list and tile actor list into the Actor tab; ensure any actor-specific controls or readouts remain functional after relocation; keep the actor list empty state consistent.
   - Data shape proposal: N/A (markup/layout change).
   - Defaults (if relevant): Actor tab shows the motivated actor list first, followed by tile actors.
   - Tests: Update UI tests/fixtures to assert actor list rendering still works under the Actor tab.
   - Determinism: No change to data ordering; UI output remains stable for identical observations.
   - Notes: Keep IDs stable to avoid changing `movement-ui` wiring.
7. [complete] Allocator persona tab: move allocator workflow panels into the Allocator tab.
   - Requirement: Relocate allocator-specific workflow panels into the Allocator tab.
   - Behavior details: Move any budgeting/receipt/limit panels into the Allocator tab; ensure placeholders are present if no allocator UI exists yet.
   - Data shape proposal: N/A (markup/layout change).
   - Defaults (if relevant): Allocator tab shows budget summary first.
   - Tests: Update UI tests/fixtures to assert allocator placeholder or panel content appears under the Allocator tab.
   - Determinism: Static panel ordering; no data-driven layout changes.
   - Notes: Keep IDs stable for future allocator wiring.
8. [complete] Director persona tab: move director workflow panels into the Director tab.
   - Requirement: Relocate director-specific workflow panels into the Director tab.
   - Behavior details: Move any plan/intent/strategy panels into the Director tab; ensure placeholders are present if no director UI exists yet.
   - Data shape proposal: N/A (markup/layout change).
   - Defaults (if relevant): Director tab shows plan summary first.
   - Tests: Update UI tests/fixtures to assert director placeholder or panel content appears under the Director tab.
   - Determinism: Static panel ordering; no data-driven layout changes.
   - Notes: Keep IDs stable for future director wiring.
9. [complete] Annotator persona tab: move annotator workflow panels into the Annotator tab.
   - Requirement: Relocate annotator-specific workflow panels into the Annotator tab.
   - Behavior details: Move affinity list, affinity legend, and trap inspector panels into the Annotator tab; ensure empty-state copy remains consistent.
   - Data shape proposal: N/A (markup/layout change).
   - Defaults (if relevant): Affinity panel first; trap inspector follows.
   - Tests: Update UI tests/fixtures to assert affinity and trap panels render under the Annotator tab.
   - Determinism: No change to list ordering or formatting.
   - Notes: Keep IDs stable to avoid changing `movement-ui` wiring.
10. [complete] Moderator persona tab: move moderator workflow panels into the Moderator tab.
   - Requirement: Keep Moderator-specific output panels in the Moderator tab while playback controls live in Runtime.
   - Behavior details: Moderator tab shows execution metadata/output placeholder; playback controls and status remain in the Runtime tab to support live interaction.
   - Data shape proposal: N/A (markup/layout change).
   - Defaults (if relevant): Moderator shows a deterministic placeholder until output exists.
   - Tests: Update UI tests/fixtures to assert Moderator output renders under the Moderator tab and controls remain in Runtime.
   - Determinism: No change to playback sequencing or status logic.
   - Notes: Keep IDs stable to avoid changing `movement-ui` wiring.
11. [complete] Orchestrator persona tab: move orchestrator workflow panels into the Orchestrator tab.
   - Requirement: Relocate adapter playground inputs, controls, and outputs into the Orchestrator tab.
   - Behavior details: Move adapter inputs/buttons/status/output into the Orchestrator tab; keep empty-state output copy consistent.
   - Data shape proposal: N/A (markup/layout change).
   - Defaults (if relevant): Output panel shows placeholder until a run completes.
   - Tests: Update UI tests/fixtures to assert adapter output renders under the Orchestrator tab.
   - Determinism: No change to adapter output formatting.
   - Notes: Keep IDs stable to avoid changing adapter wiring.
12. [complete] Configurator persona tab: move configurator/run-builder workflow panels into the Configurator tab.
   - Requirement: Relocate run-builder inputs and actions into the Configurator tab.
   - Behavior details: Move seed/map/actor/vitals fields, badges, actions, and preview into the Configurator tab; ensure run-builder wiring still targets the same IDs.
   - Data shape proposal: N/A (markup/layout change).
   - Defaults (if relevant): Run builder fields remain grouped with Start/Reset actions.
   - Tests: Update UI tests/fixtures to assert run-builder inputs render under the Configurator tab.
   - Determinism: No change to config generation or preview text.
   - Notes: Keep IDs stable to avoid changing `run-builder` wiring.
13. [complete] Persona tabs display relevant generated JSON outputs within each persona section.
   - Requirement: Surface generated JSON outputs alongside the persona tab responsible for them.
   - Behavior details: Add a JSON output panel per persona tab (where outputs exist), such as Configurator (sim-config/initial-state), Annotator (affinity/telemetry summaries), Orchestrator (adapter responses), Director/Allocator (plans/receipts when available), Moderator (tick frames if surfaced); ensure the panels show a deterministic placeholder when empty.
   - Data shape proposal: N/A (UI output panel; data already JSON).
   - Defaults (if relevant): Show "No JSON output yet." in tabs without generated output.
   - Tests: Update UI tests/fixtures to assert JSON output placeholders appear under the relevant tabs and are replaced when output is populated.
   - Determinism: JSON output ordering and formatting remain stable (pretty-printed, fixed ordering if applicable).
   - Notes: Keep output panels read-only; avoid introducing new IO or schema changes here.

### Validation + Docs
14. [complete] Update UI fixtures and tests to match the persona tabs, Runtime view, and JSON output displays.
   - Requirement: Ensure UI tests and fixtures reflect the new persona tab layout and JSON output placeholders.
   - Behavior details: Update tests to assert Runtime is default, persona tabs contain their panels, and JSON output placeholders render; adjust any fixture-backed UI tests to avoid referencing the old Inspect/Affinities/Traps tab wiring.
   - Data shape proposal: N/A (test/fixture updates only).
   - Defaults (if relevant): Runtime tab is visible by default; JSON output placeholders read "No JSON output yet."
   - Tests: Extend or add UI tests that verify persona tab layout and output placeholders; update existing UI tests if they referenced old tab ids.
   - Determinism: Test expectations are static; no time-based assertions.
   - Notes: Keep tests lightweight and HTML-driven where possible.
15. [complete] Update documentation and UI help text to reflect persona-based navigation.
   - Requirement: Align docs and UI copy with the persona tab structure and Runtime default.
   - Behavior details: Update docs to describe Runtime + persona tabs and where affinities/traps/controls live; adjust UI subtitle/help text to mention persona navigation and Runtime default.
   - Data shape proposal: N/A (docs/text update).
   - Defaults (if relevant): Runtime called out as the default tab.
   - Tests: No tests required; documentation updates only.
   - Determinism: Copy changes only.
   - Notes: Keep wording concise and consistent with persona README naming.

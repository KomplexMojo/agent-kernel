Goal: Surface configurator affinity/trap metadata in CLI workflows and the UI, with deterministic summaries and fixture-driven demos.

## 1) CLI Surface Area
1. [pending] Add CLI flags for affinity preset/loadout artifacts and resolved summaries.
   - Requirement: Accept affinity preset/loadout artifact paths in the CLI and optionally emit a resolved affinity summary artifact so CLI workflows can surface affinity metadata deterministically.
   - Behavior details: parse `--affinity-presets` (AffinityPresetArtifact) and `--affinity-loadouts` (ActorLoadoutArtifact) for relevant commands; validate schemas; when `--affinity-summary` or `--out-dir` is set, compute a resolved summary via `resolveAffinityEffects` using presets + loadouts + base vitals (from `InitialStateArtifact.actors[].vitals`) + traps (from `SimConfigArtifact.layout.data.traps`) and write `affinity-summary.json` by default; error if summary is requested without required inputs.
   - Data shape proposal (summary): `{ schema: "agent-kernel/AffinitySummary", schemaVersion: 1, meta, presetsRef, loadoutsRef, simConfigRef, initialStateRef, actors: [{ actorId, vitals, abilities, affinityStacks }], traps: [{ position, vitals, abilities, affinityStacks }] }` matching the `resolveAffinityEffects` output shape used in `tests/fixtures/personas/affinity-resolution-v1-basic.json`.
   - Defaults: omit summary output unless `--affinity-summary` or `--out-dir` is provided; default summary filename `affinity-summary.json`; defaults for stack counts and mana cost continue to flow from preset/loadout normalization.
   - Tests: add CLI tests that load fixture presets + loadouts + sim-config/initial-state, assert emitted summary equals the `affinity-resolution-v1-basic.json` expected payload; include negative tests for missing schemas or missing required flags when summary is requested.
   - Determinism: stable actor ordering (by actorId) and trap ordering (y then x); reuse runtime resolver to avoid drift; no randomness or timestamp-based ordering differences in summary payloads.
   - Notes: keep summary generation in adapters (no `core-as` IO); align flag names with existing CLI patterns and update `--help` usage.
2. [pending] Add a `configurator` CLI command to build artifacts from inputs.
   - Requirement: Add a `configurator` CLI command that turns deterministic configurator inputs into `SimConfigArtifact` + `InitialStateArtifact` outputs for fixture-driven runs.
   - Behavior details: accept `--level-gen` (LevelGenInput), `--actors` (actor base list), optional `--plan`/`--budget-receipt` artifact paths, and optional `--affinity-presets`/`--affinity-loadouts` to resolve affinity effects; generate layout via `generateGridLayoutFromInput`, resolve affinities via `resolveAffinityEffects`, then build artifacts with `buildSimConfigArtifact` + `buildInitialStateArtifact`; write outputs to `sim-config.json` and `initial-state.json` in `--out-dir`.
   - Data shape proposal (inputs): `level-gen.json` mirrors `ConfiguratorInputs.levelGen` (`{ width, height, seed?, shape?, spawn?, exit?, connectivity?, traps? }`); `actors.json` is `{ actors: [{ id, kind, position, vitals?, traits?, archetype? }] }` aligned to `InitialStateArtifact.actors` fields; presets/loadouts are standard artifacts.
   - Defaults: omit plan/budget refs when paths are not provided; if affinity presets/loadouts are missing, skip resolution and emit actors as provided; if base vitals are missing, resolve affinities against zeroed vitals (via runtime defaults).
   - Tests: add CLI tests that feed fixture level-gen + actors + affinity preset/loadout inputs and assert emitted artifacts match `sim-config-artifact-v1-configurator-trap.json` and `initial-state-artifact-v1-configurator-affinity.json`; add negative tests for invalid level-gen inputs or missing required files.
   - Determinism: reuse runtime normalization/ordering (row-major layouts, actor sort by id); seed RNG from level-gen input; avoid time-based data beyond `meta`.
   - Notes: keep configurator logic in runtime modules and wire through adapters; update CLI `--help` and README examples; do not introduce IO into `core-as`.

## 2) UI Surface Area
1. [pending] Add affinity + ability panels to actor list.
   - Requirement: Surface affinity stacks and resolved abilities in the actor list UI, accessible via the new tabs layout (no always-on clutter).
   - Behavior details: add a new `Affinities` tab that shows actor list rows with affinity chips (kind/expression + stacks) and ability pills (kind + potency + mana cost); the existing `Inspect` tab stays focused on run frames/telemetry; actor rows remain compact until the `Affinities` tab is selected.
   - Data shape proposal: rely on observation actor fields (`affinities`, `abilities`, or `affinityStacks`/`traits.abilities` depending on current UI adapter shape); map stacks into display-friendly `kind:expression xN`.
   - Defaults: when no affinity metadata is present, render a lightweight empty state in the `Affinities` tab (e.g., "No affinities resolved").
   - Tests: add UI tests that switch to the `Affinities` tab and assert affinity/ability formatting for `tests/fixtures/personas/affinity-resolution-v1-basic.json` without affecting `Inspect` tab behavior.
   - Determinism: keep display ordering stable (actor id order, ability list order).
   - Notes: avoid weapon terminology; keep tab state in UI adapter scope (no runtime changes).
2. [pending] Add a trap inspector view tied to layout metadata.
   - Requirement: Provide trap detail viewing in the UI via a dedicated `Traps` tab or a secondary panel within the `Affinities` tab.
   - Behavior details: selecting the `Traps` tab lists traps by position and shows affinity, stacks, and vitals/abilities; if the grid supports selection, clicking a trap tile focuses the corresponding row; default view remains uncluttered until the tab is selected.
   - Data shape proposal: use `observation.traps[]` (position, vitals, abilities, affinityStacks) from bindings; when only layout metadata is available, render a minimal trap list from `simConfig.layout.data.traps`.
   - Defaults: if no traps exist, show an empty state with deterministic copy; do not show the tab unless trap data is present (or show disabled with zero count).
   - Tests: add UI tests that open the `Traps` tab and verify trap rows for the trap fixture (`sim-config-artifact-v1-configurator-trap.json` + observation fixture).
   - Determinism: stable ordering by y then x; stable ability ordering within a trap.
   - Notes: keep trap display read-only and affinity-only (no weapons).
3. [pending] Add an affinity legend panel to the UI.
   - Requirement: Provide a compact affinity legend accessible from the tabbed UI without crowding the main view.
   - Behavior details: add a `Legend` button within the `Affinities` tab header that opens a small panel listing kinds (fire, water, earth, wind, life, decay, corrode, dark) and expressions (push/pull/emit); keep it collapsed by default.
   - Data shape proposal: static enum-driven list from shared affinity constants; no runtime data dependency.
   - Defaults: collapsed by default; if affinities are absent, still allow legend access for context.
   - Tests: add UI test that toggles the legend panel and asserts the presence/order of all affinity kinds and expressions.
   - Determinism: fixed ordering of kinds and expressions; no data-driven reordering.
   - Notes: keep legend copy aligned with README wording; avoid weapon language.

## 3) Fixtures and Examples
1. [pending] Add a UI fixture bundle that includes affinities + traps.
   - Requirement: Provide a dedicated UI fixture bundle that exercises affinity metadata and trap inspection for deterministic UI demos/tests.
   - Behavior details: bundle should include sim-config + initial-state artifacts with traps/affinities plus an affinity resolution fixture (actors + traps) so the UI can render Affinities/Traps tabs without running a full simulation.
   - Data shape proposal (bundle): `tests/fixtures/ui/affinity-trap-bundle/` with `sim-config.json`, `initial-state.json`, and `affinity-effects.json` matching `tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json`, `tests/fixtures/artifacts/initial-state-artifact-v1-configurator-affinity.json`, and `tests/fixtures/personas/affinity-resolution-v1-basic.json`.
   - Defaults: keep fixture ids/runIds stable and derived from existing artifacts; no random fields.
   - Tests: add a UI test that loads the bundle and asserts Affinities and Traps tab output is non-empty and deterministic.
   - Determinism: reuse existing fixture ordering (actorId order, trap y/x order); avoid time-based meta.
   - Notes: keep fixtures under `tests/fixtures/` (not `artifacts/`); prefer references to existing fixtures to avoid duplication unless a UI-specific wrapper is needed.
2. [pending] Add CLI README examples for affinity/trap runs.
   - Requirement: Document CLI examples that demonstrate affinity/trap runs and affinity summary output using existing fixtures.
   - Behavior details: add example commands for `run` with `--sim-config`, `--initial-state`, `--affinity-presets`, `--affinity-loadouts`, and `--affinity-summary`; include a short note on expected outputs and how to inspect `affinity-summary.json`.
   - Data shape proposal: reuse existing fixture paths (`sim-config-artifact-v1-configurator-trap.json`, `initial-state-artifact-v1-affinity-base.json`, `affinity-presets-artifact-v1-basic.json`, `actor-loadouts-artifact-v1-basic.json`).
   - Defaults: keep examples using fixture paths and `--ticks 0` for deterministic output; avoid network flags.
   - Tests: no new tests required; README changes only.
   - Determinism: examples should always produce identical outputs for the same fixtures.
   - Notes: align flag names with `packages/adapters-cli/src/cli/ak.mjs` usage and avoid weapon terminology.

## 4) Tests and Validation
1. [pending] Add CLI tests for new configurator flags/command.
   - Requirement: Cover the new CLI configurator command and affinity summary flags with deterministic tests.
   - Behavior details: add tests for `run` with `--affinity-presets`/`--affinity-loadouts`/`--affinity-summary` and for `configurator` with level-gen + actors inputs; include a negative test for missing required flags or invalid level-gen input.
   - Data shape proposal: reuse fixture paths from `tests/fixtures/artifacts/` and `tests/fixtures/configurator/` to avoid duplicating artifacts.
   - Defaults: ensure tests pass with `--ticks 0` and fixture-mode data only; no network access.
   - Tests: add `tests/adapters-cli/ak-affinity-summary.test.js` and `tests/adapters-cli/ak-configurator.test.js` (or extend existing CLI tests) and validate emitted artifacts against fixture expectations.
   - Determinism: assert exact artifact payloads (except meta timestamps) or compare stable sections (layout, actors, traits, affinity stacks).
   - Notes: keep tests in CLI adapter scope; skip if WASM is missing when necessary.
2. [pending] Add UI tests for affinity and trap panels.
   - Requirement: Ensure the Affinities and Traps tabs render deterministic content from fixtures and remain isolated from Inspect output.
   - Behavior details: add tests that feed affinity effects fixtures to `setupPlayback` and assert affinity list output, trap list output, and tab state when no traps exist.
   - Data shape proposal: reuse `tests/fixtures/personas/affinity-resolution-v1-basic.json` and the UI bundle in `tests/fixtures/ui/affinity-trap-bundle/`.
   - Defaults: tests should not depend on DOM; use stub elements with `textContent` and `setAttribute`.
   - Tests: extend `tests/ui-web/mvp-playing-surface.test.mjs` and add `tests/ui-web/affinity-trap-bundle.test.mjs` to cover tab output and empty-state copy.
   - Determinism: assert exact strings for affinity/trap summaries (order by actor id and trap position).
   - Notes: keep tests in UI-web scope; no runtime IO or network.

## 5) Cleanup + Docs
1. [pending] Update docs/README.md and CLI README with the new surfaces.
   - Requirement: Update docs/README.md and `packages/adapters-cli/README.md` to reflect the new affinity/trap surfaces and UI tab layout.
   - Behavior details: add a brief note on UI tabs (Inspect/Affinities/Traps) and the affinity legend; document CLI affinity summary output and configurator command usage with fixture examples.
   - Data shape proposal: reference existing fixture paths for sim-config/initial-state/affinity presets/loadouts and the UI bundle under `tests/fixtures/ui/affinity-trap-bundle/`.
   - Defaults: keep docs focused on deterministic fixture workflows; avoid network-only examples.
   - Tests: no tests required; documentation updates only.
   - Determinism: call out that fixture-based runs and summaries are deterministic for identical inputs.
   - Notes: keep wording aligned with affinity-only equipment (no weapons) and current CLI flag names.

## 6) MVP Complexity
1. [pending] Increase MVP maximum grid size and add internal layout complexity.
   - Requirement: Raise the MVP grid size cap and introduce a deterministic internal layout profile to exercise larger maps without changing core-as IO boundaries.
   - Behavior details: allow a larger width/height in MVP fixtures and layout generation (e.g., 9x9 or 11x11), and add at least one irregular walkable island profile in MVP demo runs to show non-rectangular walkable space.
   - Data shape proposal: update MVP fixtures (`sim-config-artifact-v1-mvp-grid.json`, frame buffers) or add a new fixture set that captures the expanded layout; keep layout data compatible with existing render legend.
   - Defaults: keep current MVP grid as the default selection; the larger grid is opt-in via a fixture or config flag.
   - Tests: add or update fixture-backed tests to cover the larger grid and assert deterministic tiles/kinds/spawn/exit placement.
   - Determinism: seed all randomness from fixture inputs; preserve row-major iteration and stable placement rules.
   - Notes: avoid adding new runtime dependencies; update UI copy if larger grid becomes a selectable option in the run builder.

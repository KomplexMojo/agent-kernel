# llm-pool-dungeon-planning

Goal: constrain the LLM (as dungeon master) to pick from prebuilt room/actor artifacts, keep BuildSpec assembly deterministic in the Director, and enforce budgets via the Allocator while the Orchestrator handles prompt IO/capture.

## 1) Pool Catalog & Templates
1. [implemented] Define the pool catalog schema and seed fixtures.
   - Requirement: Create a canonical catalog of reusable artifacts keyed as `type_motivation_affinity_cost` (e.g., `actor_stationary_fire_200`, `actor_attacking_earth_120`).
   - Behavior details: Store type (`actor` only) with subType metadata (`static` | `dynamic` | `trap`), motivation, affinity, token cost (arbitrary integer), tags (boss-capable, hazard type, size envelope, mobility), and optional priority. Mapping snaps to the nearest supported cost at/under a requested hint or clamps to a safety max.
   - Data shape proposal: `{ id, type: "actor", subType, motivation, affinity, cost, tags: [], meta: { sizeHint?, hazard?, mobility?, bossCapable? } }` persisted under `tests/fixtures/pool/` and a runtime-loadable catalog.
   - Concept types: one core concept (`actor`) with subtypes:
     - Static actors (walls, tiles): durability only, no other vitals, typically `canMove=false`; used to build rooms/barriers.
     - Dynamic dungeon actors: everything the dungeon creates that can interact (monsters and traps).
       - Monsters: may have all vitals, one or more affinities, and multiple motivations (including movement).
       - Traps: durability + mana only; may have a motivation like `attacking`/`defending` but no movement motivations; `canMove=false`. Barriers can optionally have duration + mobility to allow dynamic restructuring.
   - Defaults: If multiple costs exist, default to cheapest; if no hint, pick catalog default for that motivation/affinity.
   - Tests: Fixture ingest test to ensure catalog loads and sorts deterministically.
   - Determinism: Stable ordering by (type, motivation, affinity, cost); IDs derived from the catalog entry.
   - Notes: This catalog is the only source of stats/shape; LLM never invents schema.
   - Motivation kinds (must match runtime constants): `random`, `stationary`, `exploring`, `attacking`, `defending`, `patrolling`. Motivations are atomic; combine via labels (e.g., `stationary_attacking`) to express composite behaviors. Boss is a tier outcome from cost/flag, not a motivation.
   - Affinity kinds (must match runtime constants): `fire`, `water`, `earth`, `wind`, `life`, `decay`, `corrode`, `dark`.
2. [pending] Add an “Actors & Rooms” UI tab for authoring templates and saving to the pool.
   - Requirement: UI tab focused on creating/editing/saving actor, room, and trap templates for reuse in LLM interactions.
   - Behavior details: Actor templates capture motivation, affinity, cost/tokens, vitals/regen, mobility flags; “Save to pool” writes to local catalog. Room creation composes static actors (walls/tiles) into room templates/blueprints referencing those actor IDs; trap templates are actors with affinity/mana/motivation but immobile (`canMove=false`, subType=`trap`). Saved templates appear in the pool catalog and drive allowed menu options for the LLM.
   - Data shape proposal: `ActorTemplate { id, subType, motivation, affinity, cost, vitals, regen, mobility, tags }`; `RoomTemplate { id, affinity, cost?, tiles/barriers, hazardTags, actorRefs: [] }`; `TrapTemplate { id, subType:"trap", affinity, cost, manaPool, motivation, mobility:false }`.
   - Defaults: Prefill common motivations/affinities; enforce cost > 0; disallow duplicate IDs; room blueprint defaults to rectangular footprint and empty barriers; trap defaults to zero movement.
   - Tests: UI test to create a template, save, reload, and see it in the catalog/LLM menu; validation test for required fields.
   - Determinism: Persist templates sorted by ID; saving preserves order; no hidden mutations.
   - Notes: Keep adapter boundary clean—no direct IO beyond local catalog persistence.

## 2) LLM Prompt Contract & Orchestrator
1. [implemented] Define the menu-only dungeon master prompt contract (summary, not BuildSpec).
   - Requirement: LLM returns a small JSON summary choosing from allowed menus; no schema/stats invention.
   - Behavior details: Multi-turn contract—LLM acknowledges `ready`, lists missing info, waits for “final JSON” request. Allowed lists must use defined constants only: affinities (`fire`, `water`, `earth`, `wind`, `life`, `decay`, `corrode`, `dark`) and motivations (`random`, `stationary`, `exploring`, `attacking`, `defending`, `patrolling`). LLM returns counts and optional token hints, not IDs or stats.
   - Data shape proposal:
     ```json
     {
       "dungeonAffinity": "fire",
       "budgetTokens": 800,
       "rooms": [{ "motivation": "stationary", "affinity": "fire", "count": 2, "tokenHint": 200 }],
       "actors": [
         { "motivation": "attacking", "affinity": "fire", "count": 1, "tokenHint": 200 },
         { "motivation": "defending", "affinity": "earth", "count": 1, "tokenHint": 120 }
       ],
       "missing": []
     }
     ```
   - Defaults: If tokenHint absent, assume catalog default per motivation/affinity; if budgetTokens absent, use default tier and flag in `missing`.
   - Tests: Fixture prompt build test to confirm allowed menus present; contract parse test for summary JSON.
   - Determinism: Prompt text and menu ordering stable; summary parsing deterministic.
   - Notes: Spell out rules—only allowed lists, arbitrary positive token hints allowed but will be snapped down; no prose in final JSON turn.
2. [implemented] Capture prompt/response artifacts in the Orchestrator.
   - Requirement: Orchestrator executes the prompt, captures full prompt + raw response for replay, and surfaces contract/parse errors.
   - Behavior details: On invalid picks, return `invalid` + allowed options; on missing data, populate `missing` and await re-pick; store artifacts for replay/debugging.
   - Data shape proposal: `{ prompt, responseRaw, responseParsed?, errors?, missing? }` persisted alongside BuildSpec artifacts when finalized.
   - Defaults: Retry with repair prompt on parse failure; do not invent summary fields.
   - Tests: Orchestrator-level test with fixture responses (valid/invalid) to ensure captures and error surfacing.
   - Determinism: No random retries; same input/fixture yields identical captured artifacts.
   - Notes: Keep IO in Orchestrator; Director stays pure.

## 3) Director Mapping & BuildSpec Assembly
1. [implemented] Map summary picks to pool artifacts with snapping and receipts.
   - Requirement: Deterministically choose pool entries for each `{motivation, affinity, count, tokenHint}` using snap-to-nearest-<=cost (or clamp), multiplying by count.
   - Behavior details: Assign stable IDs (`actor_<motivation>_<affinity>_<appliedCost>_<n>`, `room_<motivation>_<affinity>_<appliedCost>_<n>`), derive actorGroups from motivations (boss if flagged or cost >= threshold), and generate receipts comparing requested vs applied costs.
   - Data shape proposal: `Selection { requested, applied: { id, cost }, receipt: { status: approved|downTiered|missing, reason? } }`.
   - Defaults: If no pool match, mark `missing` and request re-pick; if multiple matches, prefer lowest cost; threshold for boss derived from catalog tag or cost rule.
   - Tests: Unit tests for snapping, ID stability, and missing-handling.
   - Determinism: Stable ordering and selection; no random tie-breaks.
   - Notes: No stat invention—use catalog metadata for vitals/hazards/mobility.
2. [implemented] Assemble BuildSpec + repair flow from mapped selections.
   - Requirement: Produce BuildSpec with meta/intent/plan.hints/configurator.inputs (levelGen from room metadata; actors/actorGroups from selections) and budget refs from defaults.
   - Behavior details: Include receipts (trim/down-tier) for UI; run BuildSpec validator; on errors, produce minimal repair prompts requesting only missing summary fields (not full BuildSpec).
   - Data shape proposal: `BuildSpec` plus `receipts[]` and `appliedBudget`.
   - Defaults: Fill `meta.runId/createdAt/source` deterministically; default levelAffinity from dungeonAffinity; default levelGen shape from room size envelope.
   - Tests: Integration test: summary fixture → BuildSpec → validator ok; repair test: missing fields trigger targeted re-prompt.
   - Determinism: Validation order stable; ID reuse across refinements.
   - Notes: Preserve unknown fields if round-tripping in UI; keep ordering consistent.

## 4) Budget Enforcement (Allocator)
1. [implemented] Enforce token budget caps and emit receipts.
   - Requirement: Sum applied costs (actors + rooms/traps), enforce budgetTokens (or default tier), and return receipts for down-tier/drop actions.
   - Behavior details: Deterministic policy—down-tier before drop; drop lowest-priority first (priority from catalog); record remaining tokens and reasons.
   - Data shape proposal: `BudgetResult { totalRequested, totalApplied, totalApproved, actions: [{ id, action, delta, reason }] }`.
   - Defaults: If no budget provided, use default cap; never exceed cap; allow user override to re-run with higher cap.
   - Tests: Unit tests for over-budget scenarios (down-tier, drop), ensuring stable ordering.
   - Determinism: Same inputs → same trims; receipts stable for replay.
   - Notes: Feed receipts back to Director for optional re-prompt within remaining budget.

## 5) UI Flow: Summary → BuildSpec → Build/Run
1. [implemented] Add fixture-mode flow to consume summary, map to BuildSpec, and show receipts.
   - Requirement: UI path to load a summary fixture (or prompt result), run mapper + allocator, display BuildSpec + receipts, and allow validation before build.
   - Behavior details: Show missing/invalid picks; block build until BuildSpec valid; allow user to accept trims or re-prompt; auto-fill existing build orchestration spec field.
   - Data shape proposal: `{ summary, selections, receipts, buildSpec }` stored in UI state/session.
   - Defaults: Fixture mode by default; live mode opt-in; use last summary for “Load last plan”.
   - Tests: UI integration test loading summary fixture → BuildSpec renders → receipts shown → build button gated on validity.
   - Determinism: Ordering of selections/receipts stable; round-trip preserves ordering.
   - Notes: Reuse existing bundle review/build/run UI; avoid duplicating logic.
2. [implemented] Wire actor/room pool into prompt menus and ensure saved templates are selectable.
   - Requirement: Menus shown to LLM (and UI dropdowns) derive from the saved pool catalog and stay in sync with the authoring tab.
   - Behavior details: When templates are added/removed, update allowed lists; ensure invalidated menu options trigger re-pick/missing state.
   - Data shape proposal: `AllowedOptions { affinities: [], actorMotivations: [], roomMotivations: [], poolIds: [] }`.
   - Defaults: Fallback to built-in options if catalog empty; warn when menus shrink.
   - Tests: UI test that saving a new template updates the allowed menu and the prompt contract output.
   - Determinism: Menu ordering stable (sorted by ID/motivation/affinity).
   - Notes: Keep UX clear about source of options (local pool).

## 6) Tests & Fixtures
1. [implemented] Pool and mapper unit tests.
   - Requirement: Validate catalog load/sort, selection snapping, ID stability, and missing detection.
   - Behavior details: Include arbitrary token hints (non-tier) and ensure snap-down behavior.
   - Data shape proposal: Fixtures in `tests/fixtures/pool/` and summary fixtures with expected selections.
   - Defaults: Use deterministic seeds/IDs.
   - Determinism: Exact receipts/assertions stable.
   - Notes: Cover traps/rooms/actors variants.
2. [implemented] Budget enforcement unit tests.
   - Requirement: Over-budget scenarios down-tier then drop; receipts match policy.
   - Behavior details: Fixed policy ordering; check remaining tokens math.
   - Data shape proposal: Budget fixtures with expected actions.
   - Defaults: Default caps and overrides exercised.
   - Determinism: No randomness; same inputs → same receipts.
3. [implemented] Integration and UI tests.
   - Requirement: End-to-end summary fixture → BuildSpec → validator ok → UI renders BuildSpec/receipts and gates build.
   - Behavior details: Fixture-only; no external IO.
   - Data shape proposal: Use summary + pool fixtures; verify applied IDs/receipts.
   - Defaults: Fixture mode; live mode skipped.
   - Determinism: Stable ordering and outputs.

## 7) Docs
1. [implemented] Document the pool-driven workflow and UI authoring tab.
   - Requirement: Add doc sections (human-interfaces/UI README) linking this plan, describing pool authoring, menu-only LLM contract, receipts/trim behavior, and replay/debug story.
   - Behavior details: Include where artifacts land (catalog/summary fixtures under `tests/fixtures/pool/`), how to load them in the Pool Flow panel, and how to re-prompt/adjust within budget using the derived allowed menus. Describe the authoring tab intent (template save → catalog → menu options).
   - Data shape proposal: Reference pool catalog format (`type: actor`, `subType`, `motivation`, `affinity`, `cost`, tags/meta) and summary JSON contract (`dungeonAffinity`, `budgetTokens`, `rooms[]`, `actors[]` with `tokenHint`).
   - Defaults: Recommend fixture mode for testing; clarify token snapping (nearest <= hint) and budget enforcement (deterministic trim order); note auto-filled meta/runId/source when assembling BuildSpec.
   - Tests: N/A (docs), but link to relevant fixtures/tests (`tests/runtime/pool-*.test.js`, `tests/ui-web/pool-flow.test.mjs`) for reference.
   - Determinism: Call out deterministic catalog sorting, mapping, budget receipts, and BuildSpec validation; emphasize replayability when using captured prompt/summary + catalog.

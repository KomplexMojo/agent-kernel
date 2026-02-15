# UI Attacker Config, Regen Controls, and Budget Visibility Plan

Date: 2026-02-11

## Objective
Expose key combat configuration decisions directly in the UI so users can choose attacker setup mode, tune regen behavior, and see budget impact in real time while building a scenario.

## Success Criteria
- Users can choose attacker setup mode per run: `auto`, `user`, or `hybrid`.
- Users can set attacker vital max values and regen rates with clear validation and defaults.
- Users can configure multiple affinities per actor with explicit stack counts per affinity.
- A budget panel shows total budget, spend by category, and remaining tokens live as values change.
- Build/run actions are gated when spend rules are invalid or over budget.
- UI and runtime tests cover contract, calculations, and view wiring.

## Scope
- UI configuration controls and budget telemetry in `packages/ui-web/src/`.
- Runtime config/validation and spend calculations in `packages/runtime/src/`.
- Fixture/test updates in `tests/runtime/` and `tests/ui-web/`.
- Documentation updates in `docs/`.

## Non-Goals
- Rebalancing all actor economics or affinity math globally.
- Introducing new external adapters or IO paths.
- Replacing existing build orchestration flow end-to-end.

## Implementation Steps
1. Define the runtime contract for attacker setup mode and regen controls.
   Requirement: Add explicit fields for attacker setup strategy and regen inputs so UI and runtime share one schema.
   Tests: Add/extend tests in `tests/runtime/prompt-contract.test.js` and `tests/runtime/build-orchestrator.test.js` for valid and invalid mode/rate combinations.
   Code: `packages/runtime/src/personas/orchestrator/prompt-contract.js`, `packages/runtime/src/contracts/domain-constants.js`, `packages/runtime/src/index.js`.

2. Add attacker setup mode controls in Design view.
   Requirement: Users can choose `auto`, `user`, or `hybrid`; control states should reflect mode (for example, manual fields disabled in `auto`).
   Tests: Add UI behavior tests in `tests/ui-web/design-view.test.mjs` and wiring assertions in `tests/ui-web/view-wiring.test.mjs`.
   Code: `packages/ui-web/src/views/design-view.js`, `packages/ui-web/src/main.js`, `packages/ui-web/index.html`.

3. Add attacker regen controls for vitals and affinity stack editing.
   Requirement: UI exposes regen rates for relevant vitals and affinity stack counts per affinity with bounded numeric validation and sensible defaults.
   Tests: Extend `tests/ui-web/simulation-affinity-effects.test.mjs` and add runtime validation coverage in `tests/runtime/build-orchestrator.test.js`.
   Code: `packages/ui-web/src/views/design-view.js`, `packages/runtime/src/personas/configurator/affinity-effects.js`, `packages/runtime/src/personas/configurator/actor-generator.js`.

4. Implement live budget ledger and category breakdown.
   Requirement: Show budget source and live spending buckets for level config, actor base spend, and actor configuration spend.
   Tests: Add/extend `tests/ui-web/bundle-review-affinity.test.mjs`, `tests/ui-web/design-view.test.mjs`, and `tests/runtime/pool-buildspec.test.js` for category totals.
   Code: `packages/ui-web/src/bundle-review.js`, `packages/ui-web/src/views/design-view.js`, `packages/runtime/src/personas/configurator/spend-proposal.js`, `packages/runtime/src/personas/configurator/cost-model.js`.

5. Add spend provenance and delta feedback.
   Requirement: Each token spend shows line-item source and change delta so users can see exactly what each adjustment costs.
   Tests: Add assertions in `tests/runtime/summary-selections.test.js` and UI display checks in `tests/ui-web/design-view.test.mjs`.
   Code: `packages/runtime/src/personas/director/summary-selections.js`, `packages/runtime/src/personas/director/buildspec-assembler.js`, `packages/ui-web/src/views/design-view.js`.

6. Enforce gating and remediation UX for invalid/over-budget states.
   Requirement: Prevent build/run when invalid; show actionable fixes (reduce spend, change mode, reset regen, etc.).
   Tests: Extend `tests/ui-web/diagnostics-view.test.mjs` and `tests/runtime/build-orchestrator.test.js` to verify gating behavior.
   Code: `packages/ui-web/src/build-orchestrator.js`, `packages/ui-web/src/views/design-view.js`, `packages/runtime/src/personas/orchestrator/llm-budget-loop.js`.

7. Update docs for new UI behavior and decision model.
   Requirement: Document attacker mode tradeoffs, regen controls, and budget breakdown semantics.
   Tests: Documentation-only change.
   Code: `docs/human-interfaces.md`, `packages/adapters-cli/README.md` (if CLI flags/settings are exposed for parity).

## Recommendations
- Default to `hybrid` mode: auto-propose attacker settings, but keep user override available to reduce friction and preserve control.
- Use a shared pricing registry for level, actor, and config spend categories so UI and runtime totals cannot drift.
- Add a lightweight "What changed?" spend timeline to surface deltas after each edit.
- Persist last-used attacker/regen preset per session to speed iterative tuning.
- Keep adapter boundaries intact: calculate spend and validation in runtime modules, keep UI as presentation + interaction only.

## Risks And Mitigations
- Risk: UI totals diverge from runtime-applied totals.
  Mitigation: Render UI from runtime-produced spend receipts, not duplicated client-side formulas.
- Risk: Regen settings introduce unstable simulation behavior.
  Mitigation: Clamp ranges and add deterministic fixture tests for boundary values.
- Risk: `auto` vs `user` mode semantics become unclear.
  Mitigation: Add concise helper text and explicit precedence rules (`user` overrides `auto` proposals in `hybrid`).

## Open Questions
- Should over-budget edits be hard-blocked immediately or allowed with deferred build-time gating only?
- Which regen units should be canonical (`per tick`, `per turn`, or normalized)?
- Should attacker mode be scenario-global or actor-specific in advanced workflows?
- Should affinity stack editing support both quick presets and per-affinity manual inputs on day one?

## Acceptance Checklist
- Attacker setup mode selector (`auto`/`user`/`hybrid`) is visible and functional in Design view.
- Attacker vital regen controls validate and persist in session state.
- Affinity stack values per affinity are visible and editable in the actor configuration flow.
- Budget panel shows total, category spend, remaining, and line-item deltas while editing.
- Build/run is gated on invalid or over-budget state with clear remediation cues.
- Runtime and UI tests are added/updated for contract, spend math, and UI wiring.
- Documentation is updated for user-facing behavior and settings.

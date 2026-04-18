# Test Classification

Generated: 2026-04-18T17:16:32.519Z

## Summary

- Total test files: 227
- Covered by current default script: 196
- Missed by current default script: 31
- Targeted for Vitest: 200
- Targeted for Playwright: 27

## Suites

| Suite | Files |
| --- | ---: |
| adapters-cli | 28 |
| adapters-test | 4 |
| adapters-web | 4 |
| allocator | 4 |
| bindings | 5 |
| contracts | 5 |
| core-as | 11 |
| financial-model | 5 |
| fixtures | 6 |
| integration | 8 |
| perf | 1 |
| personas | 52 |
| playwright | 3 |
| root | 2 |
| runtime | 63 |
| scripts | 3 |
| ui-web | 23 |

## Recipes

| Recipe | Files |
| --- | ---: |
| adapter_port_contract | 8 |
| artifact_schema_roundtrip | 41 |
| browser_bundle_load_flow | 29 |
| budget_policy_invariant | 9 |
| cli_success_artifacts | 7 |
| manifest_bundle_consistency | 12 |
| perf_harness_smoke | 1 |
| runtime_module_contract | 46 |
| runtime_persona_transition | 52 |
| serve_ui_redirect_health | 1 |
| ui_cli_equivalence | 1 |
| wasm_effect_contract | 20 |

## Missed By Current Default Script

- tests/integration/ui-aura-display.test.mjs -> vitest
- tests/playwright/runtime-actions-served.spec.mjs -> playwright
- tests/playwright/serve-ui-redirect-health.spec.mjs -> playwright
- tests/playwright/serve-ui-script.spec.mjs -> playwright
- tests/runtime/affinity-palette.test.mjs -> vitest
- tests/runtime/affinity-spatial-formulas.test.mjs -> vitest
- tests/runtime/affinity-tile-mask.test.mjs -> vitest
- tests/runtime/resource-bundle-aura-rendering.test.mjs -> vitest
- tests/ui-web/actor-inspector-icons.test.mjs -> playwright
- tests/ui-web/actor-inspector.test.mjs -> playwright
- tests/ui-web/adapter-playground.test.mjs -> playwright
- tests/ui-web/affinity-legend.test.mjs -> playwright
- tests/ui-web/budget-input-validation.test.mjs -> playwright
- tests/ui-web/budget-panels.test.mjs -> playwright
- tests/ui-web/bundle-integration.test.mjs -> playwright
- tests/ui-web/design-guidance-affinity-sync.test.mjs -> playwright
- tests/ui-web/design-view.test.mjs -> playwright
- tests/ui-web/diagnostics-view.test.mjs -> playwright
- tests/ui-web/icon-resolver-invalid-data-uri.test.mjs -> playwright
- tests/ui-web/icon-resolver.test.mjs -> playwright
- tests/ui-web/layout-hierarchy.test.mjs -> playwright
- tests/ui-web/llm-trace-panel.test.mjs -> playwright
- tests/ui-web/ollama-panel.test.mjs -> playwright
- tests/ui-web/persona-tabs-layout.test.mjs -> playwright
- tests/ui-web/pool-flow.test.mjs -> playwright
- tests/ui-web/populate-ui-icons.test.mjs -> playwright
- tests/ui-web/preview-view.test.mjs -> playwright
- tests/ui-web/simulation-view.test.mjs -> playwright
- tests/ui-web/stitch-poc-view.test.mjs -> playwright
- tests/ui-web/tabs.test.mjs -> playwright
- tests/ui-web/view-wiring.test.mjs -> playwright

## Browser-Native Candidates

- tests/playwright/runtime-actions-served.spec.mjs (browser_bundle_load_flow)
- tests/playwright/serve-ui-redirect-health.spec.mjs (browser_bundle_load_flow)
- tests/playwright/serve-ui-script.spec.mjs (browser_bundle_load_flow)
- tests/scripts/serve-ui.test.js (serve_ui_redirect_health)
- tests/ui-web/actor-inspector-icons.test.mjs (browser_bundle_load_flow)
- tests/ui-web/actor-inspector.test.mjs (browser_bundle_load_flow)
- tests/ui-web/adapter-playground.test.mjs (browser_bundle_load_flow)
- tests/ui-web/affinity-legend.test.mjs (browser_bundle_load_flow)
- tests/ui-web/budget-input-validation.test.mjs (browser_bundle_load_flow)
- tests/ui-web/budget-panels.test.mjs (browser_bundle_load_flow)
- tests/ui-web/bundle-integration.test.mjs (browser_bundle_load_flow)
- tests/ui-web/design-guidance-affinity-sync.test.mjs (browser_bundle_load_flow)
- tests/ui-web/design-view.test.mjs (browser_bundle_load_flow)
- tests/ui-web/diagnostics-view.test.mjs (browser_bundle_load_flow)
- tests/ui-web/icon-resolver-invalid-data-uri.test.mjs (browser_bundle_load_flow)
- tests/ui-web/icon-resolver.test.mjs (browser_bundle_load_flow)
- tests/ui-web/layout-hierarchy.test.mjs (browser_bundle_load_flow)
- tests/ui-web/llm-trace-panel.test.mjs (browser_bundle_load_flow)
- tests/ui-web/ollama-panel.test.mjs (browser_bundle_load_flow)
- tests/ui-web/persona-tabs-layout.test.mjs (browser_bundle_load_flow)
- tests/ui-web/pool-flow.test.mjs (browser_bundle_load_flow)
- tests/ui-web/populate-ui-icons.test.mjs (browser_bundle_load_flow)
- tests/ui-web/preview-view.test.mjs (browser_bundle_load_flow)
- tests/ui-web/simulation-view.test.mjs (browser_bundle_load_flow)
- tests/ui-web/stitch-poc-view.test.mjs (browser_bundle_load_flow)
- tests/ui-web/tabs.test.mjs (browser_bundle_load_flow)
- tests/ui-web/view-wiring.test.mjs (browser_bundle_load_flow)

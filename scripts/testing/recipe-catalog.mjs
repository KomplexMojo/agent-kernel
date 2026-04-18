export const RECIPE_CATALOG = {
  cli_success_artifacts: {
    runner: "vitest",
    scaffoldable: true,
    description: "CLI command succeeds and emits expected artifacts.",
  },
  cli_failure_message: {
    runner: "vitest",
    scaffoldable: true,
    description: "CLI command fails and emits an expected error message.",
  },
  manifest_bundle_consistency: {
    runner: "vitest",
    scaffoldable: true,
    description: "Manifest, bundle, and spec fixtures stay structurally aligned.",
  },
  artifact_schema_roundtrip: {
    runner: "vitest",
    scaffoldable: true,
    description: "Artifact fixture validates against a contract validator.",
  },
  wasm_effect_contract: {
    runner: "vitest",
    scaffoldable: true,
    description: "WASM or bindings contract remains stable across helpers and fixtures.",
  },
  runtime_persona_transition: {
    runner: "vitest",
    scaffoldable: true,
    description: "Persona FSM transitions and guards remain table-driven and deterministic.",
  },
  ui_cli_equivalence: {
    runner: "vitest",
    scaffoldable: true,
    description: "Browser-host and CLI artifact flows remain equivalent.",
  },
  serve_ui_redirect_health: {
    runner: "playwright",
    scaffoldable: true,
    description: "Served UI falls back to an open port and reports readiness.",
  },
  browser_bundle_load_flow: {
    runner: "playwright",
    scaffoldable: true,
    description: "Browser-native UI flow loads and renders expected state.",
  },
  adapter_port_contract: {
    runner: "vitest",
    scaffoldable: true,
    description: "Adapter entrypoints and routed effects satisfy port contracts.",
  },
  budget_policy_invariant: {
    runner: "vitest",
    scaffoldable: true,
    description: "Budget or allocator policies preserve design invariants.",
  },
  runtime_module_contract: {
    runner: "vitest",
    scaffoldable: true,
    description: "Runtime helper modules preserve fixture-driven contract behavior.",
  },
  perf_harness_smoke: {
    runner: "vitest",
    scaffoldable: true,
    description: "Perf harness still executes and returns a bounded smoke signal.",
  },
};

export const SCAFFOLDABLE_RECIPES = Object.entries(RECIPE_CATALOG)
  .filter(([, value]) => value.scaffoldable)
  .map(([name]) => name)
  .sort((left, right) => left.localeCompare(right));

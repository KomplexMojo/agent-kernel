export { createRuntime } from "./runner/runtime.js";
export { applyBudgetCaps } from "./ports/budget.js";
export { BUDGET_CATEGORY_IDS, resolveBudgetCategoryId } from "./contracts/budget-categories.js";
export { solveWithAdapter } from "./ports/solver.js";
export { runMvpMovement } from "./mvp/movement.js";
export { BUILD_SPEC_SCHEMA, BUILD_SPEC_SCHEMA_VERSION, validateBuildSpec } from "./contracts/build-spec.js";
export { mapBuildSpecToArtifacts } from "./build/map-build-spec.js";
export { orchestrateBuild } from "./build/orchestrate-build.js";
export { buildBuildTelemetryRecord } from "./build/telemetry.js";
export { createSchemaCatalog, filterSchemaCatalogEntries } from "./contracts/schema-catalog.js";
export {
  AFFINITY_KINDS,
  AFFINITY_EXPRESSIONS,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_AFFINITY_EXPRESSION,
  ATTACKER_SETUP_MODES,
  DEFAULT_ATTACKER_SETUP_MODE,
  ATTACKER_SETUP_MODE_SET,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CONTEXT_WINDOW_TOKENS,
  PHI4_MODEL_CONTEXT_WINDOW_TOKENS,
  PHI4_LAYOUT_MAX_LATENCY_MS,
  PHI4_RESPONSE_TOKEN_BUDGET,
  PHI4_OLLAMA_OPTIONS,
  DOMAIN_CONSTRAINTS,
  VITAL_KEYS,
  TRAP_VITAL_KEYS,
  VITAL_KIND,
  VITAL_COUNT,
  DEFAULT_VITALS,
  normalizeVitalRecord,
  normalizeVitals,
} from "./contracts/domain-constants.js";

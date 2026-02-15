const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const ARTIFACTS_TS = resolve(ROOT, "packages/runtime/src/contracts/artifacts.ts");
const CONFIGURATOR_CONTRACTS_TS = resolve(ROOT, "packages/runtime/src/personas/configurator/contracts.ts");

function parseStringUnion(sourceText, typeName) {
  const pattern = new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*([^;]+);`);
  const match = sourceText.match(pattern);
  if (!match) return null;
  return match[1]
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("\"") && entry.endsWith("\""))
    .map((entry) => entry.slice(1, -1));
}

test("affinity and expression type unions stay aligned with shared runtime constants", async () => {
  const { AFFINITY_KINDS, AFFINITY_EXPRESSIONS } = await import("../../packages/runtime/src/contracts/domain-constants.js");
  const artifactsSource = readFileSync(ARTIFACTS_TS, "utf8");
  const configuratorSource = readFileSync(CONFIGURATOR_CONTRACTS_TS, "utf8");

  const affinityKinds = parseStringUnion(artifactsSource, "AffinityKind");
  const affinityExpressions = parseStringUnion(artifactsSource, "AffinityExpression");
  const trapAffinityKinds = parseStringUnion(configuratorSource, "TrapAffinityKind");
  const trapAffinityExpressions = parseStringUnion(configuratorSource, "TrapAffinityExpression");

  assert.deepEqual(affinityKinds, Array.from(AFFINITY_KINDS));
  assert.deepEqual(affinityExpressions, Array.from(AFFINITY_EXPRESSIONS));
  assert.deepEqual(trapAffinityKinds, Array.from(AFFINITY_KINDS));
  assert.deepEqual(trapAffinityExpressions, Array.from(AFFINITY_EXPRESSIONS));
});

test("domain constraints expose canonical llm defaults", async () => {
  const {
    ATTACKER_SETUP_MODES,
    DEFAULT_ATTACKER_SETUP_MODE,
    DEFAULT_LLM_BASE_URL,
    DEFAULT_LLM_CONTEXT_WINDOW_TOKENS,
    DEFAULT_LLM_MODEL,
    DOMAIN_CONSTRAINTS,
    PHI4_MODEL_CONTEXT_WINDOW_TOKENS,
    PHI4_LAYOUT_MAX_LATENCY_MS,
    PHI4_RESPONSE_TOKEN_BUDGET,
  } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );

  assert.equal(DOMAIN_CONSTRAINTS.llm.model, DEFAULT_LLM_MODEL);
  assert.equal(DOMAIN_CONSTRAINTS.llm.baseUrl, DEFAULT_LLM_BASE_URL);
  assert.equal(DOMAIN_CONSTRAINTS.llm.contextWindowTokens, DEFAULT_LLM_CONTEXT_WINDOW_TOKENS);
  assert.equal(DOMAIN_CONSTRAINTS.llm.contextWindowTokens, 256000);
  assert.equal(DOMAIN_CONSTRAINTS.llm.modelContextTokens, PHI4_MODEL_CONTEXT_WINDOW_TOKENS);
  assert.equal(DOMAIN_CONSTRAINTS.llm.modelContextTokens, 16384);
  assert.equal(DOMAIN_CONSTRAINTS.llm.outputFormat, "json");
  assert.equal(DOMAIN_CONSTRAINTS.llm.targetLatencyMs.layoutPhase, PHI4_LAYOUT_MAX_LATENCY_MS);
  assert.equal(DOMAIN_CONSTRAINTS.llm.targetLatencyMs.layoutPhase, 10000);
  assert.deepEqual(DOMAIN_CONSTRAINTS.llm.responseTokenBudget, PHI4_RESPONSE_TOKEN_BUDGET);
  assert.equal(DOMAIN_CONSTRAINTS.llm.responseTokenBudget.layoutPhase, 160);
  assert.equal(DOMAIN_CONSTRAINTS.llm.responseTokenBudget.designSummary, 220);
  assert.deepEqual(DOMAIN_CONSTRAINTS.attacker.setupModes, ATTACKER_SETUP_MODES);
  assert.equal(DOMAIN_CONSTRAINTS.attacker.defaultSetupMode, DEFAULT_ATTACKER_SETUP_MODE);
});

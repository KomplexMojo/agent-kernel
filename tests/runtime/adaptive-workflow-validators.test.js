const assert = require("node:assert/strict");

test("validator registry runs in deterministic order with stable issue shape", async () => {
  const { createValidatorRegistry, runValidators } = await import("../../packages/runtime/src/adaptive-workflow/validators.js");
  const registry = createValidatorRegistry([
    { id: "zeta", version: 0, paths: ["/actors.1"], validate: () => ({ ok: true }) },
    {
      id: "zeta",
      version: 1,
      paths: ["/actors"],
      validate: () => ({ errors: [{ field: "actors", code: "missing_actors" }] }),
    },
    {
      id: "alpha",
      version: 2,
      stage: "schema",
      paths: ["/schema"],
      validate: () => ({
        ok: false,
        issues: [{ path: "schema", stage: "invalid", code: "missing_schema", message: "schema is required" }],
      }),
    },
  ]);

  assert.deepEqual(registry.validators.map((validator) => validator.id), ["alpha", "zeta", "zeta"]);
  assert.deepEqual(registry.validators.map(({ version, paths }) => [version, paths]), [[2, ["/schema"]], [1, ["/actors/1"]], [1, ["/actors"]]]);
  const result = runValidators(registry, {}, { stage: "domain" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      validatorId: "alpha",
      validatorVersion: 2,
      stage: "schema",
      path: "/schema",
      code: "missing_schema",
      message: "schema is required",
      category: "validation",
    },
    {
      validatorId: "zeta",
      validatorVersion: 1,
      stage: "domain",
      path: "/actors",
      code: "missing_actors",
      message: "missing_actors",
      category: "validation",
    },
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.issues[0]));
  assert.ok(Object.isFrozen(result.issues));

  const thrown = runValidators(createValidatorRegistry([{ id: "throws", validate: () => { throw new Error("boom"); } }]), {});
  assert.deepEqual(JSON.parse(JSON.stringify(thrown.issues[0])), {
    category: "validation", code: "validation_failed", message: "boom", path: "/", stage: "domain", validatorId: "throws", validatorVersion: 1,
  });
  assert.equal(runValidators(createValidatorRegistry([{ id: "silent", validate: () => ({ ok: false }) }]), {}).ok, false);
});
test("failure classification maps approved categories deterministically", async () => {
  const { classifyFailure } = await import("../../packages/runtime/src/adaptive-workflow/failures.js");
  [
    ["MISSING_RESPONSE_TEXT", "model_contract"], ["timeout", "model_transport"], ["missing_budget_tokens", "budget_exhaustion"],
    ["cancelled", "cancellation"], ["write_failed", "persistence"], ["cli_exit_nonzero", "execution"], ["missing_catalog_match", "validation"],
  ].forEach(([code, category]) => assert.equal(classifyFailure({ code }), category));
  assert.equal(classifyFailure(new Error("socket timeout")), "model_transport");
  assert.equal(classifyFailure(new SyntaxError("bad json")), "model_contract");
  assert.equal(classifyFailure({ category: "execution", code: "missing_response_text" }), "execution");
  assert.equal(classifyFailure({ message: "bread is stale" }), "infrastructure");
  assert.equal(classifyFailure({ code: "unexpected_shape" }), "infrastructure");
});

test("affected validator selection uses explicit path metadata", async () => {
  const { createValidatorRegistry, selectAffectedValidators } = await import("../../packages/runtime/src/adaptive-workflow/validators.js");
  const registry = createValidatorRegistry([
    { id: "actors", version: 1, paths: ["/actors"], validate: () => ({ ok: true }) },
    { id: "actorField", version: 1, paths: ["/actors/0/motivation"], validate: () => ({ ok: true }) },
    { id: "layout", version: 1, paths: ["/layout"], validate: () => ({ ok: true }) },
    { id: "global", version: 1, paths: ["/"], validate: () => ({ ok: true }) },
  ]);
  assert.deepEqual(
    selectAffectedValidators(registry, [{ path: "/actors/0/motivation" }]).map(({ id }) => id),
    ["actorField", "actors", "global"],
  );
  assert.deepEqual(selectAffectedValidators(registry, [{ path: "/actors" }]).map(({ id }) => id), ["actorField", "actors", "global"]);
  assert.deepEqual(selectAffectedValidators(registry, [{ path: "actors.0.motivation.kind" }]).map(({ id }) => id), ["actorField", "actors", "global"]);
  assert.deepEqual(selectAffectedValidators(registry, []).map(({ id }) => id), ["actorField", "actors", "global", "layout"]);
});

test("legacy LLM session and budget-loop errors classify without shape changes", async () => {
  const { classifyFailure } = await import("../../packages/runtime/src/adaptive-workflow/failures.js");
  const { runLlmSession } = await import("../../packages/runtime/src/personas/orchestrator/llm-session.js");
  const { runLlmBudgetLoop } = await import("../../packages/runtime/src/personas/orchestrator/llm-budget-loop.js");
  const session = await runLlmSession({
    model: "fixture",
    prompt: "Return JSON",
    runId: "run_missing_adapter",
    clock: () => "2025-01-01T00:00:00Z",
  });
  assert.deepEqual(session.errors[0], {
    field: "adapter",
    code: "missing_adapter",
    message: "adapter.generate is required",
  });
  assert.equal(classifyFailure(session.errors[0]), "infrastructure");

  const budget = await runLlmBudgetLoop({ budgetTokens: 0 });
  assert.deepEqual(budget.errors[0], { field: "budgetTokens", code: "missing_budget_tokens" });
  assert.equal(classifyFailure(budget.errors[0]), "budget_exhaustion");
});

// ## TODO: Test Permutations
// - unknown error shapes should classify deterministically
// - mixed validation categories should preserve stable ordering
// - empty validator lists should return an ok result

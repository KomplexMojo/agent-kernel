/**
 * `runPoolFlow` — the UI's summary → selections → BuildSpec path.
 *
 * D8 follow-up 2026-08-08. This flow had NO test at all while it mapped catalog pools by
 * importing `director/pool-mapper.js` directly, which is how a glue function came to run
 * the Director's decision with no Director in existence. It now opens a real build round
 * and asks `director.mapPool`, so these tests pin both halves: the mapping still produces
 * the same selections, and the round it needs is refused rather than faked when the caller
 * supplies no timestamp.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const catalogPath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");

function loadUiFlow() {
  return import("../../packages/runtime/src/commands/ui-flow.js");
}

function poolInput() {
  return {
    summary: {
      dungeonAffinity: "fire",
      budgetTokens: 800,
      rooms: [{ motivation: "stationary", affinity: "fire", count: 1, tokenHint: 200 }],
      actors: [{ motivation: "attacking", affinity: "fire", count: 1, tokenHint: 200 }],
    },
    catalog: JSON.parse(readFileSync(catalogPath, "utf8")),
    runId: "pool_ui_test_run",
    source: "pool-ui",
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

test("runPoolFlow maps the summary onto the catalog and assembles a spec", async () => {
  const { runPoolFlow } = await loadUiFlow();

  const result = runPoolFlow(poolInput());

  assert.equal(result.ok, true, JSON.stringify(result.errors || []));
  assert.equal(result.runId, "pool_ui_test_run");
  assert.ok(Array.isArray(result.selections) && result.selections.length > 0);
  assert.ok(result.selections.every((entry) => entry.receipt?.status === "approved"));
  assert.ok(result.spec);
  assert.equal(result.spec.meta.runId, "pool_ui_test_run");
  assert.ok(Array.isArray(result.allowed?.motivations));
});

test("runPoolFlow selections are identical to the Director's own mapping", async () => {
  // The round is the change; the mapping is not allowed to be. Compared against the
  // Director's public surface rather than against a recorded literal, so this stays a
  // parity check on `mapPool` and not a second copy of its output.
  const { runPoolFlow } = await loadUiFlow();
  const { beginDirectorRound } = await import(
    "../../packages/runtime/src/commands/director-round.js"
  );
  const input = poolInput();

  const viaFlow = runPoolFlow(input);
  const viaDirector = beginDirectorRound({
    runId: input.runId,
    createdAt: input.createdAt,
    producedBy: input.source,
  }).mapPool({ summary: input.summary, catalog: input.catalog });

  assert.equal(viaFlow.ok, true);
  assert.equal(viaDirector.ok, true);
  // Compared as a SET: the flow reports selections after `enforceBudget`, which reorders
  // them (it ranks picks before deciding what fits) even when everything is affordable —
  // 800 tokens against two 200-token picks here. Order is the enforcer's business; the
  // mapping's business is which entries were snapped, and that must not have changed.
  const appliedIds = (selections) => selections.map((entry) => entry.applied?.id ?? null).sort();
  assert.deepEqual(appliedIds(viaFlow.selections), appliedIds(viaDirector.selections));
});

test("runPoolFlow REFUSES without createdAt rather than letting a persona invent one", async () => {
  const { runPoolFlow } = await loadUiFlow();
  const { createdAt, ...withoutCreatedAt } = poolInput();

  const result = runPoolFlow(withoutCreatedAt);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_created_at");
  assert.ok(result.errors.length > 0);
});

test("runPoolFlow still reports missing summary and catalog before anything else", async () => {
  const { runPoolFlow } = await loadUiFlow();
  const input = poolInput();

  assert.equal(runPoolFlow({ ...input, summary: undefined }).reason, "missing_summary");
  assert.equal(runPoolFlow({ ...input, catalog: undefined }).reason, "missing_catalog");
});

// ## TODO: Test Permutations
// - summaries whose picks match no catalog entry (receipt.status "missing")
// - budgets tight enough that enforceBudget drops picks, so the flow's selections and the
//   Director's raw mapping deliberately DIVERGE
// - catalogs that fail normalization, so the flow returns reason "mapping_failed"
// - createdAt present but not ISO-8601, and createdAt as a whitespace-only string
// - source values other than "pool-ui", checked against the round's producedBy

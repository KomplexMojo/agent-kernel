const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const catalogPath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");

test("summary + catalog produces a valid BuildSpec", async () => {
  const { buildBuildSpecFromSummary } = await import(
    "../../packages/runtime/src/personas/director/buildspec-assembler.js"
  );
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const summary = {
    dungeonTheme: "fire",
    budgetTokens: 800,
    rooms: [{ motivation: "stationary", affinity: "fire", count: 1, tokenHint: 200 }],
    actors: [{ motivation: "attacking", affinity: "fire", count: 1, tokenHint: 200 }],
    tags: ["test"],
  };

  const result = buildBuildSpecFromSummary({
    summary,
    catalog,
    runId: "pool_test_run",
    createdAt: "2024-01-01T00:00:00Z",
    source: "director-pool-test",
  });

  assert.equal(result.ok, true);
  assert.ok(result.spec);
  assert.equal(result.spec.meta.runId, "pool_test_run");
  assert.equal(result.spec.intent.goal.includes("fire"), true);
  assert.equal(result.spec.configurator.inputs.actors.length, 1);
  assert.equal(result.spec.configurator.inputs.actorGroups[0].count, 1);
});

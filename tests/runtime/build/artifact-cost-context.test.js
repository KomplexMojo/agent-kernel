import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { orchestrateBuild } from "../../../packages/runtime/src/build/orchestrate-build.js";

const ROOT = resolve(import.meta.dirname, "../../..");

function loadFixture(name) {
  return JSON.parse(readFileSync(resolve(ROOT, `tests/fixtures/artifacts/${name}`), "utf8"));
}

function build(fixtureName) {
  return orchestrateBuild({ spec: loadFixture(fixtureName) });
}

describe("meta.cost propagation on emitted artifacts", () => {
  test("spec carries meta.cost with receipt and proposal refs when budget present", async () => {
    const result = await build("build-spec-v1-budget-tokens-only.json");
    assert.ok(result.spendProposal, "spendProposal must be generated");
    assert.ok(result.budgetReceipt, "budgetReceipt must be generated");
    const cost = result.spec?.meta?.cost;
    assert.ok(cost, "spec.meta.cost must be present when budget is supplied");
    assert.ok(cost.receiptRef, "spec.meta.cost.receiptRef must be set");
    assert.ok(cost.proposalRef, "spec.meta.cost.proposalRef must be set");
  });

  test("spec.meta.cost.runTotalTokens equals budgetReceipt.totalCost", async () => {
    const result = await build("build-spec-v1-budget-tokens-only.json");
    const cost = result.spec?.meta?.cost;
    assert.ok(cost, "spec.meta.cost must be present");
    assert.equal(cost.runTotalTokens, result.budgetReceipt.totalCost,
      "runTotalTokens must match budgetReceipt.totalCost");
  });

  test("spec.meta.cost.budgetTokens equals the input budget tokens", async () => {
    const result = await build("build-spec-v1-budget-tokens-only.json");
    const cost = result.spec?.meta?.cost;
    assert.ok(cost, "spec.meta.cost must be present");
    assert.equal(cost.budgetTokens, 500, "budgetTokens must equal the spec's budget tokens value");
  });

  test("simConfig carries meta.cost with same receipt and proposal refs as spec", async () => {
    const result = await build("build-spec-v1-budget-tokens-only.json");
    assert.ok(result.simConfig, "simConfig must be present");
    const cost = result.simConfig?.meta?.cost;
    assert.ok(cost, "simConfig.meta.cost must be present when budget is supplied");
    assert.deepEqual(cost.receiptRef, result.spec.meta.cost.receiptRef,
      "simConfig and spec must share the same receiptRef");
    assert.deepEqual(cost.proposalRef, result.spec.meta.cost.proposalRef,
      "simConfig and spec must share the same proposalRef");
  });

  test("initialState carries meta.cost", async () => {
    const result = await build("build-spec-v1-budget-tokens-only.json");
    assert.ok(result.initialState, "initialState must be present");
    const cost = result.initialState?.meta?.cost;
    assert.ok(cost, "initialState.meta.cost must be present when budget is supplied");
    assert.ok(cost.receiptRef, "initialState.meta.cost.receiptRef must be set");
  });

  test("no meta.cost on spec when no budget is supplied", async () => {
    const result = await build("build-spec-v1-basic.json");
    assert.equal(result.spec?.meta?.cost, undefined,
      "spec.meta.cost must be absent when no budget is supplied");
  });
});

// ## TODO: Test Permutations
// - budget-tokens-only (no explicit priceList): cost refs still populated via default price list
// - explicit budgetArtifact + priceListArtifact: same cost context shape
// - spendProposal is denied/partial: meta.cost still present, runTotalTokens reflects actual spend
// - resourceBundle.meta.cost matches spec.meta.cost refs
// - affinitySummary.meta.cost present when affinityPresets supplied and budget present

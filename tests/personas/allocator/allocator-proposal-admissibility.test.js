const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * CR.6 half B — budget admissibility belongs to the Allocator.
 *
 * REPLACES tests/personas/actor-budget-gating.test.js, which drove the same
 * fixture through the ACTOR because `filterBudgetedProposals` ran inline inside
 * `actor/controller.js`. Judging whether a proposal is affordable is an economy
 * question and the charter gives the Allocator sole authority over the economy;
 * the give-away was that the ids being resolved (`motivation_reflexive`,
 * `affinity_expression_*`, `affinity_stack`) are priced in the Allocator's own
 * `base-costs.json`.
 *
 * Same fixture, same expectations, asked of the persona that owns the answer.
 * The fixture's `expectedKinds`/`expectedLabels` describe ACTIONS the Actor used
 * to build, so they are mapped back to the proposals that survive admission.
 */

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../fixtures/personas/persona-behavior-v1-actor-budget-gating.json"), "utf8"),
);

test("allocator admits only the proposals a budget allows", async () => {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );

  assert.ok(fixture.cases.length > 0, "the fixture must carry cases, or this asserts nothing");

  fixture.cases.forEach((entry) => {
    const allocator = createAllocatorPersona({ clock: () => "fixed" });
    const admitted = allocator.admitProposals(entry.proposals, {
      budgetReceipt: entry.budgetReceipt,
      budgetAllocation: entry.budgetAllocation,
    });

    assert.deepEqual(
      admitted.map((proposal) => proposal.kind),
      entry.expectedKinds,
      `${entry.id}: admitted proposal kinds`,
    );
    assert.deepEqual(
      admitted.map((proposal) => proposal.params && proposal.params.label).filter(Boolean),
      entry.expectedLabels,
      `${entry.id}: admitted proposal labels`,
    );
  });
});

test("allocator admits everything when there is no budget to judge against", async () => {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );

  const allocator = createAllocatorPersona({ clock: () => "fixed" });
  const proposals = fixture.cases[0].proposals;

  // This is the tick plane's situation today: no receipt reaches it, so nothing
  // is denied. It is the reason moving this policy changed no run output.
  assert.deepEqual(allocator.admitProposals(proposals, {}), proposals);
  assert.deepEqual(allocator.admitProposals(proposals), proposals);
});

test("allocator admissibility is not something the Actor can still do", async () => {
  const actorSource = readFileSync(
    resolve(__dirname, "../../../packages/runtime/src/personas/actor/controller.js"),
    "utf8",
  );
  // A1 single-origin: the policy must not have been copied, only moved. Comments
  // that NAME the moved functions are fine; a call or definition is not.
  const code = actorSource
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");

  for (const symbol of ["filterBudgetedProposals", "hasBudgetAllowance", "MOTIVATION_IDS"]) {
    assert.ok(
      !code.includes(symbol),
      `${symbol} is still live in the Actor — budget policy has two origins again`,
    );
  }
});

/**
 * ## TODO: Test Permutations
 *
 * - a receipt whose line item is `denied` vs one with quantity 0
 * - allocation pools other than `affinity_motivation`
 * - proposals carrying costKind/costId directly rather than kind/tier
 * - affinity proposals where the expression is allowed but affinity_stack is not
 * - a receipt and an allocation that disagree
 */

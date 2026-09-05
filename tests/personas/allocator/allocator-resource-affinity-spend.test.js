/**
 * M17 — Resource payloads are charged against the build budget: failing tests
 *
 * THE BUG THIS CLOSES: an affinity resource was charged NOTHING. buildSpendItems'
 * resource branch (extractResourcePriceEntries) only priced the vital/permanenceMode
 * shapes, so `--resource affinity=water;...` produced no spend lines at all.
 *
 * Why that matters beyond a missing line item: the design has NO hard cap on
 * permanent-affinity resources per level, deliberately — scarcity is supposed to be
 * emergent, because "the number of high-value permanent resources will naturally be
 * limited by the budget available to the creator". A free resource imposes no limit,
 * so the scarcity model simply did not exist.
 *
 * Costing rules (price list is authoritative; cost-model.js is NOT):
 *   - Resources are charged via resource_* price ids carrying the free-floating
 *     premium (round(1.5 × base)). Hazards pay no premium — they grant nothing.
 *   - Scaling shape is inherited from the mirrored base id: stacks and regen stay
 *     quadratic, everything else linear.
 *   - The vital DELTA keeps its existing resource_base/level/permanent pricing —
 *     it was already charged, and must not be double-charged here.
 *   - The vital REGEN is newly charged (it was a new field in M15).
 *
 * Tests MUST FAIL until M17 implements the affinity/regen branch of
 * extractResourcePriceEntries.
 */
const assert = require("node:assert/strict");

const SPEND = "../../../packages/runtime/src/personas/allocator/spend-proposal.js";
const PRICES = "../../../packages/runtime/src/personas/allocator/default-price-list.js";

function lineFor(proposal, id) {
  const items = proposal?.items || [];
  return items.find((i) => i.id === id);
}

function resourceLines(proposal) {
  return (proposal?.items || []).filter((i) => i.category === "resources");
}

const affinityResource = (over = {}) => ({
  id: "res_1",
  permanenceMode: "consumable",
  vitals: [],
  affinity: { kind: "water", expression: "emit", stacks: 2, mana: 50, manaRegen: 0 },
  ...over,
});

test("an affinity resource produces spend lines instead of being free", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const proposal = buildSpendProposal({ resources: [affinityResource()] });
  const lines = resourceLines(proposal);
  assert.ok(lines.length > 0, "affinity resource must be charged");
});

test("the affinity payload charges base, stacks and expression", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const proposal = buildSpendProposal({ resources: [affinityResource()] });
  assert.ok(lineFor(proposal, "resource_affinity_base"), "missing base line");
  assert.equal(lineFor(proposal, "resource_affinity_stack").quantity, 2);
  assert.ok(lineFor(proposal, "resource_affinity_expression_localized"), "emit → localized");
});

test("push/pull map to externalize, emit/draw to localized/sustain", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const at = (expression) => {
    const p = buildSpendProposal({
      resources: [affinityResource({ affinity: { kind: "fire", expression, stacks: 1, mana: 1, manaRegen: 0 } })],
    });
    return (p.items || []).map((i) => i.id).filter((id) => id.startsWith("resource_affinity_expression_"));
  };
  assert.deepEqual(at("push"), ["resource_affinity_expression_externalize"]);
  assert.deepEqual(at("emit"), ["resource_affinity_expression_localized"]);
  assert.deepEqual(at("draw"), ["resource_affinity_expression_sustain"]);
});

test("the mana pool is charged", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const proposal = buildSpendProposal({ resources: [affinityResource()] });
  assert.equal(lineFor(proposal, "resource_vital_mana_point").quantity, 50);
});

test("manaRegen is charged, and quadratically — this is what makes permanence expensive", async () => {
  const { buildSpendProposal, } = await import(SPEND);
  const { buildDefaultPriceList, applyFormula } = await import(PRICES);
  const proposal = buildSpendProposal({
    resources: [affinityResource({
      affinity: { kind: "water", expression: "emit", stacks: 2, mana: 50, manaRegen: 5 },
    })],
  });
  const line = lineFor(proposal, "resource_vital_mana_regen_tick");
  assert.ok(line, "permanent resource must charge its regen");
  assert.equal(line.quantity, 5);

  const item = buildDefaultPriceList().items.find((i) => i.id === "resource_vital_mana_regen_tick");
  assert.equal(item.formula, "quadratic");
  // 5 regen costs 25× the unit, not 5× — the whole point.
  assert.equal(applyFormula(item, 5), item.unitCost * 25);
});

test("a temporary resource charges no regen at all", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const proposal = buildSpendProposal({ resources: [affinityResource()] }); // manaRegen 0
  assert.equal(lineFor(proposal, "resource_vital_mana_regen_tick"), undefined);
});

test("a permanent resource costs materially more than the identical temporary one", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const { buildDefaultPriceList, applyFormula } = await import(PRICES);
  const prices = Object.fromEntries(buildDefaultPriceList().items.map((i) => [i.id, i]));
  const total = (manaRegen) => {
    const p = buildSpendProposal({
      resources: [affinityResource({
        affinity: { kind: "water", expression: "emit", stacks: 2, mana: 50, manaRegen },
      })],
    });
    return resourceLines(p).reduce((sum, line) => {
      const item = prices[line.id];
      return sum + (item ? applyFormula(item, line.quantity) : 0);
    }, 0);
  };
  const temporary = total(0);
  const permanent = total(5);
  assert.ok(permanent > temporary, `permanent ${permanent} must exceed temporary ${temporary}`);
  // Scarcity depends on the gap being significant, not incidental.
  assert.ok(permanent - temporary >= 25, `gap ${permanent - temporary} is too small to limit anything`);
});

test("the vital regen of a vital+regen resource is charged", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const proposal = buildSpendProposal({
    resources: [{
      id: "res_v",
      permanenceMode: "consumable",
      vitals: [{ key: "health", delta: 5, regen: 2 }],
    }],
  });
  assert.equal(lineFor(proposal, "resource_vital_health_regen_tick").quantity, 2);
});

test("the vital delta keeps its existing pricing — not double-charged", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const proposal = buildSpendProposal({
    resources: [{
      id: "res_v",
      permanenceMode: "consumable",
      vitals: [{ key: "health", delta: 5 }],
    }],
  });
  assert.equal(lineFor(proposal, "resource_base").quantity, 5); // existing behaviour
  assert.equal(lineFor(proposal, "resource_vital_health_point"), undefined); // no double charge
});

test("existing vital-only resources are unchanged", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const proposal = buildSpendProposal({
    resources: [{ id: "r", permanenceMode: "permanent", vitals: [{ key: "mana", delta: 6 }] }],
  });
  assert.equal(lineFor(proposal, "resource_permanent").quantity, 6);
  assert.equal(resourceLines(proposal).length, 1);
});

test("a resource carrying both payloads charges both", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const proposal = buildSpendProposal({
    resources: [{
      id: "res_both",
      permanenceMode: "consumable",
      vitals: [{ key: "health", delta: 3, regen: 1 }],
      affinity: { kind: "fire", expression: "push", stacks: 1, mana: 10, manaRegen: 0 },
    }],
  });
  assert.equal(lineFor(proposal, "resource_base").quantity, 3);
  assert.equal(lineFor(proposal, "resource_vital_health_regen_tick").quantity, 1);
  assert.ok(lineFor(proposal, "resource_affinity_base"));
  assert.equal(lineFor(proposal, "resource_vital_mana_point").quantity, 10);
});

test("resource spend lines are categorised as resources for pool accounting", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const proposal = buildSpendProposal({ resources: [affinityResource()] });
  for (const line of resourceLines(proposal)) {
    assert.equal(line.category, "resources");
  }
});

// ---------------------------------------------------------------------------
// ## TODO: Test Permutations
//
// Hand to Ollama (/ollama-test-permutations) once M17 is green. Expand:
//   - All 10 kinds × 4 expressions produce the right expression line.
//   - stacks 1..10 and manaRegen 0..10 quantities.
//   - Multiple affinity resources in one level accumulate distinct subject refs.
//   - A budget that affords one permanent resource denies the second (emergent scarcity).
//   - Legacy V1 (tier/stat/delta/dropRate) resources still price unchanged.
// ---------------------------------------------------------------------------

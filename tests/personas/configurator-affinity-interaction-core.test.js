const assert = require("node:assert/strict");


test("affinity interaction delegation: core-ts resolves interactions, async pressure, and relationships", async () => {
const { createCore } = await import("../../packages/core-ts/src/index.ts");
const {
  AFFINITY_KIND_TO_CODE,
  AFFINITY_EXPRESSION_TO_CODE,
  resolveAffinityInteractionFromCore,
  resolveNetPressureFromCore,
  resolveRelationshipFromCore,
} = await import("../../packages/runtime/src/personas/configurator/affinity-interaction-core.js");

const core = createCore();
core.init(0);

// ── Code map validation ──

assert.equal(Object.keys(AFFINITY_KIND_TO_CODE).length, 10, "10 affinity kinds");
assert.equal(AFFINITY_KIND_TO_CODE.fire, 1);
assert.equal(AFFINITY_KIND_TO_CODE.dark, 10);
assert.equal(Object.keys(AFFINITY_EXPRESSION_TO_CODE).length, 4, "4 expressions");
assert.equal(AFFINITY_EXPRESSION_TO_CODE.push, 1);
assert.equal(AFFINITY_EXPRESSION_TO_CODE.draw, 4);

// ── resolveAffinityInteractionFromCore: same kind, push vs push ──

{
  const result = resolveAffinityInteractionFromCore(core,
    { kind: "fire", expression: "push", stacks: 2 },
    { kind: "fire", expression: "push", stacks: 1 },
  );
  assert.ok(result !== null, "same-kind interaction resolves");
  assert.equal(result.relationshipName, "same", "fire vs fire = same");
  assert.ok(Number.isInteger(result.sourceEffect), "sourceEffect is integer");
  assert.ok(Number.isInteger(result.targetEffect), "targetEffect is integer");
  assert.ok(Number.isInteger(result.visualState), "visualState is integer");
  assert.ok(typeof result.sourceEffectName === "string", "sourceEffectName is string");
  assert.ok(typeof result.targetEffectName === "string", "targetEffectName is string");
  assert.ok(typeof result.visualStateName === "string", "visualStateName is string");
  assert.ok(Number.isInteger(result.netSourceStacks), "netSourceStacks is integer");
  assert.ok(Number.isInteger(result.netTargetStacks), "netTargetStacks is integer");
  assert.ok(Number.isInteger(result.canceledStacks), "canceledStacks is integer");
}

// ── resolveAffinityInteractionFromCore: opposite kinds ──

{
  const result = resolveAffinityInteractionFromCore(core,
    { kind: "fire", expression: "push", stacks: 3 },
    { kind: "water", expression: "push", stacks: 2 },
  );
  assert.ok(result !== null, "opposite interaction resolves");
  assert.equal(result.relationshipName, "opposite", "fire vs water = opposite");
  // Opposite push vs push should cancel stacks
  assert.equal(result.canceledStacks, 2, "min(3,2) = 2 canceled");
  assert.equal(result.netSourceStacks, 1, "3 - 2 = 1 net source");
  assert.equal(result.netTargetStacks, 0, "2 - 2 = 0 net target");
}

// ── resolveAffinityInteractionFromCore: neutral kinds ──

{
  const result = resolveAffinityInteractionFromCore(core,
    { kind: "fire", expression: "push", stacks: 1 },
    { kind: "earth", expression: "push", stacks: 1 },
  );
  assert.ok(result !== null, "neutral interaction resolves");
  assert.equal(result.relationshipName, "neutral", "fire vs earth = neutral");
}

// ── resolveAffinityInteractionFromCore: cross-expression ──

{
  const result = resolveAffinityInteractionFromCore(core,
    { kind: "fire", expression: "emit", stacks: 1 },
    { kind: "water", expression: "draw", stacks: 1 },
  );
  assert.ok(result !== null, "cross-expression interaction resolves");
  assert.equal(result.relationshipName, "opposite", "fire vs water still opposite");
}

// ── resolveAffinityInteractionFromCore: null core → null ──

{
  const result = resolveAffinityInteractionFromCore(null,
    { kind: "fire", expression: "push", stacks: 1 },
    { kind: "water", expression: "push", stacks: 1 },
  );
  assert.equal(result, null, "null core → null");
}

// ── resolveAffinityInteractionFromCore: invalid kind → null ──

{
  const result = resolveAffinityInteractionFromCore(core,
    { kind: "invalid", expression: "push", stacks: 1 },
    { kind: "water", expression: "push", stacks: 1 },
  );
  assert.equal(result, null, "invalid kind → null");
}

// ── resolveAffinityInteractionFromCore: invalid expression → null ──

{
  const result = resolveAffinityInteractionFromCore(core,
    { kind: "fire", expression: "invalid", stacks: 1 },
    { kind: "water", expression: "push", stacks: 1 },
  );
  assert.equal(result, null, "invalid expression → null");
}

// ── resolveAffinityInteractionFromCore: missing stacks defaults to 1 ──

{
  const result = resolveAffinityInteractionFromCore(core,
    { kind: "fire", expression: "push" },
    { kind: "fire", expression: "push" },
  );
  assert.ok(result !== null, "missing stacks → defaults to 1");
  assert.equal(result.relationshipName, "same");
}

// ── resolveNetPressureFromCore: basic cancellation ──

{
  const baseByKind = { fire: 3, water: 2, earth: 0, wind: 0, life: 0, decay: 0, corrode: 0, fortify: 0, light: 0, dark: 0 };
  const { netByKind, cancellations } = resolveNetPressureFromCore(core, baseByKind);
  assert.equal(netByKind.fire, 1, "fire: 3 - 2 = 1");
  assert.equal(netByKind.water, 0, "water: 2 - 2 = 0");
  assert.ok(cancellations.length > 0, "has cancellations");
  const fireCancel = cancellations.find(c => c.kind === "fire" || c.opposite === "fire");
  assert.ok(fireCancel, "fire/water cancellation recorded");
  assert.equal(fireCancel.canceled, 2, "canceled = min(3,2) = 2");
}

// ── resolveNetPressureFromCore: no opposites → no cancellation ──

{
  const baseByKind = { fire: 2, water: 0, earth: 3, wind: 0, life: 0, decay: 0, corrode: 0, fortify: 0, light: 0, dark: 0 };
  const { netByKind, cancellations } = resolveNetPressureFromCore(core, baseByKind);
  assert.equal(netByKind.fire, 2, "fire unchanged");
  assert.equal(netByKind.earth, 3, "earth unchanged");
  // fire/water: fire=2, water=0 → no actual cancellation (actualCanceled = min(2,0) = 0)
  // earth/wind: earth=3, wind=0 → no actual cancellation
  const realCancellations = cancellations.filter(c => c.canceled > 0);
  assert.equal(realCancellations.length, 0, "no actual cancellations");
}

// ── resolveNetPressureFromCore: multiple pairs ──

{
  const baseByKind = { fire: 4, water: 4, earth: 1, wind: 3, life: 0, decay: 0, corrode: 5, fortify: 2, light: 0, dark: 0 };
  const { netByKind, cancellations } = resolveNetPressureFromCore(core, baseByKind);
  // fire/water: cancel min(4,4)=4
  assert.equal(netByKind.fire, 0, "fire: 4-4=0");
  assert.equal(netByKind.water, 0, "water: 4-4=0");
  // earth/wind: cancel min(1,3)=1
  assert.equal(netByKind.earth, 0, "earth: 1-1=0");
  assert.equal(netByKind.wind, 2, "wind: 3-1=2");
  // corrode/fortify: cancel min(5,2)=2
  assert.equal(netByKind.corrode, 3, "corrode: 5-2=3");
  assert.equal(netByKind.fortify, 0, "fortify: 2-2=0");
  const realCancellations = cancellations.filter(c => c.canceled > 0);
  assert.equal(realCancellations.length, 3, "3 actual cancellations");
}

// ── resolveNetPressureFromCore: null core → passthrough ──

{
  const baseByKind = { fire: 2, water: 1 };
  const { netByKind, cancellations } = resolveNetPressureFromCore(null, baseByKind);
  assert.equal(netByKind.fire, 2, "null core → passthrough fire");
  assert.equal(netByKind.water, 1, "null core → passthrough water");
  assert.equal(cancellations.length, 0, "null core → no cancellations");
}

// ── resolveNetPressureFromCore: all zeroes → all zeroes ──

{
  const baseByKind = { fire: 0, water: 0, earth: 0, wind: 0, life: 0, decay: 0, corrode: 0, fortify: 0, light: 0, dark: 0 };
  const { netByKind, cancellations } = resolveNetPressureFromCore(core, baseByKind);
  for (const [kind, val] of Object.entries(netByKind)) {
    assert.equal(val, 0, kind + " is 0");
  }
  assert.equal(cancellations.length, 0, "no cancellations for zeroes");
}

// ── resolveRelationshipFromCore: same ──

{
  const rel = resolveRelationshipFromCore(core, "fire", "fire");
  assert.equal(rel, "same", "fire/fire = same");
}

// ── resolveRelationshipFromCore: opposite ──

{
  const rel = resolveRelationshipFromCore(core, "fire", "water");
  assert.equal(rel, "opposite", "fire/water = opposite");
}

// ── resolveRelationshipFromCore: neutral ──

{
  const rel = resolveRelationshipFromCore(core, "fire", "earth");
  assert.equal(rel, "neutral", "fire/earth = neutral");
}

// ── resolveRelationshipFromCore: all 5 opposite pairs ──

{
  const pairs = [
    ["fire", "water"], ["earth", "wind"], ["life", "decay"],
    ["corrode", "fortify"], ["light", "dark"],
  ];
  for (const [a, b] of pairs) {
    assert.equal(resolveRelationshipFromCore(core, a, b), "opposite", a + "/" + b + " = opposite");
    assert.equal(resolveRelationshipFromCore(core, b, a), "opposite", b + "/" + a + " = opposite");
  }
}

// ── resolveRelationshipFromCore: null core → unknown ──

{
  const rel = resolveRelationshipFromCore(null, "fire", "water");
  assert.equal(rel, "unknown", "null core → unknown");
}

// ── resolveRelationshipFromCore: invalid kind → unknown ──

{
  const rel = resolveRelationshipFromCore(core, "invalid", "water");
  assert.equal(rel, "unknown", "invalid kind → unknown");
}

console.log("configurator-affinity-interaction: all assertions passed");
});

// ## TODO: Test Permutations
// - [ ] All 10 affinity kinds same-kind interaction: verify relationship = "same"
// - [ ] All 5 opposite pairs: verify interaction cancellation stacks correct
// - [ ] All 4 expressions × 4 expressions cross-expression: verify resolves non-null
// - [ ] Stack asymmetry: source > target and source < target for opposite kinds
// - [ ] Stacks = 0 or negative: verify defaults to 1
// - [ ] resolveNetPressureFromCore with single non-zero kind (no opposite present): verify passthrough
// - [ ] resolveNetPressureFromCore: JS resolveNetPressure parity for 10 random baseByKind inputs
// - [ ] resolveRelationshipFromCore: all 100 kind×kind pairs categorized correctly
// - [ ] Sequential calls: verify last-result state resets between calls
// - [ ] Large stacks (100+): verify cancellation arithmetic correct

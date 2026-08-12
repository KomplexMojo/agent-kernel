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

test("affinity interaction delegation permutations", async () => {
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
const kinds = Object.keys(AFFINITY_KIND_TO_CODE);
const expressions = Object.keys(AFFINITY_EXPRESSION_TO_CODE);
const oppositePairs = [
  ["fire", "water"],
  ["earth", "wind"],
  ["life", "decay"],
  ["corrode", "fortify"],
  ["light", "dark"],
];
const oppositeMap = new Map(oppositePairs.flatMap(([a, b]) => [[a, b], [b, a]]));
const expectedNetPressure = (baseByKind) => {
  const netByKind = {};
  const cancellations = [];
  const visited = new Set();
  for (const kind of kinds) {
    if (visited.has(kind)) continue;
    const opposite = oppositeMap.get(kind);
    if (!opposite || visited.has(opposite)) {
      netByKind[kind] = baseByKind[kind] || 0;
      visited.add(kind);
      continue;
    }
    const sourceStacks = baseByKind[kind] || 0;
    const oppositeStacks = baseByKind[opposite] || 0;
    const canceled = Math.min(sourceStacks, oppositeStacks);
    netByKind[kind] = sourceStacks - canceled;
    netByKind[opposite] = oppositeStacks - canceled;
    if (canceled > 0) {
      cancellations.push({ kind, opposite, sourceStacks, oppositeStacks, canceled });
    }
    visited.add(kind);
    visited.add(opposite);
  }
  return { netByKind, cancellations };
};

for (const kind of kinds) {
  const result = resolveAffinityInteractionFromCore(
    core,
    { kind, expression: "push", stacks: 2 },
    { kind, expression: "push", stacks: 1 },
  );
  assert.ok(result !== null, `${kind} same-kind resolves`);
  assert.equal(result.relationshipName, "same", `${kind}/${kind} relationship`);
}

for (const [sourceKind, targetKind] of oppositePairs) {
  const result = resolveAffinityInteractionFromCore(
    core,
    { kind: sourceKind, expression: "push", stacks: 5 },
    { kind: targetKind, expression: "push", stacks: 3 },
  );
  assert.ok(result !== null, `${sourceKind}/${targetKind} resolves`);
  assert.equal(result.relationshipName, "opposite");
  assert.equal(result.canceledStacks, 3);
  assert.equal(result.netSourceStacks, 2);
  assert.equal(result.netTargetStacks, 0);
}

for (const sourceExpression of expressions) {
  for (const targetExpression of expressions) {
    const result = resolveAffinityInteractionFromCore(
      core,
      { kind: "fire", expression: sourceExpression, stacks: 1 },
      { kind: "water", expression: targetExpression, stacks: 1 },
    );
    assert.ok(result !== null, `${sourceExpression}/${targetExpression} resolves`);
    assert.equal(result.relationshipName, "opposite");
  }
}

{
  const sourceWins = resolveAffinityInteractionFromCore(
    core,
    { kind: "fire", expression: "push", stacks: 4 },
    { kind: "water", expression: "push", stacks: 1 },
  );
  assert.equal(sourceWins.canceledStacks, 1);
  assert.equal(sourceWins.netSourceStacks, 3);
  assert.equal(sourceWins.netTargetStacks, 0);

  const targetWins = resolveAffinityInteractionFromCore(
    core,
    { kind: "fire", expression: "push", stacks: 1 },
    { kind: "water", expression: "push", stacks: 4 },
  );
  assert.equal(targetWins.canceledStacks, 1);
  assert.equal(targetWins.netSourceStacks, 0);
  assert.equal(targetWins.netTargetStacks, 3);
}

{
  const result = resolveAffinityInteractionFromCore(
    core,
    { kind: "fire", expression: "push", stacks: 0 },
    { kind: "water", expression: "push", stacks: -2 },
  );
  assert.equal(result.canceledStacks, 1);
  assert.equal(result.netSourceStacks, 0);
  assert.equal(result.netTargetStacks, 0);
}

{
  const { netByKind, cancellations } = resolveNetPressureFromCore(core, { fire: 7 });
  assert.equal(netByKind.fire, 7);
  assert.equal(netByKind.water, 0);
  assert.equal(cancellations.length, 0);
}

const pressureFixtures = [
  { fire: 3, water: 1 },
  { fire: 0, water: 5, earth: 2 },
  { earth: 9, wind: 4, life: 2, decay: 2 },
  { corrode: 6, fortify: 1, light: 8, dark: 3 },
  { fire: 1, water: 1, earth: 1, wind: 1, life: 1, decay: 1 },
  { fire: 10, water: 0, dark: 10 },
  { life: 0, decay: 7, corrode: 2, fortify: 9 },
  { wind: 12, earth: 5, light: 0, dark: 2 },
  { fire: 4, water: 9, earth: 8, wind: 1, life: 3 },
  { corrode: 0, fortify: 0, light: 11, dark: 11 },
];
for (const fixture of pressureFixtures) {
  assert.deepEqual(resolveNetPressureFromCore(core, fixture), expectedNetPressure(fixture));
}

for (const sourceKind of kinds) {
  for (const targetKind of kinds) {
    const expected = sourceKind === targetKind
      ? "same"
      : oppositeMap.get(sourceKind) === targetKind
        ? "opposite"
        : "neutral";
    assert.equal(resolveRelationshipFromCore(core, sourceKind, targetKind), expected, `${sourceKind}/${targetKind}`);
  }
}

assert.equal(resolveRelationshipFromCore(core, "fire", "fire"), "same");
assert.equal(resolveRelationshipFromCore(core, "fire", "earth"), "neutral");
assert.equal(resolveRelationshipFromCore(core, "fire", "water"), "opposite");

{
  const result = resolveAffinityInteractionFromCore(
    core,
    { kind: "fire", expression: "push", stacks: 250 },
    { kind: "water", expression: "push", stacks: 125 },
  );
  assert.equal(result.canceledStacks, 125);
  assert.equal(result.netSourceStacks, 125);
  assert.equal(result.netTargetStacks, 0);
}
});

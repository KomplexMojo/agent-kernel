const assert = require("node:assert/strict");

test("affinity bindings round-trip all kind and expression names", async () => {
  const {
    AFFINITY_KIND_BY_CODE,
    AFFINITY_EXPRESSION_BY_CODE,
  } = await import("../../packages/core-ts/src/index.ts");
  assert.deepEqual(Object.values(AFFINITY_KIND_BY_CODE), [
    "fire", "water", "earth", "wind", "life",
    "decay", "corrode", "fortify", "light", "dark",
  ]);
  assert.deepEqual(Object.values(AFFINITY_EXPRESSION_BY_CODE), ["push", "pull", "emit", "draw"]);
});

test("readAffinityInteractionResult reports all relationship names", async () => {
  const { createCore, readAffinityInteractionResult } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  const cases = [
    [1, 1, "same"],
    [1, 2, "opposite"],
    [1, 3, "neutral"],
  ];
  for (const [source, target, expected] of cases) {
    assert.equal(core.resolveAffinityInteraction(source, 1, 1, target, 1, 1), 1);
    assert.equal(readAffinityInteractionResult(core).relationshipName, expected);
  }
});

test("readAffinityInteractionResult covers the 48 expression relationship matrix cells", async () => {
  const { createCore, readAffinityInteractionResult } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  const relationshipPairs = [
    [1, 1, "same"],
    [1, 2, "opposite"],
    [1, 3, "neutral"],
  ];
  let count = 0;
  for (let sourceExpression = 1; sourceExpression <= 4; sourceExpression += 1) {
    for (let targetExpression = 1; targetExpression <= 4; targetExpression += 1) {
      for (const [sourceKind, targetKind, relationshipName] of relationshipPairs) {
        assert.equal(core.resolveAffinityInteraction(sourceKind, sourceExpression, 2, targetKind, targetExpression, 1), 1);
        const result = readAffinityInteractionResult(core);
        assert.equal(result.relationshipName, relationshipName);
        assert.notEqual(result.visualStateName, "unknown");
        assert.notEqual(result.sourceEffectName, "unknown");
        assert.notEqual(result.targetEffectName, "unknown");
        assert.equal(
          result.canceledStacks,
          relationshipName === "opposite" ? 1 : 0,
          `${sourceExpression}/${targetExpression}/${relationshipName} cancellation`,
        );
        if (relationshipName === "neutral") {
          assert.equal(result.sourceEffectName, "none");
          assert.equal(result.targetEffectName, "none");
          assert.equal(result.visualStateName, "layered");
        }
        count += 1;
      }
    }
  }
  assert.equal(count, 48);
});

test("core affinity codebook functions are callable through bindings", async () => {
  const { createCore } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  [
    "getAffinityKindCount",
    "getAffinityExpressionCount",
    "getOppositeAffinityKind",
    "resolveAffinityRelationshipCode",
    "computeAffinityRadius",
    "getAffinityInteractionCellCount",
    "getAffinityVisualStateCount",
    "getAffinityEffectCount",
  ].forEach((name) => assert.equal(typeof core[name], "function", `${name} export`));
});


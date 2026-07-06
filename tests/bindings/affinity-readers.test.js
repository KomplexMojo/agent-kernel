const assert = require("node:assert/strict");

test("affinity bindings: code maps, readAffinityFieldAt, readAffinityInteractionResult, readActorAffinity", async () => {
  const {
    createCore,
    AFFINITY_KIND_BY_CODE,
    AFFINITY_EXPRESSION_BY_CODE,
    AFFINITY_RELATIONSHIP_BY_CODE,
    AFFINITY_EFFECT_BY_CODE,
    AFFINITY_VISUAL_STATE_BY_CODE,
    readAffinityFieldAt,
    readAffinityInteractionResult,
    readActorAffinity,
  } = await import("../../packages/core-ts/src/index.ts");

  const core = createCore();
  core.init(0);

  // ── Code maps ──

  assert.equal(AFFINITY_KIND_BY_CODE[1], "fire");
  assert.equal(AFFINITY_KIND_BY_CODE[2], "water");
  assert.equal(AFFINITY_KIND_BY_CODE[10], "dark");
  assert.equal(Object.keys(AFFINITY_KIND_BY_CODE).length, 10, "10 affinity kinds");

  assert.equal(AFFINITY_EXPRESSION_BY_CODE[1], "push");
  assert.equal(AFFINITY_EXPRESSION_BY_CODE[4], "draw");
  assert.equal(Object.keys(AFFINITY_EXPRESSION_BY_CODE).length, 4, "4 expressions");

  assert.equal(AFFINITY_RELATIONSHIP_BY_CODE[0], "same");
  assert.equal(AFFINITY_RELATIONSHIP_BY_CODE[1], "opposite");
  assert.equal(AFFINITY_RELATIONSHIP_BY_CODE[2], "neutral");

  assert.equal(AFFINITY_EFFECT_BY_CODE[0], "none");
  assert.equal(AFFINITY_EFFECT_BY_CODE[1], "damage");
  assert.equal(AFFINITY_EFFECT_BY_CODE[6], "amplified_damage");
  assert.equal(Object.keys(AFFINITY_EFFECT_BY_CODE).length, 7, "7 effects");

  assert.equal(AFFINITY_VISUAL_STATE_BY_CODE[1], "clash_neutral");
  assert.equal(AFFINITY_VISUAL_STATE_BY_CODE[18], "resonance");
  assert.equal(AFFINITY_VISUAL_STATE_BY_CODE[21], "emit_field");
  assert.equal(Object.keys(AFFINITY_VISUAL_STATE_BY_CODE).length, 21, "21 visual states");

  // ── readAffinityFieldAt ──

  core.configureGrid(5, 5);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      core.setTileAt(x, y, 1);
    }
  }
  core.armStaticTrapAt(2, 2, 1, 3, 2, 10); // fire emit stacks=2

  core.computeStaticTrapAffinityField();

  // Source tile (2,2) should have full intensity for fire (kind=1)
  const srcField = readAffinityFieldAt(core, 2, 2, 1);
  assert.ok(srcField.intensity > 0, "source tile has intensity");
  assert.equal(srcField.stacks, 2, "source tile stacks = 2");
  assert.equal(srcField.expression, 3, "expression = emit");
  assert.equal(srcField.expressionName, "emit", "expressionName = emit");
  assert.ok(srcField.contributionCount >= 1, "at least one contribution");

  // Tile at distance 2 (emit has buffer=1, so distance 1 is zero)
  const nearField = readAffinityFieldAt(core, 4, 2, 1);
  assert.ok(nearField.intensity > 0, "distance-2 tile has intensity");
  assert.ok(nearField.intensity <= srcField.intensity, "distance-2 <= source");

  // Empty cell for different kind should have zero intensity
  const emptyField = readAffinityFieldAt(core, 0, 0, 2);
  assert.equal(emptyField.intensity, 0, "no water field");
  assert.equal(emptyField.stacks, 0, "no water stacks");

  // ── readAffinityInteractionResult ──

  // Fire push vs water push (opposite, with cancellation)
  const result = core.resolveAffinityInteraction(1, 1, 3, 2, 1, 2);
  assert.equal(result, 1, "resolution succeeds");

  const interaction = readAffinityInteractionResult(core);
  assert.equal(interaction.relationship, 1, "opposite");
  assert.equal(interaction.relationshipName, "opposite");
  assert.equal(interaction.sourceEffect, 2, "conditional_damage");
  assert.equal(interaction.sourceEffectName, "conditional_damage");
  assert.equal(interaction.targetEffect, 2, "conditional_damage");
  assert.equal(interaction.targetEffectName, "conditional_damage");
  assert.equal(interaction.visualState, 2, "clash_opposed");
  assert.equal(interaction.visualStateName, "clash_opposed");
  assert.equal(interaction.canceledStacks, 2, "canceled = min(3,2)");
  assert.equal(interaction.netSourceStacks, 1, "net source = 3-2");
  assert.equal(interaction.netTargetStacks, 0, "net target = 2-2");

  // Same-kind interaction (no cancellation)
  core.resolveAffinityInteraction(1, 1, 2, 1, 1, 3);
  const sameInteraction = readAffinityInteractionResult(core);
  assert.equal(sameInteraction.relationship, 0, "same");
  assert.equal(sameInteraction.relationshipName, "same");
  assert.equal(sameInteraction.canceledStacks, 0, "no cancellation for same");
  assert.equal(sameInteraction.netSourceStacks, 2, "source unchanged");
  assert.equal(sameInteraction.netTargetStacks, 3, "target unchanged");

  // ── readActorAffinity ──

  core.configureGrid(5, 5);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      core.setTileAt(x, y, 1);
    }
  }
  core.clearActorPlacements();
  core.addActorPlacement(10, 1, 1);
  core.addActorPlacement(20, 3, 3);
  core.applyActorPlacements();

  // Actor 0: fire emit stacks=2
  core.setMotivatedActorAffinity(0, 1, 3, 2);
  const actorAff = readActorAffinity(core, 0);
  assert.notEqual(actorAff, null, "actor 0 has affinity");
  assert.equal(actorAff.kind, 1, "kind = fire");
  assert.equal(actorAff.kindName, "fire");
  assert.equal(actorAff.expression, 3, "expression = emit");
  assert.equal(actorAff.expressionName, "emit");
  assert.equal(actorAff.stacks, 2, "stacks = 2");

  // Actor 1: no affinity set
  const noAff = readActorAffinity(core, 1);
  assert.equal(noAff, null, "actor 1 has no affinity");

  // ── Core affinity exports through bindings ──

  assert.equal(core.getAffinityKindCount(), 10, "10 kinds");
  assert.equal(core.getAffinityExpressionCount(), 4, "4 expressions");
  assert.equal(core.getOppositeAffinityKind(1), 2, "fire opposite = water");
  assert.equal(core.resolveAffinityRelationshipCode(1, 1), 0, "same");
  assert.equal(core.resolveAffinityRelationshipCode(1, 2), 1, "opposite");
  assert.equal(core.resolveAffinityRelationshipCode(1, 3), 2, "neutral");
  assert.ok(core.computeAffinityRadius(3, 2) >= 1, "emit radius >= 1");
  assert.equal(core.getAffinityInteractionCellCount(), 48, "48 matrix cells");
  assert.equal(core.getAffinityVisualStateCount(), 21, "21 visual states");
  assert.equal(core.getAffinityEffectCount(), 7, "7 effects");
});

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

test("readAffinityFieldAt reports zero for every kind with no source present", async () => {
  const { createCore, readAffinityFieldAt } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.configureGrid(3, 3);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) core.setTileAt(x, y, 1);
  }
  core.computeStaticTrapAffinityField();
  for (let kind = 1; kind <= 10; kind += 1) {
    const field = readAffinityFieldAt(core, 1, 1, kind);
    assert.equal(field.intensity, 0, `kind ${kind} intensity`);
    assert.equal(field.stacks, 0, `kind ${kind} stacks`);
    assert.equal(field.contributionCount, 0, `kind ${kind} contributionCount`);
  }
});

test("readAffinityFieldAt uses max stacks for overlapping same-kind traps", async () => {
  const { createCore, readAffinityFieldAt } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.configureGrid(5, 5);
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) core.setTileAt(x, y, 1);
  }
  assert.equal(core.armStaticTrapAt(2, 2, 1, 3, 1, 10), 1);
  assert.equal(core.armStaticTrapAt(2, 2, 1, 3, 3, 10), 1);
  core.computeStaticTrapAffinityField();
  const field = readAffinityFieldAt(core, 2, 2, 1);
  assert.equal(field.intensity, 1);
  assert.equal(field.stacks, 3);
  assert.equal(field.expressionName, "emit");
});

test("readAffinityFieldAt combines actor and trap same-kind contributions", async () => {
  const { createCore, readAffinityFieldAt } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.configureGrid(5, 5);
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) core.setTileAt(x, y, 1);
  }
  core.armStaticTrapAt(2, 2, 1, 3, 1, 10);
  core.computeStaticTrapAffinityField();
  core.clearActorPlacements();
  core.addActorPlacement(10, 2, 2);
  core.applyActorPlacements();
  core.setMotivatedActorAffinity(0, 1, 3, 2);
  core.computeActorAffinityField();
  const field = readAffinityFieldAt(core, 2, 2, 1);
  assert.ok(field.contributionCount >= 2, `expected combined contributions, got ${field.contributionCount}`);
  assert.equal(field.expressionName, "emit");
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
        count += 1;
      }
    }
  }
  assert.equal(count, 48);
});

test("readActorAffinity resets after configureGrid and names all expressions", async () => {
  const { createCore, readActorAffinity } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.configureGrid(5, 5);
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) core.setTileAt(x, y, 1);
  }
  core.clearActorPlacements();
  core.addActorPlacement(10, 1, 1);
  core.applyActorPlacements();
  const expectedNames = ["push", "pull", "emit", "draw"];
  for (let expression = 1; expression <= 4; expression += 1) {
    core.setMotivatedActorAffinity(0, 1, expression, 2);
    assert.equal(readActorAffinity(core, 0).expressionName, expectedNames[expression - 1]);
  }
  core.configureGrid(5, 5);
  assert.equal(readActorAffinity(core, 0), null);
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

test("readAffinityFieldAt reports flat draw falloff inside radius", async () => {
  const { createCore, readAffinityFieldAt } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.configureGrid(7, 7);
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) core.setTileAt(x, y, 1);
  }
  core.armStaticTrapAt(3, 3, 1, 4, 2, 10);
  core.computeStaticTrapAffinityField();
  const source = readAffinityFieldAt(core, 3, 3, 1);
  const adjacent = readAffinityFieldAt(core, 4, 3, 1);
  assert.equal(source.expressionName, "draw");
  assert.equal(adjacent.expressionName, "draw");
  assert.equal(adjacent.intensity, source.intensity);
});

test("resolveMotivatedActorAffinityInteraction resolves through actor affinity bindings", async () => {
  const { createCore, readAffinityInteractionResult } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.configureGrid(5, 5);
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) core.setTileAt(x, y, 1);
  }
  core.clearActorPlacements();
  core.addActorPlacement(10, 1, 1);
  core.addActorPlacement(20, 3, 3);
  core.applyActorPlacements();
  core.setMotivatedActorAffinity(0, 1, 1, 3);
  core.setMotivatedActorAffinity(1, 2, 1, 2);
  assert.equal(core.resolveMotivatedActorAffinityInteraction(0, 1), 1);
  const result = readAffinityInteractionResult(core);
  assert.equal(result.relationshipName, "opposite");
  assert.equal(result.canceledStacks, 2);
  assert.equal(result.netSourceStacks, 1);
});

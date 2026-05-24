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

// ## TODO: Test Permutations
// - [ ] All 10 affinity kinds: verify kindName round-trip through code map
// - [ ] All 4 expressions: verify expressionName round-trip
// - [ ] readAffinityFieldAt with all 10 kinds: verify zero when no source present
// - [ ] readAffinityFieldAt with multiple traps same kind: verify max-intensity overlap
// - [ ] readAffinityFieldAt with actor + trap same kind same cell: verify combined field
// - [ ] readAffinityInteractionResult with all 3 relationships: verify names
// - [ ] readAffinityInteractionResult for all 48 matrix cells: spot-check 8+ cells
// - [ ] readActorAffinity after configureGrid resets: verify null
// - [ ] readActorAffinity with all expressions: verify expressionName
// - [ ] Core codebook exports: all affinity codebook functions callable through bindings
// - [ ] readAffinityFieldAt with draw expression: verify flat falloff
// - [ ] Interaction resolution through resolveMotivatedActorAffinityInteraction via bindings

const assert = require("node:assert/strict");

test("game element visual registry covers core game vocabularies", async () => {
  const {
    GAME_AFFINITY_EXPRESSIONS,
    GAME_AFFINITY_KINDS,
    GAME_ELEMENT_VISUALS,
    GAME_MOTIVATION_KINDS,
    getGameElementVisualEntries,
  } = await import("../../packages/runtime/src/contracts/game-elements.js");

  assert.deepEqual(Object.keys(GAME_ELEMENT_VISUALS.actors), ["delver", "warden"]);
  assert.ok(GAME_ELEMENT_VISUALS.tiles.floor);
  assert.ok(GAME_ELEMENT_VISUALS.tiles.wall);
  assert.deepEqual(Object.keys(GAME_ELEMENT_VISUALS.affinities), Array.from(GAME_AFFINITY_KINDS));
  assert.deepEqual(Object.keys(GAME_ELEMENT_VISUALS.affinityExpressions), Array.from(GAME_AFFINITY_EXPRESSIONS));
  assert.deepEqual(Object.keys(GAME_ELEMENT_VISUALS.motivations), Array.from(GAME_MOTIVATION_KINDS));
  assert.deepEqual(Object.keys(GAME_ELEMENT_VISUALS.affinityStacks), ["tier1", "tier2", "tier3"]);

  getGameElementVisualEntries().forEach((entry) => {
    assert.equal(typeof entry.unicodeIcon, "string", `${entry.id} missing unicodeIcon`);
    assert.ok(entry.unicodeIcon.length > 0, `${entry.id} has empty unicodeIcon`);
    assert.match(entry.defaultColor, /^#[0-9a-f]{6}$/i, `${entry.id} missing defaultColor`);
    assert.equal(typeof entry.description, "string", `${entry.id} missing description`);
    assert.ok(entry.description.length > 0, `${entry.id} has empty description`);
    assert.equal(typeof entry.imageResource?.assetId, "string", `${entry.id} missing image assetId`);
    assert.ok(entry.imageResource.assetId.length > 0, `${entry.id} has empty image assetId`);
    assert.equal(typeof entry.imageResource?.relativePath, "string", `${entry.id} missing relativePath`);
    assert.ok(entry.imageResource.relativePath.endsWith(".png"), `${entry.id} relativePath must be png`);
  });
});

test("domain constants and resource bundle assets use the game element registry", async () => {
  const {
    GAME_AFFINITY_EXPRESSIONS,
    GAME_AFFINITY_KINDS,
    GAME_MOTIVATION_KINDS,
    getResourceBundleAssetSpecs,
  } = await import("../../packages/runtime/src/contracts/game-elements.js");
  const {
    AFFINITY_EXPRESSIONS,
    AFFINITY_KINDS,
  } = await import("../../packages/runtime/src/contracts/domain-constants.js");
  const {
    MOTIVATION_KINDS,
  } = await import("../../packages/runtime/src/personas/configurator/motivation-loadouts.js");
  const {
    createDefaultResourceBundleArtifact,
    validateResourceBundleArtifact,
  } = await import("../../packages/runtime/src/render/resource-bundle.js");

  assert.deepEqual(Array.from(AFFINITY_KINDS), Array.from(GAME_AFFINITY_KINDS));
  assert.deepEqual(Array.from(AFFINITY_EXPRESSIONS), Array.from(GAME_AFFINITY_EXPRESSIONS));
  assert.deepEqual(Array.from(MOTIVATION_KINDS), Array.from(GAME_MOTIVATION_KINDS));

  const bundle = createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy = "test", runId = "registry" } = {}) => ({
      id: `${producedBy}_${runId}`,
      runId,
      createdAt: "2000-01-01T00:00:00.000Z",
      producedBy,
    }),
    emitVisualAssets: true,
  });
  const validation = validateResourceBundleArtifact(bundle);
  assert.equal(validation.ok, true, validation.errors?.join(", "));

  const expectedAssetIds = new Set(getResourceBundleAssetSpecs({ emitVisualAssets: true }).map((spec) => spec.id));
  const bundleAssetIds = new Set(bundle.assets.map((asset) => asset.id));
  expectedAssetIds.forEach((assetId) => {
    assert.equal(bundleAssetIds.has(assetId), true, `ResourceBundle missing ${assetId}`);
  });
});

// ## TODO: Test Permutations
// - registry entries with missing generated image resource should fail validation
// - legacy v1 ResourceBundle specs should include old affinity/motivation/expression asset IDs
// - duplicated registry asset IDs should be rejected before ResourceBundle construction

const assert = require("node:assert/strict");

test("game element visual registry covers core game vocabularies", async () => {
  const {
    GAME_AFFINITY_EXPRESSIONS,
    GAME_AFFINITY_KINDS,
    GAME_COLOR_PALETTE,
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

  assert.equal(GAME_ELEMENT_VISUALS.types.room.defaultColor, GAME_COLOR_PALETTE.types.room);
  assert.equal(GAME_ELEMENT_VISUALS.cards.room.defaultColor, GAME_COLOR_PALETTE.types.room);
  assert.equal(GAME_ELEMENT_VISUALS.types.attacker.defaultColor, GAME_COLOR_PALETTE.types.attacker);
  assert.notEqual(GAME_ELEMENT_VISUALS.types.attacker.defaultColor, GAME_ELEMENT_VISUALS.vitals.health.defaultColor);
});

test("game element palette avoids cross-concept color overlap", async () => {
  const {
    GAME_AFFINITY_KINDS,
    GAME_ELEMENT_VISUALS,
    getGameElementVisualEntries,
  } = await import("../../packages/runtime/src/contracts/game-elements.js");

  const roleForVisual = (entry) => {
    if (entry.group === "affinities") return `affinity.${entry.key}`;
    if (entry.group === "affinityExpressions") return `expression.${entry.key}`;
    if (entry.group === "motivations") return `motivation.${entry.key}`;
    if (entry.group === "vitals") return `vital.${entry.key}`;
    if (entry.group === "affinityStacks") return `stack.${entry.key}`;
    if (entry.group === "tiles") return `tile.${entry.key}`;
    if (entry.group === "ui") return `ui.${entry.key}`;
    if (entry.group === "overlays") return `overlay.${entry.key}`;
    if (entry.group === "actorMedallionComponents") {
      if (entry.key.startsWith("actor-")) return entry.key.slice("actor-".length);
      if (entry.key.startsWith("vital-")) return `vital.${entry.key.slice("vital-".length)}`;
      if (entry.key.startsWith("expression-")) return `expression.${entry.key.slice("expression-".length)}`;
      if (entry.key.startsWith("motivation-")) return `motivation.${entry.key.slice("motivation-".length)}`;
      if (entry.key.startsWith("affinity-")) return `affinity.${entry.key.slice("affinity-".length)}`;
      return `component.${entry.key}`;
    }
    return entry.key;
  };

  const roleColors = new Map();
  const colorRoles = new Map();
  getGameElementVisualEntries().forEach((entry) => {
    const role = roleForVisual(entry);
    const color = entry.defaultColor.toLowerCase();
    const previousColor = roleColors.get(role);
    if (previousColor) {
      assert.equal(color, previousColor, `${entry.id} does not match existing ${role} color`);
    } else {
      roleColors.set(role, color);
    }
    const previousRole = colorRoles.get(color);
    if (previousRole) {
      assert.equal(previousRole, role, `${entry.id} color overlaps ${previousRole}`);
    } else {
      colorRoles.set(color, role);
    }
  });

  GAME_AFFINITY_KINDS.forEach((affinity) => {
    assert.equal(
      GAME_ELEMENT_VISUALS.affinities[affinity].defaultColor,
      GAME_ELEMENT_VISUALS.actorMedallionComponents[`affinity-${affinity}`].defaultColor,
    );
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

test("resource bundle validation rejects visual assets missing generated image resource", async () => {
  const {
    createDefaultResourceBundleArtifact,
    validateResourceBundleArtifact,
  } = await import("../../packages/runtime/src/render/resource-bundle.js");
  const bundle = createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy = "test", runId = "registry" } = {}) => ({
      id: `${producedBy}_${runId}`,
      runId,
      createdAt: "2000-01-01T00:00:00.000Z",
      producedBy,
    }),
    emitVisualAssets: true,
  });
  const broken = {
    ...bundle,
    assets: bundle.assets.map((asset, index) => index === 0
      ? { ...asset, dataUri: "", relativePath: "" }
      : asset),
  };
  const validation = validateResourceBundleArtifact(broken);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /dataUri/);
  assert.match(validation.errors.join("\n"), /relativePath/);
});

test("legacy v1 resource bundle specs include old affinity motivation and expression asset ids", async () => {
  const {
    GAME_AFFINITY_EXPRESSIONS,
    GAME_AFFINITY_KINDS,
    GAME_MOTIVATION_KINDS,
    getResourceBundleAssetSpecs,
  } = await import("../../packages/runtime/src/contracts/game-elements.js");
  const ids = new Set(getResourceBundleAssetSpecs({ emitVisualAssets: false }).map((spec) => spec.id));
  GAME_AFFINITY_KINDS.forEach((kind) => assert.equal(ids.has(`affinity.${kind}`), true));
  GAME_MOTIVATION_KINDS.forEach((kind) => assert.equal(ids.has(`motivation.${kind}`), true));
  GAME_AFFINITY_EXPRESSIONS.forEach((expression) => assert.equal(ids.has(`expression.${expression}`), true));
});

test("resource bundle validation rejects duplicated asset ids", async () => {
  const {
    createDefaultResourceBundleArtifact,
    validateResourceBundleArtifact,
  } = await import("../../packages/runtime/src/render/resource-bundle.js");
  const bundle = createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy = "test", runId = "registry" } = {}) => ({
      id: `${producedBy}_${runId}`,
      runId,
      createdAt: "2000-01-01T00:00:00.000Z",
      producedBy,
    }),
    emitVisualAssets: true,
  });
  const duplicated = {
    ...bundle,
    assets: [
      bundle.assets[0],
      { ...bundle.assets[1], id: bundle.assets[0].id },
      ...bundle.assets.slice(2),
    ],
  };
  const validation = validateResourceBundleArtifact(duplicated);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /unique/);
});

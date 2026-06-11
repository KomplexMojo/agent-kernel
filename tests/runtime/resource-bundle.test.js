const assert = require("node:assert/strict");

test("resource bundle default artifact validates and renders deterministically", async () => {
  const {
    createDefaultResourceBundleArtifact,
    encodeRgbaToPng,
    renderBoardWithResourceBundle,
    validateResourceBundleArtifact,
  } = await import("../../packages/runtime/src/render/resource-bundle.js");

  const bundle = createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy = "test", runId = "run_resource_bundle" } = {}) => ({
      id: `${producedBy}_${runId}`,
      runId,
      createdAt: "2000-01-01T00:00:00.000Z",
      producedBy,
    }),
    runId: "run_resource_bundle",
    producedBy: "test",
  });
  const validation = validateResourceBundleArtifact(bundle);
  assert.equal(validation.ok, true, validation.errors?.join(", "));

  const rendered = await renderBoardWithResourceBundle({
    tiles: ["S.E", ".#.", "..."],
    actors: [
      { id: "delver_alpha", position: { x: 0, y: 1 }, affinities: [{ kind: "fire" }], motivation: "attacking" },
      { id: "warden_beta", position: { x: 2, y: 2 }, affinities: [{ kind: "water" }], motivation: "defending" },
    ],
    resourceBundle: bundle,
  });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.width, 96);
  assert.equal(rendered.height, 96);
  assert.equal(rendered.pixels.length, 96 * 96 * 4);

  const png = encodeRgbaToPng(rendered);
  assert.deepEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 64);
});

test("resource bundle visual-assets mode emits v2 mappings and inline asset payloads", async () => {
  const {
    createDefaultResourceBundleArtifact,
    listResourceBundleAssetFiles,
    validateResourceBundleArtifact,
  } = await import("../../packages/runtime/src/render/resource-bundle.js");

  const bundle = createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy = "test", runId = "run_resource_bundle_visual" } = {}) => ({
      id: `${producedBy}_${runId}`,
      runId,
      createdAt: "2000-01-01T00:00:00.000Z",
      producedBy,
    }),
    runId: "run_resource_bundle_visual",
    producedBy: "test",
    emitVisualAssets: true,
  });

  const validation = validateResourceBundleArtifact(bundle);
  assert.equal(validation.ok, true, validation.errors?.join(", "));
  assert.equal(bundle.schemaVersion, 2);
  assert.equal(bundle.bundleVersion, 2);
  assert.equal(bundle.mappings.tiles.fog, "tile.fog");
  assert.equal(bundle.mappings.actors.byRoleAndAffinity.delver.fire, "actor.delver.fire");
  assert.equal(bundle.mappings.actors.byRoleAndAffinity.warden.fire, "actor.warden.fire");
  assert.equal(bundle.mappings.actors.byRoleAndAffinity.delver.fire === bundle.mappings.actors.byRoleAndAffinity.warden.fire, false);
  assert.equal(bundle.mappings.actorMedallions.expressionStyle, "triangles");
  assert.equal(bundle.mappings.actorMedallions.components.frame, "component.actor-medallion.frame");
  assert.equal(bundle.mappings.overlays.expressions.emit, "overlay.expression.emit");
  assert.equal(bundle.mappings.overlays.stackTiers.tier3, "overlay.stack-tier.tier3");
  assert.equal(bundle.mappings.overlays.tileAffinities.floor.fire, "overlay.tile.floor.affinity.fire");
  assert.equal(bundle.mappings.overlays.tileAffinities.wall.fire, "overlay.tile.wall.affinity.fire");
  assert.equal(bundle.mappings.tileEffects.composition, "base_tile_plus_overlay_alpha");
  assert.equal(bundle.mappings.tileEffects.affinityOverlays.floor.fire, "overlay.tile.floor.affinity.fire");
  assert.equal(bundle.mappings.icons.types.hazard, "icon.type.hazard");
  assert.equal(bundle.mappings.icons.items.hazard, "icon.item.hazard");
  assert.equal(bundle.mappings.icons.motivations.user_controlled, "icon.motivation.user_controlled");
  assert.equal(bundle.mappings.icons.vitals.defence, "icon.vital.defence");

  const delverFire = bundle.assets.find((asset) => asset.id === "actor.delver.fire");
  const overlayFire = bundle.assets.find((asset) => asset.id === "overlay.affinity.fire");
  const floorOverlayFire = bundle.assets.find((asset) => asset.id === "overlay.tile.floor.affinity.fire");
  const wallOverlayFire = bundle.assets.find((asset) => asset.id === "overlay.tile.wall.affinity.fire");
  const defenceIcon = bundle.assets.find((asset) => asset.id === "icon.vital.defence");
  const iconFire = bundle.assets.find((asset) => asset.id === "icon.affinity.fire");
  const fogTile = bundle.assets.find((asset) => asset.id === "tile.fog");
  const medallionFrame = bundle.assets.find((asset) => asset.id === "component.actor-medallion.frame");
  const medallionExpression = bundle.assets.find((asset) => asset.id === "component.actor-medallion.expression.push");
  const medallionAffinity = bundle.assets.find((asset) => asset.id === "component.actor-medallion.affinity.fire");
  assert.ok(delverFire?.dataUri?.startsWith("data:image/png;base64,"));
  assert.equal(delverFire?.relativePath, "visual-assets/actors/delver-fire.png");
  assert.ok(overlayFire?.dataUri?.startsWith("data:image/png;base64,"));
  assert.equal(overlayFire?.relativePath, "visual-assets/overlays/affinity-fire.png");
  assert.equal(overlayFire?.variants?.hud?.width, 16);
  assert.equal(overlayFire?.variants?.standard?.width, 32);
  assert.equal(overlayFire?.variants?.large?.width, 64);
  assert.ok(floorOverlayFire?.dataUri?.startsWith("data:image/png;base64,"));
  assert.equal(floorOverlayFire?.relativePath, "visual-assets/tiles/overlays/floor-affinity-fire.png");
  assert.equal(wallOverlayFire?.relativePath, "visual-assets/tiles/overlays/wall-affinity-fire.png");
  assert.equal(defenceIcon?.relativePath, "visual-assets/misc/icon-vital-defence.png");
  assert.ok(iconFire?.variants?.hud?.relativePath.endsWith("icon-affinity-fire.png"));
  assert.ok(fogTile?.dataUri?.startsWith("data:image/png;base64,"));
  assert.equal(fogTile?.relativePath, "visual-assets/tiles/fog.png");
  assert.ok(medallionFrame?.dataUri?.startsWith("data:image/png;base64,"));
  assert.equal(medallionFrame?.relativePath, "visual-assets/actor-medallions/components/frame.png");
  assert.ok(medallionExpression?.dataUri?.startsWith("data:image/png;base64,"));
  assert.equal(medallionExpression?.relativePath, "visual-assets/actor-medallions/components/expression-push.png");
  assert.ok(medallionAffinity?.dataUri?.startsWith("data:image/png;base64,"));
  assert.equal(medallionAffinity?.relativePath, "visual-assets/actor-medallions/components/affinity-fire.png");

  const files = listResourceBundleAssetFiles(bundle);
  assert.ok(files.some((file) => file.relativePath === "visual-assets/overlays/hud/affinity-fire.png"));
  assert.ok(files.some((file) => file.relativePath === "visual-assets/overlays/large/affinity-fire.png"));
  assert.ok(files.some((file) => file.relativePath === "visual-assets/tiles/overlays/large/floor-affinity-fire.png"));
  assert.ok(files.some((file) => file.relativePath === "visual-assets/misc/hud/icon-vital-defence.png"));
  assert.ok(files.some((file) => file.relativePath === "visual-assets/actor-medallions/components/frame.png"));
});

test("resource bundle v1 keeps static actor rendering compatibility", async () => {
  const {
    createDefaultResourceBundleArtifact,
    validateResourceBundleArtifact,
  } = await import("../../packages/runtime/src/render/resource-bundle.js");

  const bundle = createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy = "test", runId = "run_resource_bundle_v1" } = {}) => ({
      id: `${producedBy}_${runId}`,
      runId,
      createdAt: "2000-01-01T00:00:00.000Z",
      producedBy,
    }),
    runId: "run_resource_bundle_v1",
    producedBy: "test",
  });

  const validation = validateResourceBundleArtifact(bundle);
  assert.equal(validation.ok, true, validation.errors?.join(", "));
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.mappings.actorMedallions, undefined);
  assert.equal(bundle.assets.some((asset) => asset.id.startsWith("component.actor-medallion.")), false);
});

test("renderBoardWithResourceBundle applies formula-driven affinity overlays to nearby walls", async () => {
  const {
    renderBoardWithResourceBundle,
  } = await import("../../packages/runtime/src/render/resource-bundle.js");

  const tiles = [
    "###",
    "#.#",
    "###",
  ];

  const base = await renderBoardWithResourceBundle({ tiles, actors: [], floorAffinityTraps: [] });
  assert.equal(base.ok, true);

  const affected = await renderBoardWithResourceBundle({
    tiles,
    actors: [],
    floorAffinityTraps: [
      { position: { x: 1, y: 1 }, affinity: { kind: "fire", expression: "emit", stacks: 3 } },
    ],
  });
  assert.equal(affected.ok, true);

  function tileChanged(left, right, tileX, tileY) {
    const tileWidth = right.tileWidth;
    for (let py = 0; py < tileWidth; py += 1) {
      for (let px = 0; px < tileWidth; px += 1) {
        const x = tileX * tileWidth + px;
        const y = tileY * tileWidth + py;
        const idx = (y * right.width + x) * 4;
        if (
          left.pixels[idx] !== right.pixels[idx]
          || left.pixels[idx + 1] !== right.pixels[idx + 1]
          || left.pixels[idx + 2] !== right.pixels[idx + 2]
          || left.pixels[idx + 3] !== right.pixels[idx + 3]
        ) return true;
      }
    }
    return false;
  }

  assert.equal(tileChanged(base, affected, 0, 0), true, "nearby wall tile should receive affinity overlay");
});

test("renderBoardWithResourceBundle tints floor tiles when affinities are present", async () => {
  const {
    createDefaultResourceBundleArtifact,
    renderBoardWithResourceBundle,
  } = await import("../../packages/runtime/src/render/resource-bundle.js");

  const bundle = createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy = "test", runId = "run_resource_bundle_affinity" } = {}) => ({
      id: producedBy + "_" + runId,
      runId,
      createdAt: "2000-01-01T00:00:00.000Z",
      producedBy,
    }),
    runId: "run_resource_bundle_affinity",
    producedBy: "test",
  });

  const tiles = ["..", ".."]; // 2x2 board

  const base = await renderBoardWithResourceBundle({ tiles, resourceBundle: bundle });
  assert.equal(base.ok, true);

  const tinted = await renderBoardWithResourceBundle({
    tiles,
    resourceBundle: bundle,
    floorAffinityTraps: [
      { x: 0, y: 0, affinity: { kind: "fire", stacks: 2 } },
    ],
  });
  assert.equal(tinted.ok, true);

  function tileChanged(left, right, tileX, tileY) {
    const tileWidth = right.tileWidth;
    for (let py = 0; py < tileWidth; py += 1) {
      for (let px = 0; px < tileWidth; px += 1) {
        const x = tileX * tileWidth + px;
        const y = tileY * tileWidth + py;
        const idx = (y * right.width + x) * 4;
        if (
          left.pixels[idx] !== right.pixels[idx]
          || left.pixels[idx + 1] !== right.pixels[idx + 1]
          || left.pixels[idx + 2] !== right.pixels[idx + 2]
          || left.pixels[idx + 3] !== right.pixels[idx + 3]
        ) return true;
      }
    }
    return false;
  }

  assert.equal(tileChanged(base, tinted, 0, 0), true, "affinity overlay should change source floor tile pixels");
});

test("renderBoardWithResourceBundle tints floor tiles for observation-style traps", async () => {
  const {
    createDefaultResourceBundleArtifact,
    renderBoardWithResourceBundle,
  } = await import("../../packages/runtime/src/render/resource-bundle.js");

  const bundle = createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy = "test", runId = "run_resource_bundle_obs_affinity" } = {}) => ({
      id: producedBy + "_" + runId,
      runId,
      createdAt: "2000-01-01T00:00:00.000Z",
      producedBy,
    }),
    runId: "run_resource_bundle_obs_affinity",
    producedBy: "test",
  });

  const tiles = ["..", ".."]; // 2x2 board

  const base = await renderBoardWithResourceBundle({ tiles, resourceBundle: bundle });
  assert.equal(base.ok, true);

  const tinted = await renderBoardWithResourceBundle({
    tiles,
    resourceBundle: bundle,
    floorAffinityTraps: [
      {
        position: { x: 1, y: 0 },
        affinities: [{ kind: "water", stacks: 3, targetType: "floor" }],
      },
    ],
  });
  assert.equal(tinted.ok, true);

  function tileChanged(left, right, tileX, tileY) {
    const tileWidth = right.tileWidth;
    for (let py = 0; py < tileWidth; py += 1) {
      for (let px = 0; px < tileWidth; px += 1) {
        const x = tileX * tileWidth + px;
        const y = tileY * tileWidth + py;
        const idx = (y * right.width + x) * 4;
        if (
          left.pixels[idx] !== right.pixels[idx]
          || left.pixels[idx + 1] !== right.pixels[idx + 1]
          || left.pixels[idx + 2] !== right.pixels[idx + 2]
          || left.pixels[idx + 3] !== right.pixels[idx + 3]
        ) return true;
      }
    }
    return false;
  }

  assert.equal(tileChanged(base, tinted, 1, 0), true, "observation-style trap should change source floor tile pixels");
});

const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/render/resource-bundle.js");

test("resource bundle default artifact validates and renders deterministically", () => {
  runEsm(`
    import assert from "node:assert/strict";
    import {
      createDefaultResourceBundleArtifact,
      encodeRgbaToPng,
      renderBoardWithResourceBundle,
      validateResourceBundleArtifact,
    } from ${JSON.stringify(modulePath)};

    const bundle = createDefaultResourceBundleArtifact({
      createMeta: ({ producedBy = "test", runId = "run_resource_bundle" } = {}) => ({
        id: \`\${producedBy}_\${runId}\`,
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
  `);
});

test("resource bundle visual-assets mode emits v2 mappings and inline asset payloads", () => {
  runEsm(`
    import assert from "node:assert/strict";
    import {
      createDefaultResourceBundleArtifact,
      validateResourceBundleArtifact,
    } from ${JSON.stringify(modulePath)};

    const bundle = createDefaultResourceBundleArtifact({
      createMeta: ({ producedBy = "test", runId = "run_resource_bundle_visual" } = {}) => ({
        id: \`\${producedBy}_\${runId}\`,
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
    assert.equal(bundle.mappings.overlays.expressions.emit, "overlay.expression.emit");
    assert.equal(bundle.mappings.overlays.stackTiers.tier3, "overlay.stack-tier.tier3");

    const delverFire = bundle.assets.find((asset) => asset.id === "actor.delver.fire");
    const fogTile = bundle.assets.find((asset) => asset.id === "tile.fog");
    assert.ok(delverFire?.dataUri?.startsWith("data:image/png;base64,"));
    assert.equal(delverFire?.relativePath, "visual-assets/actors/delver-fire.png");
    assert.ok(fogTile?.dataUri?.startsWith("data:image/png;base64,"));
    assert.equal(fogTile?.relativePath, "visual-assets/tiles/fog.png");
  `);
});

test("renderBoardWithResourceBundle keeps floor neutral and marks localized traps", () => {
  runEsm(`
    import assert from "node:assert/strict";
    import {
      createDefaultResourceBundleArtifact,
      renderBoardWithResourceBundle,
    } from ${JSON.stringify(modulePath)};

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

    const floorCornerOffset = 0;
    const baseCornerRgba = Array.from(base.pixels.slice(floorCornerOffset, floorCornerOffset + 4));
    const markedCornerRgba = Array.from(tinted.pixels.slice(floorCornerOffset, floorCornerOffset + 4));
    assert.deepEqual(
      markedCornerRgba,
      baseCornerRgba,
      "neutral floor corner pixel should remain unchanged without room-wide tint",
    );

    const centerOffset = ((16 * tinted.width) + 16) * 4;
    const baseCenterRgba = Array.from(base.pixels.slice(centerOffset, centerOffset + 4));
    const markedCenterRgba = Array.from(tinted.pixels.slice(centerOffset, centerOffset + 4));

    assert.notDeepEqual(
      markedCenterRgba,
      baseCenterRgba,
      "localized trap marker should change center pixel RGBA for trap tile",
    );
  `);
});

test("renderBoardWithResourceBundle marks observation-style traps as localized hazards", () => {
  runEsm(`
    import assert from "node:assert/strict";
    import {
      createDefaultResourceBundleArtifact,
      renderBoardWithResourceBundle,
    } from ${JSON.stringify(modulePath)};

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

    const tileWidth = tinted.width / 2;
    const cornerOffset = tileWidth * 4; // top-left pixel of tile (1,0)
    const baseCornerRgba = Array.from(base.pixels.slice(cornerOffset, cornerOffset + 4));
    const markedCornerRgba = Array.from(tinted.pixels.slice(cornerOffset, cornerOffset + 4));
    assert.deepEqual(
      markedCornerRgba,
      baseCornerRgba,
      "observation trap should not tint the whole floor tile corner",
    );

    const centerX = tileWidth + Math.floor(tileWidth / 2);
    const centerY = Math.floor(tileWidth / 2);
    const centerOffset = ((centerY * tinted.width) + centerX) * 4;
    const baseCenterRgba = Array.from(base.pixels.slice(centerOffset, centerOffset + 4));
    const markedCenterRgba = Array.from(tinted.pixels.slice(centerOffset, centerOffset + 4));

    assert.notDeepEqual(
      markedCenterRgba,
      baseCenterRgba,
      "observation-style trap should render a localized marker at its tile center",
    );
  `);
});

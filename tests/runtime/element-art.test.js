// #768: a client goes from game meaning to drawable art through the ResourceBundle only.
// No asset path is built by the caller; dressing swaps art without a UI change.
const assert = require("node:assert/strict");

const META = { id: "m", runId: "r", createdAt: "2000-01-01T00:00:00.000Z", producedBy: "test" };
const createMeta = () => ({ ...META });

async function setup() {
  const rb = await import("../../packages/runtime/src/render/resource-bundle.js");
  const art = await import("../../packages/runtime/src/render/element-art.js");
  const bundle = rb.createDefaultResourceBundleArtifact({ createMeta, emitVisualAssets: true });
  const pixels = new Uint8Array(32 * 32 * 4).fill(255);
  const dataUri = `data:image/png;base64,${Buffer.from(rb.encodeRgbaToPng({ width: 32, height: 32, pixels })).toString("base64")}`;
  const dressing = {
    schema: rb.RESOURCE_BUNDLE_DRESSING_SCHEMA, schemaVersion: 1, meta: META, dressingId: "p",
    assets: { "icon.affinity.dark": { mimeType: "image/png", width: 32, height: 32, dataUri, relativePath: "painted/orb-dark.png" } },
  };
  return { rb, art, bundle, dressing, dataUri };
}

test("an undressed element resolves to procedural art with a data URI", async () => {
  const { art, bundle } = await setup();
  const r = art.resolveElementArt(bundle, { role: "resource", yields: "affinity", affinity: "dark" });
  assert.equal(r.status, "procedural");
  assert.equal(r.assetId, "icon.affinity.dark");
  assert.match(r.dataUri, /^data:image\/png;base64,/);
  assert.equal(r.width, 32);
});

test("the same descriptor picks up painted art once the bundle is dressed", async () => {
  const { rb, art, bundle, dressing, dataUri } = await setup();
  const dressed = rb.dressResourceBundle(bundle, dressing);
  const r = art.resolveElementArt(dressed, { role: "resource", yields: "affinity", affinity: "dark" });
  assert.equal(r.status, "painted");
  assert.equal(r.dataUri, dataUri);
  assert.equal(r.relativePath, "painted/orb-dark.png");
});

test("tiles, actors, hazards and vitals resolve through the bundle mappings", async () => {
  const { art, bundle } = await setup();
  assert.equal(art.resolveElementArt(bundle, { tile: "wall" }).assetId, "tile.wall");
  assert.equal(art.resolveElementArt(bundle, { role: "delver", affinity: "fire" }).assetId, "actor.delver.fire");
  assert.equal(art.resolveElementArt(bundle, { role: "warden", affinity: "water" }).assetId, "actor.warden.water");
  assert.equal(art.resolveElementArt(bundle, { role: "hazard", affinity: "fire" }).assetId, "item.hazard");
  assert.equal(art.resolveElementArt(bundle, { role: "resource", yields: "vital", vital: "health" }).assetId, "icon.vital.health");
});

test("a board sprite from the draw model is a valid descriptor", async () => {
  const { art, bundle } = await setup();
  const r = art.resolveElementArt(bundle, { role: "delver", affinity: "dark" });
  assert.equal(r.assetId, "actor.delver.dark");
});

test("an unknown element is reported missing, never silently wrong art", async () => {
  const { art, bundle } = await setup();
  for (const d of [{ tile: "lava" }, { role: "delver", affinity: "plasma" }, {}, null, { role: "resource", yields: "vital", vital: "luck" }]) {
    const r = art.resolveElementArt(bundle, d);
    assert.equal(r.status, "missing");
    assert.equal(r.assetId, null);
    assert.equal(r.dataUri, null);
  }
});

test("coverage lists painted, procedural and missing elements", async () => {
  const { rb, art, bundle, dressing } = await setup();
  const before = art.elementArtCoverage(bundle);
  assert.equal(before.painted.length, 0);
  assert.ok(before.procedural.length > 20);
  assert.deepEqual(before.missing, []);
  const after = art.elementArtCoverage(rb.dressResourceBundle(bundle, dressing));
  assert.ok(after.painted.includes("resource/affinity/dark"));
  assert.ok(!after.procedural.includes("resource/affinity/dark"));
  assert.equal(after.painted.length + after.procedural.length, before.procedural.length);
});

test("coverage reports an element whose mapping is absent", async () => {
  const { art, bundle } = await setup();
  const broken = structuredClone(bundle);
  delete broken.mappings.tiles.wall;
  assert.ok(art.elementArtCoverage(broken).missing.includes("tile/wall"));
});

// TODO: Test Permutations

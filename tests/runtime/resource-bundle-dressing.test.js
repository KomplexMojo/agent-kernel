const assert = require("node:assert/strict");

const META = { id: "dress_1", runId: "run_dress", createdAt: "2000-01-01T00:00:00.000Z", producedBy: "game" };
const createMeta = ({ producedBy = "test", runId = "run_dress" } = {}) => ({ ...META, producedBy, runId });

async function load() {
  return import("../../packages/runtime/src/render/resource-bundle.js");
}

async function paintedUri(encodeRgbaToPng, size = 32) {
  const pixels = new Uint8Array(size * size * 4).fill(200);
  const bytes = encodeRgbaToPng({ width: size, height: size, pixels });
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

async function setup() {
  const mod = await load();
  const bundle = mod.createDefaultResourceBundleArtifact({ createMeta, emitVisualAssets: true });
  const dataUri = await paintedUri(mod.encodeRgbaToPng);
  const dressing = {
    schema: mod.RESOURCE_BUNDLE_DRESSING_SCHEMA,
    schemaVersion: 1,
    meta: META,
    dressingId: "primordial-painted",
    assets: {
      "actor.delver.dark": { mimeType: "image/png", width: 32, height: 32, dataUri, relativePath: "painted/delver-dark.png" },
    },
  };
  return { mod, bundle, dressing, dataUri };
}

test("a partial dressing validates and replaces only the dressed asset", async () => {
  const { mod, bundle, dressing, dataUri } = await setup();
  assert.equal(mod.validateResourceBundleDressing(dressing, bundle).ok, true);
  const dressed = mod.dressResourceBundle(bundle, dressing);
  assert.equal(mod.validateResourceBundleArtifact(dressed).ok, true);
  const asset = dressed.assets.find((a) => a.id === "actor.delver.dark");
  assert.equal(asset.dataUri, dataUri);
  assert.equal(asset.origin, "painted");
  assert.equal(asset.relativePath, "painted/delver-dark.png");
  const untouched = dressed.assets.find((a) => a.id === "actor.warden.dark");
  assert.equal(untouched.origin, undefined);
  assert.equal(dressed.assets.length, bundle.assets.length);
  assert.notEqual(dressed, bundle);
  assert.equal(bundle.assets.find((a) => a.id === "actor.delver.dark").origin, undefined);
});

test("dressed files are listed for export", async () => {
  const { mod, bundle, dressing } = await setup();
  const files = mod.listResourceBundleAssetFiles(mod.dressResourceBundle(bundle, dressing));
  assert.ok(files.some((f) => f.relativePath === "painted/delver-dark.png"));
});

test("an unknown asset id is refused by name", async () => {
  const { mod, bundle, dressing } = await setup();
  dressing.assets["actor.nope.dark"] = dressing.assets["actor.delver.dark"];
  const result = mod.validateResourceBundleDressing(dressing, bundle);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("actor.nope.dark")));
  assert.throws(() => mod.dressResourceBundle(bundle, dressing), /actor\.nope\.dark/);
});

test("a size other than 32x32 is refused", async () => {
  const { mod, bundle, dressing } = await setup();
  dressing.assets["actor.delver.dark"].width = 16;
  const result = mod.validateResourceBundleDressing(dressing, bundle);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("width")));
});

test("a non-PNG data URI is refused", async () => {
  const { mod, bundle, dressing } = await setup();
  dressing.assets["actor.delver.dark"].dataUri = "data:image/png;base64,AAAA";
  const result = mod.validateResourceBundleDressing(dressing, bundle);
  assert.equal(result.ok, false);
});

test("a wrong schema or an empty dressing is refused", async () => {
  const { mod, bundle, dressing } = await setup();
  assert.equal(mod.validateResourceBundleDressing({ ...dressing, schema: "x" }, bundle).ok, false);
  assert.equal(mod.validateResourceBundleDressing({ ...dressing, assets: {} }, bundle).ok, false);
});

test("a V1 bundle cannot be dressed", async () => {
  const { mod, dressing } = await setup();
  const v1 = mod.createDefaultResourceBundleArtifact({ createMeta });
  assert.throws(() => mod.dressResourceBundle(v1, dressing), /schemaVersion/);
});

test("variants are validated individually", async () => {
  const { mod, bundle, dressing, dataUri } = await setup();
  dressing.assets["actor.delver.dark"].variants = { hud: { width: 16, height: 16, dataUri, relativePath: "painted/delver-dark-16.png" } };
  assert.equal(mod.validateResourceBundleDressing(dressing, bundle).ok, false);
  dressing.assets["actor.delver.dark"].variants = { hud: { width: 16, height: 16, dataUri: "data:image/png;base64,AAAA", relativePath: "x.png" } };
  assert.equal(mod.validateResourceBundleDressing(dressing, bundle).ok, false);
});

test("the checked-in dressing fixture is a valid dressing", async () => {
  const mod = await load();
  const fixture = require("../fixtures/artifacts/resource-bundle-dressing-v1.json");
  const bundle = mod.createDefaultResourceBundleArtifact({ createMeta, emitVisualAssets: true });
  const result = mod.validateResourceBundleDressing(fixture, bundle);
  assert.equal(result.ok, true, result.errors?.join(", "));
});

// TODO: Test Permutations

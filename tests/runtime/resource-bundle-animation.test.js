// #771: optional presentation animation on a drawable asset. Never required, never in the
// simulation or the board sprite; a still image always works.
const assert = require("node:assert/strict");

const META = { id: "m", runId: "r", createdAt: "2000-01-01T00:00:00.000Z", producedBy: "game" };
const createMeta = () => ({ ...META });

async function setup() {
  const rb = await import("../../packages/runtime/src/render/resource-bundle.js");
  const art = await import("../../packages/runtime/src/render/element-art.js");
  const bundle = rb.createDefaultResourceBundleArtifact({ createMeta, emitVisualAssets: true });
  const uri = (shade) => `data:image/png;base64,${Buffer.from(rb.encodeRgbaToPng({ width: 32, height: 32, pixels: new Uint8Array(32 * 32 * 4).fill(shade) })).toString("base64")}`;
  const still = uri(200);
  const frame = (shade, n) => ({ dataUri: uri(shade), relativePath: `painted/orb-dark-${n}.png`, durationMs: 120 });
  const dressing = {
    schema: rb.RESOURCE_BUNDLE_DRESSING_SCHEMA, schemaVersion: 1, meta: META, dressingId: "p",
    assets: {
      "icon.affinity.dark": {
        mimeType: "image/png", width: 32, height: 32, dataUri: still, relativePath: "painted/orb-dark.png",
        animations: {
          idle: { loop: "loop", frames: [frame(100, 1), frame(160, 2), frame(220, 3)] },
          pulse: { loop: "pingpong", frames: [frame(90, 4), frame(250, 5)] },
        },
      },
    },
  };
  return { rb, art, bundle, dressing };
}

test("a dressing may carry named animations and the dressed asset keeps them", async () => {
  const { rb, bundle, dressing } = await setup();
  assert.equal(rb.validateResourceBundleDressing(dressing, bundle).ok, true);
  const dressed = rb.dressResourceBundle(bundle, dressing);
  const asset = dressed.assets.find((a) => a.id === "icon.affinity.dark");
  assert.deepEqual(Object.keys(asset.animations).sort(), ["idle", "pulse"]);
  assert.equal(asset.animations.idle.frames.length, 3);
  assert.equal(rb.validateResourceBundleArtifact(dressed).ok, true);
});

test("an element resolves its still art plus animations; undressed has none", async () => {
  const { rb, art, bundle, dressing } = await setup();
  const d = { role: "resource", yields: "affinity", affinity: "dark" };
  const plain = art.resolveElementArt(bundle, d);
  assert.deepEqual(plain.animations, {});
  assert.match(plain.dataUri, /^data:image\/png/);
  const dressed = art.resolveElementArt(rb.dressResourceBundle(bundle, dressing), d);
  assert.ok(dressed.dataUri, "still art stays available beside animations");
  assert.equal(dressed.animations.pulse.loop, "pingpong");
  assert.deepEqual(art.resolveElementArt(bundle, { tile: "lava" }).animations, {});
});

test("animation frame files are listed for export", async () => {
  const { rb, bundle, dressing } = await setup();
  const files = rb.listResourceBundleAssetFiles(rb.dressResourceBundle(bundle, dressing)).map((f) => f.relativePath);
  assert.ok(files.includes("painted/orb-dark-1.png") && files.includes("painted/orb-dark-5.png"));
});

test("bad animations are refused", async () => {
  const { rb, bundle, dressing } = await setup();
  const mutate = (fn) => {
    const d = structuredClone(dressing);
    fn(d.assets["icon.affinity.dark"].animations);
    return rb.validateResourceBundleDressing(d, bundle);
  };
  assert.equal(mutate((a) => { a.idle.loop = "bounce"; }).ok, false);
  assert.equal(mutate((a) => { a.idle.frames = [a.idle.frames[0]]; }).ok, false);
  assert.equal(mutate((a) => { a.idle.frames[0].durationMs = 0; }).ok, false);
  assert.equal(mutate((a) => { a.idle.frames[1].dataUri = "data:image/png;base64,AAAA"; }).ok, false);
  assert.equal(mutate((a) => { delete a.idle.frames[1].relativePath; }).ok, false);
  assert.equal(mutate((a) => { a.idle.frames = Array.from({ length: 33 }, () => a.idle.frames[0]); }).ok, false);
});

test("animation never reaches the board draw model: the sprite stays two-channel", async () => {
  const { buildBoardDrawModel } = await import("../../packages/runtime/src/render/board-draw-model.js");
  assert.equal(buildBoardDrawModel.length, 1, "the draw model takes the view only, never a bundle");
  const source = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../packages/runtime/src/render/board-draw-model.js"), "utf8");
  assert.doesNotMatch(source, /animation/i);
});

// TODO: Test Permutations

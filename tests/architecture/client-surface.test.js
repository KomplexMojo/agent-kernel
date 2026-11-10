// #767: the graphical client surface is a promise. Adding a name is fine; removing or
// renaming one breaks the game, so the list is pinned and a shrink fails here first.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const FACADE = "packages/runtime/src/render/client-surface.js";

const PINNED = [
  "HUD_VITAL_LABELS", "WALL_NEIGHBOUR_BITS", "WALL_BLOB_BITS", "WALL_BLOB_MASKS", "wallBlobSlot", "ENTITY_SPRITE_ROLES", "ICON_SHAPES", "PLAY_COMMAND_KINDS", "PLAY_DIRECTIONS",
  "PLAY_DIRECTION_STEPS", "PLAY_SIGHT", "RESOURCE_BUNDLE_DRESSING_SCHEMA", "RESOURCE_BUNDLE_SCHEMA", "buildActorHudModel", "buildIconModel",
  "buildBoardDrawModel", "buildBoardFrame", "playWindowBounds", "buildAffinityBoardOverlayModel", "createDefaultResourceBundleArtifact", "createPlaySession", "listResourceBundleAssetFiles",
  "normalizeEntitySpriteState", "normalizePlayCommand", "replayPlaySession", "dressResourceBundle", "elementArtCoverage", "elementKeyFor", "resolveElementArt", "validateResourceBundleArtifact", "validateResourceBundleDressing",
];

test("the client surface exports at least the pinned names, each defined", async () => {
  const surface = await import(resolve(ROOT, FACADE));
  const missing = PINNED.filter((name) => surface[name] === undefined);
  assert.deepEqual(missing, [], `client-surface.js lost published names: ${missing.join(", ")}`);
});

test("the facade re-exports only: no logic of its own", () => {
  const source = readFileSync(resolve(ROOT, FACADE), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(source, /\b(function|const|let|class)\b/, "client-surface.js must contain re-exports only");
});

test("the facade is declared on the API surface and exported by the runtime package", () => {
  const boundary = JSON.parse(readFileSync(resolve(ROOT, "tests/architecture/framework-game-boundary.json"), "utf8"));
  assert.ok(boundary.apiSurface[FACADE], "client-surface.js must be listed in apiSurface");
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "packages/runtime/package.json"), "utf8"));
  assert.equal(manifest.exports["./src/render/client-surface.js"], "./src/render/client-surface.js");
});

// ## TODO: Test Permutations
// - a play session created through the facade acts and views like ui-ascii's

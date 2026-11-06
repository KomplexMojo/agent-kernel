/** #735 sub-issue 10: the runtime atlas manifest maps game things to spritesheet frames. */
import { test } from "vitest";
import assert from "node:assert/strict";
import { GAME_AFFINITY_KINDS, GAME_VITAL_KEYS } from "../../packages/runtime/src/contracts/game-elements.js";
import {
  SPRITE_ATLAS_ENTRIES, spriteAtlasManifest, spriteKeyFor, resolveSpriteFrame, spriteAtlasCoverage, placeholderFrame,
} from "../../packages/runtime/src/render/sprite-atlas-manifest.js";

test("every affinity has delver, warden, hazard and affinity-resource entries", () => {
  assert.equal(GAME_AFFINITY_KINDS.length, 10);
  for (const a of GAME_AFFINITY_KINDS) {
    for (const k of [`delver/${a}`, `warden/${a}`, `hazard/${a}`, `resource/affinity/${a}`]) assert.ok(SPRITE_ATLAS_ENTRIES[k], k);
  }
});

test("vital resources are distinct from affinity resources", () => {
  for (const v of GAME_VITAL_KEYS) {
    const vital = resolveSpriteFrame({ role: "resource", yields: "vital", vital: v });
    const aff = resolveSpriteFrame({ role: "resource", yields: "affinity", affinity: "fire" });
    assert.ok(vital && aff);
    assert.notEqual(SPRITE_ATLAS_ENTRIES[vital.key].frame, SPRITE_ATLAS_ENTRIES[aff.key].frame);
  }
});

test("placeholder status and missing frames resolve to the category placeholder", () => {
  assert.equal(resolveSpriteFrame({ tile: "wall" }).frame, placeholderFrame("tile"));
  assert.equal(resolveSpriteFrame({ role: "hazard", affinity: "fire" }, new Set()).frame, placeholderFrame("hazard"));
  const hit = resolveSpriteFrame({ role: "hazard", affinity: "fire" }, { frames: { "hazard/fire": {} } });
  assert.deepEqual([hit.frame, hit.status], ["hazard/fire", "recoloured"]);
});

test("unknown descriptors resolve to null and coverage reports gaps", () => {
  assert.equal(spriteKeyFor({}), "");
  assert.equal(resolveSpriteFrame({ role: "dragon" }), null);
  const cov = spriteAtlasCoverage({ frames: [{ filename: "tile/floor" }] });
  assert.ok(cov.missingFrames.includes("hazard/water"));
  assert.ok(cov.recoloured.includes("tile/floor"));
});

test("manifest is serializable and versioned", () => {
  const m = spriteAtlasManifest();
  assert.equal(m.schema, "agent-kernel/SpriteAtlasManifest");
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
});

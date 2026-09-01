/**
 * RB2.1 / A2 — production mixed-room composition must pass through the Configurator persona.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const ORCHESTRATOR = "packages/runtime/src/build/orchestrate-build.js";
const CONTROLLER = "packages/runtime/src/personas/configurator/controller.js";
const MIXED_ROOM = "packages/runtime/src/personas/configurator/mixed-room-composition.js";
const SUMMARY = "packages/runtime/src/build/mixed-room-summary.js";

const FORBIDDEN_BUILD_HELPERS = Object.freeze([
  "augmentLayoutWithRoomAffinityEffects",
  "buildCardAffinityProfiles",
  "buildMixedRoomComposition",
  "buildMixedRoomProfilesFromCardSet",
  "buildMixedRoomTemplateMap",
  "collectMixedRoomTemplateHazards",
  "deriveMixedRoomCompositionProfile",
  "deriveMixedRoomDominantInvestment",
  "normalizeMixedRoomLocalizedHazards",
  "normalizeMixedRoomLocalizedTiles",
  "normalizeMixedRoomOverlay",
]);

test("build glue consumes the real Configurator mixed-room capability and owns no copy", () => {
  const orchestrator = readFileSync(join(ROOT, ORCHESTRATOR), "utf8");
  const controller = readFileSync(join(ROOT, CONTROLLER), "utf8");
  const mixedRoom = readFileSync(join(ROOT, MIXED_ROOM), "utf8");
  const summary = readFileSync(join(ROOT, SUMMARY), "utf8");

  assert.match(orchestrator, /const\s+configuratorBuild\s*=\s*createConfiguratorPersona\(/);
  assert.match(orchestrator, /\bcomposeMixedRooms\b/);
  assert.match(controller, /composeMixedRooms:\s*services\.composeMixedRooms/);
  assert.match(mixedRoom, /export function composeMixedRooms\(/);
  assert.equal(summary.includes("deriveCompositionProfile"), false);
  assert.equal(summary.includes("deriveDominantInvestment"), false);

  for (const helper of FORBIDDEN_BUILD_HELPERS) {
    assert.equal(
      orchestrator.includes(helper),
      false,
      `${helper} is Configurator policy and must not be restored in build glue`,
    );
  }
});

// ## TODO: Test Permutations
// - reject a second mixed-room implementation added under another build-glue filename
// - inventory every production composeMixedRooms consumer and require a real persona origin

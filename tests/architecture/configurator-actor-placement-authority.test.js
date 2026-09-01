/**
 * RB2.2 / A2 — actor placement policy originates in the Configurator, never build glue.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const ORCHESTRATOR = "packages/runtime/src/build/orchestrate-build.js";
const CONTROLLER = "packages/runtime/src/personas/configurator/controller.js";
const SERVICES = "packages/runtime/src/personas/configurator/configurator-services.js";
const PLACEMENT = "packages/runtime/src/personas/configurator/actor-placement.js";

test("build consumes the real Configurator actor-placement capability without policy residue", () => {
  const orchestrator = readFileSync(join(ROOT, ORCHESTRATOR), "utf8");
  const controller = readFileSync(join(ROOT, CONTROLLER), "utf8");
  const services = readFileSync(join(ROOT, SERVICES), "utf8");
  const placement = readFileSync(join(ROOT, PLACEMENT), "utf8");

  assert.match(orchestrator, /\.placeActors\(\{/);
  assert.match(controller, /placeActors:\s*services\.placeActors/);
  assert.match(services, /\bplaceActors\b/);
  assert.match(placement, /export function placeActors\(/);

  const forbiddenResidue = [
    "deriveActorPower",
    "createActorGroups",
    "selectGroupAnchors",
    "normalizeActorPositionsLegacy",
    "actorTextBag",
    "inferActorRole",
    "partitionActorsByRole",
    "pickPreferredPosition",
    "normalizeActorPositions",
    "DELVER_KEYWORDS",
    "WARDEN_KEYWORDS",
    "supportPerLeader",
  ];
  forbiddenResidue.forEach((token) => {
    assert.equal(orchestrator.includes(token), false, `${token} must not remain in build glue`);
  });
});

// ## TODO: Test Permutations
// - reject renamed role-keyword lists or actor-power rankings restored in build glue
// - inventory all production actor-placement consumers and require a Configurator origin

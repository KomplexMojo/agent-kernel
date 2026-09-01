/**
 * RB3.1 / A2 — build glue consumes Allocator price and actor-availability policy, never copies it.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const ORCHESTRATOR = "packages/runtime/src/build/orchestrate-build.js";
const CONTROLLER = "packages/runtime/src/personas/allocator/controller.js";
const SERVICES = "packages/runtime/src/personas/allocator/allocator-services.js";

test("build price and actor-expansion policy originate on the real Allocator surface", () => {
  const orchestrator = readFileSync(join(ROOT, ORCHESTRATOR), "utf8");
  const controller = readFileSync(join(ROOT, CONTROLLER), "utf8");
  const services = readFileSync(join(ROOT, SERVICES), "utf8");

  assert.match(orchestrator, /createAllocatorPersona\(/);
  assert.match(orchestrator, /\.resolvePriceList\(/);
  assert.match(orchestrator, /\.resolveActorExpansionAvailability\(/);
  assert.match(controller, /resolvePriceList:\s*services\.resolvePriceList/);
  assert.match(
    controller,
    /resolveActorExpansionAvailability:\s*services\.resolveActorExpansionAvailability/,
  );
  assert.match(services, /function resolvePriceList\(/);
  assert.match(services, /function resolveActorExpansionAvailability\(/);

  assert.equal(orchestrator.includes("mergePriceListWithDefaults"), false);
  assert.equal(orchestrator.includes("resolveActorPoolRemaining"), false);
  assert.doesNotMatch(orchestrator, /pool\?\.id\s*===\s*["'](?:delver|wardens)["']/);
  assert.doesNotMatch(orchestrator, /Math\.min\(probeRemaining,\s*actorPoolRemaining\)/);
});

// ## TODO: Test Permutations
// - inventory every production consumer of both capabilities and require a real Allocator origin
// - reject global/pool minimum arithmetic restored under renamed build-glue locals

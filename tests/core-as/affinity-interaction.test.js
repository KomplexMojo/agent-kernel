const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

function hasInteractionAPI(core) {
  return typeof core.resolveAffinityInteraction === "function"
    && typeof core.getLastInteractionSourceEffect === "function"
    && typeof core.getLastInteractionTargetEffect === "function"
    && typeof core.getLastInteractionVisualState === "function"
    && typeof core.getLastInteractionRelationship === "function"
    && typeof core.getLastInteractionNetSourceStacks === "function"
    && typeof core.getLastInteractionNetTargetStacks === "function"
    && typeof core.getLastInteractionCanceledStacks === "function";
}

// Affinity kind codes
const FIRE = 1, WATER = 2, EARTH = 3;
// Expression codes
const PUSH = 1, PULL = 2, EMIT = 3, DRAW = 4;
// Relationship codes
const SAME = 0, OPPOSITE = 1, NEUTRAL = 2;
// Effect codes
const NONE = 0, DAMAGE = 1, COND_DAMAGE = 2, POTENCY_REDUCED = 3;
const MANA_GAIN = 4, MANA_LOSS = 5, AMPLIFIED_DAMAGE = 6;

// ── Same-kind interactions ──

test("resolveAffinityInteraction: same-kind same-expression (fire push vs fire push)", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasInteractionAPI(core)) { t.skip("Interaction API not yet exported."); return; }

  core.init(0);
  const result = core.resolveAffinityInteraction(FIRE, PUSH, 2, FIRE, PUSH, 3);
  assert.equal(result, 1, "returns 1 on success");

  assert.equal(core.getLastInteractionRelationship(), SAME, "same kind → same relationship");
  // Matrix: push vs push, same → srcEffect=N, tgtEffect=N, visual=1 (ClashNeutral)
  assert.equal(core.getLastInteractionSourceEffect(), NONE, "src effect: none");
  assert.equal(core.getLastInteractionTargetEffect(), NONE, "tgt effect: none");
  assert.equal(core.getLastInteractionVisualState(), 1, "visual: ClashNeutral");

  // Same relationship: no stack cancellation
  assert.equal(core.getLastInteractionCanceledStacks(), 0, "no cancellation for same");
  assert.equal(core.getLastInteractionNetSourceStacks(), 2, "net source = original");
  assert.equal(core.getLastInteractionNetTargetStacks(), 3, "net target = original");
});

// ── Opposite-kind interactions ──

test("resolveAffinityInteraction: opposite-kind (fire push vs water push)", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasInteractionAPI(core)) { t.skip("Interaction API not yet exported."); return; }

  core.init(0);
  core.resolveAffinityInteraction(FIRE, PUSH, 3, WATER, PUSH, 2);

  assert.equal(core.getLastInteractionRelationship(), OPPOSITE, "fire/water → opposite");
  // Matrix: push vs push, opposite → srcEffect=CD, tgtEffect=CD, visual=2 (ClashOpposed)
  assert.equal(core.getLastInteractionSourceEffect(), COND_DAMAGE, "src: conditional damage");
  assert.equal(core.getLastInteractionTargetEffect(), COND_DAMAGE, "tgt: conditional damage");
  assert.equal(core.getLastInteractionVisualState(), 2, "visual: ClashOpposed");

  // Opposite with push vs push uses stack cancellation
  const usesCancel = core.getAffinityMatrixUsesStackCancellation(PUSH, PUSH, OPPOSITE);
  assert.equal(usesCancel, 1, "push vs push opposite uses cancellation");
  assert.equal(core.getLastInteractionCanceledStacks(), 2, "canceled = min(3,2) = 2");
  assert.equal(core.getLastInteractionNetSourceStacks(), 1, "net source = 3-2 = 1");
  assert.equal(core.getLastInteractionNetTargetStacks(), 0, "net target = 2-2 = 0");
});

// ── Neutral-kind interactions ──

test("resolveAffinityInteraction: neutral-kind (fire push vs earth push)", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasInteractionAPI(core)) { t.skip("Interaction API not yet exported."); return; }

  core.init(0);
  core.resolveAffinityInteraction(FIRE, PUSH, 2, EARTH, PUSH, 2);

  assert.equal(core.getLastInteractionRelationship(), NEUTRAL, "fire/earth → neutral");
  // Matrix: push vs push, neutral → srcEffect=N, tgtEffect=N, visual=20 (Layered)
  assert.equal(core.getLastInteractionSourceEffect(), NONE, "src: none");
  assert.equal(core.getLastInteractionTargetEffect(), NONE, "tgt: none");
  assert.equal(core.getLastInteractionVisualState(), 20, "visual: Layered");

  // No cancellation for neutral
  assert.equal(core.getLastInteractionCanceledStacks(), 0, "no cancellation");
  assert.equal(core.getLastInteractionNetSourceStacks(), 2, "net source unchanged");
  assert.equal(core.getLastInteractionNetTargetStacks(), 2, "net target unchanged");
});

// ── Cross-expression interactions ──

test("resolveAffinityInteraction: pull vs emit, opposite", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasInteractionAPI(core)) { t.skip("Interaction API not yet exported."); return; }

  core.init(0);
  // Fire pull vs water emit
  core.resolveAffinityInteraction(FIRE, PULL, 2, WATER, EMIT, 3);

  assert.equal(core.getLastInteractionRelationship(), OPPOSITE, "fire/water opposite");
  // Matrix: pull vs emit, opposite → srcEffect=D, tgtEffect=PR
  assert.equal(core.getLastInteractionSourceEffect(), DAMAGE, "src: damage");
  assert.equal(core.getLastInteractionTargetEffect(), POTENCY_REDUCED, "tgt: potency reduced");

  // pull vs emit, opposite: uses cancellation
  assert.equal(core.getLastInteractionCanceledStacks(), 2, "canceled = min(2,3) = 2");
  assert.equal(core.getLastInteractionNetSourceStacks(), 0, "net source = 0");
  assert.equal(core.getLastInteractionNetTargetStacks(), 1, "net target = 1");
});

test("resolveAffinityInteraction: draw vs draw, same → Resonance", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasInteractionAPI(core)) { t.skip("Interaction API not yet exported."); return; }

  core.init(0);
  // Fire draw vs fire draw (same kind)
  core.resolveAffinityInteraction(FIRE, DRAW, 2, FIRE, DRAW, 2);

  assert.equal(core.getLastInteractionRelationship(), SAME, "same kind");
  // Matrix: draw vs draw, same → visual=18 (Resonance)
  assert.equal(core.getLastInteractionVisualState(), 18, "visual: Resonance");
  assert.equal(core.getLastInteractionSourceEffect(), NONE, "src: none");
  assert.equal(core.getLastInteractionTargetEffect(), NONE, "tgt: none");
});

test("resolveAffinityInteraction: draw vs push, opposite → Vulnerability + AmplifiedDamage", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasInteractionAPI(core)) { t.skip("Interaction API not yet exported."); return; }

  core.init(0);
  // Fire draw vs water push (opposite)
  core.resolveAffinityInteraction(FIRE, DRAW, 1, WATER, PUSH, 3);

  assert.equal(core.getLastInteractionRelationship(), OPPOSITE);
  // Matrix: draw vs push, opposite → srcEffect=AD, tgtEffect=N
  assert.equal(core.getLastInteractionSourceEffect(), AMPLIFIED_DAMAGE, "src: amplified damage");
  assert.equal(core.getLastInteractionTargetEffect(), NONE, "tgt: none");
  assert.equal(core.getLastInteractionVisualState(), 7, "visual: Vulnerability");

  // draw vs push, opposite: uses cancellation
  assert.equal(core.getLastInteractionCanceledStacks(), 1, "canceled = min(1,3)");
});

// ── Actor-to-actor interaction ──

function setAllFloors(core, width, height) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      core.setTileAt(x, y, 1);
    }
  }
}

test("resolveMotivatedActorAffinityInteraction resolves between two actors", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasInteractionAPI(core)) { t.skip("Interaction API not yet exported."); return; }
  if (typeof core.resolveMotivatedActorAffinityInteraction !== "function") {
    t.skip("resolveMotivatedActorAffinityInteraction not yet exported.");
    return;
  }

  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  // Place two actors
  core.clearActorPlacements();
  core.addActorPlacement(10, 1, 1);
  core.addActorPlacement(20, 3, 3);
  core.applyActorPlacements();

  // Actor 0: fire emit stacks=2
  core.setMotivatedActorAffinity(0, FIRE, EMIT, 2);
  // Actor 1: water emit stacks=3
  core.setMotivatedActorAffinity(1, WATER, EMIT, 3);

  const result = core.resolveMotivatedActorAffinityInteraction(0, 1);
  assert.equal(result, 1, "resolution succeeds");

  // Fire/water = opposite; emit vs emit opposite
  assert.equal(core.getLastInteractionRelationship(), OPPOSITE);
  assert.equal(core.getLastInteractionCanceledStacks(), 2, "canceled = min(2,3)");
  assert.equal(core.getLastInteractionNetSourceStacks(), 0, "net source = 0");
  assert.equal(core.getLastInteractionNetTargetStacks(), 1, "net target = 1");
});

test("resolveMotivatedActorAffinityInteraction returns 0 for actor without affinity", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasInteractionAPI(core)) { t.skip("Interaction API not yet exported."); return; }
  if (typeof core.resolveMotivatedActorAffinityInteraction !== "function") {
    t.skip("resolveMotivatedActorAffinityInteraction not yet exported.");
    return;
  }

  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  core.clearActorPlacements();
  core.addActorPlacement(10, 1, 1);
  core.addActorPlacement(20, 3, 3);
  core.applyActorPlacements();

  // Only actor 0 has affinity
  core.setMotivatedActorAffinity(0, FIRE, EMIT, 2);

  const result = core.resolveMotivatedActorAffinityInteraction(0, 1);
  assert.equal(result, 0, "returns 0 when target has no affinity");
});

// ── Invalid inputs ──

test("resolveAffinityInteraction rejects invalid inputs", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasInteractionAPI(core)) { t.skip("Interaction API not yet exported."); return; }

  core.init(0);

  // Invalid kind
  assert.equal(core.resolveAffinityInteraction(0, PUSH, 1, FIRE, PUSH, 1), 0, "invalid src kind");
  assert.equal(core.resolveAffinityInteraction(FIRE, PUSH, 1, 0, PUSH, 1), 0, "invalid tgt kind");

  // Invalid expression
  assert.equal(core.resolveAffinityInteraction(FIRE, 0, 1, WATER, PUSH, 1), 0, "invalid src expr");
  assert.equal(core.resolveAffinityInteraction(FIRE, PUSH, 1, WATER, 5, 1), 0, "invalid tgt expr");

  // Invalid stacks
  assert.equal(core.resolveAffinityInteraction(FIRE, PUSH, 0, WATER, PUSH, 1), 0, "zero src stacks");
  assert.equal(core.resolveAffinityInteraction(FIRE, PUSH, 1, WATER, PUSH, 0), 0, "zero tgt stacks");
});

// ## TODO: Test Permutations
// - [ ] All 48 matrix cells: iterate srcExpr×tgtExpr×relationship, verify effects match matrix arrays
// - [ ] Stack cancellation correctness: equal stacks, unequal stacks, 1 vs max stacks
// - [ ] All 5 opposite pairs: fire/water, earth/wind, life/decay, corrode/fortify, light/dark
// - [ ] Same-kind all expressions: verify no cancellation for same-kind pairs
// - [ ] resolveMotivatedActorAffinityInteraction with invalid actor indices
// - [ ] Sequential resolutions: verify last-result getters update correctly between calls
// - [ ] Neutral relationship for non-paired kinds (fire vs earth, etc.)
// - [ ] Visual state coverage: at least one test reaches each of the 21 visual states

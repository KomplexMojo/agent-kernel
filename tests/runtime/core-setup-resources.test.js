const assert = require("node:assert/strict");

let coreSetupModulePromise;

function loadSetupModule() {
  coreSetupModulePromise ??= import("../../packages/runtime/src/runner/core-setup.mjs");
  return coreSetupModulePromise;
}

// A core stand-in that records placement calls. Only the surface core-setup is
// allowed to touch is present, so a call to anything else fails loudly.
function makeCore() {
  const vitals = [];
  const affinities = [];
  return {
    vitals,
    affinities,
    configureGrid() { return 0; },
    setTileAt() {},
    placeResourceAt(x, y, vitalKind, delta, mode, regen) {
      vitals.push({ x, y, vitalKind, delta, mode, regen });
      return 1;
    },
    placeAffinityResourceAt(x, y, kind, expression, stacks, mana, manaRegen) {
      affinities.push({ x, y, kind, expression, stacks, mana, manaRegen });
      return 1;
    },
  };
}

function simConfigWith(resources) {
  return {
    layout: {
      kind: "grid",
      data: {
        width: 5,
        height: 5,
        tiles: [".....", ".....", ".....", ".....", "....."],
        resources,
      },
    },
  };
}

test("a consumable vital resource raises the current vital at its cell", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  const result = applySimConfigToCore(core, simConfigWith([
    {
      id: "resource_health_consumable",
      permanenceMode: "consumable",
      vitals: [{ key: "health", delta: 5 }],
      position: { x: 3, y: 2 },
      x: 3,
      y: 2,
    },
  ]));

  assert.equal(result.ok, true);
  assert.equal(core.affinities.length, 0);
  assert.deepEqual(core.vitals, [
    { x: 3, y: 2, vitalKind: 0, delta: 5, mode: 0, regen: 0 },
  ]);
});

// permanenceMode is the whole difference between healing an actor and enlarging
// it, and the runtime's mode codes have to agree with the artifact contract's
// three names or a "level" grant silently becomes a top-up.
test("permanenceMode maps to the mode code that governs current vs max", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  const result = applySimConfigToCore(core, simConfigWith([
    { permanenceMode: "consumable", vitals: [{ key: "health", delta: 1 }], position: { x: 1, y: 1 } },
    { permanenceMode: "level", vitals: [{ key: "mana", delta: 2 }], position: { x: 2, y: 1 } },
    { permanenceMode: "permanent", vitals: [{ key: "stamina", delta: 3 }], position: { x: 3, y: 1 } },
  ]));

  assert.equal(result.ok, true);
  assert.deepEqual(core.vitals.map((entry) => [entry.vitalKind, entry.mode]), [
    [0, 0],
    [1, 1],
    [2, 2],
  ]);
});

test("a granted vital regen rides along independently of the mode", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  const result = applySimConfigToCore(core, simConfigWith([
    {
      id: "resource_health_regeneration",
      permanenceMode: "level",
      vitals: [{ key: "health", delta: 0, regen: 2 }],
      position: { x: 3, y: 2 },
    },
  ]));

  assert.equal(result.ok, true);
  assert.deepEqual(core.vitals, [
    { x: 3, y: 2, vitalKind: 0, delta: 0, mode: 1, regen: 2 },
  ]);
});

test("an affinity-only resource is placed through the affinity surface", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  const result = applySimConfigToCore(core, simConfigWith([
    {
      id: "resource_temporary_fire_push",
      permanenceMode: "consumable",
      vitals: [],
      affinity: { kind: "fire", expression: "push", stacks: 2, mana: 12, manaRegen: 0 },
      position: { x: 3, y: 2 },
    },
  ]));

  assert.equal(result.ok, true);
  assert.equal(core.vitals.length, 0);
  assert.equal(core.affinities.length, 1);
  const [placed] = core.affinities;
  assert.equal(placed.x, 3);
  assert.equal(placed.y, 2);
  assert.equal(placed.stacks, 2);
  assert.equal(placed.mana, 12);
  assert.equal(placed.manaRegen, 0);
  assert.ok(placed.kind > 0, "fire must resolve to a valid affinity kind code");
  assert.ok(placed.expression > 0, "push must resolve to a valid expression code");
});

// manaRegen is the only thing separating a permanent grant from a temporary one,
// so it has to survive the trip rather than being defaulted away.
test("manaRegen survives placement, because it is what makes a grant permanent", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  applySimConfigToCore(core, simConfigWith([
    {
      permanenceMode: "consumable",
      vitals: [],
      affinity: { kind: "fire", expression: "emit", stacks: 2, mana: 12, manaRegen: 2 },
      position: { x: 4, y: 2 },
    },
  ]));

  assert.equal(core.affinities.length, 1);
  assert.equal(core.affinities[0].manaRegen, 2);
});

test("a resource carrying both payloads is placed through both surfaces at one cell", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  applySimConfigToCore(core, simConfigWith([
    {
      permanenceMode: "consumable",
      vitals: [{ key: "health", delta: 4 }],
      affinity: { kind: "fire", expression: "push", stacks: 1, mana: 6, manaRegen: 0 },
      position: { x: 2, y: 2 },
    },
  ]));

  assert.equal(core.vitals.length, 1);
  assert.equal(core.affinities.length, 1);
  assert.equal(core.vitals[0].x, 2);
  assert.equal(core.vitals[0].y, 2);
  assert.equal(core.affinities[0].x, 2);
  assert.equal(core.affinities[0].y, 2);
});

test("a bare x/y placement is accepted, the same as a position object", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  applySimConfigToCore(core, simConfigWith([
    { permanenceMode: "consumable", vitals: [{ key: "health", delta: 1 }], x: 1, y: 4 },
  ]));

  assert.deepEqual(core.vitals.map((entry) => [entry.x, entry.y]), [[1, 4]]);
});

// Every rejection below would otherwise place a resource that behaves as
// something other than what was authored, which is worse than placing nothing.
test("malformed resources are skipped rather than placed wrong", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  const result = applySimConfigToCore(core, simConfigWith([
    null,
    "not-an-object",
    { permanenceMode: "consumable", vitals: [{ key: "health", delta: 1 }] },
    { permanenceMode: "consumable", vitals: [{ key: "luck", delta: 1 }], position: { x: 1, y: 1 } },
    { permanenceMode: "teleport", vitals: [{ key: "health", delta: 1 }], position: { x: 1, y: 2 } },
    { permanenceMode: "consumable", vitals: [{ key: "health", delta: "lots" }], position: { x: 1, y: 3 } },
    {
      permanenceMode: "consumable",
      vitals: [],
      affinity: { kind: "glitter", expression: "push", stacks: 1, mana: 1, manaRegen: 0 },
      position: { x: 2, y: 1 },
    },
    {
      permanenceMode: "consumable",
      vitals: [],
      affinity: { kind: "fire", expression: "sideways", stacks: 1, mana: 1, manaRegen: 0 },
      position: { x: 2, y: 2 },
    },
    {
      permanenceMode: "consumable",
      vitals: [],
      affinity: { kind: "fire", expression: "push", stacks: 0, mana: 1, manaRegen: 0 },
      position: { x: 2, y: 3 },
    },
  ]));

  assert.equal(result.ok, true);
  assert.deepEqual(core.vitals, []);
  assert.deepEqual(core.affinities, []);
});

// A cell holds one vital payload. Extra grants are dropped by the representation,
// so pin it as a declared limit rather than leaving it to be discovered.
test("only the first vital grant can occupy a cell", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  applySimConfigToCore(core, simConfigWith([
    {
      permanenceMode: "consumable",
      vitals: [{ key: "health", delta: 1 }, { key: "mana", delta: 9 }],
      position: { x: 1, y: 1 },
    },
  ]));

  assert.equal(core.vitals.length, 1);
  assert.equal(core.vitals[0].vitalKind, 0);
  assert.equal(core.vitals[0].delta, 1);
});

test("a core without the resource surface is left alone rather than crashed", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = { configureGrid() { return 0; }, setTileAt() {} };

  const result = applySimConfigToCore(core, simConfigWith([
    { permanenceMode: "consumable", vitals: [{ key: "health", delta: 1 }], position: { x: 1, y: 1 } },
    {
      permanenceMode: "consumable",
      vitals: [],
      affinity: { kind: "fire", expression: "push", stacks: 1, mana: 1, manaRegen: 0 },
      position: { x: 2, y: 2 },
    },
  ]));

  assert.equal(result.ok, true);
});

test("a layout with no resources places nothing", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const core = makeCore();

  assert.equal(applySimConfigToCore(core, simConfigWith(undefined)).ok, true);
  assert.equal(applySimConfigToCore(core, simConfigWith([])).ok, true);
  assert.deepEqual(core.vitals, []);
  assert.deepEqual(core.affinities, []);
});

// ## TODO: Test Permutations
test.skip("a resource whose cell is outside the configured grid is refused by the core, not by core-setup", async () => {});
test.skip("two resources authored at the same cell: the second overwrites the first's payload", async () => {});
test.skip("negative delta on a consumable vital drains rather than grants", async () => {});
test.skip("a negative manaRegen is rejected before reaching placeAffinityResourceAt", async () => {});
test.skip("every affinity kind in AFFINITY_KINDS resolves to a code the core accepts", async () => {});
test.skip("every vital key in RESOURCE_VITAL_KEYS maps to the VITAL_KIND the core expects", async () => {});
test.skip("resources load after hazards, so a hazard and a resource can share a cell", async () => {});

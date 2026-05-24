const assert = require("node:assert/strict");

let coreSetupModulePromise;

function loadSetupModule() {
  coreSetupModulePromise ??= import("../../packages/runtime/src/runner/core-setup.mjs");
  return coreSetupModulePromise;
}

test("applySimConfigToCore arms hazards from layout.data.hazards", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const core = {
    configureGrid() { return 0; },
    setTileAt() {},
    armStaticTrapAt(x, y, kind, expression, stacks, manaReserve) {
      armed.push({ x, y, kind, expression, stacks, manaReserve });
      return 1;
    },
  };

  const simConfig = {
    layout: {
      kind: "grid",
      data: {
        width: 6,
        height: 6,
        tiles: ["......", "......", "......", "......", "......", "......"],
        hazards: [
          {
            id: "fire-hazard-1",
            entityType: "hazard",
            kind: "fire",
            position: { x: 2, y: 2 },
            emitStrength: 3,
            affinityStacks: [
              { kind: "fire", stacks: 2, expression: "emit" },
            ],
          },
        ],
      },
    },
  };

  const result = applySimConfigToCore(core, simConfig);
  assert.equal(result.ok, true, "applySimConfig succeeded");
  assert.equal(armed.length, 1, "one hazard armed");
  assert.equal(armed[0].x, 2, "hazard x");
  assert.equal(armed[0].y, 2, "hazard y");
  assert.equal(armed[0].kind, 1, "fire kind code");
  assert.equal(armed[0].expression, 3, "emit expression code");
  assert.equal(armed[0].stacks, 2, "stacks from affinityStacks[0]");
  assert.ok(armed[0].manaReserve > 0, "manaReserve derived from stacks");
});

test("applySimConfigToCore normalizes hazards with position.x/y (not flat x/y)", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const core = {
    configureGrid() { return 0; },
    setTileAt() {},
    armStaticTrapAt(x, y, kind, expression, stacks, manaReserve) {
      armed.push({ x, y, kind, expression, stacks, manaReserve });
      return 1;
    },
  };

  const simConfig = {
    layout: {
      kind: "grid",
      data: {
        width: 4,
        height: 4,
        tiles: ["....", "....", "....", "...."],
        hazards: [
          {
            id: "h1",
            position: { x: 3, y: 1 },
            affinityStacks: [{ kind: "water", stacks: 1, expression: "push" }],
            vitals: { mana: { current: 5, max: 5, regen: 1 } },
          },
        ],
      },
    },
  };

  const result = applySimConfigToCore(core, simConfig);
  assert.equal(result.ok, true);
  assert.equal(armed.length, 1);
  assert.equal(armed[0].x, 3);
  assert.equal(armed[0].y, 1);
  assert.equal(armed[0].kind, 2, "water kind code");
  assert.equal(armed[0].expression, 1, "push expression code");
  assert.equal(armed[0].stacks, 1);
  assert.equal(armed[0].manaReserve, 5, "mana from vitals");
});

test("applySimConfigToCore arms both traps and hazards", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const core = {
    configureGrid() { return 0; },
    setTileAt() {},
    armStaticTrapAt(x, y, kind, expression, stacks, manaReserve) {
      armed.push({ x, y, kind, expression, stacks, manaReserve });
      return 1;
    },
  };

  const simConfig = {
    layout: {
      kind: "grid",
      data: {
        width: 6,
        height: 6,
        tiles: ["......", "......", "......", "......", "......", "......"],
        traps: [
          {
            x: 1,
            y: 1,
            blocking: false,
            affinity: { kind: "earth", expression: "emit", stacks: 3 },
            vitals: { mana: { current: 4, max: 4, regen: 1 } },
          },
        ],
        hazards: [
          {
            id: "h1",
            position: { x: 3, y: 3 },
            affinityStacks: [{ kind: "fire", stacks: 2, expression: "emit" }],
            vitals: { mana: { current: 6, max: 6, regen: 2 } },
          },
        ],
      },
    },
  };

  const result = applySimConfigToCore(core, simConfig);
  assert.equal(result.ok, true);
  assert.equal(armed.length, 2, "both trap and hazard armed");
  assert.equal(armed[0].x, 1, "trap at 1,1");
  assert.equal(armed[1].x, 3, "hazard at 3,3");
});

test("applySimConfigToCore skips hazards with invalid/missing affinity", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const core = {
    configureGrid() { return 0; },
    setTileAt() {},
    armStaticTrapAt(x, y, kind, expression, stacks, manaReserve) {
      armed.push({ x, y, kind, expression, stacks, manaReserve });
      return 1;
    },
  };

  const simConfig = {
    layout: {
      kind: "grid",
      data: {
        width: 4,
        height: 4,
        tiles: ["....", "....", "....", "...."],
        hazards: [
          { id: "h1", position: { x: 1, y: 1 } },
          { id: "h2", position: { x: 2, y: 2 }, affinityStacks: [] },
          { id: "h3", position: { x: 3, y: 3 }, affinityStacks: [{ kind: "invalid_kind", stacks: 1, expression: "push" }] },
          { id: "h4", affinityStacks: [{ kind: "fire", stacks: 1, expression: "push" }] },
        ],
      },
    },
  };

  const result = applySimConfigToCore(core, simConfig);
  assert.equal(result.ok, true);
  assert.equal(armed.length, 0, "no hazards armed - all invalid");
});

test("applySimConfigToCore normalizes non-canonical hazard expression to push", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const core = {
    configureGrid() { return 0; },
    setTileAt() {},
    armStaticTrapAt(x, y, kind, expression, stacks, manaReserve) {
      armed.push({ x, y, kind, expression, stacks, manaReserve });
      return 1;
    },
  };

  const simConfig = {
    layout: {
      kind: "grid",
      data: {
        width: 4,
        height: 4,
        tiles: ["....", "....", "....", "...."],
        hazards: [
          {
            id: "h1",
            position: { x: 1, y: 1 },
            affinityStacks: [{ kind: "fire", stacks: 1, expression: "burning" }],
            vitals: { mana: { current: 3, max: 3, regen: 1 } },
          },
        ],
      },
    },
  };

  const result = applySimConfigToCore(core, simConfig);
  assert.equal(result.ok, true);
  assert.equal(armed.length, 1, "hazard armed with fallback expression");
  assert.equal(armed[0].expression, 1, "expression falls back to push (code 1)");
});

test("applyInitialStateToCore writes first actor affinity to core", async () => {
  const { applyInitialStateToCore } = await loadSetupModule();
  const affinityWrites = [];
  const core = {
    clearActorPlacements() {},
    addActorPlacement() {},
    validateActorPlacement() { return 0; },
    applyActorPlacements() { return 0; },
    setMotivatedActorVital() {},
    setMotivatedActorMovementCost() {},
    setMotivatedActorActionCostMana() {},
    setMotivatedActorActionCostStamina() {},
    validateActorCapabilities() { return 0; },
    setMotivatedActorAffinity(index, kind, expression, stacks) {
      affinityWrites.push({ index, kind, expression, stacks });
      return 1;
    },
  };

  const initialState = {
    actors: [
      {
        id: "delver-1",
        position: { x: 1, y: 1 },
        vitals: { health: { current: 10, max: 10, regen: 0 } },
        affinities: [
          { kind: "fire", stacks: 2, expression: "emit" },
          { kind: "water", stacks: 1, expression: "push" },
        ],
      },
      {
        id: "warden-1",
        position: { x: 3, y: 3 },
        vitals: { health: { current: 8, max: 8, regen: 0 } },
        affinities: [
          { kind: "dark", stacks: 3, expression: "draw" },
        ],
      },
    ],
  };

  const result = applyInitialStateToCore(core, initialState);
  assert.equal(result.ok, true);
  assert.equal(affinityWrites.length, 2, "2 actors -> 2 affinity writes");
  assert.equal(affinityWrites[0].index, 0, "delver-1 at index 0");
  assert.equal(affinityWrites[0].kind, 1, "fire kind code");
  assert.equal(affinityWrites[0].expression, 3, "emit expression code");
  assert.equal(affinityWrites[0].stacks, 2, "stacks = 2");
  assert.equal(affinityWrites[1].index, 1, "warden-1 at index 1");
  assert.equal(affinityWrites[1].kind, 10, "dark kind code");
  assert.equal(affinityWrites[1].expression, 4, "draw expression code");
  assert.equal(affinityWrites[1].stacks, 3, "stacks = 3");
});

test("applyInitialStateToCore skips actors without valid affinities", async () => {
  const { applyInitialStateToCore } = await loadSetupModule();
  const affinityWrites = [];
  const core = {
    clearActorPlacements() {},
    addActorPlacement() {},
    validateActorPlacement() { return 0; },
    applyActorPlacements() { return 0; },
    setMotivatedActorVital() {},
    setMotivatedActorMovementCost() {},
    setMotivatedActorActionCostMana() {},
    setMotivatedActorActionCostStamina() {},
    validateActorCapabilities() { return 0; },
    setMotivatedActorAffinity(index, kind, expression, stacks) {
      affinityWrites.push({ index, kind, expression, stacks });
      return 1;
    },
  };

  const initialState = {
    actors: [
      {
        id: "actor-no-affinity",
        position: { x: 1, y: 1 },
        vitals: { health: { current: 10, max: 10, regen: 0 } },
      },
      {
        id: "actor-empty-affinities",
        position: { x: 2, y: 2 },
        vitals: { health: { current: 10, max: 10, regen: 0 } },
        affinities: [],
      },
      {
        id: "actor-invalid-kind",
        position: { x: 3, y: 3 },
        vitals: { health: { current: 10, max: 10, regen: 0 } },
        affinities: [{ kind: "not_a_real_kind", stacks: 1, expression: "push" }],
      },
    ],
  };

  const result = applyInitialStateToCore(core, initialState);
  assert.equal(result.ok, true);
  assert.equal(affinityWrites.length, 0, "no affinity writes for invalid/missing affinities");
});

test("initializeCoreFromArtifacts calls computeAffinityField when available", async () => {
  const { initializeCoreFromArtifacts } = await loadSetupModule();
  let fieldComputed = false;
  const core = {
    configureGrid() { return 0; },
    setTileAt() {},
    armStaticTrapAt() { return 1; },
    clearActorPlacements() {},
    addActorPlacement() {},
    validateActorPlacement() { return 0; },
    applyActorPlacements() { return 0; },
    setMotivatedActorVital() {},
    setMotivatedActorMovementCost() {},
    setMotivatedActorActionCostMana() {},
    setMotivatedActorActionCostStamina() {},
    validateActorCapabilities() { return 0; },
    setMotivatedActorAffinity() { return 1; },
    computeAffinityField() {
      fieldComputed = true;
      return 0;
    },
  };

  const simConfig = {
    layout: {
      kind: "grid",
      data: {
        width: 4,
        height: 4,
        tiles: ["....", "....", "....", "...."],
        hazards: [
          {
            id: "h1",
            position: { x: 1, y: 1 },
            affinityStacks: [{ kind: "fire", stacks: 1, expression: "emit" }],
            vitals: { mana: { current: 3, max: 3, regen: 1 } },
          },
        ],
      },
    },
  };

  const initialState = {
    actors: [
      {
        id: "delver-1",
        position: { x: 0, y: 0 },
        vitals: { health: { current: 10, max: 10, regen: 0 } },
        affinities: [{ kind: "fire", stacks: 1, expression: "push" }],
      },
    ],
  };

  const result = initializeCoreFromArtifacts(core, { simConfig, initialState });
  assert.equal(result.layout.ok, true);
  assert.equal(result.actor.ok, true);
  assert.equal(fieldComputed, true, "computeAffinityField was called");
});

// ## TODO: Test Permutations
// - [ ] All 10 affinity kinds as hazard affinityStacks[0].kind: verify kind code correct
// - [ ] All 4 expressions as hazard expression: verify expression code correct
// - [ ] Hazard with vitals.mana vs hazard without vitals: verify mana fallback
// - [ ] Hazard emitStrength > stacks and emitStrength < stacks: verify stacks used (not emitStrength)
// - [ ] Multiple hazards at same position: verify both armed
// - [ ] Hazard at board edge (0,0) and (width-1, height-1): verify armed
// - [ ] Actor with non-canonical expression (e.g. "resistant"): verify fallback to push
// - [ ] Actor with stacks=0 or negative: verify skipped or defaulted
// - [ ] Mixed actors with and without affinities: verify only valid ones written
// - [ ] initializeCoreFromArtifacts without computeAffinityField export: verify no error
// - [ ] Sequential initializeCoreFromArtifacts calls: verify field recomputed each time

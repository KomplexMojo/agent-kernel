const assert = require("node:assert/strict");

let coreSetupModulePromise;

function loadSetupModule() {
  coreSetupModulePromise ??= import("../../packages/runtime/src/runner/core-setup.mjs");
  return coreSetupModulePromise;
}

const AFFINITY_KIND_CODES = Object.freeze({
  fire: 1,
  water: 2,
  earth: 3,
  wind: 4,
  life: 5,
  decay: 6,
  corrode: 7,
  fortify: 8,
  light: 9,
  dark: 10,
});

const AFFINITY_EXPRESSION_CODES = Object.freeze({
  push: 1,
  pull: 2,
  emit: 3,
  draw: 4,
});

function createArmingCore(armed) {
  return {
    configureGrid() { return 0; },
    setTileAt() {},
    armStaticTrapAt(x, y, kind, expression, stacks, manaReserve) {
      armed.push({ x, y, kind, expression, stacks, manaReserve });
      return 1;
    },
  };
}

function createActorAffinityCore(affinityWrites, computeCalls = null) {
  return {
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
    setMotivatedActorAffinity(index, kind, expression, stacks) {
      affinityWrites.push({ index, kind, expression, stacks });
      return 1;
    },
    ...(computeCalls
      ? {
        computeAffinityField() {
          computeCalls.count += 1;
          return 0;
        },
      }
      : {}),
  };
}

function createGridSimConfig(data = {}) {
  return {
    layout: {
      kind: "grid",
      data: {
        width: 6,
        height: 6,
        tiles: ["......", "......", "......", "......", "......", "......"],
        ...data,
      },
    },
  };
}

function createInitialState(actors) {
  return { actors };
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

test("applySimConfigToCore maps all hazard affinity kinds to core codes", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const hazards = Object.keys(AFFINITY_KIND_CODES).map((kind, index) => ({
    id: `hazard-${kind}`,
    position: { x: index % 6, y: Math.floor(index / 6) },
    affinityStacks: [{ kind, stacks: 1, expression: "emit" }],
  }));

  const result = applySimConfigToCore(createArmingCore(armed), createGridSimConfig({ hazards }));

  assert.equal(result.ok, true);
  assert.equal(armed.length, 10);
  for (const entry of armed) {
    const kind = Object.entries(AFFINITY_KIND_CODES).find(([, code]) => code === entry.kind)?.[0];
    assert.ok(kind, `unknown kind code ${entry.kind}`);
    assert.equal(entry.kind, AFFINITY_KIND_CODES[kind]);
  }
});

test("applySimConfigToCore maps all hazard affinity expressions to core codes", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const hazards = Object.keys(AFFINITY_EXPRESSION_CODES).map((expression, index) => ({
    id: `hazard-${expression}`,
    position: { x: index + 1, y: 1 },
    affinityStacks: [{ kind: "fire", stacks: 2, expression }],
  }));

  const result = applySimConfigToCore(createArmingCore(armed), createGridSimConfig({ hazards }));

  assert.equal(result.ok, true);
  assert.deepEqual(
    armed.map((entry) => entry.expression),
    Object.values(AFFINITY_EXPRESSION_CODES),
  );
});

test("applySimConfigToCore prefers hazard vitals.mana and falls back to stacks", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const hazards = [
    {
      id: "with-mana",
      position: { x: 1, y: 1 },
      affinityStacks: [{ kind: "fire", stacks: 2, expression: "emit" }],
      vitals: { mana: { current: 9, max: 9, regen: 0 } },
    },
    {
      id: "without-mana",
      position: { x: 2, y: 1 },
      affinityStacks: [{ kind: "water", stacks: 4, expression: "emit" }],
    },
  ];

  const result = applySimConfigToCore(createArmingCore(armed), createGridSimConfig({ hazards }));

  assert.equal(result.ok, true);
  assert.equal(armed[0].manaReserve, 9);
  assert.equal(armed[1].manaReserve, 12);
});

test("applySimConfigToCore uses affinity stacks rather than hazard emitStrength", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const hazards = [
    {
      id: "emit-greater",
      position: { x: 1, y: 1 },
      emitStrength: 10,
      affinityStacks: [{ kind: "fire", stacks: 2, expression: "emit" }],
    },
    {
      id: "emit-smaller",
      position: { x: 2, y: 1 },
      emitStrength: 1,
      affinityStacks: [{ kind: "water", stacks: 4, expression: "emit" }],
    },
  ];

  const result = applySimConfigToCore(createArmingCore(armed), createGridSimConfig({ hazards }));

  assert.equal(result.ok, true);
  assert.deepEqual(armed.map((entry) => entry.stacks), [2, 4]);
});

test("applySimConfigToCore arms duplicate-position hazards and board-edge hazards", async () => {
  const { applySimConfigToCore } = await loadSetupModule();
  const armed = [];
  const hazards = [
    { id: "same-a", position: { x: 2, y: 2 }, affinityStacks: [{ kind: "fire", stacks: 1, expression: "push" }] },
    { id: "same-b", position: { x: 2, y: 2 }, affinityStacks: [{ kind: "water", stacks: 1, expression: "pull" }] },
    { id: "edge-a", position: { x: 0, y: 0 }, affinityStacks: [{ kind: "earth", stacks: 1, expression: "emit" }] },
    { id: "edge-b", position: { x: 5, y: 5 }, affinityStacks: [{ kind: "wind", stacks: 1, expression: "draw" }] },
  ];

  const result = applySimConfigToCore(createArmingCore(armed), createGridSimConfig({ hazards }));

  assert.equal(result.ok, true);
  assert.equal(armed.length, 4);
  assert.deepEqual(armed.map(({ x, y }) => `${x},${y}`), ["2,2", "2,2", "0,0", "5,5"]);
});

test("applyInitialStateToCore normalizes actor affinity expressions and skips invalid stacks", async () => {
  const { applyInitialStateToCore } = await loadSetupModule();
  const affinityWrites = [];
  const core = createActorAffinityCore(affinityWrites);
  const initialState = createInitialState([
    {
      id: "actor-negative",
      position: { x: 1, y: 1 },
      affinities: [{ kind: "fire", stacks: -1, expression: "emit" }],
    },
    {
      id: "actor-resistant",
      position: { x: 2, y: 2 },
      affinities: [{ kind: "water", stacks: 3, expression: "resistant" }],
    },
    {
      id: "actor-zero",
      position: { x: 3, y: 3 },
      affinities: [{ kind: "earth", stacks: 0, expression: "draw" }],
    },
  ]);

  const result = applyInitialStateToCore(core, initialState);

  assert.equal(result.ok, true);
  assert.equal(affinityWrites.length, 1);
  assert.equal(affinityWrites[0].index, 1);
  assert.equal(affinityWrites[0].kind, AFFINITY_KIND_CODES.water);
  assert.equal(affinityWrites[0].expression, AFFINITY_EXPRESSION_CODES.push);
  assert.equal(affinityWrites[0].stacks, 3);
});

test("applyInitialStateToCore writes only valid actors from a mixed actor list", async () => {
  const { applyInitialStateToCore } = await loadSetupModule();
  const affinityWrites = [];
  const initialState = createInitialState([
    { id: "actor-empty", position: { x: 0, y: 0 }, affinities: [] },
    { id: "actor-invalid-kind", position: { x: 1, y: 1 }, affinities: [{ kind: "void", stacks: 1, expression: "emit" }] },
    { id: "actor-valid", position: { x: 2, y: 2 }, affinities: [{ kind: "dark", stacks: 5, expression: "draw" }] },
  ]);

  const result = applyInitialStateToCore(createActorAffinityCore(affinityWrites), initialState);

  assert.equal(result.ok, true);
  assert.deepEqual(affinityWrites, [{ index: 2, kind: AFFINITY_KIND_CODES.dark, expression: AFFINITY_EXPRESSION_CODES.draw, stacks: 5 }]);
});

test("initializeCoreFromArtifacts tolerates missing computeAffinityField export", async () => {
  const { initializeCoreFromArtifacts } = await loadSetupModule();
  const affinityWrites = [];
  const core = createActorAffinityCore(affinityWrites);
  delete core.computeAffinityField;

  const result = initializeCoreFromArtifacts(core, {
    simConfig: createGridSimConfig(),
    initialState: createInitialState([{ id: "actor", position: { x: 1, y: 1 } }]),
  });

  assert.equal(result.layout.ok, true);
  assert.equal(result.actor.ok, true);
});

test("initializeCoreFromArtifacts recomputes affinity field on sequential calls", async () => {
  const { initializeCoreFromArtifacts } = await loadSetupModule();
  const affinityWrites = [];
  const computeCalls = { count: 0 };
  const core = createActorAffinityCore(affinityWrites, computeCalls);
  const payload = {
    simConfig: createGridSimConfig({
      hazards: [{ id: "h1", position: { x: 1, y: 1 }, affinityStacks: [{ kind: "fire", stacks: 1, expression: "emit" }] }],
    }),
    initialState: createInitialState([{ id: "actor", position: { x: 2, y: 2 }, affinities: [{ kind: "water", stacks: 1, expression: "push" }] }]),
  };

  initializeCoreFromArtifacts(core, payload);
  initializeCoreFromArtifacts(core, payload);

  assert.equal(computeCalls.count, 2);
});

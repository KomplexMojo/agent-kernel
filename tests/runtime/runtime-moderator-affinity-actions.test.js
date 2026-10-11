// #158 triage: stays here (not tests/personas/moderator/) — it wires a full runtime with a real
// Moderator persona and asserts on what the RUNTIME applies to core, not on the persona's own
// decision output in isolation. Runtime-to-core orchestration, not persona-alone behavior.
const assert = require("node:assert/strict");

test("runtime applies moderator affinity environment actions to core", async () => {
  const { createRuntime } = await import(
    "../../packages/runtime/src/runner/runtime.js"
  );
  const { createModeratorPersona } = await import(
    "../../packages/runtime/src/personas/moderator/persona.js"
  );

  const setTiles = [];
  const armedHazards = [];

  const core = {
    init() {},
    applyAction() {},
    getCounter() { return 0; },
    getEffectCount() { return 0; },
    getEffectKind() { return 0; },
    getEffectValue() { return 0; },
    clearEffects() {},
    getMapWidth() { return 3; },
    getMapHeight() { return 3; },
    getActorX() { return 1; },
    getActorY() { return 1; },
    getActorKind() { return 2; },
    getActorVitalCurrent(kind) { return kind === 1 ? 3 : 10; },
    getActorVitalMax() { return 10; },
    getActorVitalRegen() { return 0; },
    getTileActorKind(x, y) {
      return x === 1 && y === 0 ? 1 : 0;
    },
    getCurrentTick() { return 0; },
    setTileAt(x, y, tile) {
      setTiles.push({ x, y, tile });
    },
    armStaticHazardAt(x, y, affinityKind, expression, stacks, manaReserve) {
      armedHazards.push({ x, y, affinityKind, expression, stacks, manaReserve });
      return 1;
    },
  };

  const personas = {
    moderator: createModeratorPersona({ clock: () => "fixed" }),
  };

  const runtime = createRuntime({
    core,
    adapters: { logger: { log() {}, warn() {}, error() {} } },
    personas,
  });

  await runtime.init({
    seed: 0,
    affinityEffects: {
      actors: [
        {
          actorId: "actor",
          resolvedEffects: [
            {
              id: "water:emit:barrier:destroy_barrier",
              category: "environment",
              operation: "destroy_barrier",
              sourceType: "actor",
              kind: "water",
              expression: "emit",
              stacks: 3,
              targetType: "barrier",
            },
            {
              id: "water:emit:floor:arm_static_hazard",
              category: "environment",
              operation: "arm_static_hazard",
              sourceType: "actor",
              kind: "water",
              expression: "emit",
              stacks: 3,
              targetType: "floor",
              manaReserve: 2,
            },
          ],
        },
      ],
    },
  });

  await runtime.step();

  assert.equal(setTiles.length, 1);
  assert.deepEqual(setTiles[0], { x: 1, y: 0, tile: 1 });
  assert.equal(armedHazards.length, 1);
  assert.deepEqual(armedHazards[0], { x: 1, y: 1, affinityKind: 2, expression: 3, stacks: 3, manaReserve: 2 });
});

test("runtime persist-or-spawn hazard uses registry quantities when unified", async () => {
  const { createCore } = await import("../../packages/core-ts/src/index.ts");
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const { createRuntime } = await import(
    "../../packages/runtime/src/runner/runtime.js"
  );
  const { createModeratorPersona } = await import(
    "../../packages/runtime/src/personas/moderator/persona.js"
  );

  const configurator = createConfiguratorPersona({ clock: () => "fixed" });
  const layout = { width: 3, height: 1, terrain: ["floor", "floor", "exit"] };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "arm-config", runId: "arm", createdAt: "fixed" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { caster: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "arm-state", runId: "arm", createdAt: "fixed" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 3, height: 1 },
    terrain: layout.terrain,
    actors: [
      {
        id: "caster",
        category: "delver",
        position: { x: 0, y: 0 },
        vitals: { health: { current: 10, max: 10, regen: 0 } },
        motivations: ["waiting"],
      },
      {
        id: "flame",
        category: "hazard",
        position: { x: 1, y: 0 },
        vitals: {
          durability: { current: 3, max: 3, regen: 0 },
          mana: { current: 1, max: 1, regen: 0 },
        },
        affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
        activeAffinityKey: "fire:emit",
      },
    ],
  });

  const core = createCore();
  const armed = [];
  core.armStaticHazardAt = (...args) => {
    armed.push(args);
    return 1;
  };

  const runtime = createRuntime({
    core,
    adapters: {},
    personas: {
      moderator: createModeratorPersona({ clock: () => "fixed" }),
      actor: {
        subscribePhases: ["observe", "decide"],
        state: "idle",
        view() { return { state: this.state, context: {} }; },
        advance({ event, tick, payload }) {
          this.state = event;
          const action = event === "propose"
            ? { actorId: payload.actorId, tick, kind: "wait" }
            : null;
          return { state: this.state, context: {}, actions: action ? [action] : [], effects: [], telemetry: null };
        },
      },
    },
  });

  await runtime.init({
    seed: 0,
    simConfig,
    initialState,
    affinityEffects: {
      actors: [
        {
          actorId: "caster",
          resolvedEffects: [
            {
              id: "water:emit:floor:arm_static_hazard",
              category: "environment",
              operation: "arm_static_hazard",
              sourceType: "actor",
              kind: "water",
              expression: "emit",
              stacks: 3,
              targetType: "floor",
              manaReserve: 2,
            },
          ],
        },
      ],
    },
  });

  await runtime.step();

  assert.equal(armed.length, 0);
  const flame = runtime.getActorSnapshot().actors.find((actor) => actor.id === "flame");
  assert.deepEqual(flame.affinities, [{ kind: "water", expression: "emit", stacks: 3 }]);
  assert.equal(flame.activeAffinityKey, "water:emit");
  assert.deepEqual(flame.vitals.mana, { current: 2, max: 2, regen: 0 });
  assert.deepEqual(flame.vitals.durability, { current: 3, max: 3, regen: 0 });
});

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

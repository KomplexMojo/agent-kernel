const assert = require("node:assert/strict");

test("readObservation includes static hazards exposed directly by core", async () => {
  const { readObservation } = await import(
    "../../packages/core-ts/src/index.ts"
  );

  const core = {
    getMapWidth() { return 3; },
    getMapHeight() { return 3; },
    getActorX() { return 1; },
    getActorY() { return 1; },
    getActorKind() { return 2; },
    getActorVitalCurrent() { return 1; },
    getActorVitalMax() { return 1; },
    getActorVitalRegen() { return 0; },
    getTileActorKind(x, y) { return x === 0 && y === 0 ? 1 : 0; },
    getCurrentTick() { return 0; },
    getTileActorCount() { return 0; },
    getStaticHazardAffinityAt(x, y) { return x === 1 && y === 1 ? 1 : 0; },
    getStaticHazardExpressionAt() { return 3; },
    getStaticHazardStacksAt() { return 2; },
    getStaticHazardManaReserveAt() { return 5; },
  };

  const obs = readObservation(core, { actorIdLabel: "actor_mvp" });
  assert.ok(Array.isArray(obs.hazards));
  assert.equal(obs.hazards.length, 1);
  assert.deepEqual(obs.hazards[0].position, { x: 1, y: 1 });
  assert.equal(obs.hazards[0].manaReserve, 5);
  assert.deepEqual(obs.hazards[0].affinities, [
    { kind: "fire", expression: "emit", stacks: 2, targetType: "floor" },
  ]);
});

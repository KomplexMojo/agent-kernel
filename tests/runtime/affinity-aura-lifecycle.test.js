const assert = require("node:assert/strict");

// A 9x9 room: walls on the perimeter, floor inside, as the projection's
// `{ x, y, type }` tile records.
const BASE_TILES = [];
for (let y = 0; y < 9; y += 1) {
  for (let x = 0; x < 9; x += 1) {
    const wall = x === 0 || y === 0 || x === 8 || y === 8;
    BASE_TILES.push({ x, y, type: wall ? "wall" : "floor" });
  }
}

test("computes serialized auras from hazard actors with affinities", async () => {
  const [auraMod, spatialMod, domainMod] = await Promise.all([
    import("../../packages/runtime/src/render/affinity-aura.js"),
    import("../../packages/runtime/src/contracts/affinity-spatial-rules.js"),
    import("../../packages/runtime/src/contracts/domain-constants.js"),
  ]);

  const { computeAuraMap, serializeAuraMap } = auraMod;
  const { SPATIAL_WEIGHTS, INTERACTION_MATRIX } = spatialMod;
  const { AFFINITY_OPPOSITES } = domainMod;

  const actors = [
    {
      id: "hazard_0",
      x: 5,
      y: 5,
      affinities: [{ kind: "dark", expression: "emit", stacks: 1 }],
    },
  ];

  const auraMap = computeAuraMap(actors, BASE_TILES, {
    affinityOpposites: AFFINITY_OPPOSITES,
    weights: SPATIAL_WEIGHTS,
  });
  const serializedAuras = serializeAuraMap(auraMap, INTERACTION_MATRIX, SPATIAL_WEIGHTS);

  assert.ok(Array.isArray(serializedAuras), "serialized auras should be an array");
  assert.ok(serializedAuras.length > 0, "a dark emitter should project at least one aura");

  const aura = serializedAuras[0];
  assert.equal(typeof aura.x, "number");
  assert.equal(typeof aura.y, "number");
  assert.equal(typeof aura.visualState, "string");
  assert.ok(Array.isArray(aura.sourceEffects));
  assert.ok(Array.isArray(aura.targetEffects));
  assert.ok(aura.layers.length > 0, "aura should have at least one layer");

  const layer = aura.layers.find((entry) => entry.kind === "dark" && entry.expression === "emit");
  assert.ok(layer, "should have a dark emit aura layer from the hazard");
  assert.equal(layer.actorId, "hazard_0");
  assert.equal(layer.stacks, 1);
  assert.equal(typeof layer.intensity, "number");
});

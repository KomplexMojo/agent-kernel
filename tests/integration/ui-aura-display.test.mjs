import assert from "node:assert/strict";
import { computeAuraMap, serializeAuraMap } from "../../packages/runtime/src/render/affinity-aura.js";
import { INTERACTION_MATRIX, SPATIAL_WEIGHTS } from "../../packages/runtime/src/contracts/affinity-spatial-rules.js";
import { AFFINITY_OPPOSITES } from "../../packages/runtime/src/contracts/domain-constants.js";
import { computePreviewFocusBounds } from "../../packages/ui-web/src/views/preview-renderers.js";

function floorTiles(width, height) {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({ x, y, type: "floor" })),
  ).flat();
}

test("serialized runtime aura data is consumed by preview focus bounds", () => {
  const baseTiles = floorTiles(7, 7);
  const auraMap = computeAuraMap([
    {
      id: "actor_fire_emit",
      x: 3,
      y: 3,
      affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
    },
  ], baseTiles, {
    affinityOpposites: AFFINITY_OPPOSITES,
    weights: SPATIAL_WEIGHTS,
  });
  const auras = serializeAuraMap(auraMap, INTERACTION_MATRIX, SPATIAL_WEIGHTS);

  assert.ok(auras.length > 0);
  assert.ok(auras.some((aura) => aura.visualState && aura.layers.some((layer) => layer.kind === "fire")));

  const bounds = computePreviewFocusBounds({
    boardWidth: 7,
    boardHeight: 7,
    observation: { actors: [], hazards: [], auras },
  });

  assert.ok(bounds);
  assert.ok(bounds.minX <= 3 && bounds.maxX >= 3);
  assert.ok(bounds.minY <= 3 && bounds.maxY >= 3);
});

test("serialized aura records expose tooltip-ready production fields", () => {
  const auraMap = computeAuraMap([
    {
      id: "hazard_dark_emit",
      x: 2,
      y: 2,
      affinities: [{ kind: "dark", expression: "emit", stacks: 1 }],
    },
  ], floorTiles(5, 5), {
    affinityOpposites: AFFINITY_OPPOSITES,
    weights: SPATIAL_WEIGHTS,
  });
  const [aura] = serializeAuraMap(auraMap, INTERACTION_MATRIX, SPATIAL_WEIGHTS);

  assert.ok(aura);
  assert.equal(typeof aura.x, "number");
  assert.equal(typeof aura.y, "number");
  assert.equal(typeof aura.visualState, "string");
  assert.ok(Array.isArray(aura.layers));
  assert.ok(Array.isArray(aura.sourceEffects));
  assert.ok(Array.isArray(aura.targetEffects));
  assert.ok(aura.layers.some((layer) => layer.actorId === "hazard_dark_emit"));
});

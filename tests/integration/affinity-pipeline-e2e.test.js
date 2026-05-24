/**
 * Affinity Pipeline End-to-End Integration Test
 *
 * Validates the full data flow:
 *   SimConfig hazards + InitialState actors
 *   -> initializeCoreFromArtifacts (core-setup.mjs)
 *   -> readAffinityFieldAt (bindings)
 *   -> deriveTileAffinityVisuals({ fieldRecords })
 *   -> tileVisuals Map (renderer-ready shape)
 *
 * This test exercises every layer of the pipeline in a single pass:
 *   runtime (core-setup) -> core-ts -> core-ts -> ui-web (tile-affinity-visuals)
 */

const assert = require("node:assert/strict");

test("affinity pipeline e2e: fixture -> core -> field records -> tile visuals -> renderer shape", async () => {
  const [bindings, coreSetup, tileVisuals] = await Promise.all([
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/runtime/src/runner/core-setup.mjs"),
    import("../../packages/ui-web/src/views/tile-affinity-visuals.js"),
  ]);

  const { createCore, readAffinityFieldAt, AFFINITY_KIND_BY_CODE } = bindings;
  const { initializeCoreFromArtifacts } = coreSetup;
  const { deriveTileAffinityVisuals } = tileVisuals;

  const core = createCore();
  core.init(0);

  // ── Build fixture artifacts ──

  const simConfig = {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    layout: {
      kind: "grid",
      data: {
        width: 7,
        height: 7,
        tiles: [
          ".......",
          ".......",
          ".......",
          ".......",
          ".......",
          ".......",
          ".......",
        ],
        hazards: [
          {
            id: "h-fire-1",
            entityType: "hazard",
            position: { x: 3, y: 3 },
            emitStrength: 2,
            affinityStacks: [{ kind: "fire", stacks: 2, expression: "emit" }],
          },
        ],
      },
    },
  };

  const initialState = {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    actors: [
      {
        id: "delver-1",
        entityType: "actor",
        position: { x: 0, y: 0 },
        vitals: {
          hp: { current: 10, max: 10, regen: 0 },
          mana: { current: 5, max: 5, regen: 0 },
          stamina: { current: 5, max: 5, regen: 0 },
        },
        capabilities: { movementCost: 1 },
        affinities: [{ kind: "water", expression: "push", stacks: 1 }],
      },
    ],
  };

  // ── Step 1: Initialize core from artifacts ──

  const result = initializeCoreFromArtifacts(core, { simConfig, initialState });
  assert.equal(result.layout.ok, true, "layout init ok");
  assert.equal(result.actor.ok, true, "actor init ok");

  // ── Step 2: Read field records from the core ──

  const kindCount = Object.keys(AFFINITY_KIND_BY_CODE).length;
  const fieldRecords = [];

  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      for (let kindCode = 1; kindCode <= kindCount; kindCode++) {
        const field = readAffinityFieldAt(core, x, y, kindCode);
        if (field && field.intensity > 0) {
          fieldRecords.push({
            x,
            y,
            kind: AFFINITY_KIND_BY_CODE[kindCode] || "unknown",
            kindCode,
            intensity: field.intensity,
            stacks: field.stacks,
            expression: field.expression,
            expressionName: field.expressionName,
            contributionCount: field.contributionCount,
          });
        }
      }
    }
  }

  assert.ok(fieldRecords.length > 0, "field records collected from core");

  // Verify fire hazard at (3,3) produced records
  const fireAtOrigin = fieldRecords.filter((r) => r.x === 3 && r.y === 3 && r.kind === "fire");
  assert.ok(fireAtOrigin.length >= 1, "fire field at hazard origin");
  assert.ok(fireAtOrigin[0].intensity > 0, "fire origin has intensity");
  assert.equal(fireAtOrigin[0].stacks, 2, "origin stacks = 2");
  assert.equal(fireAtOrigin[0].expressionName, "emit", "origin expression = emit");

  // Verify spread: some tile near (3,3) but not at origin should have fire
  const fireNearby = fieldRecords.filter(
    (r) => r.kind === "fire" && !(r.x === 3 && r.y === 3) && r.intensity > 0
  );
  assert.ok(fireNearby.length > 0, "fire spread to nearby tiles");

  // Verify intensity gradient: nearby tiles have lower intensity than origin
  const originIntensity = fireAtOrigin[0].intensity;
  for (const nearby of fireNearby) {
    assert.ok(nearby.intensity <= originIntensity, "nearby intensity <= origin");
  }

  // ── Step 3: Derive tile visuals from field records ──

  const tileVisualsMap = deriveTileAffinityVisuals({
    fieldRecords,
    resourceBundle: { mappings: { overlays: {} } },
  });

  assert.ok(tileVisualsMap instanceof Map, "tileVisuals is a Map");
  assert.ok(tileVisualsMap.size > 0, "tileVisuals has entries");

  // Verify origin tile visual
  const originVisual = tileVisualsMap.get("3,3");
  assert.ok(originVisual, "origin tile has visual");
  assert.equal(originVisual.affinityKind, "fire", "origin visual kind = fire");
  assert.equal(originVisual.color, 0xf05a28, "fire color");
  assert.ok(originVisual.intensity > 0, "origin visual intensity > 0");
  assert.ok(originVisual.alpha > 0, "origin visual alpha > 0");
  assert.ok(originVisual.alpha <= 1, "origin visual alpha <= 1");

  // Verify contributions array is present (fieldRecords path)
  assert.ok(Array.isArray(originVisual.contributions), "contributions array present");
  assert.ok(originVisual.contributions.length >= 1, "at least one contribution");
  assert.equal(originVisual.contributions[0].kind, "fire", "contribution kind = fire");

  // Verify renderer shape: all tile visuals have required properties
  for (const [key, visual] of tileVisualsMap) {
    assert.ok(typeof visual.intensity === "number", key + " has intensity");
    assert.ok(typeof visual.affinityKind === "string", key + " has affinityKind");
    assert.ok(typeof visual.color === "number", key + " has color");
    assert.ok(typeof visual.alpha === "number", key + " has alpha");
    assert.ok(visual.alpha >= 0 && visual.alpha <= 1, key + " alpha in [0,1]");
  }

  // Verify actor water field at (0,0): actor push produces a field at the actor's own tile
  const actorVisual = tileVisualsMap.get("0,0");
  if (actorVisual) {
    assert.equal(actorVisual.affinityKind, "water", "actor tile has water affinity");
    assert.equal(actorVisual.color, 0x2b7fff, "water color");
  }

  // Only fire and water visuals should be present (no other kinds)
  const unexpectedVisuals = [...tileVisualsMap.values()].filter(
    (v) => v.affinityKind !== "fire" && v.affinityKind !== "water"
  );
  assert.equal(unexpectedVisuals.length, 0, "only fire and water visuals present");
});

/*
## TODO: Test Permutations
- [ ] Fixture with water hazard (emit): verify water visuals with blue tint (0x2b7fff)
- [ ] Fixture with earth + wind opposite hazards at same tile: verify dominant-by-intensity
- [ ] Fixture with actor fire emit + hazard fire emit overlapping: verify combined intensity
- [ ] Fixture with hazard emitStrength=0: verify empty tileVisuals
- [ ] Fixture with actor having non-canonical expression (e.g. "burning"): verify fallback to "push" (no persistent field)
- [ ] Fixture with multiple hazards of different kinds: verify contributions array has multiple entries at overlap tile
- [ ] Fixture with all 10 affinity kinds: verify each produces correct color in tileVisuals
- [ ] Fixture with hazard at grid edge (0,0): verify field does not extend past grid boundary
- [ ] Fixture with draw expression: verify flat falloff (constant intensity within radius)
- [ ] Verify tileVisuals keys match expected "x,y" format
*/

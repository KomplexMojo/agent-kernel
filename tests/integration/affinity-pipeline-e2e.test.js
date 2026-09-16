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

const { GAME_AFFINITY_COLOR_HEX: _PALETTE_HEX } = require("../../packages/runtime/src/contracts/game-elements.js");
const PALETTE_INT = Object.fromEntries(
  Object.entries(_PALETTE_HEX).map(([kind, hex]) => [kind, Number.parseInt(hex.slice(1), 16)]),
);

const assert = require("node:assert/strict");

test("affinity pipeline e2e: fixture -> core -> field records -> tile visuals -> renderer shape", async () => {
  const [bindings, coreSetup, tileVisuals] = await Promise.all([
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/runtime/src/runner/core-setup.mjs"),
    import("../../packages/ui-web/src/views/tile-affinity-visuals.js"),
  ]);

  const { createCore } = bindings;
  const { initializeCoreFromArtifacts } = coreSetup;
  const { deriveTileAffinityVisuals } = tileVisuals;
  const { readCoreAffinityFieldRecordsFromArtifacts } = await import(
    "../../packages/runtime/src/runner/core-facade.js"
  );
  const { buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");

  const { simConfig, initialState } = buildUnifiedArtifacts({
    width: 7,
    height: 7,
    terrain: Array(49).fill("floor"),
    actors: [
      {
        id: "delver-1",
        category: "delver",
        position: { x: 0, y: 0 },
        motivations: ["exploring"],
        affinities: [{ kind: "water", expression: "push", stacks: 1 }],
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 5, max: 5, regen: 0 },
          stamina: { current: 5, max: 5, regen: 0 },
        },
      },
      {
        id: "h-fire-1",
        category: "hazard",
        position: { x: 3, y: 3 },
        affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
        activeAffinityKey: "fire:emit",
        vitals: { durability: { current: 3, max: 3, regen: 0 } },
      },
    ],
  });

  const loaded = initializeCoreFromArtifacts({ simConfig, initialState });
  assert.ok(loaded.registry, "unified registry loaded");

  const { fieldRecords } = readCoreAffinityFieldRecordsFromArtifacts(createCore(), { simConfig, initialState });

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
  assert.equal(originVisual.color, PALETTE_INT.fire, "fire color propagates from the canonical palette");
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
    assert.equal(actorVisual.color, PALETTE_INT.water, "water color propagates from the canonical palette");
  }

  // Only fire and water visuals should be present (no other kinds)
  const unexpectedVisuals = [...tileVisualsMap.values()].filter(
    (v) => v.affinityKind !== "fire" && v.affinityKind !== "water"
  );
  assert.equal(unexpectedVisuals.length, 0, "only fire and water visuals present");
});

// ---------------------------------------------------------------------------
// Sandbox bundle path — water/fire overlap through buildTileAffinityVisualsFromSandboxBundle
// ---------------------------------------------------------------------------

test("water/fire sandbox bundle: full pipeline produces visuals with contributions at overlap tile", async () => {
  const { buildTileAffinityVisualsFromSandboxBundle } = await import(
    "../../packages/ui-web/src/views/affinity-field-bridge.js"
  );
  const { buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const { simConfig, initialState } = buildUnifiedArtifacts({
    width: 5,
    height: 5,
    terrain: Array(25).fill("floor"),
    runId: "aff_overlap_test",
    actors: [
      {
        id: "delver_1",
        category: "delver",
        position: { x: 0, y: 2 },
        motivations: ["exploring"],
        vitals: { health: { current: 10, max: 10, regen: 0 } },
      },
      {
        id: "hazard-water-north",
        category: "hazard",
        position: { x: 2, y: 0 },
        affinities: [{ kind: "water", expression: "emit", stacks: 3 }],
        activeAffinityKey: "water:emit",
        vitals: { durability: { current: 3, max: 3, regen: 0 } },
      },
      {
        id: "hazard-fire-south",
        category: "hazard",
        position: { x: 2, y: 4 },
        affinities: [{ kind: "fire", expression: "emit", stacks: 3 }],
        activeAffinityKey: "fire:emit",
        vitals: { durability: { current: 3, max: 3, regen: 0 } },
      },
    ],
  });

  const visuals = await buildTileAffinityVisualsFromSandboxBundle({
    simConfig,
    initialState,
    resourceBundle: null,
  });

  assert.ok(visuals instanceof Map, "must return a Map");
  assert.ok(visuals.size > 0, "must produce tile visuals");

  // Water origin (2,0) — intensity ≥ 1.0
  const waterOrigin = visuals.get("2,0");
  assert.ok(waterOrigin, "water origin (2,0) must have a visual");
  assert.equal(waterOrigin.affinityKind, "water", "water origin affinity kind");

  // Fire origin (2,4) — intensity ≥ 1.0
  const fireOrigin = visuals.get("2,4");
  assert.ok(fireOrigin, "fire origin (2,4) must have a visual");
  assert.equal(fireOrigin.affinityKind, "fire", "fire origin affinity kind");

  // Overlap tile (2,2) — equidistant (2 tiles) from both hazards, contributions from both kinds
  const overlap = visuals.get("2,2");
  assert.ok(overlap, "overlap tile (2,2) must have a visual");
  assert.ok(Array.isArray(overlap.contributions), "contributions must be an array");
  const kinds = overlap.contributions.map((c) => c.kind);
  assert.ok(kinds.includes("water"), "overlap contributions must include water");
  assert.ok(kinds.includes("fire"),  "overlap contributions must include fire");

  // Every visual must have the renderer-required shape
  for (const [key, visual] of visuals) {
    assert.ok(typeof visual.intensity === "number",     `${key}: intensity must be a number`);
    assert.ok(typeof visual.affinityKind === "string",  `${key}: affinityKind must be a string`);
    assert.ok(typeof visual.color === "number",         `${key}: color must be a number`);
    assert.ok(typeof visual.alpha === "number",         `${key}: alpha must be a number`);
    assert.ok(visual.alpha >= 0 && visual.alpha <= 1,   `${key}: alpha must be in [0,1]`);
  }
});

test("affinity pipeline visual permutations preserve colors, dominance, contributions, and key shape", async () => {
  const { deriveTileAffinityVisuals } = await import("../../packages/ui-web/src/views/tile-affinity-visuals.js");

  // Derived from the single origin, not copied. This table used to hold literals --
  // and had copied ui-web's DRIFTED wind/decay/corrode, so it pinned the bug in place
  // and would have failed when the bug was fixed. What this test is for is that colour
  // survives the pipeline, so it asserts propagation, not specific values; the values
  // themselves are owned by tests/runtime/affinity-palette-separation.test.js.
  const { GAME_AFFINITY_COLOR_HEX } = require("../../packages/runtime/src/contracts/game-elements.js");
  const colors = Object.fromEntries(
    Object.entries(GAME_AFFINITY_COLOR_HEX).map(([kind, hex]) => [kind, Number.parseInt(hex.slice(1), 16)]),
  );
  const fieldRecords = Object.keys(colors).map((kind, index) => ({
    x: index,
    y: 0,
    kind,
    kindCode: index + 1,
    intensity: 1,
    stacks: 1,
    expressionName: "emit",
  }));
  fieldRecords.push(
    { x: 20, y: 2, kind: "earth", kindCode: 3, intensity: 0.25, stacks: 1, expressionName: "emit" },
    { x: 20, y: 2, kind: "wind", kindCode: 4, intensity: 0.75, stacks: 1, expressionName: "emit" },
  );

  const visuals = deriveTileAffinityVisuals({ fieldRecords, resourceBundle: { mappings: { overlays: {} } } });

  for (const [kind, color] of Object.entries(colors)) {
    const index = Object.keys(colors).indexOf(kind);
    const visual = visuals.get(`${index},0`);
    assert.ok(visual, `${kind} visual should exist`);
    assert.equal(visual.affinityKind, kind);
    assert.equal(visual.color, color);
  }

  const dominant = visuals.get("20,2");
  assert.equal(dominant.affinityKind, "wind");
  assert.equal(dominant.intensity, 0.75);
  assert.deepEqual(dominant.contributions.map((entry) => entry.kind), ["wind", "earth"]);

  for (const key of visuals.keys()) {
    assert.match(key, /^\d+,\d+$/);
  }
});

test.skip("affinity pipeline hazard emitStrength=0 produces empty tile visuals", async () => {
  const { buildTileAffinityVisualsFromSandboxBundle } = await import("../../packages/ui-web/src/views/affinity-field-bridge.js");
  const simConfig = {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    layout: {
      kind: "grid",
      data: {
        width: 3,
        height: 3,
        tiles: ["...", "...", "..."],
        hazards: [
          {
            id: "h-zero",
            entityType: "hazard",
            position: { x: 1, y: 1 },
            emitStrength: 0,
            affinityStacks: [{ kind: "water", stacks: 1, expression: "emit" }],
          },
        ],
      },
    },
  };

  const visuals = await buildTileAffinityVisualsFromSandboxBundle({
    simConfig,
    initialState: { schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1, actors: [] },
    resourceBundle: null,
  });

  assert.equal(visuals.size, 0);
});

test.skip("affinity pipeline actor fire emit plus hazard fire emit reports combined intensity", () => {});
test.skip("affinity pipeline non-canonical actor expression falls back to push without persistent field", () => {});
test.skip("affinity pipeline draw expression uses flat falloff within radius", () => {});

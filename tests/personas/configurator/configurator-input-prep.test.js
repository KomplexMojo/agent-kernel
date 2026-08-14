/**
 * P2.2 — the Configurator owns input preparation on the CONFIG plane.
 *
 * The persona audit found the Configurator's FSM never gated real behavior:
 * the CLI (ak-impl.mjs) prepared configurator inputs inline — grid sizing
 * (ensureAuthoringLevelGenCapacity), hazard placement, resource mapping — and
 * reached around the persona. P2.2 relocates that pure logic into
 * personas/configurator/input-preparation.js and fronts it with an FSM-gated
 * service surface (provideConfig → prepareLevelGen/mapResources → validate →
 * lock), mirroring the Allocator (P1.1) and Director (P2.1a) surfaces. P2.3.1
 * threads the CLI through this surface and deletes the inline copy.
 *
 * The grid arithmetic is the program's most goldens-sensitive code (it feeds
 * sim-config), so it was moved BYTE-FOR-BYTE. These characterization cases pin
 * the exact numbers; a drift in the moved formulas fails here before it can
 * reach a golden.
 */
const assert = require("node:assert/strict");

const CONFIGURATOR = "../../../packages/runtime/src/personas/configurator/persona.js";
const PREP = "../../../packages/runtime/src/personas/configurator/input-preparation.js";

async function makeConfigurator() {
  const { createConfiguratorPersona } = await import(CONFIGURATOR);
  return createConfiguratorPersona({ clock: () => "2026-07-22T00:00:00.000Z" });
}

// ---------------------------------------------------------------------------
// prepareLevelGen — grid-sizing characterization (byte-for-byte with ak-impl)
// ---------------------------------------------------------------------------

test("prepareLevelGen sizes a single medium room with no hazards/floor tiles", async () => {
  const { prepareLevelGen } = await import(PREP);
  const levelGen = prepareLevelGen({
    existingLevelGen: {},
    rooms: [{ value: { size: "medium", count: 1 } }],
    floorTiles: [],
    hazards: [],
  });
  // walkableSide 5, profileGridSide 5+4=9, roomCapacitySide 0 (single room) → 9.
  assert.equal(levelGen.width, 9);
  assert.equal(levelGen.height, 9);
  assert.deepEqual(levelGen.shape, {
    roomCount: 1,
    roomMinSize: 5,
    roomMaxSize: 5,
    corridorWidth: 1,
  });
  assert.equal(levelGen.walkableTilesTarget, undefined);
  assert.equal(levelGen.hazards, undefined);
});

test("prepareLevelGen scales the grid to the requested room COUNT (sqrt-packing)", async () => {
  const { prepareLevelGen } = await import(PREP);
  const levelGen = prepareLevelGen({
    existingLevelGen: {},
    rooms: [{ value: { size: "medium", count: 5 } }],
    floorTiles: [],
    hazards: [],
  });
  // 5 rooms: columns=ceil(sqrt5)=3, rows=2, max=3 → 3*(8+1)+4 = 31.
  assert.equal(levelGen.width, 31);
  assert.equal(levelGen.height, 31);
});

test("prepareLevelGen enforces MIN_ROOM_SIZE_WITH_ITEMS and walkable target with hazards", async () => {
  const { prepareLevelGen } = await import(PREP);
  const levelGen = prepareLevelGen({
    existingLevelGen: {},
    rooms: [{ value: { size: "small", count: 1 } }],
    floorTiles: [{ value: { count: 4 } }],
    hazards: [
      {
        value: {
          id: "h1",
          x: 1,
          y: 1,
          blocking: true,
          affinityStacks: [{ kind: "fire", stacks: 1 }],
          vitals: { health: 10 },
        },
      },
    ],
  });
  // requestedWalkable = 4 + 1 blocking = 5 → walkableSide 6. resolveRoomSizeProfile
  // FLOORS at medium ("small" never downgrades below the medium default), so the
  // profile is {min 5, max 8}; profileGridSide = 5+4 = 9 wins. With hazards present
  // roomMinSize is held at MIN_ROOM_SIZE_WITH_ITEMS=5 and roomMaxSize at the
  // profile's 8 (vs the no-hazard floor of 3).
  assert.equal(levelGen.width, 9);
  assert.equal(levelGen.height, 9);
  assert.equal(levelGen.shape.roomMinSize, 5);
  assert.equal(levelGen.shape.roomMaxSize, 8);
  assert.equal(levelGen.walkableTilesTarget, 4);
  assert.deepEqual(levelGen.hazards, [
    { id: "h1", x: 1, y: 1, blocking: true, affinity: { kind: "fire", stacks: 1 }, vitals: { health: 10 } },
  ]);
});

test("prepareLevelGen never shrinks an existing larger grid, and passes unplaced hazards through", async () => {
  const { prepareLevelGen } = await import(PREP);
  const levelGen = prepareLevelGen({
    existingLevelGen: { width: 40, height: 40 },
    rooms: [{ value: { size: "small", count: 1 } }],
    floorTiles: [],
    hazards: [{ value: { id: "roaming", affinity: "fire" } }],
  });
  assert.equal(levelGen.width, 40);
  assert.equal(levelGen.height, 40);
  // No x/y → hazard is spread through verbatim (room-relative placement later).
  assert.deepEqual(levelGen.hazards, [{ id: "roaming", affinity: "fire" }]);
});

// ---------------------------------------------------------------------------
// mapResources — schema mapping
// ---------------------------------------------------------------------------

test("mapResources maps schemaVersion 3 and legacy resource values", async () => {
  const { mapResources } = await import(PREP);
  const mapped = mapResources([
    { _schemaVersion: 3, id: "r3", permanenceMode: "permanent", vitals: { health: 5 }, extra: "dropme" },
    { id: "r1", tier: "common", stat: "health", delta: 10, dropRate: 0.5, extra: "dropme" },
  ]);
  assert.deepEqual(mapped, [
    { id: "r3", permanenceMode: "permanent", vitals: { health: 5 } },
    { id: "r1", tier: "common", stat: "health", delta: 10, dropRate: 0.5 },
  ]);
});

// ---------------------------------------------------------------------------
// FSM gating — the state gates real behavior (charter: no label-only states)
// ---------------------------------------------------------------------------

test("preparation REFUSES before a config is provided — the state gates behavior", async () => {
  const c = await makeConfigurator();
  assert.equal(c.view().state, "uninitialized");
  assert.throws(
    () => c.prepareLevelGen({ rooms: [], floorTiles: [], hazards: [] }),
    (e) => e.code === "configurator_state" && /uninitialized/.test(e.message),
  );
  assert.throws(() => c.mapResources([]), (e) => e.code === "configurator_state");
  assert.equal(c.view().state, "uninitialized", "a refusal does not move the FSM");
});

test("provideConfig opens the round; prepare/map work in pending_config and configured", async () => {
  const c = await makeConfigurator();
  const { state } = c.provideConfig({ dungeonAffinity: "fire" });
  assert.equal(state, "pending_config");

  const levelGen = c.prepareLevelGen({ rooms: [{ value: { size: "medium", count: 1 } }], floorTiles: [], hazards: [] });
  assert.equal(levelGen.width, 9);
  assert.deepEqual(c.mapResources([{ id: "r1", tier: "common", stat: "health", delta: 1, dropRate: 1 }]), [
    { id: "r1", tier: "common", stat: "health", delta: 1, dropRate: 1 },
  ]);

  assert.equal(c.validate().state, "configured");
  // Assembly still permitted while configured (before lock).
  assert.equal(c.prepareLevelGen({ rooms: [], floorTiles: [], hazards: [] }).width, 9);
  assert.equal(c.lock().state, "locked");
});

test("provideConfig rejects a missing/invalid config and stays uninitialized", async () => {
  const c = await makeConfigurator();
  assert.throws(() => c.provideConfig(null), (e) => e.code === "configurator_state");
  assert.equal(c.view().state, "uninitialized");
});

test("view() stays JSON-serializable and reports the assembly context", async () => {
  const c = await makeConfigurator();
  c.provideConfig({ dungeonAffinity: "fire" });
  c.prepareLevelGen({ rooms: [], floorTiles: [], hazards: [] });
  c.mapResources([]);
  const v = c.view();
  assert.deepEqual(JSON.parse(JSON.stringify(v)), v);
  assert.equal(v.context.hasConfig, true);
  assert.equal(v.context.levelGenPrepared, 1);
  assert.equal(v.context.resourcesMapped, 1);
});

// ## TODO: Test Permutations
// - large profile rooms (roomMinSize 8) size profileGridSide to 12
// - multiple room entries of differing sizes: the largest profile wins
// - floorTiles that push walkableSide above profileGridSide (dense corridors)
// - update_config path: configured → pending_config → validate again
// - lock() before validate() refuses; validate() before provideConfig() refuses

/**
 * D8.3 — the Director asks the Configurator for room geometry; it does not derive it.
 *
 * `summary-selections.js` used to import `configurator/card-model.js` for
 * `deriveLayoutFromRoomCards` and `buildRoomDesignFromRoomCards`, and stamp their results
 * into the summary it was resolving. That was the last leg of the Director↔Configurator
 * cycle, and it made the Director a second author of the SIZE → LAYOUT table (small 24
 * tiles / rooms 3–5, medium 48 / 5–8, large 96 / 8–12) that `card-model.js` records as
 * Configurator geometry.
 *
 * The Allocator was given exactly this treatment for exactly these functions at CR.9 M2
 * (`AllocatorRoomGeometryError`). These tests are the Director's half of the same rule.
 *
 * ⚠️ THE SCOPE OF THE REFUSAL IS THE POINT, not just its existence. Both derivations return
 * null for a card set with no room cards, so an actor-only summary has no geometry to
 * derive and must still resolve with NO capability at all. A refusal that fired on every
 * card set would be an outage rather than a boundary — the same trap D8-G's card-free
 * ledger test pins.
 */
const assert = require("node:assert/strict");
const { configuratorRoomGeometry } = require("../../helpers/configurator-capabilities.js");

const SELECTIONS = "../../../packages/runtime/src/personas/director/summary-selections.js";

const ROOM_SUMMARY = Object.freeze({
  dungeonAffinity: "fire",
  budgetTokens: 1000,
  cardSet: [
    { id: "room_a", type: "room", roomSize: "medium", affinity: "fire", count: 2 },
  ],
});

const ACTOR_ONLY_SUMMARY = Object.freeze({
  dungeonAffinity: "fire",
  budgetTokens: 1000,
  cardSet: [
    { id: "warden_a", type: "warden", affinity: "fire", count: 1, motivations: ["defending"] },
  ],
});

test("the Director resolves room cards through the Configurator's geometry", async () => {
  const { extractSummaryFromCardSet } = await import(SELECTIONS);
  const roomGeometry = await configuratorRoomGeometry();

  const resolved = extractSummaryFromCardSet(ROOM_SUMMARY, roomGeometry);

  // Two medium rooms: 48 room tiles + 16 connector tiles each, per card-model.js.
  assert.deepEqual(resolved.layout, {
    floorTiles: 128,
    connectorFloorTiles: 32,
    billableFloorTiles: 96,
  });
  assert.equal(resolved.roomDesign.roomCount, 2);
  assert.equal(resolved.roomDesign.roomMinSize, 5);
  assert.equal(resolved.roomDesign.roomMaxSize, 8);
});

test("the geometry is the CONFIGURATOR's answer, not a Director copy of it", async () => {
  // Compared against the Configurator's public surface rather than a recorded literal:
  // the point of D8.3 is that there is one author, so the assertion has to be identity
  // with that author. A hardcoded expectation would still pass if the Director grew a
  // second, agreeing-for-now implementation — which is exactly how CR.1 stayed invisible.
  const { extractSummaryFromCardSet } = await import(SELECTIONS);
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/persona.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => "2026-08-08T00:00:00.000Z" });
  const roomGeometry = {
    deriveRoomLayout: configurator.deriveRoomLayout,
    buildRoomDesign: configurator.buildRoomDesign,
  };

  const resolved = extractSummaryFromCardSet(ROOM_SUMMARY, roomGeometry);
  const cards = resolved.cardSet.filter((card) => card.type === "room");

  assert.deepEqual(resolved.layout, configurator.deriveRoomLayout(cards));
  assert.deepEqual(resolved.roomDesign, configurator.buildRoomDesign(cards));
});

test("the Director REFUSES to resolve room cards without the Configurator's geometry", async () => {
  const { extractSummaryFromCardSet, DirectorRoomGeometryError } = await import(SELECTIONS);

  assert.throws(
    () => extractSummaryFromCardSet(ROOM_SUMMARY),
    (error) => error instanceof DirectorRoomGeometryError
      && error.code === "director_room_geometry_required",
  );
});

test("a HALF-supplied capability is refused, not silently half-used", async () => {
  // `{ deriveRoomLayout }` with no `buildRoomDesign` would otherwise produce a summary with
  // a correct layout and NO roomDesign — well-formed, buildable, and quietly missing the
  // room shape. Partial capabilities are the shape `normalizeLayoutCosts` refuses for
  // prices, for the same reason.
  const { extractSummaryFromCardSet, DirectorRoomGeometryError } = await import(SELECTIONS);
  const roomGeometry = await configuratorRoomGeometry();

  assert.throws(
    () => extractSummaryFromCardSet(ROOM_SUMMARY, { deriveRoomLayout: roomGeometry.deriveRoomLayout }),
    (error) => error instanceof DirectorRoomGeometryError,
  );
  assert.throws(
    () => extractSummaryFromCardSet(ROOM_SUMMARY, { buildRoomDesign: roomGeometry.buildRoomDesign }),
    (error) => error instanceof DirectorRoomGeometryError,
  );
});

test("an actor-only card set resolves with NO geometry capability at all", async () => {
  const { extractSummaryFromCardSet } = await import(SELECTIONS);

  const resolved = extractSummaryFromCardSet(ACTOR_ONLY_SUMMARY);

  assert.equal(resolved.actors.length, 1);
  assert.equal(resolved.layout, undefined);
  assert.equal(resolved.roomDesign, undefined);
});

test("the Director persona answers room geometry with no wiring from the caller", async () => {
  // The persona holds its own Configurator seam (controller.js -> configurator/persona.js,
  // the public barrel), so `deriveLevelGen` works on a room card set without the caller
  // knowing a Configurator is involved. That is what makes the refusal above a boundary
  // rather than a burden pushed onto every caller.
  const { createDirectorPersona } = await import(
    "../../../packages/runtime/src/personas/director/persona.js"
  );
  const director = createDirectorPersona({ clock: () => "2026-08-08T00:00:00.000Z" });

  const levelGen = director.deriveLevelGen(ROOM_SUMMARY);

  assert.equal(levelGen.shape.roomCount, 2);
  assert.equal(levelGen.walkableTilesTarget, 128);
});

// ## TODO: Test Permutations
// - each room size (small/medium/large) and mixed-size sets, against the Configurator's answer
// - a card set whose only room card has count 0 or a non-integer count
// - `cards` rather than `cardSet` as the spelling, with room cards present
// - a summary that already carries `roomDesign`, checking the merge order is preserved
// - `buildSelectionsFromSummary` and `buildBuildSpecFromSummary` refusing on the same input

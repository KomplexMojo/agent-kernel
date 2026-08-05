/**
 * CR.9 M2 — the Allocator prices room geometry; it does not derive it.
 *
 * Room tile counts (small 24, medium 48, large 96) live in the SIZE -> LAYOUT table
 * in `configurator/card-model.js`, which that file explicitly records as Configurator
 * geometry rather than shared vocabulary. The Allocator used to import it and work
 * the count out itself — a persona computing structure it does not own, purely to
 * have something to charge for.
 *
 * The derivation is now INJECTED at the composition root, the same shape as CR.6's
 * `createActorPersona({ admitProposals: allocator.admitProposals })` going the other
 * way. These tests are the teeth of that: the refusal, and the agreement.
 *
 * WHY A REFUSAL TEST AND NOT ONLY A DIFFERENTIAL. A default would have been the easy
 * option and it is precisely the defect class this program keeps finding — a second,
 * silently-diverging answer to "how big is this card set", invisible because the
 * output stays well-formed. So absence is a loud error, and this test is what stops
 * a future edit reintroducing a quiet fallback.
 *
 * TEETH NOTE (verified by perturbation, 2026-08-04). The pre-M2 defect was restored
 * exactly — re-importing `configurator/card-model.js` and writing
 * `(deriveRoomLayout || deriveLayoutFromRoomCards)(cardSet)` — and the results split
 * cleanly:
 *   DETECTED  the two REFUSAL tests, and `persona-boundary.test.js` (new crossing).
 *   NOT DETECTED  the two tests below them. With a fallback delegating to the very
 *                 function the Configurator exposes, the layouts and prices are
 *                 byte-identical, so agreement and monotonicity both stay green.
 * That is the whole lesson of this program in miniature: **the refusal is the
 * detector; the differential is a precondition.** The differentials still earn their
 * place — they catch the two implementations DRIFTING once they exist separately —
 * but do not mistake them for the guard.
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/";
const CLOCK = () => "2026-08-04T00:00:00.000Z";

async function configuratorGeometry() {
  const { createConfiguratorPersona } = await import(`${P}configurator/persona.js`);
  return createConfiguratorPersona({ clock: CLOCK }).deriveRoomLayout;
}

const ROOM_CARD = { id: "room_medium", type: "room", source: "room", roomSize: "medium", count: 1 };

test("an Allocator with no Configurator geometry refuses to price a room card", async () => {
  const { calculateRoomCardUnitCost } = await import(`${P}allocator/spend-proposal.js`);

  assert.throws(
    () => calculateRoomCardUnitCost({ card: ROOM_CARD, priceList: { items: [] } }),
    (error) => error.code === "allocator_room_geometry_required",
    "pricing a room card without the injected derivation must refuse, not fall back to "
      + "the Allocator deriving geometry it does not own",
  );
});

test("the refusal reaches through the persona surface, not just the module", async () => {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);

  // Constructed WITHOUT deriveRoomLayout — the pre-M2 call shape.
  const allocator = createAllocatorPersona({ clock: CLOCK });

  assert.throws(
    () => allocator.evaluateRoomCardLayoutSpend({ cardSet: [ROOM_CARD], budgetTokens: 1000 }),
    (error) => error.code === "allocator_room_geometry_required",
    "the persona must refuse too — a guard that only holds on the internal module "
      + "leaves the public surface free to reintroduce the default",
  );
});

test("with the geometry injected, the Allocator prices what the Configurator derived", async () => {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { createConfiguratorPersona } = await import(`${P}configurator/persona.js`);

  const deriveRoomLayout = await configuratorGeometry();
  const allocator = createAllocatorPersona({ clock: CLOCK, deriveRoomLayout });

  const cardSet = [
    { ...ROOM_CARD, roomSize: "small" },
    { ...ROOM_CARD, id: "room_large", roomSize: "large" },
  ];

  const priced = allocator.evaluateRoomCardLayoutSpend({ cardSet, budgetTokens: 100000 });

  // The DIFFERENTIAL: the layout the Allocator reports must be the one the
  // Configurator produces standalone. If the Allocator ever derives its own again,
  // these disagree the moment the two implementations drift — which is exactly how
  // the original defect would return.
  const standalone = createConfiguratorPersona({ clock: CLOCK }).deriveRoomLayout(cardSet);

  assert.deepEqual(
    priced.layout,
    {
      floorTiles: standalone.floorTiles,
      connectorFloorTiles: standalone.connectorFloorTiles,
      billableFloorTiles: standalone.billableFloorTiles,
    },
    "the Allocator reported a geometry the Configurator did not derive — that is a "
      + "second implementation of a chartered decision",
  );

  // Preconditions, so the agreement above is not vacuous.
  assert.ok(standalone.billableFloorTiles > 0, "precondition: the card set must have billable tiles");
  assert.ok(priced.spentTokens > 0, "precondition: pricing must actually charge for those tiles");
});

test("room size drives the price, so the injected geometry is genuinely load-bearing", async () => {
  const { calculateRoomCardUnitCost } = await import(`${P}allocator/spend-proposal.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const deriveRoomLayout = await configuratorGeometry();

  // CR.9 M5: this passed `{ items: [] }`. An empty list prices no tiles, and the Allocator
  // now refuses one rather than completing it from the deleted contracts default — so the
  // test has to supply the list production would (the persona's own default).
  const priceOf = (roomSize) => calculateRoomCardUnitCost({
    card: { ...ROOM_CARD, roomSize },
    priceList: buildDefaultPriceList(),
    deriveRoomLayout,
  }).cost;

  const small = priceOf("small");
  const large = priceOf("large");

  assert.ok(
    large > small,
    "a large room must cost more than a small one — if these matched, the derivation "
      + "would not be reaching the price and every test above would be vacuous",
  );
});

// ## TODO: Test Permutations

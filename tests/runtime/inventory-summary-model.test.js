/**
 * The inventory summary is the data behind the toggleable inventory screen.
 *
 * Grouping, ordering, labels and token arithmetic are semantics, so they live in
 * runtime for the same reason the HUD view-model does: `ui-web` should draw what
 * it is handed. The Phaser shelf rail derives the same shape inline today; this
 * is the single origin both surfaces can read.
 */
const assert = require("node:assert/strict");

const {
  buildInventorySummary,
  INVENTORY_TYPE_ORDER,
} = require("../../packages/runtime/src/render/inventory-summary-model.js");
const { GAME_COLOR_PALETTE } = require("../../packages/runtime/src/contracts/game-elements.js");

const CARDS = [
  { id: "R-1", type: "room", tokens: 120 },
  { id: "R-2", type: "room", tokens: 120 },
  { id: "D-1", type: "delver", tokens: 110 },
  { id: "W-1", type: "warden", tokens: 51 },
  { id: "W-2", type: "warden", tokens: 51 },
  { id: "W-3", type: "warden", tokens: 51 },
];
const LEDGER = {
  byType: {
    room: { allocatedTokens: 725, usedTokens: 240 },
    delver: { allocatedTokens: 625, usedTokens: 110 },
    warden: { allocatedTokens: 575, usedTokens: 153 },
    hazard: { allocatedTokens: 375, usedTokens: 0 },
    resource: { allocatedTokens: 200, usedTokens: 0 },
  },
};

test("groups every card under its type, in the canonical order", () => {
  const summary = buildInventorySummary({ cards: CARDS, allocationLedger: LEDGER });
  assert.deepEqual(summary.groups.map((g) => g.type), [...INVENTORY_TYPE_ORDER]);
  const by = Object.fromEntries(summary.groups.map((g) => [g.type, g]));
  assert.equal(by.room.count, 2);
  assert.equal(by.warden.count, 3);
  assert.equal(by.hazard.count, 0, "an empty group is still reported, not dropped");
});

test("reports allocated, used and remaining tokens per group", () => {
  const by = Object.fromEntries(
    buildInventorySummary({ cards: CARDS, allocationLedger: LEDGER }).groups.map((g) => [g.type, g]),
  );
  assert.equal(by.room.allocatedTokens, 725);
  assert.equal(by.room.usedTokens, 240);
  assert.equal(by.room.remainingTokens, 485);
  assert.equal(by.hazard.remainingTokens, 375, "unspent allocation is fully remaining");
});

test("totals are the sum of the groups, not a separate count", () => {
  // A total that is computed independently is a total that can disagree with the
  // rows above it.
  const summary = buildInventorySummary({ cards: CARDS, allocationLedger: LEDGER });
  const sum = (k) => summary.groups.reduce((t, g) => t + g[k], 0);
  assert.equal(summary.totals.allocatedTokens, sum("allocatedTokens"));
  assert.equal(summary.totals.usedTokens, sum("usedTokens"));
  assert.equal(summary.totals.remainingTokens, sum("remainingTokens"));
  assert.equal(summary.totals.cardCount, CARDS.length);
});

test("each group carries the icon identity the rest of the UI uses", () => {
  // So the summary rows and the board sprites cannot drift apart.
  for (const group of buildInventorySummary({ cards: CARDS, allocationLedger: LEDGER }).groups) {
    const expected = GAME_COLOR_PALETTE.types[group.type] || GAME_COLOR_PALETTE.items[group.type];
    assert.equal(group.colorHex, expected, `${group.type} colour`);
    assert.ok(group.iconCategory, `${group.type} needs an icon category`);
  }
});

test("remaining can go negative and is reported, not clamped", () => {
  // Overspend is real state. Hiding it behind a clamp turns a budget error into
  // a display that looks fine.
  const summary = buildInventorySummary({
    cards: [{ id: "R-1", type: "room", tokens: 900 }],
    allocationLedger: { byType: { room: { allocatedTokens: 100, usedTokens: 900 } } },
  });
  const room = summary.groups.find((g) => g.type === "room");
  assert.equal(room.remainingTokens, -800);
  assert.equal(summary.totals.overspent, true);
});

test("survives missing cards, missing ledger, and junk input", () => {
  for (const input of [undefined, {}, { cards: null, allocationLedger: null }, { cards: "nope" }]) {
    const summary = buildInventorySummary(input);
    assert.equal(summary.groups.length, INVENTORY_TYPE_ORDER.length);
    assert.equal(summary.totals.cardCount, 0);
    assert.equal(summary.totals.overspent, false);
  }
});

test("cards of an unknown type are counted rather than silently dropped", () => {
  const summary = buildInventorySummary({
    cards: [...CARDS, { id: "X-1", type: "sorcery", tokens: 10 }],
    allocationLedger: LEDGER,
  });
  assert.equal(summary.totals.cardCount, CARDS.length + 1);
  assert.equal(summary.unknown.length, 1, "unknown types are surfaced, not hidden");
  assert.equal(summary.unknown[0].id, "X-1");
});

test("the summary is serializable", () => {
  const summary = buildInventorySummary({ cards: CARDS, allocationLedger: LEDGER });
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
});

// ## TODO: Test Permutations
// Named permutations awaiting /local-test-gen. Empty bodies on purpose -- see
// tests/README.md: un-skipping one creates a vacuously passing empty test.
test.skip("card token values arriving as strings are coerced", () => {});
test.skip("duplicate card ids are both counted", () => {});
test.skip("a ledger entry for a type with no cards still reports its allocation", () => {});
test.skip("very large token counts format without loss", () => {});

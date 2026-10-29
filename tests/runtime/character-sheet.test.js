/**
 * The character sheet is the model behind the screen where a player configures their own
 * delver. It holds choices and a cursor; the Allocator prices them and the viability floor
 * and slot limits come from the shared constants. What it writes is an ordinary `--delver` spec.
 */
const assert = require("node:assert/strict");

const SHEET = "../../packages/runtime/src/runner/character-sheet.js";
const HERO = "count=1;id=hero;affinity=fire;affinities=fire:emit:2:1,fire:push:3:1;equip=fire:emit;motivation=user_controlled;vitals=health:20:1,mana:30:3,stamina:10:2,durability:10:1";

async function load() {
  return import(SHEET);
}

test("a scenario's delver opens as the sheet, priced by the Allocator", async () => {
  const { createCharacterSheet } = await load();
  const view = createCharacterSheet({ spec: HERO, budgetTokens: 1000 }).view();
  assert.equal(view.total, 234, "the same spend ak create records for this delver");
  assert.equal(view.ok, true);
  assert.equal(view.remaining, 766);
  assert.deepEqual(view.rows.map((row) => row.id), [
    "slot-1", "slot-2", "slot-3", "vital-health", "vital-mana", "vital-stamina", "vital-durability",
  ]);
  assert.equal(view.rows.find((row) => row.id === "vital-mana").price, 30 + 9);
});

test("editing a value reprices through the Allocator and the spec round-trips", async () => {
  const { createCharacterSheet, SHEET_INTENT } = await load();
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 1000 });
  const before = sheet.view().total;
  sheet.apply(SHEET_INTENT.RIGHT); sheet.apply(SHEET_INTENT.RIGHT); // slot 1 range
  sheet.apply(SHEET_INTENT.INC);
  assert.ok(sheet.view().total > before);
  assert.match(sheet.spec(), /affinities=fire:emit:3,fire:push:3/);
  assert.match(sheet.spec(), /motivation=user_controlled/);
  assert.match(sheet.spec(), /equip=fire:emit(;|$)/);
});

test("confirm is refused over budget, below the viability floor, and for a duplicate slot", async () => {
  const { createCharacterSheet, SHEET_INTENT } = await load();
  assert.equal(createCharacterSheet({ spec: HERO, budgetTokens: 100 }).apply(SHEET_INTENT.CONFIRM).done, null);
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 1000 });
  for (let i = 0; i < 4; i += 1) sheet.apply(SHEET_INTENT.DOWN); // vital-mana
  for (let i = 0; i < 40; i += 1) sheet.apply(SHEET_INTENT.DEC);
  const refused = sheet.apply(SHEET_INTENT.CONFIRM);
  assert.equal(refused.done, null);
  assert.match(refused.refused.join(" "), /mana needs max 10\+/);
  assert.equal(createCharacterSheet({ spec: HERO, budgetTokens: 1000 }).apply(SHEET_INTENT.CONFIRM).done, "confirm");
  const dup = createCharacterSheet({ spec: "count=1;affinities=fire:push:1,fire:push:2;vitals=health:10:1,mana:10:1,stamina:5:1,durability:10:1", budgetTokens: 1000 });
  assert.match(dup.view().problems.join(" "), /fire push is held twice/);
});

test("extra slots are priced by the Allocator and capped by core", async () => {
  const { createCharacterSheet, SHEET_INTENT } = await load();
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 5000 });
  const base = sheet.view();
  sheet.apply(SHEET_INTENT.ADD_SLOT);
  const more = sheet.view();
  assert.equal(more.slotCount, 4);
  assert.ok(more.slotsExtraPrice > 0 && more.total > base.total);
  assert.match(sheet.spec(), /slots=4/);
  for (let i = 0; i < 10; i += 1) sheet.apply(SHEET_INTENT.ADD_SLOT);
  assert.equal(sheet.view().slotCount, more.maxSlots);
});

test("every affinity kind and expression can be chosen, none is a default", async () => {
  const { createCharacterSheet, SHEET_INTENT } = await load();
  const { AFFINITY_KINDS } = await import("../../packages/runtime/src/contracts/domain-constants.js");
  const sheet = createCharacterSheet({ spec: "count=1;vitals=health:10:1,mana:10:1,stamina:5:1,durability:10:1", budgetTokens: 5000 });
  sheet.apply(SHEET_INTENT.INC); // fills the empty slot
  const seen = new Set();
  for (let i = 0; i < AFFINITY_KINDS.length; i += 1) {
    seen.add(sheet.view().rows[0].fields[0].value);
    sheet.apply(SHEET_INTENT.INC);
  }
  assert.deepEqual([...seen].sort(), [...AFFINITY_KINDS].sort());
});

test("reset returns to the opening character", async () => {
  const { createCharacterSheet, SHEET_INTENT } = await load();
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 1000 });
  sheet.apply(SHEET_INTENT.DOWN); sheet.apply(SHEET_INTENT.DOWN); sheet.apply(SHEET_INTENT.INC);
  sheet.apply(SHEET_INTENT.RESET);
  assert.equal(sheet.view().total, 234);
});

test("select puts the cursor on a tapped row and field, within bounds", async () => {
  const { createCharacterSheet, SHEET_INTENT } = await load();
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 1000 });
  sheet.select(4, 0); // mana max
  sheet.apply(SHEET_INTENT.INC);
  assert.match(sheet.spec(), /mana:31:3/);
  sheet.select(0, 9);
  assert.deepEqual(sheet.view().cursor, { row: 0, field: 4 }, "a field past the end lands on the last one");
  sheet.select(99, 0);
  assert.deepEqual(sheet.view().cursor, { row: 0, field: 4 }, "an unknown row is ignored");
});

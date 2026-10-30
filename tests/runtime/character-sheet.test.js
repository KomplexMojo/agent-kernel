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
    "slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6", "vital-health", "vital-mana", "vital-stamina", "vital-durability", "minion-1",
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
  assert.match(sheet.spec(), /equip=fire:emit,fire:push;/, "every slot held starts equipped");
});

test("confirm is refused over budget, below the viability floor, and for a duplicate slot", async () => {
  const { createCharacterSheet, SHEET_INTENT } = await load();
  assert.equal(createCharacterSheet({ spec: HERO, budgetTokens: 100 }).apply(SHEET_INTENT.CONFIRM).done, null);
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 1000 });
  for (let i = 0; i < 7; i += 1) sheet.apply(SHEET_INTENT.DOWN); // vital-mana
  for (let i = 0; i < 40; i += 1) sheet.apply(SHEET_INTENT.DEC);
  const refused = sheet.apply(SHEET_INTENT.CONFIRM);
  assert.equal(refused.done, null);
  assert.match(refused.refused.join(" "), /mana needs max 10\+/);
  assert.equal(createCharacterSheet({ spec: HERO, budgetTokens: 1000 }).apply(SHEET_INTENT.CONFIRM).done, "confirm");
  const dup = createCharacterSheet({ spec: "count=1;affinities=fire:push:1,fire:push:2;vitals=health:10:1,mana:10:1,stamina:5:1,durability:10:1", budgetTokens: 1000 });
  assert.match(dup.view().problems.join(" "), /fire push is held twice/);
});

test("every slot up to core's cap is listed; a kind past the free ones buys a slot the Allocator prices", async () => {
  const { createCharacterSheet } = await load();
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 5000 });
  const base = sheet.view();
  assert.equal(base.rows.filter((row) => row.kind === "slot").length, base.maxSlots);
  assert.equal(base.slotCount, base.freeSlots);
  sheet.choose(2, "kind", "water");
  assert.equal(sheet.view().slotCount, base.freeSlots, "the third affinity fills a free slot");
  sheet.choose(5, "kind", "light");
  const more = sheet.view();
  assert.equal(more.slotCount, 4);
  assert.ok(more.slotsExtraPrice > 0 && more.total > base.total);
  assert.match(sheet.spec(), /slots=4/);
  sheet.choose(5, "kind", "none");
  assert.equal(sheet.view().slotCount, base.freeSlots, "back to none, the slot is not bought");
  assert.equal(sheet.view().slotsExtraPrice, 0);
  assert.doesNotMatch(sheet.spec(), /slots=/);
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

test("an empty slot shows kind none with its other fields at their defaults, and costs nothing", async () => {
  const { createCharacterSheet } = await load();
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 1000 });
  const third = sheet.view().rows[2];
  assert.equal(third.empty, true);
  assert.deepEqual(third.fields.map((field) => field.value), ["none", "push", 1, 1]);
  assert.equal(third.price, 0);
  assert.equal(third.mana, null);
  assert.ok(sheet.view().choices.kind.includes("none"));
});

test("choose sets a slot's kind by name, and none empties it again", async () => {
  const { createCharacterSheet } = await load();
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 1000 });
  const base = sheet.view().total;
  sheet.choose(2, "kind", "water");
  assert.match(sheet.spec(), /affinities=fire:emit:2,fire:push:3,water:push:1;/);
  assert.ok(sheet.view().total > base, "the Allocator prices the new slot");
  sheet.choose(0, "kind", "light");
  assert.match(sheet.spec(), /affinities=light:emit:2,fire:push:3,water:push:1;/, "the slot keeps its form, range and start");
  sheet.choose(2, "kind", "none");
  assert.equal(sheet.view().rows[2].empty, true, "none empties the slot");
  assert.match(sheet.spec(), /affinities=light:emit:2,fire:push:3;/);
  sheet.choose(2, "kind", "plasma");
  sheet.choose(7, "kind", "fire");
  assert.match(sheet.spec(), /affinities=light:emit:2,fire:push:3;/, "an unknown kind or a vital row is ignored");
});

test("+ on a kind steps through none as well as every kind", async () => {
  const { createCharacterSheet, SHEET_INTENT } = await load();
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 5000 });
  sheet.select(2, 0);
  sheet.apply(SHEET_INTENT.DEC);
  assert.notEqual(sheet.view().rows[2].fields[0].value, "none");
  sheet.apply(SHEET_INTENT.INC);
  assert.equal(sheet.view().rows[2].fields[0].value, "none");
  assert.doesNotMatch(sheet.spec(), /:1;equip/);
});

test("a tap steps a choice (none, every kind, none again) and only lights a number for − and +", async () => {
  const { createCharacterSheet, SHEET_INTENT } = await load();
  const { AFFINITY_KINDS, AFFINITY_EXPRESSIONS } = await import("../../packages/runtime/src/contracts/domain-constants.js");
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 5000 });
  const kind = () => sheet.view().rows[2].fields[0].value;
  const seen = [];
  for (let i = 0; i <= AFFINITY_KINDS.length; i += 1) { sheet.tap(2, 0); seen.push(kind()); }
  assert.deepEqual(seen, [...AFFINITY_KINDS, "none"]);
  assert.equal(sheet.view().cursorNumeric, false, "− and + mean nothing on a kind");
  sheet.tap(0, 1);
  assert.equal(sheet.view().rows[0].fields[1].value, AFFINITY_EXPRESSIONS[(AFFINITY_EXPRESSIONS.indexOf("emit") + 1) % AFFINITY_EXPRESSIONS.length]);
  const vitalAt = sheet.view().rows.findIndex((row) => row.id === "vital-health");
  const before = sheet.spec();
  sheet.tap(vitalAt, 0);
  assert.equal(sheet.spec(), before, "a tap on a vital changes nothing");
  assert.equal(sheet.view().cursorNumeric, true);
  sheet.apply(SHEET_INTENT.INC);
  assert.notEqual(sheet.spec(), before);
});

// Darren, 2026-10-30: a tap on a held slot's range or intensity steps it up and loops back to 1
// past its limit: the largest value whose mana still fits max mana and whose price fits the allowance.
test("a tap steps range and intensity and loops at the largest value max mana and the allowance afford", async () => {
  const { createCharacterSheet } = await load();
  const spec = "affinities=fire:push:1,fire:emit:1;vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1";
  const sheet = createCharacterSheet({ spec, budgetTokens: 5000 });
  const field = (row, name) => sheet.view().rows[row].fields.find((entry) => entry.name === name);
  const taps = (row, at, count) => Array.from({ length: count }, () => { sheet.tap(row, at); return sheet.view().rows[row].fields[at].value; });
  // Push at mana 10: 2 × i² × r(r+1)/2 fits up to range 2 or intensity 2.
  assert.deepEqual([field(0, "range").limit, field(0, "intensity").limit], [2, 2]);
  assert.deepEqual(taps(0, 2, 3), [2, 1, 2]);
  // Emit at mana 10: 2 + r + i² a tick fits up to range 7 at intensity 1.
  assert.equal(field(1, "range").limit, 7);
  assert.deepEqual(taps(1, 2, 8), [2, 3, 4, 5, 6, 7, 1, 2]);
  for (const row of [0, 1]) {
    const mana = sheet.view().rows[row].mana;
    assert.equal(mana.overMax, false, "every value a tap reaches can be paid");
  }
  // The allowance caps it too: with tokens for only the slots as they are, a tap loops at once.
  const tight = createCharacterSheet({ spec, budgetTokens: createCharacterSheet({ spec, budgetTokens: 5000 }).view().total });
  assert.equal(tight.view().rows[1].fields.find((entry) => entry.name === "range").limit, 1);
  // An empty slot has no limit to show and a tap leaves it at 1.
  assert.equal(sheet.view().rows[2].fields.find((entry) => entry.name === "range").limit, undefined);
  sheet.tap(2, 2);
  assert.equal(sheet.view().rows[2].fields[2].value, 1);
});

test("minions: a tap cycles a role, each one adds a row, none takes it out, and the Configurator's loadouts are priced", async () => {
  const { createCharacterSheet } = await load();
  const sheet = createCharacterSheet({ spec: HERO, budgetTokens: 5000 });
  const minionRows = () => sheet.view().rows.filter((row) => row.kind === "minion");
  const at = (n) => sheet.view().rows.findIndex((row) => row.id === `minion-${n}`);
  const base = sheet.view().total;
  sheet.tap(at(1), 0);
  assert.deepEqual(minionRows().map((row) => row.fields[0].value), ["shield", "none"]);
  assert.equal(minionRows()[0].loadout, "fire emit r2", "a shield emits the delver's own kind");
  assert.ok(minionRows()[0].price > 0 && sheet.view().total === base + minionRows()[0].price);
  sheet.tap(at(2), 0); sheet.tap(at(2), 0); // support
  sheet.tap(at(3), 0); sheet.tap(at(3), 0); sheet.tap(at(3), 0); // striker
  assert.equal(minionRows().length, 4, "three minions and a row to add another");
  assert.deepEqual(sheet.minions(), ["shield", "support", "striker"]);
  sheet.tap(at(1), 0); sheet.tap(at(1), 0); sheet.tap(at(1), 0); // shield -> none
  assert.deepEqual(sheet.minions(), ["support", "striker"], "none takes the minion out and the rest close up");
  assert.match(sheet.spec(), /;minions=support\+striker;/, "the spec carries them, for ak create");
  assert.deepEqual(createCharacterSheet({ spec: sheet.spec(), budgetTokens: 5000 }).minions(), ["support", "striker"], "and reads them back");
  assert.equal(sheet.view().cursorNumeric, false);
});

// Darren, 2026-10-29: the mana each slot spends, as a guide: per tick for an emit or draw,
// per cast for a push or pull. It is what core charges, for every kind.
test("each held slot shows its mana: an emit or draw per tick, a push or pull per cast", async () => {
  const { createCharacterSheet } = await load();
  const { AFFINITY_KINDS } = await import("../../packages/runtime/src/contracts/domain-constants.js");
  const { actorCastManaPrice } = await import("../../packages/core-ts/src/rules/actor-cast.ts");
  const { createConfiguratorPersona } = await import("../../packages/runtime/src/personas/configurator/persona.js");
  const { castManaBase } = createConfiguratorPersona({ clock: () => "2026-10-29T00:00:00.000Z" }).resolveActorTurnCosts({ movementStamina: {} });
  for (const kind of AFFINITY_KINDS) {
    const sheet = createCharacterSheet({ spec: `count=1;affinities=${kind}:emit:3:2,${kind}:draw:1,${kind}:push:3:2,${kind}:pull:2;vitals=health:10:1,mana:20:2,stamina:5:1,durability:10:1`, budgetTokens: 9000 });
    const [emit, draw, push, pull] = sheet.view().rows.slice(0, 4).map((row) => row.mana);
    assert.deepEqual(emit, { amount: 2 + 3 + 4, per: "tick", overMax: false }, `${kind}: 2 + range + intensity²`);
    assert.deepEqual(draw, { amount: 2 + 1 + 1, per: "tick", overMax: false });
    const pushPrice = actorCastManaPrice(castManaBase[`${kind}:push`], 3, 2);
    assert.deepEqual(push, { amount: pushPrice, per: "cast", overMax: pushPrice > 20 });
    assert.equal(pull.amount, actorCastManaPrice(castManaBase[`${kind}:pull`], 2, 1));
    assert.equal(sheet.view().manaPerTick, 9 + 4, "emits and draws together");
  }
  const strong = createCharacterSheet({ spec: "count=1;affinities=dark:emit:3:12;vitals=health:10:1,mana:40:4,stamina:5:1,durability:10:1", budgetTokens: 9000 });
  assert.deepEqual(strong.view().rows[0].mana, { amount: 149, per: "tick", overMax: true }, "above max mana it can never run");
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
  sheet.select(7, 0); // mana max
  sheet.apply(SHEET_INTENT.INC);
  assert.match(sheet.spec(), /mana:31:3/);
  sheet.select(0, 9);
  assert.deepEqual(sheet.view().cursor, { row: 0, field: 3 }, "a field past the end lands on the last one");
  sheet.select(99, 0);
  assert.deepEqual(sheet.view().cursor, { row: 0, field: 3 }, "an unknown row is ignored");
});

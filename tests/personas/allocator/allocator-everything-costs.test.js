/**
 * CR.9 M5 — EVERYTHING IN THE GAME COSTS SOMETHING.
 *
 * MAINTAINER RULE 2026-08-05: "everything in the game should have a cost, even if it is
 * just the base 1 token cost. Adding an economy is partially to prevent economic
 * exploitation."
 *
 * That reframes what the price list is for. A budget is not a balancing knob, it is the
 * only thing standing between an author and unlimited content — so anything obtainable
 * for zero tokens is not a pricing gap, it is an exploit. Two shapes make something free,
 * and this file gates both:
 *
 *   A PRICE OF ZERO           — the item is charged, at nothing. `motivation_stationary`
 *                               was 0, so a stationary warden's motivation was free and a
 *                               level could be filled with them at no cost.
 *   NO CHARGING PATH          — the item has a price nobody spends. `tile_hallway` was
 *                               published at 3 and charged by nothing (CR.9 M5); the
 *                               hazard affinity payload skipped `affinity_base` that the
 *                               identical actor payload pays.
 *
 * The second is the dangerous one, because the price list LOOKS complete. Reading it tells
 * you hallways cost 3; only running a payload through the charging code tells you nobody
 * ever pays it. So the census below is empirical: it drives real payloads through the real
 * spend proposal and compares what was CHARGED against what is PUBLISHED.
 *
 * ═══ WHY A MATRIX AND NOT A SPOT CHECK ═════════════════════════════════════════
 *
 * A spot check finds the gap you already suspect. The matrix enumerates every motivation
 * kind, every affinity expression, every vital, and every resource permanence mode, so a
 * price id added later without a charging path fails here on the next run rather than
 * living for the life of a branch under a green suite — which is precisely how
 * `tile_hallway` and `hazard_base` survived.
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/";
const META = Object.freeze({
  id: "census",
  runId: "census_run",
  createdAt: "2026-08-05T00:00:00.000Z",
  producedBy: "allocator",
});

const VITAL_KEYS = ["health", "mana", "stamina", "durability"];
const EXPRESSIONS = ["emit", "push", "pull", "draw"];
const MOTIVATION_KINDS = [
  "stationary", "random", "exploring", "patrolling", "attacking", "defending",
  "stealthy", "friendly", "reflexive", "goal_oriented", "strategy_focused", "user_controlled",
];
const ALL_VITALS = Object.fromEntries(
  VITAL_KEYS.map((key) => [key, { max: 2, current: 2, regen: 1 }]),
);

async function loadLayoutSpend() {
  return import(`${P}personas/allocator/layout-spend.js`);
}

async function load() {
  const { buildSpendProposal } = await import(`${P}personas/allocator/spend-proposal.js`);
  const { buildDefaultPriceList } = await import(`${P}personas/allocator/default-price-list.js`);
  const { createConfiguratorPersona } = await import(`${P}personas/configurator/persona.js`);
  const normalizeMotivations = createConfiguratorPersona({
    clock: () => "2026-08-05T00:00:00.000Z",
  }).normalizeMotivations;
  const priceList = buildDefaultPriceList();
  return {
    buildDefaultPriceList,
    priceList,
    charge: (payload) => buildSpendProposal({ meta: META, normalizeMotivations, ...payload }),
    priceOf: (id) => priceList.items.find((item) => item.id === id)?.unitCost ?? 0,
  };
}

/** Every payload shape the economy is supposed to be able to price. */
function censusPayloads() {
  const payloads = [
    { layout: { floorTiles: 1, hallwayTiles: 1 } },
    { hazards: [{ id: "h", vitals: ALL_VITALS, affinity: { kind: "fire", expression: "emit", stacks: 1 } }] },
    { actors: [{ id: "a", type: "delver", vitals: ALL_VITALS }] },
    { resources: [{ id: "r", permanenceMode: "consumable", vitals: [{ key: "mana", delta: 1 }] }] },
    { resources: [{ id: "r", permanenceMode: "level", vitals: [{ key: "mana", delta: 1 }] }] },
    { resources: [{ id: "r", permanenceMode: "permanent", vitals: [{ key: "health", delta: 1 }] }] },
  ];
  for (const expression of EXPRESSIONS) {
    payloads.push({ actors: [{ id: "a", type: "delver", affinities: [{ kind: "fire", expression, stacks: 1 }] }] });
    payloads.push({ resources: [{ id: "r", affinity: { kind: "fire", expression, stacks: 1, mana: 1, manaRegen: 1 } }] });
  }
  for (const kind of MOTIVATION_KINDS) {
    payloads.push({ actors: [{ id: "a", type: "delver", motivations: [{ kind }] }] });
  }
  for (const key of VITAL_KEYS) {
    payloads.push({
      resources: [{ id: "r", permanenceMode: "permanent", vitals: [{ key, delta: 1, regen: 1 }] }],
    });
  }
  return payloads;
}

// ── No item is free ───────────────────────────────────────────────────────────

test("no published price is zero — a free item is an exploit, not a discount", async () => {
  const { priceList } = await load();

  const free = priceList.items
    .filter((item) => !(item.unitCost > 0))
    .map((item) => `${item.kind}:${item.id} = ${item.unitCost}`);

  assert.deepEqual(
    free,
    [],
    "everything in the game costs something, even if it is only the 1-token base. "
      + "`motivation_stationary` sat at 0, so an author could fill a level with stationary "
      + "wardens and spend nothing on their behavior",
  );
});

// ── Everything published is actually charged ──────────────────────────────────

/**
 * Ids that are published but deliberately never charged, each with the reason.
 *
 * The M4 precedent (`invalid_requirements` on the authoring-outcome vocabulary) applies:
 * "no producer" and "dead" are different claims, and the difference has to be written down
 * or the exception list becomes the place defects hide. The test below also asserts each
 * entry is STILL unreachable, so an id that gains a charging path must be removed from here
 * rather than quietly sitting in an allowlist.
 *
 * ⚠️ OPEN ASYMMETRY, for a maintainer decision — not a free item. A resource granting a
 * vital IS charged: its delta is billed through `resource_base` / `resource_level` /
 * `resource_permanent` (1×/5×/10× the grant). But `resource_vital_mana_point` IS charged
 * directly as well, from the affinity payload's mana grant, while the health/stamina/
 * durability equivalents are not. One of two things is true and only the Allocator's owner
 * can say which: either the three ids should be deleted, or all four should be billed the
 * same way. Both move the economy, so neither is done here.
 */
const UNCHARGED_BY_DESIGN = Object.freeze({
  "resource:resource_vital_health_point":
    "resource vital deltas are billed through the permanence-mode id, not per point",
  "resource:resource_vital_stamina_point":
    "resource vital deltas are billed through the permanence-mode id, not per point",
  "resource:resource_vital_durability_point":
    "resource vital deltas are billed through the permanence-mode id, not per point",
});

test("every published price id is charged by some real payload", async () => {
  const { priceList, charge } = await load();

  const charged = new Set();
  for (const payload of censusPayloads()) {
    for (const item of charge(payload).items || []) {
      charged.add(`${item.kind}:${item.id}`);
    }
  }

  const published = priceList.items.map((item) => `${item.kind}:${item.id}`).sort();
  const unreachable = published.filter((id) => !charged.has(id) && !UNCHARGED_BY_DESIGN[id]);

  assert.deepEqual(
    unreachable,
    [],
    "a price with no charging path is worse than a missing price: the list reads complete, "
      + "so nobody looks. tile_hallway was published at 3 and charged by nothing; hazard_base "
      + "was published at 10 and charged by nothing",
  );

  // The exception list cannot rot into a hiding place: an id that becomes chargeable, or
  // that leaves the price list, has to be taken out of it deliberately.
  for (const id of Object.keys(UNCHARGED_BY_DESIGN)) {
    assert.ok(
      published.includes(id),
      `${id} is listed as uncharged-by-design but is no longer published — drop the entry`,
    );
    assert.ok(
      !charged.has(id),
      `${id} is listed as uncharged-by-design but IS now charged — drop the entry`,
    );
  }
});

// ── Each entity kind pays a base, whatever else it carries ────────────────────

test("a bare entity still costs something — existing is not free", async () => {
  const { charge } = await load();

  const bare = [
    ["a hazard with no payload", { hazards: [{ id: "h" }] }, "hazard_basic"],
    ["an actor with no payload", { actors: [{ id: "a", type: "delver" }] }, "actor_spawn"],
    ["one floor tile", { layout: { floorTiles: 1 } }, "tile_floor"],
    ["one hallway tile", { layout: { hallwayTiles: 1 } }, "tile_hallway"],
  ];

  for (const [label, payload, expectedId] of bare) {
    const items = charge(payload).items || [];
    const base = items.find((item) => item.id === expectedId);
    assert.ok(base, `${label}: nothing charged ${expectedId} — the entity was free`);
    assert.ok(base.quantity > 0, `${label}: ${expectedId} charged a zero quantity`);
  }
});

// ── The same payload costs the same wherever it is attached ───────────────────

test("a hazard's affinity payload pays the same base an actor's does", async () => {
  const { charge } = await load();

  const affinity = { kind: "fire", expression: "emit", stacks: 2 };
  const idsFor = (items) => new Set(items.map((item) => item.id));

  const hazardItems = idsFor(charge({ hazards: [{ id: "h", affinity }] }).items || []);
  const actorItems = idsFor(charge({
    actors: [{ id: "a", type: "delver", affinities: [affinity] }],
  }).items || []);

  assert.ok(
    actorItems.has("affinity_base"),
    "precondition: the canonical actor path charges a base for an affinity payload",
  );
  assert.ok(
    hazardItems.has("affinity_base"),
    "the identical payload on a hazard skipped affinity_base — 10 tokens of affinity, free, "
      + "for every hazard in every level. Two charging sites for one payload is the CR.1 "
      + "defect class; here it was not a divergent number but a missing charge",
  );
});

/**
 * The shape the CLI actually produces, which is NOT the shape the pricer was reading.
 *
 * `ak create --hazard "affinity=fire;expression=emit"` records the payload as
 * `{ affinity: "fire", expression: "emit", affinityStacks: [...] }` — affinity as a STRING
 * beside a stacks array — while the hazard pricer tested `typeof affinity === "object"`.
 * The test above uses the object shape and so could never see this: on the real build path
 * a hazard's entire affinity payload was charged NOTHING. The g1 golden is the receipt to
 * read — a delver's fire/emit affinity cost 46 tokens; the hazard's identical fire/emit
 * affinity cost 0, and the hazard's whole line was its 5-token base.
 *
 * The same mismatch hid the hazard's vitals: the CLI writes `{ kind: "one-time", amount: N }`
 * and the pricer read `{ max, current, regen }`.
 *
 * ⇒ A charging path that matches one SHAPE of a payload is not a charging path for the
 * payload — the same lesson as the guard-spelling trap, in the economy.
 */
test("a hazard authored the way the CLI writes it pays for its affinity and its vitals", async () => {
  const { charge } = await load();

  const cliShapedHazard = {
    id: "hazard_1",
    affinity: "fire",
    expression: "emit",
    proximityRadius: 2,
    affinityStacks: [{ kind: "fire", expression: "emit", stacks: 1, targetType: "floor" }],
    vitals: { durability: { kind: "one-time", amount: 1 }, mana: { kind: "one-time", amount: 0 } },
  };

  const items = charge({ hazards: [cliShapedHazard] }).items || [];
  const byId = new Map(items.map((item) => [item.id, item]));

  assert.ok(byId.get("hazard_basic"), "the base is charged (this part always worked)");
  assert.ok(
    byId.get("affinity_base"),
    "a hazard's affinity payload pays a base, exactly as a delver's does",
  );
  assert.ok(
    byId.get("affinity_stack"),
    "and its stacks — a level of affinity hazards at 5 tokens each is the exploit the "
      + "economy exists to prevent",
  );
  assert.ok(
    byId.get("affinity_expression_localized"),
    "and its expression: emit maps to the localized expression price",
  );
  assert.equal(
    byId.get("vital_durability_point")?.quantity,
    1,
    "the hazard's one-time durability grant is a vital point and is charged like one",
  );
});

/**
 * ONE PAYLOAD, ONE PRICE — the other half of "everything costs something".
 *
 * Charging a thing twice is the same defect as charging it never: both mean the receipt
 * is not the price. Two cases, both found after the first pass:
 *
 *   OVER-CHARGE ACROSS SITES. The hazard site charged the affinity EXPRESSION once per
 *   stack, while the actor branch and the canonical `calculateActorConfigurationUnitCost`
 *   charge it once. A 3-stack push cost a hazard 105 tokens where an actor pays 35. The
 *   content-gen benchmark is what found it: scenario 51 failed all three runs on
 *   `deniedPools=hazards:262/156` once M5 added the missing base on top.
 *
 *   DOUBLE-CHARGE WITHIN A SITE. `countFloorTiles` counts every walkable cell of a `tiles`
 *   grid — hallways included — so charging an explicit `hallwayTiles` on top bills them
 *   twice. Latent when written (no fixture carries both shapes), which is precisely why it
 *   needs a test rather than a comment.
 */
test("the same affinity payload costs the same on a hazard as on an actor", async () => {
  const { charge } = await load();

  // TWO affinities, one of them multi-stack: the shape that exposes BOTH divergences.
  // Comparing ID sets would pass either way — the Codex review's point — so this compares
  // quantities per id, which is where "one payload, one price" actually lives.
  const affinities = [
    { kind: "earth", expression: "push", stacks: 3 },
    { kind: "fire", expression: "emit", stacks: 1 },
  ];
  const affinityQuantities = (items) => Object.fromEntries(
    items
      .filter((item) => item.kind === "affinity")
      .map((item) => [item.id, item.quantity])
      .sort(),
  );

  const hazardItems = charge({ hazards: [{ id: "h", affinityStacks: affinities }] }).items || [];
  const actorItems = charge({ actors: [{ id: "a", type: "delver", affinities }] }).items || [];

  assert.deepEqual(
    affinityQuantities(hazardItems),
    affinityQuantities(actorItems),
    "every affinity charge must match the canonical actor site quantity-for-quantity: the "
      + "expression once per entry (not per stack) and the base once per entry (not per "
      + "hazard). One payload with two prices is the defect this milestone closes",
  );
  assert.equal(
    affinityQuantities(actorItems).affinity_base,
    2,
    "precondition: the canonical site charges a base per affinity entry",
  );
});

test("a caller who prices a tile at zero is refused, not quietly overruled", async () => {
  const { AllocatorTilePriceError, evaluateLayoutSpend } = await loadLayoutSpend();

  const freeTiles = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    items: [{ id: "tile_floor", kind: "tile", unitCost: 0 }],
  };

  assert.throws(
    () => evaluateLayoutSpend({ layout: { floorTiles: 10 }, budgetTokens: 100, priceList: freeTiles }),
    (error) => {
      assert.ok(error instanceof AllocatorTilePriceError);
      return true;
    },
    "silence and zero are different statements: a list that omits a tile defers to the "
      + "canonical price, but a list that PRICES it at zero has asked for a free tile, and "
      + "substituting a default there would both overrule the caller and reopen the exploit",
  );
});

test("a V1/V2 hazard's top-level vitals are charged like a V3 hazard's nested ones", async () => {
  const { charge } = await load();

  // V1 shape: grants at the top level, no `vitals` object at all.
  const items = charge({ hazards: [{ id: "h", mana: 3, durability: 2 }] }).items || [];
  const byId = new Map(items.map((item) => [item.id, item]));

  assert.equal(byId.get("vital_mana_point")?.quantity, 3);
  assert.equal(byId.get("vital_durability_point")?.quantity, 2);
});

test("a grid-shaped layout is not billed twice for its hallways", async () => {
  const { charge, priceOf } = await load();

  // Five walkable cells in the grid, of which the author also reports 2 as hallway.
  const grid = ["#####", "#...#", "#..##", "#####"];
  const walkable = grid.join("").split("").filter((cell) => cell !== "#").length;

  const spend = charge({ layout: { tiles: grid, hallwayTiles: 2 } });
  const tileItems = (spend.items || []).filter((item) => item.kind === "tile");
  const tileTokens = tileItems.reduce((sum, item) => sum + item.quantity * priceOf(item.id), 0);

  assert.equal(
    tileTokens,
    walkable * priceOf("tile_floor"),
    "the grid already counts hallway cells as walkable, so adding the explicit hallway "
      + "count on top charges the same tiles twice",
  );
});

// ## TODO: Test Permutations

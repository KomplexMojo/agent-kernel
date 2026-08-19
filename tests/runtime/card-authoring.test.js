import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildSummaryFromCardSet,
  calculateCardValue,
  createDesignCard,
  dropPropertyOnCard,
} from "../../packages/runtime/src/commands/card-authoring.js";
import { buildDefaultPriceList } from "../../packages/runtime/src/personas/allocator/default-price-list.js";

test("runtime card authoring owns property-drop semantics", () => {
  const delver = createDesignCard({
    id: "delver_authoring",
    type: "delver",
    affinity: "fire",
    motivations: ["attacking"],
  });

  const affinityResult = dropPropertyOnCard(delver, { group: "affinities", value: "water" });
  assert.equal(affinityResult.ok, true);
  assert.equal(affinityResult.reason, "affinity_added");
  assert.ok(affinityResult.card.affinities.some((entry) => entry.kind === "water"));

  const conflictResult = dropPropertyOnCard(delver, { group: "motivations", value: "defending" });
  assert.equal(conflictResult.ok, false);
  assert.equal(conflictResult.reason, "motivation_conflict");
  assert.equal(conflictResult.conflictsWith, "attacking");
});

test("runtime card authoring builds summaries from authored cards", () => {
  const room = createDesignCard({
    id: "room_authoring",
    type: "room",
    roomSize: "medium",
    affinity: "fire",
    count: 2,
  });
  const warden = createDesignCard({
    id: "warden_authoring",
    type: "warden",
    affinity: "earth",
    motivations: ["defending"],
    count: 1,
  });

  const { summary, cards, spendLedger } = buildSummaryFromCardSet({
    cards: [room, warden],
    budgetTokens: 4000,
  });

  assert.equal(summary.budgetTokens, 4000);
  assert.equal(summary.roomDesign.roomCount, 2);
  assert.equal(cards.length, 2);
  assert.ok(spendLedger);
});

test("ui design-guidance facade re-exports runtime authoring functions", async () => {
  const runtime = await import("../../packages/runtime/src/commands/card-authoring.js");
  const ui = await import("../../packages/ui-web/src/design-guidance.js");

  assert.equal(ui.createDesignCard, runtime.createDesignCard);
  assert.equal(ui.dropPropertyOnCard, runtime.dropPropertyOnCard);
  assert.equal(ui.buildSummaryFromCardSet, runtime.buildSummaryFromCardSet);
});

test("resource card property updates preserve budget ceilings and permanent multipliers", () => {
  const resource = createDesignCard({
    id: "resource_authoring",
    type: "resource",
    affinity: "life",
    resourceVitals: { mana: { delta: 4, regen: 2 } },
    permanent: true,
    budgetCeiling: 100,
  });

  const beforeValue = calculateCardValue(resource);
  const result = dropPropertyOnCard(resource, { group: "affinities", value: "light" });
  const afterValue = calculateCardValue(result.card);

  assert.equal(result.ok, true);
  assert.equal(result.card.permanent, true);
  assert.equal(result.card.budgetCeiling, 100);
  assert.equal(beforeValue.unitTokens, 100);
  assert.equal(afterValue.unitTokens, 100);
  assert.ok(afterValue.lineItems.some((item) => item.id === "resource_mana_delta" && item.unitCostTokens === 40));
});

test("hazard cards keep mana and durability normalization stable through facade imports", async () => {
  const ui = await import("../../packages/ui-web/src/design-guidance.js");
  const hazard = ui.createDesignCard({
    id: "hazard_authoring",
    type: "hazard",
    affinity: "fire",
    expressions: ["draw"],
    mana: { kind: "regen", current: 2, max: 7, regen: 3 },
    durability: { kind: "one-time", amount: 4 },
    tokenHint: 75,
  });

  const runtimeHazard = createDesignCard(hazard);

  assert.deepEqual(runtimeHazard.mana, { kind: "regen", current: 2, max: 7, regen: 3 });
  assert.deepEqual(runtimeHazard.durability, { kind: "one-time", amount: 4 });
  assert.equal(runtimeHazard.expressions[0], "draw");
  assert.equal(calculateCardValue(runtimeHazard).unitTokens, 75);
});

test("empty and duplicate card ids keep summary generation deterministic", () => {
  const explicitDuplicateA = createDesignCard({ id: "duplicate_card", type: "room", roomSize: "small", count: 1 });
  const explicitDuplicateB = createDesignCard({ id: "duplicate_card", type: "warden", affinity: "dark", count: 1 });
  const generated = createDesignCard({ id: "", type: "resource", resourceVitals: { health: { delta: 1, regen: 0 } } });

  const first = buildSummaryFromCardSet({ cards: [explicitDuplicateA, explicitDuplicateB, generated], budgetTokens: 500 });
  const second = buildSummaryFromCardSet({ cards: [explicitDuplicateA, explicitDuplicateB, generated], budgetTokens: 500 });

  assert.match(generated.id, /^G-[A-Z0-9]{6}$/);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.cards.map((card) => card.id), second.cards.map((card) => card.id));
  assert.equal(first.cards.filter((card) => card.id === "duplicate_card").length, 1);
  assert.equal(new Set(first.cards.map((card) => card.id)).size, first.cards.length);
});

test("actor card cost reflects the motivation/affinity vital floor, not the pre-floor authored vitals", () => {
  // An actor authored via `ak_create` without --vitals gets an all-zero mana/stamina
  // pool at authoring time (this is the shape ak_create's own agentAuthoringCommand
  // actually produces — createDesignCard's own interactive-UI defaults are already
  // nonzero and don't reproduce the bug). AM.2b/AM.5 raise that to a real floor (and
  // charge for it) at build time. calculateCardValue must price the floored pool, or
  // an "attacking" delver with no authored mana/stamina reads as free — the Inventory
  // panel showed exactly that (0t).
  // All four vitals zero, not just mana/stamina: health/durability contribute their own
  // (unrelated) nonzero cost once nonzero, which would make a loose ">0" assertion pass
  // even without the floor fix. Zeroing everything makes ">0" only satisfiable by the
  // motivation/affinity floor actually firing.
  const zeroVitals = {
    health: { current: 0, max: 0, regen: 0 },
    mana: { current: 0, max: 0, regen: 0 },
    stamina: { current: 0, max: 0, regen: 0 },
    durability: { current: 0, max: 0, regen: 0 },
  };
  const delver = createDesignCard({
    id: "delver_floor_pricing",
    type: "delver",
    affinity: "fire",
    motivations: ["attacking"],
    vitals: zeroVitals,
  });
  assert.deepEqual(delver.vitals.mana, { current: 0, max: 0, regen: 0 });
  assert.deepEqual(delver.vitals.stamina, { current: 0, max: 0, regen: 0 });

  const priceList = buildDefaultPriceList({ createdAt: "2026-08-19T00:00:00.000Z" });

  assert.ok(
    calculateCardValue(delver, { priceList }).unitTokens > 0,
    "an attacking, fire-affinity delver has a real mana+stamina floor and must not price as free",
  );

  const warden = createDesignCard({
    id: "warden_floor_pricing",
    type: "warden",
    affinity: "dark",
    motivations: ["defending"],
    vitals: zeroVitals,
  });
  assert.ok(
    calculateCardValue(warden, { priceList }).unitTokens > 0,
    "a defending, dark-affinity warden has a real mana floor and must not price as free",
  );

  // Original card object must be untouched — the floor functions mutate their own
  // draft copy, never the caller's card (which may be locked/shared elsewhere).
  assert.deepEqual(delver.vitals.mana, { current: 0, max: 0, regen: 0 });
  assert.deepEqual(delver.vitals.stamina, { current: 0, max: 0, regen: 0 });
});

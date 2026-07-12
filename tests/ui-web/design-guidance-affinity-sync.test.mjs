import assert from "node:assert/strict";
import {
  adjustAffinityStack,
  createDesignCard,
  dropPropertyOnCard,
} from "../../packages/ui-web/src/design-guidance.js";

test("card drop rules accept valid type + affinity + expression sequence", () => {
  const blank = createDesignCard({ type: "warden", affinity: "fire", motivations: ["defending"] });

  const withAffinity = dropPropertyOnCard(blank, { group: "affinities", value: "water" });
  assert.equal(withAffinity.ok, true);
  assert.equal(withAffinity.reason, "affinity_added");
  assert.ok(withAffinity.card.affinities.some((entry) => entry.kind === "water"));

  const withExpression = dropPropertyOnCard(withAffinity.card, { group: "expressions", value: "push" });
  assert.equal(withExpression.ok, true);
  assert.equal(withExpression.reason, "expression_added");
  assert.ok(withExpression.card.expressions.includes("push"));
  const waterEntries = withExpression.card.affinities.filter((entry) => entry.kind === "water");
  assert.ok(waterEntries.some((entry) => entry.expression === "emit"));
  assert.ok(waterEntries.some((entry) => entry.expression === "push"));
  assert.ok(withExpression.card.affinities.some((entry) => entry.kind === "fire" && entry.expression === "emit"));
});

test("room cards carry no affinities — they are generic containers", () => {
  const roomCard = createDesignCard({ type: "room", affinity: "earth", roomSize: "small" });
  assert.deepEqual(roomCard.affinities, [], "rooms must have no affinities");
  assert.deepEqual(roomCard.expressions, [], "rooms must have no expressions");
});

test("room cards have no default affinity stacks — affinity comes from hazards", () => {
  const roomCard = createDesignCard({ type: "room", roomSize: "medium" });
  assert.deepEqual(roomCard.affinities, [], "rooms must not have default affinity stacks");
});

test("card drop rules toggle affinity removal when same affinity is dropped twice", () => {
  const warden = createDesignCard({
    type: "warden",
    affinity: "fire",
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    motivations: ["defending"],
  });

  const addWater = dropPropertyOnCard(warden, { group: "affinities", value: "water" });
  assert.equal(addWater.ok, true);
  assert.ok(addWater.card.affinities.some((entry) => entry.kind === "water"));

  const removeWater = dropPropertyOnCard(addWater.card, { group: "affinities", value: "water" });
  assert.equal(removeWater.ok, true);
  assert.equal(removeWater.reason, "affinity_removed");
  assert.ok(!removeWater.card.affinities.some((entry) => entry.kind === "water"));
});

test("affinity stacks are per affinity-expression combo and zero removes the combo", () => {
  const warden = createDesignCard({
    type: "warden",
    affinity: "fire",
    affinities: [
      { kind: "fire", expression: "push", stacks: 1 },
      { kind: "fire", expression: "pull", stacks: 1 },
      { kind: "water", expression: "emit", stacks: 2 },
    ],
    motivations: ["defending"],
  });

  const boosted = adjustAffinityStack(warden, "water", 2, "emit");
  const removed = adjustAffinityStack(boosted, "fire", -1, "push");

  assert.equal(removed.affinities.find((entry) => entry.kind === "water" && entry.expression === "emit")?.stacks, 4);
  assert.equal(removed.affinities.find((entry) => entry.kind === "fire" && entry.expression === "push"), undefined);
  assert.equal(removed.affinities.find((entry) => entry.kind === "fire" && entry.expression === "pull")?.stacks, 1);
});

test("same affinity supports multiple expression combos", () => {
  const delver = createDesignCard({
    type: "delver",
    affinity: "fire",
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    motivations: ["attacking"],
  });

  const withPull = dropPropertyOnCard(delver, { group: "expressions", value: "pull" });
  const withEmit = dropPropertyOnCard(withPull.card, { group: "expressions", value: "emit" });
  const fireCombos = withEmit.card.affinities.filter((entry) => entry.kind === "fire");

  assert.equal(withEmit.ok, true);
  assert.ok(fireCombos.some((entry) => entry.expression === "push" && entry.stacks === 1));
  assert.ok(fireCombos.some((entry) => entry.expression === "pull" && entry.stacks === 1));
  assert.ok(fireCombos.some((entry) => entry.expression === "emit" && entry.stacks === 1));
});

test("draw expression is valid for delver and warden affinities", () => {
  const delver = createDesignCard({
    type: "delver",
    affinity: "water",
    affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
    motivations: ["attacking"],
  });

  const withDraw = dropPropertyOnCard(delver, { group: "expressions", value: "draw" });
  assert.equal(withDraw.ok, true);
  assert.equal(withDraw.reason, "expression_added");
  const waterCombos = withDraw.card.affinities.filter((entry) => entry.kind === "water");
  assert.ok(waterCombos.some((entry) => entry.expression === "emit" && entry.stacks === 1));
  assert.ok(waterCombos.some((entry) => entry.expression === "draw" && entry.stacks === 1));
});

test("motivation toggles support removing and re-adding motivations", () => {
  const delver = createDesignCard({
    type: "delver",
    affinity: "fire",
    motivations: ["attacking"],
  });

  const removed = dropPropertyOnCard(delver, { group: "motivations", value: "attacking" });
  assert.equal(removed.ok, true);
  assert.equal(removed.reason, "motivation_removed");
  assert.deepEqual(removed.card.motivations, []);

  const added = dropPropertyOnCard(removed.card, { group: "motivations", value: "defending" });
  assert.equal(added.ok, true);
  assert.equal(added.reason, "motivation_added");
  assert.deepEqual(added.card.motivations, ["defending"]);
});

test("motivation toggles block contradictory motivations from the same exclusive group", () => {
  const delver = createDesignCard({
    type: "delver",
    affinity: "fire",
    motivations: ["attacking", "patrolling"],
  });

  const blockedCombat = dropPropertyOnCard(delver, { group: "motivations", value: "defending" });
  assert.equal(blockedCombat.ok, false);
  assert.equal(blockedCombat.reason, "motivation_conflict");
  assert.equal(blockedCombat.conflictsWith, "attacking");

  const blockedMobility = dropPropertyOnCard(delver, { group: "motivations", value: "stationary" });
  assert.equal(blockedMobility.ok, false);
  assert.equal(blockedMobility.reason, "motivation_conflict");
  assert.equal(blockedMobility.conflictsWith, "patrolling");
});

test("changing card type replaces incompatible card payload", () => {
  const warden = createDesignCard({
    type: "warden",
    affinity: "wind",
    motivations: ["patrolling"],
    expressions: ["pull"],
  });

  const switched = dropPropertyOnCard(warden, { group: "type", value: "room" });
  assert.equal(switched.ok, true);
  assert.equal(switched.card.type, "room");
  assert.equal(switched.card.source, "room");
  assert.deepEqual(switched.card.motivations, []);
  assert.equal(switched.card.vitals, undefined);
  assert.ok(["small", "medium", "large"].includes(switched.card.roomSize));
});

test("design-guidance.js loads as an ES module without import-link errors (BUG-1 regression guard)", async () => {
  // BUG-1 regression: importing a now-removed constant from domain-constants.js
  // produced a hard ESM link error that prevented main.js from executing.
  // The import block was repaired in M2 by defining ROOM_AFFINITY_STACK_COST_FACTOR
  // locally. This test fails fast if anyone re-introduces a missing import binding.
  const mod = await import("../../packages/ui-web/src/design-guidance.js");
  assert.equal(typeof mod.createDesignCard, "function");
  assert.equal(typeof mod.dropPropertyOnCard, "function");
  assert.equal(typeof mod.adjustAffinityStack, "function");
});

test("room cards with all three sizes produce empty affinities and expressions", () => {
  for (const size of ["small", "medium", "large"]) {
    const roomCard = createDesignCard({ type: "room", roomSize: size });
    assert.deepEqual(roomCard.affinities, [], `room size ${size} must have no affinities`);
    assert.deepEqual(roomCard.expressions, [], `room size ${size} must have no expressions`);
  }
});

test("dropPropertyOnCard with unknown group key returns ok=false without throwing", () => {
  const card = createDesignCard({ type: "warden", affinity: "fire", motivations: ["defending"] });
  const result = dropPropertyOnCard(card, { group: "colors", value: "red" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported_group");
});

test("adjustAffinityStack with delta 0 leaves entry stacks unchanged", () => {
  const card = createDesignCard({
    type: "warden",
    affinity: "fire",
    affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
    motivations: ["defending"],
  });
  const adjusted = adjustAffinityStack(card, "fire", 0, "push");
  const entry = adjusted.affinities.find((e) => e.kind === "fire" && e.expression === "push");
  assert.equal(entry.stacks, 2);
  assert.equal(adjusted.affinities.length, 1);
});

test("dropping an affinity on a room card leaves affinities empty (room invariant enforced)", () => {
  const room = createDesignCard({ type: "room", roomSize: "medium" });
  const result = dropPropertyOnCard(room, { group: "affinities", value: "fire" });
  assert.deepEqual(result.card.affinities, [], "room affinities must stay empty after affinity drop");
  assert.equal(typeof result.reason, "string");
});

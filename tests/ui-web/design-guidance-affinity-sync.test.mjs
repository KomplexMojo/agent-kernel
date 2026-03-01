import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustAffinityStack,
  createDesignCard,
  dropPropertyOnCard,
} from "../../packages/ui-web/src/design-guidance.js";

test("card drop rules accept valid type + affinity + expression sequence", () => {
  const blank = createDesignCard({ type: "defender", affinity: "fire", motivations: ["defending"] });

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

test("card drop rules support expression binding for room card affinities", () => {
  const roomCard = createDesignCard({ type: "room", affinity: "earth", roomSize: "small" });
  const result = dropPropertyOnCard(roomCard, { group: "expressions", value: "pull" });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "expression_added");
  const earthEntries = result.card.affinities.filter((entry) => entry.kind === "earth");
  assert.ok(earthEntries.some((entry) => entry.expression === "emit"));
  assert.ok(earthEntries.some((entry) => entry.expression === "pull"));
});

test("room cards default to dark emit with two stacks", () => {
  const roomCard = createDesignCard({ type: "room", roomSize: "medium" });
  assert.equal(roomCard.affinity, "dark");
  const darkEmit = roomCard.affinities.find((entry) => entry.kind === "dark" && entry.expression === "emit");
  assert.ok(darkEmit);
  assert.equal(darkEmit.stacks, 2);
});

test("card drop rules toggle affinity removal when same affinity is dropped twice", () => {
  const defender = createDesignCard({
    type: "defender",
    affinity: "fire",
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    motivations: ["defending"],
  });

  const addWater = dropPropertyOnCard(defender, { group: "affinities", value: "water" });
  assert.equal(addWater.ok, true);
  assert.ok(addWater.card.affinities.some((entry) => entry.kind === "water"));

  const removeWater = dropPropertyOnCard(addWater.card, { group: "affinities", value: "water" });
  assert.equal(removeWater.ok, true);
  assert.equal(removeWater.reason, "affinity_removed");
  assert.ok(!removeWater.card.affinities.some((entry) => entry.kind === "water"));
});

test("affinity stacks are per affinity-expression combo and zero removes the combo", () => {
  const defender = createDesignCard({
    type: "defender",
    affinity: "fire",
    affinities: [
      { kind: "fire", expression: "push", stacks: 1 },
      { kind: "fire", expression: "pull", stacks: 1 },
      { kind: "water", expression: "emit", stacks: 2 },
    ],
    motivations: ["defending"],
  });

  const boosted = adjustAffinityStack(defender, "water", 2, "emit");
  const removed = adjustAffinityStack(boosted, "fire", -1, "push");

  assert.equal(removed.affinities.find((entry) => entry.kind === "water" && entry.expression === "emit")?.stacks, 4);
  assert.equal(removed.affinities.find((entry) => entry.kind === "fire" && entry.expression === "push"), undefined);
  assert.equal(removed.affinities.find((entry) => entry.kind === "fire" && entry.expression === "pull")?.stacks, 1);
});

test("same affinity supports multiple expression combos", () => {
  const attacker = createDesignCard({
    type: "attacker",
    affinity: "fire",
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    motivations: ["attacking"],
  });

  const withPull = dropPropertyOnCard(attacker, { group: "expressions", value: "pull" });
  const withEmit = dropPropertyOnCard(withPull.card, { group: "expressions", value: "emit" });
  const fireCombos = withEmit.card.affinities.filter((entry) => entry.kind === "fire");

  assert.equal(withEmit.ok, true);
  assert.ok(fireCombos.some((entry) => entry.expression === "push" && entry.stacks === 1));
  assert.ok(fireCombos.some((entry) => entry.expression === "pull" && entry.stacks === 1));
  assert.ok(fireCombos.some((entry) => entry.expression === "emit" && entry.stacks === 1));
});

test("motivation toggles support removing and re-adding motivations", () => {
  const attacker = createDesignCard({
    type: "attacker",
    affinity: "fire",
    motivations: ["attacking"],
  });

  const removed = dropPropertyOnCard(attacker, { group: "motivations", value: "attacking" });
  assert.equal(removed.ok, true);
  assert.equal(removed.reason, "motivation_removed");
  assert.deepEqual(removed.card.motivations, []);

  const added = dropPropertyOnCard(removed.card, { group: "motivations", value: "defending" });
  assert.equal(added.ok, true);
  assert.equal(added.reason, "motivation_added");
  assert.deepEqual(added.card.motivations, ["defending"]);
});

test("changing card type replaces incompatible card payload", () => {
  const defender = createDesignCard({
    type: "defender",
    affinity: "wind",
    motivations: ["patrolling"],
    expressions: ["pull"],
  });

  const switched = dropPropertyOnCard(defender, { group: "type", value: "room" });
  assert.equal(switched.ok, true);
  assert.equal(switched.card.type, "room");
  assert.equal(switched.card.source, "room");
  assert.deepEqual(switched.card.motivations, []);
  assert.equal(switched.card.vitals, undefined);
  assert.ok(["small", "medium", "large"].includes(switched.card.roomSize));
});

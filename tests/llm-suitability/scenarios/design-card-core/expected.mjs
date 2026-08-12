import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildSummaryFromCardSet,
  createDesignCard,
  dropPropertyOnCard,
} from "../../../../packages/ui-web/src/design-guidance.js";

test("createDesignCard normalizes room, actor, and resource cards", () => {
  const room = createDesignCard({ type: "room", affinity: "water", roomSize: "large", motivations: ["defending"] });
  assert.equal(room.type, "room");
  assert.equal(room.roomSize, "large");
  assert.deepEqual(room.motivations, []);
  assert.deepEqual(room.affinities, []);
  assert.equal(room.vitals, undefined);

  const delver = createDesignCard({ type: "delver", affinity: "fire", motivations: ["attacking"] });
  assert.equal(delver.type, "delver");
  assert.ok(delver.vitals.health.max > 0);
  assert.ok(delver.motivations.includes("attacking"));
  assert.ok(delver.affinities.some((entry) => entry.kind === "fire"));

  const resource = createDesignCard({ type: "resource", tier: "level", stat: "vitalMax", delta: 2, budgetCeiling: 50 });
  assert.equal(resource.type, "resource");
  assert.equal(resource.tier, "level");
  assert.equal(resource.stat, "vitalMax");
  assert.equal(resource.delta, 2);
  assert.equal(resource.budgetCeiling, 50);
});

test("dropPropertyOnCard applies affinity and reports motivation conflict", () => {
  const delver = createDesignCard({ type: "delver", motivations: ["attacking"] });
  const affinityResult = dropPropertyOnCard(delver, { group: "affinities", value: "water" });
  assert.equal(affinityResult.ok, true);
  assert.ok(affinityResult.card.affinities.some((entry) => entry.kind === "water"));

  const conflict = dropPropertyOnCard(delver, { group: "motivations", value: "defending" });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, "motivation_conflict");
});

test("room affinity fields do not affect room card cost", () => {
  const room = createDesignCard({
    id: "room_affinity",
    type: "room",
    affinity: "earth",
    roomSize: "medium",
    affinities: [{ kind: "earth", expression: "push", stacks: 1 }],
  });
  const stackedRoom = createDesignCard({
    ...room,
    affinities: [{ kind: "earth", expression: "push", stacks: 4 }],
  });

  const base = buildSummaryFromCardSet({ cards: [room], budgetTokens: 4000 });
  const updated = buildSummaryFromCardSet({ cards: [stackedRoom], budgetTokens: 4000 });

  assert.equal(base.summary.spendLedger.spentTokens, updated.summary.spendLedger.spentTokens);
});

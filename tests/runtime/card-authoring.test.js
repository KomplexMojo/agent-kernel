import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildSummaryFromCardSet,
  createDesignCard,
  dropPropertyOnCard,
} from "../../packages/runtime/src/commands/card-authoring.js";

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

// ## TODO: Test Permutations
// - resource card property updates should preserve budget ceilings and permanent multipliers
// - hazard cards should keep mana and durability normalization stable through facade imports
// - empty and duplicate card ids should remain deterministic after controller-level id assignment

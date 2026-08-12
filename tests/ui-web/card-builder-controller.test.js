import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildSummaryFromCardSet,
  createDesignCard,
} from "../../packages/ui-web/src/design-guidance.js";
// M2 target module — does not exist yet. These tests are the implementation contract.
import {
  createCardBuilderController,
  buildPropertyCatalog,
} from "../../packages/ui-web/src/card-builder-controller.js";

function activeCardId(controller) {
  return controller.getActiveCard().id;
}

test("controller projects the existing buildPropertyCatalog options", () => {
  const controller = createCardBuilderController();
  const catalog = controller.getCatalog();
  const expected = buildPropertyCatalog();

  assert.deepEqual(
    catalog.type.map((entry) => entry.value),
    expected.type.map((entry) => entry.value),
  );
  assert.deepEqual(
    catalog.affinities.map((group) => group.kinds),
    expected.affinities.map((group) => group.kinds),
  );
  assert.deepEqual(
    catalog.expressions.map((group) => group.kinds),
    expected.expressions.map((group) => group.kinds),
  );
  assert.deepEqual(
    catalog.motivations.map((group) => group.kinds),
    expected.motivations.map((group) => group.kinds),
  );
});

test("controller starts with a blank untyped active card and no shelved cards", () => {
  const controller = createCardBuilderController();
  const active = controller.getActiveCard();
  assert.equal(active.type, "");
  assert.match(active.id, /^C-[A-Z0-9]{6}$/);
  assert.deepEqual(controller.getCards(), []);
});

test("applyPropertyDrop routes through the existing card-builder actions", () => {
  const controller = createCardBuilderController();
  const blank = activeCardId(controller);

  const typed = controller.applyPropertyDrop(blank, { group: "type", value: "delver" });
  assert.deepEqual(typed, { ok: true });
  const delver = controller.getActiveCard();
  assert.equal(delver.type, "delver");
  assert.match(delver.id, /^A-[A-Z0-9]{6}$/);
  assert.equal(delver.affinity, "light");

  controller.applyPropertyDrop(delver.id, { group: "affinities", value: "water" });
  controller.applyPropertyDrop(delver.id, { group: "expressions", value: "emit", affinityKind: "water" });
  const updated = controller.getActiveCard();
  assert.ok(updated.affinities.some((entry) => entry.kind === "water"));
});

test("count, vital, and affinity-stack adjustments recompute receipt and budget", () => {
  const controller = createCardBuilderController();
  const blank = activeCardId(controller);
  controller.applyPropertyDrop(blank, { group: "type", value: "delver" });
  const delver = controller.getActiveCard();
  const baseTotal = delver.cardValue.totalTokens;

  controller.adjustCardCount(delver.id, 1);
  assert.equal(controller.getActiveCard().count, delver.count + 1);

  const healthBefore = controller.getActiveCard().vitals.health.max;
  controller.adjustVital(delver.id, "health", "max", 10);
  const afterVital = controller.getActiveCard();
  assert.equal(afterVital.vitals.health.max, healthBefore + 10);
  assert.ok(afterVital.cardValue.totalTokens > baseTotal);

  controller.applyPropertyDrop(delver.id, { group: "affinities", value: "water" });
  controller.adjustAffinityStack(delver.id, "water", 2, "emit");
  const stacked = controller.getActiveCard();
  assert.ok(
    stacked.tokenReceipt.affinities.some((entry) => entry.includes("water:")),
  );
  assert.equal(
    stacked.tokenReceipt.lineItems.reduce((sum, item) => sum + (item.totalTokens || 0), 0),
    stacked.tokenReceipt.tokenTotals.total,
  );
});

test("invalid property drop rejects without mutating cards and preserves a status message", () => {
  const controller = createCardBuilderController();
  const blank = activeCardId(controller);
  const before = controller.getActiveCard();

  // affinity drop on an untyped card is blocked by the existing validation path.
  const result = controller.applyPropertyDrop(blank, { group: "affinities", value: "fire" });
  assert.equal(result.ok, true); // matches DOM builder: action runs, drop blocked internally
  const after = controller.getActiveCard();
  assert.equal(after.type, before.type);
  assert.deepEqual(after.affinities, before.affinities);

  const status = controller.getStatus();
  assert.equal(status.level, "error");
  assert.match(status.message, /missing_type/i);
});

test("unsupported group is rejected and leaves the active card untouched", () => {
  const controller = createCardBuilderController();
  const blank = activeCardId(controller);
  controller.applyPropertyDrop(blank, { group: "type", value: "delver" });
  const delver = controller.getActiveCard();

  const result = controller.applyPropertyDrop(delver.id, { group: "not_a_group", value: "x" });
  assert.equal(result.ok, true);
  assert.deepEqual(controller.getActiveCard().affinities, delver.affinities);
  assert.equal(controller.getStatus().level, "error");
});

test("setCards loads an existing card set and publishes a summary", () => {
  const controller = createCardBuilderController();
  const applied = controller.setCards([
    createDesignCard({ id: "room_build", type: "room", roomSize: "medium", affinity: "fire", count: 2 }),
    createDesignCard({ id: "atk_build", type: "delver", affinity: "fire", motivations: ["attacking"], count: 1 }),
    createDesignCard({ id: "def_build", type: "warden", affinity: "earth", motivations: ["defending"], count: 1 }),
  ]);
  assert.equal(applied, true);
  const cards = controller.getCards();
  assert.equal(cards.length, 3);
  assert.ok(controller.getSummary());
  assert.ok(controller.getSpendLedger());
});

test("controller summary matches the standalone buildSummaryFromCardSet output", () => {
  const cards = [
    createDesignCard({ id: "room_x", type: "room", roomSize: "medium", affinity: "fire", count: 2 }),
    createDesignCard({ id: "atk_x", type: "delver", affinity: "fire", motivations: ["attacking"], count: 1 }),
  ];
  const controller = createCardBuilderController();
  controller.setCards(cards);
  const { summary: expectedSummary } = buildSummaryFromCardSet({
    cards,
    budgetTokens: controller.getState().budgetTokens,
    budgetSplitPercent: controller.getState().budgetSplitPercent,
  });

  const controllerSummary = controller.getSummary();
  assert.equal(controllerSummary.roomDesign.roomCount, expectedSummary.roomDesign.roomCount);
  assert.equal(controllerSummary.budgetTokens, expectedSummary.budgetTokens);
});

test("loadBuildSpec hydrates the controller from an agent-authored build spec and publishes spec text", async () => {
  const controller = createCardBuilderController();
  const result = await controller.loadBuildSpec({
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "build_spec_controller",
      runId: "run_controller",
      createdAt: "2026-04-08T00:00:00.000Z",
      source: "cli-agent",
    },
    intent: { goal: "Load authored cards", hints: { budgetTokens: 5000 } },
    plan: {
      hints: {
        cardSet: [
          { id: "warden_alpha", type: "warden", count: 1, affinity: "earth", motivations: ["defending"] },
        ],
      },
    },
    configurator: {
      inputs: {
        cardSet: [
          { id: "room_alpha", type: "room", count: 1, affinity: "fire", roomSize: "medium" },
        ],
      },
    },
  });

  assert.equal(result.ok, true);
  const cards = controller.getCards();
  assert.equal(cards.length, 2);
  assert.ok(cards.some((card) => card.type === "room"));
  assert.ok(cards.some((card) => card.type === "warden"));
  const specText = await controller.publishSpecText();
  assert.equal(specText.ok, true);
  assert.equal(typeof specText.specText, "string");
  assert.ok(specText.specText.length > 0);
});

test("unknown catalog affinity rejects without mutating the typed active card", () => {
  const controller = createCardBuilderController();
  controller.applyPropertyDrop(activeCardId(controller), { group: "type", value: "delver" });
  const before = controller.getActiveCard();

  const result = controller.applyPropertyDrop(before.id, { group: "affinities", value: "plasma" });

  assert.equal(result.ok, true);
  assert.deepEqual(controller.getActiveCard().affinities, before.affinities);
  assert.equal(controller.getStatus().level, "error");
  assert.match(controller.getStatus().message, /invalid_affinity/i);
});

test("expression drops honor affinityKind and targetAffinity payload variants", () => {
  for (const targetKey of ["affinityKind", "targetAffinity"]) {
    const controller = createCardBuilderController();
    controller.applyPropertyDrop(activeCardId(controller), { group: "type", value: "delver" });
    const delver = controller.getActiveCard();
    controller.applyPropertyDrop(delver.id, { group: "affinities", value: "water" });
    const multiAffinity = controller.getActiveCard();

    controller.applyPropertyDrop(multiAffinity.id, {
      group: "expressions",
      value: "draw",
      [targetKey]: "water",
    });

    const updated = controller.getActiveCard();
    assert.ok(
      updated.affinities.some((entry) => entry.kind === "water" && entry.expression === "draw"),
      `${targetKey} should target water`,
    );
  }
});

test("motivation conflict drop preserves motivations and surfaces conflict status", () => {
  const controller = createCardBuilderController();
  controller.applyPropertyDrop(activeCardId(controller), { group: "type", value: "delver" });
  const delver = controller.getActiveCard();
  assert.ok(delver.motivations.includes("attacking"));

  const result = controller.applyPropertyDrop(delver.id, { group: "motivations", value: "defending" });

  assert.equal(result.ok, true);
  assert.deepEqual(controller.getActiveCard().motivations, delver.motivations);
  assert.equal(controller.getStatus().level, "error");
  assert.match(controller.getStatus().message, /conflicts/i);
});

test("setCards with an empty array clears shelved cards and resets the active editor", () => {
  const controller = createCardBuilderController();
  assert.equal(controller.setCards([
    createDesignCard({ id: "room_clear", type: "room", roomSize: "small", affinity: "fire" }),
  ]), true);

  assert.equal(controller.setCards([]), true);

  assert.deepEqual(controller.getCards(), []);
  assert.equal(controller.getActiveCard().type, "");
  assert.match(controller.getActiveCard().id, /^C-[A-Z0-9]{6}$/);
});

test("setCards with duplicate raw ids keeps a single shelved entry", () => {
  const controller = createCardBuilderController();

  const applied = controller.setCards([
    createDesignCard({ id: "duplicate_card", type: "room", roomSize: "small", affinity: "fire" }),
    createDesignCard({ id: "duplicate_card", type: "room", roomSize: "large", affinity: "water" }),
  ]);

  assert.equal(applied, true);
  assert.equal(controller.getCards().length, 1);
  assert.equal(controller.getCards()[0].type, "room");
});

test("over-budget setCards rejects and reports the allocation violation", () => {
  const controller = createCardBuilderController();
  const before = controller.getCards();

  const applied = controller.setCards([
    createDesignCard({ id: "atk_over_budget", type: "delver", affinity: "fire", tokenHint: 5000, count: 1 }),
  ]);

  assert.equal(applied, false);
  assert.deepEqual(controller.getCards(), before);
  assert.equal(controller.getStatus().level, "error");
  assert.match(controller.getStatus().message, /allocation exceeded|budget/i);
});

test("loadBuildSpec with no editable card set returns missing_card_set", async () => {
  const controller = createCardBuilderController();

  const result = await controller.loadBuildSpec({
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "build_spec_empty",
      runId: "run_empty",
      createdAt: "2026-04-08T00:00:00.000Z",
      source: "cli-agent",
    },
    intent: { goal: "No editable cards", hints: { budgetTokens: 2500 } },
    plan: { hints: {} },
    configurator: { inputs: {} },
  });

  assert.deepEqual(result, { ok: false, reason: "missing_card_set" });
});

test("controller catalog chip values remain within buildPropertyCatalog", () => {
  const controller = createCardBuilderController();
  const catalog = controller.getCatalog();
  const expected = buildPropertyCatalog();

  for (const groupName of ["affinities", "expressions", "motivations"]) {
    const expectedValues = new Set(expected[groupName].flatMap((group) => group.options.map((option) => option.value)));
    const actualValues = catalog[groupName].flatMap((group) => group.options.map((option) => option.value));
    actualValues.forEach((value) => {
      assert.ok(expectedValues.has(value), `${groupName} value ${value} must come from buildPropertyCatalog`);
    });
  }
});

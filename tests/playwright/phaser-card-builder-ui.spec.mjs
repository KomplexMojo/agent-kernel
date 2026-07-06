/**
 * Card builder Phaser UI — functional layout and interaction coverage.
 *
 * These tests verify that the Phaser renderer presents a real card builder UI
 * matching the DOM design view's three-panel layout:
 *
 *   PALETTE (left)   — property chips grouped by type/affinities/expressions/
 *                       motivations; chips are disabled when prerequisites
 *                       (type not set, no affinity set, etc.) are not met.
 *   EDITOR (center)  — active card state: ID, type, cost, applied properties,
 *                       room-size selector for room cards, and a Shelve button.
 *   SHELF (right)    — shelved cards grouped by type with per-group budget
 *                       equations (allocated − [used] = remaining).
 *
 * All chips in the registry carry a `zone` field ("palette" | "editor" | "shelf").
 * The surface exposes `getEditorChips()` and `getBudgetInfo()` in addition to
 * the existing `getChipPositions()` and `getCardPositions()`.
 *
 * UI-surface coverage only — no live external services.
 */
import { test, expect } from "@playwright/test";
import { startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

let serveProcess = null;
let baseUrl = null;

test.beforeAll(async () => {
  const result = await startServeUi();
  serveProcess = result.proc;
  baseUrl = result.url;
});

test.afterAll(async () => {
  if (serveProcess) await stopProcess(serveProcess);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForSurface(page) {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });
}

async function waitForChips(page) {
  await page.waitForFunction(
    () => (window.__ak_phaserFrame?.getCardBuilderSurface?.()?.getChipPositions?.()?.length ?? 0) > 0,
    { timeout: 15_000 },
  );
}

async function canvasClick(page, chip) {
  const box = await page.locator(".card-builder-phaser-stage canvas").first().boundingBox();
  await page.mouse.click(box.x + chip.x + chip.width / 2, box.y + chip.y + chip.height / 2);
}

// ---------------------------------------------------------------------------
// Zone fields — every chip position must carry a zone
// ---------------------------------------------------------------------------

test("palette chips carry zone: 'palette'", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  const chips = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getChipPositions(),
  );

  expect(chips.length).toBeGreaterThan(0);
  for (const chip of chips) {
    expect(chip).toHaveProperty("zone", "palette");
  }
});

test("shelf card positions carry zone: 'shelf' and typeGroup matching the card type", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  // Build and shelve a room card via JS API.
  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const id = surface.getController().getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "room" } });
    surface.emitIntent({ kind: "move_card_between_groups", group: "room" });
    await surface.render();
  });

  const positions = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getCardPositions(),
  );

  expect(positions.length).toBe(1);
  expect(positions[0]).toHaveProperty("zone", "shelf");
  expect(positions[0]).toHaveProperty("typeGroup", "room");
});

// ---------------------------------------------------------------------------
// Editor panel API
// ---------------------------------------------------------------------------

test("getEditorChips() is exposed on the card builder surface", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  const chips = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getEditorChips?.(),
  );

  expect(Array.isArray(chips)).toBe(true);
});

test("initial render includes a card_header chip in the editor zone", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  const header = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getEditorChips?.()
      ?.find((c) => c.role === "card_header"),
  );

  expect(header).toBeTruthy();
  expect(header.zone).toBe("editor");
});

test("after setting type, the editor zone includes a shelve_button chip", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const id = surface.getController().getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "delver" } });
    await surface.render();
  });

  const shelveBtn = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getEditorChips?.()
      ?.find((c) => c.role === "shelve_button"),
  );

  expect(shelveBtn).toBeTruthy();
  expect(shelveBtn.zone).toBe("editor");
});

test("clicking the shelve_button chip in the canvas moves the card to the shelf", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const id = surface.getController().getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "room" } });
    await surface.render();
  });

  const shelveBtn = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getEditorChips?.()
      ?.find((c) => c.role === "shelve_button"),
  );
  expect(shelveBtn).toBeTruthy();

  await canvasClick(page, shelveBtn);

  await page.waitForFunction(
    () => window.__ak_phaserFrame.getCardBuilderSurface().getController().getCards().length === 1,
    { timeout: 5_000 },
  );

  const cardCount = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getController().getCards().length,
  );
  expect(cardCount).toBe(1);

  // Active card resets to blank after shelve.
  const activeType = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getController().getActiveCard().type,
  );
  expect(activeType).toBe("");
});

test("editor zone shows applied affinity as a chip after affinity drop", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const ctrl = surface.getController();
    const id = ctrl.getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "delver" } });
    // After type drop card id changes; fetch fresh.
    const newId = ctrl.getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: newId, property: { group: "affinities", value: "fire" } });
    await surface.render();
  });

  const editorAffinityChip = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getEditorChips?.()
      ?.find((c) => c.zone === "editor" && c.group === "affinities"),
  );

  expect(editorAffinityChip).toBeTruthy();
  expect(editorAffinityChip.value).toBe("fire");
});

test("editor zone shows room_size chip for a room-type active card", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const id = surface.getController().getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "room" } });
    await surface.render();
  });

  const roomSizeChip = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getEditorChips?.()
      ?.find((c) => c.role === "room_size"),
  );

  expect(roomSizeChip).toBeTruthy();
  expect(roomSizeChip.zone).toBe("editor");
  // Default size is medium.
  expect(roomSizeChip.label.toLowerCase()).toContain("medium");
});

// ---------------------------------------------------------------------------
// Disabled states in the palette
// ---------------------------------------------------------------------------

test("affinity chips in the palette are disabled before a type is set", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  const affinityChips = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getChipPositions()
      .filter((c) => c.group === "affinities"),
  );

  expect(affinityChips.length).toBeGreaterThan(0);
  for (const chip of affinityChips) {
    expect(chip.enabled).toBe(false);
  }
});

test("affinity chips become enabled after a type is set", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const id = surface.getController().getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "delver" } });
    await surface.render();
  });

  const affinityChips = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getChipPositions()
      .filter((c) => c.group === "affinities"),
  );

  expect(affinityChips.length).toBeGreaterThan(0);
  for (const chip of affinityChips) {
    expect(chip.enabled).toBe(true);
  }
});

test("motivation chips are disabled for room-type active card", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const id = surface.getController().getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "room" } });
    await surface.render();
  });

  const motivationChips = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getChipPositions()
      .filter((c) => c.group === "motivations"),
  );

  expect(motivationChips.length).toBeGreaterThan(0);
  for (const chip of motivationChips) {
    expect(chip.enabled).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// Budget bar
// ---------------------------------------------------------------------------

test("getBudgetInfo() is exposed on the card builder surface and returns budget totals", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  const budget = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getBudgetInfo?.(),
  );

  expect(budget).not.toBeNull();
  expect(budget).toHaveProperty("totalTokens");
  expect(budget).toHaveProperty("spentTokens");
  expect(budget).toHaveProperty("remainingTokens");
  expect(budget.totalTokens).toBeGreaterThan(0);
  expect(budget.remainingTokens).toBe(budget.totalTokens - budget.spentTokens);
});

test("budget spent increases after shelving a typed card", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  const before = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getBudgetInfo?.()?.spentTokens ?? 0,
  );

  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const ctrl = surface.getController();
    const id = ctrl.getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "delver" } });
    surface.emitIntent({ kind: "move_card_between_groups", group: "delver" });
    await surface.render();
  });

  const after = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getBudgetInfo?.()?.spentTokens ?? 0,
  );

  expect(after).toBeGreaterThan(before);
});

// ---------------------------------------------------------------------------
// Shelf budget per group
// ---------------------------------------------------------------------------

test("shelf shows per-type group budget info accessible via getShelfBudget()", async ({ page }) => {
  await waitForSurface(page);
  await waitForChips(page);

  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const ctrl = surface.getController();
    const id = ctrl.getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "room" } });
    surface.emitIntent({ kind: "move_card_between_groups", group: "room" });
    await surface.render();
  });

  const shelfBudget = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getShelfBudget?.(),
  );

  expect(shelfBudget).not.toBeNull();
  expect(shelfBudget).toHaveProperty("room");
  expect(shelfBudget.room).toHaveProperty("allocatedTokens");
  expect(shelfBudget.room).toHaveProperty("usedTokens");
  expect(shelfBudget.room).toHaveProperty("remainingTokens");
});

test.skip("card builder expression chips are enabled only after affinity is applied", async () => {});
test.skip("card builder clicking applied affinity removes it from editor card", async () => {});
test.skip("card builder room size chip cycles small medium large on repeated click", async () => {});
test.skip("card builder card_header label updates after type drop with type and cost", async () => {});
test.skip("card builder shelf group headers appear when group is empty", async () => {});
test.skip("card builder multiple shelved cards appear in correct groups", async () => {});
test.skip("card builder getBudgetInfo allocated object has per-type breakdown", async () => {});

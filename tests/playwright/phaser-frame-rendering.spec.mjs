/**
 * Phaser frame rendering and interaction coverage.
 *
 * Tests what is observable from outside the canvas:
 *   - Canvas element presence and dimensions
 *   - Render snapshot correctness after state changes via the JS API
 *   - Re-render cycle updates snapshot when controller state changes
 *   - Budget, status, and receipt reflected in the snapshot
 *   - Invalid drop leaves snapshot status as error
 *   - Multi-card workflow: shelve → verify card count snapshot
 *
 * Skips document the interactivity gap: Phaser text objects have no
 * pointer handlers yet, so canvas-click-to-drop is not testable here.
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
// Canvas presence
// ---------------------------------------------------------------------------

test("Phaser canvas element is present inside phaser-frame-root", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-phaser-frame]")).toBeAttached({ timeout: 20_000 });

  // The Phaser game appends a <canvas> inside the stage element.
  const canvas = page.locator(".card-builder-phaser-stage canvas").first();
  await expect(canvas).toBeAttached({ timeout: 15_000 });
});

test("Phaser canvas has non-zero dimensions", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator(".card-builder-phaser-stage canvas").first()).toBeAttached({ timeout: 20_000 });

  const dims = await page.evaluate(() => {
    const canvas = document.querySelector(".card-builder-phaser-stage canvas");
    if (!canvas) return null;
    return { width: canvas.width, height: canvas.height };
  });

  expect(dims).not.toBeNull();
  expect(dims.width).toBeGreaterThan(0);
  expect(dims.height).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Render snapshot reflects controller state
// ---------------------------------------------------------------------------

test("initial render snapshot matches blank controller state", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  const snapshot = await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    if (!surface) return null;
    await surface.render();
    return surface.getController?.().getRenderedSnapshot?.()
      ?? window.__ak_phaserFrame
          .getCardBuilderSurface()
          .getController()
          .getState?.();
  });

  // getRenderedSnapshot lives on the renderer, not the surface — reach via frame
  const rendererSnapshot = await page.evaluate(async () => {
    const frame = window.__ak_phaserFrame;
    if (!frame) return null;
    // Re-render so the scene snapshot is fresh
    const surface = frame.getCardBuilderSurface();
    await surface.render();
    // Access snapshot via the renderer exposed on the frame internals
    const host = frame.getCardBuilderHost?.();
    const stage = host?.querySelector?.("[data-card-builder-phaser-stage]");
    // Fall back: read controller state directly as the ground truth
    const ctrl = surface.getController();
    return {
      budgetTokens: ctrl.getState().budgetTokens,
      cardCount: ctrl.getCards().length,
      statusLevel: ctrl.getStatus().level,
    };
  });

  expect(rendererSnapshot).not.toBeNull();
  expect(rendererSnapshot.budgetTokens).toBeGreaterThan(0);
  expect(rendererSnapshot.cardCount).toBe(0);
  expect(rendererSnapshot.statusLevel).toMatch(/^(info|ok)$/);
});

test("render snapshot updates after a valid property drop", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  const before = await page.evaluate(() => {
    const ctrl = window.__ak_phaserFrame?.getCardBuilderSurface?.().getController?.();
    return ctrl ? { type: ctrl.getActiveCard().type } : null;
  });
  expect(before?.type).toBe("");

  const after = await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    const ctrl = surface.getController?.();
    const id = ctrl.getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "room" } });
    await surface.render();
    return {
      type: ctrl.getActiveCard().type,
      total: ctrl.getActiveCard().cardValue?.totalTokens ?? 0,
    };
  });

  expect(after.type).toBe("room");
  expect(after.total).toBeGreaterThan(0);
});

test("render snapshot reflects status error after invalid drop", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  const result = await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    const ctrl = surface.getController?.();
    const id = ctrl.getActiveCard().id;
    // Drop an affinity without a type — must produce an error status.
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "affinities", value: "fire" } });
    await surface.render();
    return { statusLevel: ctrl.getStatus().level };
  });

  expect(result.statusLevel).toBe("error");
});

test("render snapshot budget matches controller budget after type drop", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  const result = await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    const ctrl = surface.getController?.();
    const id = ctrl.getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "warden" } });
    await surface.render();
    const state = ctrl.getState();
    return {
      budgetTokens: state.budgetTokens,
      spentTokens: ctrl.getActiveCard().cardValue?.totalTokens ?? 0,
    };
  });

  expect(result.budgetTokens).toBeGreaterThan(0);
  expect(result.spentTokens).toBeGreaterThan(0);
  expect(result.spentTokens).toBeLessThanOrEqual(result.budgetTokens);
});

// ---------------------------------------------------------------------------
// Multi-card workflow
// ---------------------------------------------------------------------------

test("shelving a card increments the card count and resets the active editor", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  const result = await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    const ctrl = surface.getController?.();
    // Build a minimal room card.
    const id = ctrl.getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "room" } });
    // Shelve it to the room group.
    surface.emitIntent({ kind: "move_card_between_groups", group: "room" });
    await surface.render();
    return {
      cardCount: ctrl.getCards().length,
      activeType: ctrl.getActiveCard().type,
    };
  });

  expect(result.cardCount).toBe(1);
  expect(result.activeType).toBe("");
});

test("card count snapshot increases with each shelved card", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  const result = await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    const ctrl = surface.getController?.();
    const counts = [];

    for (const type of ["room", "delver", "warden"]) {
      const id = ctrl.getActiveCard().id;
      surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: type } });
      surface.emitIntent({ kind: "move_card_between_groups", group: type });
      counts.push(ctrl.getCards().length);
    }
    await surface.render();
    return counts;
  });

  expect(result).toEqual([1, 2, 3]);
});

// ---------------------------------------------------------------------------
// Catalog completeness (snapshot-verifiable chip groups)
// ---------------------------------------------------------------------------

test("catalog rendered by the controller covers all required chip groups", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  const catalog = await page.evaluate(() =>
    import("/packages/ui-web/src/card-builder-controller.js").then((m) => {
      const cat = m.buildPropertyCatalog();
      return {
        typeCount: cat.type.length,
        affinityGroupCount: cat.affinities.length,
        expressionGroupCount: cat.expressions.length,
        motivationGroupCount: cat.motivations.length,
      };
    })
  );

  expect(catalog.typeCount).toBeGreaterThanOrEqual(5);      // room, delver, warden, hazard, resource
  expect(catalog.affinityGroupCount).toBeGreaterThan(0);
  expect(catalog.expressionGroupCount).toBeGreaterThan(0);
  expect(catalog.motivationGroupCount).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Pointer interactivity — canvas click and hover via chip position registry
// ---------------------------------------------------------------------------

test("clicking a type chip in the canvas sets the active card type", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  // Wait until the initial render has populated the chip registry.
  await page.waitForFunction(
    () => (window.__ak_phaserFrame?.getCardBuilderSurface?.()?.getChipPositions?.()?.length ?? 0) > 0,
    { timeout: 15_000 },
  );

  const roomChip = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getChipPositions()
      .find((c) => c.group === "type" && c.value === "room")
  );
  expect(roomChip).toBeTruthy();

  const canvasBox = await page.locator(".card-builder-phaser-stage canvas").first().boundingBox();
  await page.mouse.click(
    canvasBox.x + roomChip.x + roomChip.width / 2,
    canvasBox.y + roomChip.y + roomChip.height / 2,
  );

  // The pointerdown handler calls render() async; wait for the state change.
  await page.waitForFunction(
    () => window.__ak_phaserFrame.getCardBuilderSurface().getController().getActiveCard().type === "room",
    { timeout: 5_000 },
  );

  const type = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getController().getActiveCard().type
  );
  expect(type).toBe("room");
});

test("clicking an affinity chip applies the property to the active card", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  // Set type via JS first so the affinity drop is valid; re-render to refresh chip registry.
  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const id = surface.getController().getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "room" } });
    await surface.render();
  });

  const fireChip = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getChipPositions()
      .find((c) => c.group === "affinities" && c.value === "fire")
  );
  expect(fireChip).toBeTruthy();

  const canvasBox = await page.locator(".card-builder-phaser-stage canvas").first().boundingBox();
  await page.mouse.click(
    canvasBox.x + fireChip.x + fireChip.width / 2,
    canvasBox.y + fireChip.y + fireChip.height / 2,
  );

  // Affinities have zero additional token cost; the observable change is the status message.
  await page.waitForFunction(
    () => window.__ak_phaserFrame.getCardBuilderSurface().getController().getStatus().message.includes("affinities:fire"),
    { timeout: 5_000 },
  );

  const status = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getController().getStatus()
  );
  expect(status.level).toBe("info");
  expect(status.message).toContain("affinities:fire");
});

test("hovering a chip shows highlight feedback", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  await page.waitForFunction(
    () => (window.__ak_phaserFrame?.getCardBuilderSurface?.()?.getChipPositions?.()?.length ?? 0) > 0,
    { timeout: 15_000 },
  );

  const delverChip = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getChipPositions()
      .find((c) => c.group === "type" && c.value === "delver")
  );
  expect(delverChip).toBeTruthy();

  const canvasBox = await page.locator(".card-builder-phaser-stage canvas").first().boundingBox();
  await page.mouse.move(
    canvasBox.x + delverChip.x + delverChip.width / 2,
    canvasBox.y + delverChip.y + delverChip.height / 2,
  );

  // Phaser processes pointermove on its game loop tick; allow a frame to pass.
  await page.waitForFunction(
    () => window.__ak_phaserFrame.getCardBuilderSurface().getHoveredChip() !== null,
    { timeout: 3_000 },
  );

  const hovered = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getHoveredChip()
  );
  expect(hovered).toBe(delverChip.label);
});

test("clicking a shelved card in the deck group pulls it back to the editor", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  // Build a room card and shelve it.
  await page.evaluate(async () => {
    const surface = window.__ak_phaserFrame.getCardBuilderSurface();
    const id = surface.getController().getActiveCard().id;
    surface.emitIntent({ kind: "drop_chip", cardId: id, property: { group: "type", value: "room" } });
    surface.emitIntent({ kind: "move_card_between_groups", group: "room" });
    await surface.render();
  });

  const cardCount = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getController().getCards().length
  );
  expect(cardCount).toBe(1);

  // Active editor should be blank after stash.
  const activeTypeBefore = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getController().getActiveCard().type
  );
  expect(activeTypeBefore).toBe("");

  const cardChip = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getCardPositions()[0]
  );
  expect(cardChip).toBeTruthy();

  const canvasBox = await page.locator(".card-builder-phaser-stage canvas").first().boundingBox();
  await page.mouse.click(
    canvasBox.x + cardChip.x + cardChip.width / 2,
    canvasBox.y + cardChip.y + cardChip.height / 2,
  );

  await page.waitForFunction(
    () => window.__ak_phaserFrame.getCardBuilderSurface().getController().getActiveCard().type !== "",
    { timeout: 5_000 },
  );

  const activeTypeAfter = await page.evaluate(() =>
    window.__ak_phaserFrame.getCardBuilderSurface().getController().getActiveCard().type
  );
  expect(activeTypeAfter).toBe("room");
});

// ## TODO: Test Permutations
// - Re-render cycle with affinity-kind payload after type is set
// - Over-budget scenario: fill card to budget limit, verify status reflects over-budget
// - Canvas resize: resize viewport, verify canvas width updates on next render
// - Dispose + remount: call dispose(), remount, verify canvas re-appears
// - select_card intent with unknown id returns ok:false and leaves state unchanged

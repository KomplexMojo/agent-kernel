/**
 * M3/M7 — Unified Phaser frame smoke coverage.
 *
 * Drives the unified Phaser game frame (card builder surface + gameplay surface):
 *   1. Frame mounts with both surface hosts
 *   2. Phaser card drag/drop applies a property and updates the receipt
 *   3. Invalid drop is rejected and surfaces a status message
 *   4. Gameplay run bundle loads and renders an initial board
 *
 * UI-surface coverage only — no live external services.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolveFixturePath, startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

let serveProcess = null;
let baseUrl = null;

const scenarioPath = resolveFixturePath(
  "tests", "fixtures", "scenarios", "delver-warden-battle-v1-basic.json",
);
const scenarioJson = JSON.parse(readFileSync(scenarioPath, "utf8"));

test.beforeAll(async () => {
  const result = await startServeUi();
  serveProcess = result.proc;
  baseUrl = result.url;
});

test.afterAll(async () => {
  if (serveProcess) await stopProcess(serveProcess);
});

test("unified Phaser frame mounts with both surface hosts", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-phaser-frame]")).toBeAttached({ timeout: 20_000 });
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached();
  await expect(page.locator("[data-gameplay-surface]")).toBeAttached();
});

test("Phaser card drag/drop applies a property and updates the receipt", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  const result = await page.evaluate(() => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    if (!surface) return { ok: false, reason: "no_surface" };
    const controller = surface.getController?.() || surface;
    const activeId = controller.getActiveCard().id;
    const dropped = surface.emitIntent?.({
      kind: "drop_chip",
      cardId: activeId,
      property: { group: "type", value: "delver" },
    });
    const after = controller.getActiveCard();
    return { ok: Boolean(dropped?.ok), type: after.type, total: after.cardValue?.totalTokens ?? null };
  });

  expect(result.ok).toBe(true);
  expect(result.type).toBe("delver");
  expect(result.total).toBeGreaterThan(0);
});

test("invalid Phaser drop is rejected and surfaces a status message", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-card-builder-surface]")).toBeAttached({ timeout: 20_000 });

  const result = await page.evaluate(() => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    const controller = surface.getController?.() || surface;
    const blank = controller.getActiveCard();
    surface.emitIntent?.({
      kind: "drop_chip",
      cardId: blank.id,
      property: { group: "affinities", value: "fire" },
    });
    const after = controller.getActiveCard();
    return { type: after.type, status: controller.getStatus?.() };
  });

  expect(result.type).toBe("");
  expect(result.status.level).toBe("error");
});

test("gameplay surface loads a run bundle and renders the initial board", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("[data-gameplay-surface]")).toBeAttached({ timeout: 20_000 });

  const loaded = await page.evaluate(async (scenario) => {
    return await window.__ak_loadScenario(scenario, { targetTab: "gameplay" });
  }, scenarioJson);
  expect(loaded).toBe(true);

  // The unified frame's gameplay surface reuses the existing gameplay renderer
  // (loadRun playback) during the transition, so the run canvas renders in the
  // reused gameplay host. Assert the run loaded and the canvas is visible.
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
});

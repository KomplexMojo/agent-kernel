import { test, expect } from "@playwright/test";
import { startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

test("served ui keeps the simulation board owned by the Phaser host", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await page.locator('[data-tab="simulation"]').click();

    await expect(page.locator("#simulation-phaser-host")).toBeVisible();
    await expect(page.locator("#frame-buffer")).toBeHidden();
    await expect(page.locator('[aria-label="Runtime controls"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="Runtime movement controls"]')).toHaveCount(0);
    await expect(page.locator(".runtime-controls button")).toHaveCount(0);

    for (const selector of [
      "#runtime-move-up-left",
      "#runtime-move-up",
      "#runtime-move-up-right",
      "#runtime-move-left",
      "#runtime-move-right",
      "#runtime-move-down-left",
      "#runtime-move-down",
      "#runtime-move-down-right",
      "#runtime-cast",
    ]) {
      await expect(page.locator(selector)).toHaveCount(0);
    }
  } finally {
    await stopProcess(served.proc);
  }
});

import { test, expect } from "@playwright/test";
import { startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

test("served ui keeps runtime movement controls inside the runtime actions section", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await page.locator('[data-tab="simulation"]').click();

    const controlsSection = page.locator('[aria-label="Runtime controls"]');
    const movementGroup = page.locator('[aria-label="Runtime movement controls"]');

    await expect(controlsSection).toBeVisible();
    await expect(movementGroup).toBeVisible();

    const movementIds = [
      "#runtime-move-up-left",
      "#runtime-move-up",
      "#runtime-move-up-right",
      "#runtime-move-left",
      "#runtime-move-right",
      "#runtime-move-down-left",
      "#runtime-move-down",
      "#runtime-move-down-right",
    ];

    for (const selector of movementIds) {
      await expect(movementGroup.locator(selector)).toHaveCount(1);
    }
  } finally {
    await stopProcess(served.proc);
  }
});

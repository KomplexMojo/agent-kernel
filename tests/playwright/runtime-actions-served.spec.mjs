import { test, expect } from "@playwright/test";
import { startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

test("served ui exposes gameplay step controls and removes legacy runtime movement controls", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await page.locator('[data-tab="gameplay"]').click();

    await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible();
    await expect(page.locator("#gameplay-step-back")).toBeVisible();
    await expect(page.locator("#gameplay-step-forward")).toBeVisible();
    await expect(page.locator('[data-tab="simulation"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="Runtime movement controls"]')).toHaveCount(0);
    await expect(page.locator("#runtime-move-up")).toHaveCount(0);
  } finally {
    await stopProcess(served.proc);
  }
});

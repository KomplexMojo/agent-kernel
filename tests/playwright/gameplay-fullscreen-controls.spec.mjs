import { test, expect } from "@playwright/test";
import { startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

let served;

test.beforeAll(async () => {
  const result = await startServeUi();
  served = { proc: result.proc, url: result.url, stop: () => stopProcess(result.proc) };
});

test.afterAll(async () => {
  await served?.stop?.();
});

test("gameplay tab panel should have a fullscreen button", async ({ page }) => {
  await page.goto(served.url);
  await page.evaluate((id) => window.__ak_setActiveTab(id), "gameplay");
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });

  const fullscreenBtn = page.locator("#gameplay-fullscreen");
  await expect(fullscreenBtn).toBeAttached({ timeout: 5_000 });
  await expect(fullscreenBtn).toBeVisible();
});

test("clicking fullscreen button should set a fullscreen dataset attribute", async ({ page }) => {
  await page.goto(served.url);
  await page.evaluate((id) => window.__ak_setActiveTab(id), "gameplay");
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });

  const fullscreenBtn = page.locator("#gameplay-fullscreen");
  await expect(fullscreenBtn).toBeVisible({ timeout: 5_000 });
  await fullscreenBtn.click();

  const gameplayPanel = page.locator('[data-tab-panel="gameplay"]');
  await expect(gameplayPanel).toHaveAttribute("data-gameplay-fullscreen", "true", { timeout: 5_000 });
});

test("after entering fullscreen, playback controls should still be visible", async ({ page }) => {
  await page.goto(served.url);
  await page.evaluate((id) => window.__ak_setActiveTab(id), "gameplay");
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });

  const fullscreenBtn = page.locator("#gameplay-fullscreen");
  await expect(fullscreenBtn).toBeVisible({ timeout: 5_000 });
  await fullscreenBtn.click();

  await expect(page.locator("#gameplay-step-back")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#gameplay-step-forward")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#gameplay-zoom-in")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#gameplay-zoom-out")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#gameplay-fit-level")).toBeVisible({ timeout: 5_000 });
});

test("ESC or a close button exits fullscreen mode", async ({ page }) => {
  await page.goto(served.url);
  await page.evaluate((id) => window.__ak_setActiveTab(id), "gameplay");
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });

  const fullscreenBtn = page.locator("#gameplay-fullscreen");
  await expect(fullscreenBtn).toBeVisible({ timeout: 5_000 });
  await fullscreenBtn.click();

  const gameplayPanel = page.locator('[data-tab-panel="gameplay"]');
  await expect(gameplayPanel).toHaveAttribute("data-gameplay-fullscreen", "true", { timeout: 5_000 });

  // ESC should exit fullscreen
  await page.keyboard.press("Escape");
  await expect(gameplayPanel).toHaveAttribute("data-gameplay-fullscreen", "false", { timeout: 5_000 });
});

test("after exiting fullscreen, gameplay panel is visible and actor-inspector is accessible", async ({ page }) => {
  await page.goto(served.url);
  await page.evaluate((id) => window.__ak_setActiveTab(id), "gameplay");
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });

  const fullscreenBtn = page.locator("#gameplay-fullscreen");
  await expect(fullscreenBtn).toBeVisible({ timeout: 5_000 });
  await fullscreenBtn.click();

  const gameplayPanel = page.locator('[data-tab-panel="gameplay"]');
  await expect(gameplayPanel).toHaveAttribute("data-gameplay-fullscreen", "true", { timeout: 5_000 });

  await page.keyboard.press("Escape");
  await expect(gameplayPanel).toHaveAttribute("data-gameplay-fullscreen", "false", { timeout: 5_000 });

  // Gameplay panel must still be visible
  await expect(gameplayPanel).toBeVisible();

  // Actor inspector must be accessible
  await expect(page.locator("#actor-inspector")).toBeVisible({ timeout: 5_000 });
});

/*
## TODO: Test Permutations
- Fullscreen entry and exit while a run is actively loaded with actors on the board
- Repeated fullscreen toggles (3+ cycles) do not break camera controls
- Fullscreen button has appropriate aria-label for accessibility
- Fullscreen mode on a narrow viewport (<768px) does not overflow
- Tab switching away from gameplay while in fullscreen exits fullscreen
- Browser back/forward navigation while in fullscreen exits fullscreen gracefully
*/

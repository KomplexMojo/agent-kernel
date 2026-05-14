import { test, expect } from "@playwright/test";
import { resolveFixturePath, startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

const bundlePath = resolveFixturePath("tests", "fixtures", "ui", "build-spec-bundle", "bundle.json");

test("served Run tab keeps the Phaser surface and removes HTML board-local controls after bundle load", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await page.locator('[data-tab="diagnostics"]').click();
    await expect(page.locator('[data-tab-panel="diagnostics"]').first()).toBeVisible();

    await page.setInputFiles("#bundle-file", bundlePath);
    await expect(page.locator("#bundle-status")).toContainText("Bundle loaded");

    await page.locator('[data-tab="simulation"]').click();
    await expect(page.locator('[data-tab-panel="simulation"]').first()).toBeVisible();

    await expect(page.locator("#simulation-phaser-host")).toBeVisible();
    await expect(page.locator("#frame-buffer")).toBeHidden();
    await expect(page.locator(".runtime-controls button")).toHaveCount(0);
    await expect(page.locator(".runtime-affinity-placeholders button")).toHaveCount(0);

    const removedIds = [
      "#runtime-move-up-left",
      "#runtime-move-up",
      "#runtime-move-up-right",
      "#runtime-move-left",
      "#runtime-cast",
      "#runtime-move-right",
      "#runtime-move-down-left",
      "#runtime-move-down",
      "#runtime-move-down-right",
      "#runtime-affinity-choice-fire",
      "#runtime-affinity-choice-water",
      "#runtime-affinity-choice-earth",
      "#runtime-affinity-expression-expand",
      "#runtime-affinity-expression-focus",
      "#runtime-affinity-expression-shift",
    ];
    for (const selector of removedIds) {
      await expect(page.locator(selector)).toHaveCount(0);
    }
  } finally {
    await stopProcess(served.proc);
  }
});

test("served Preview tab loads the canonical build bundle result", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await page.locator('[data-tab="diagnostics"]').click();
    await expect(page.locator('[data-tab-panel="diagnostics"]').first()).toBeVisible();

    await page.setInputFiles("#bundle-file", bundlePath);
    await expect(page.locator("#bundle-status")).toContainText("Bundle loaded");

    await page.locator('[data-tab="preview"]').click();
    await expect(page.locator('[data-tab-panel="preview"]').first()).toBeVisible();

    await expect(page.locator("#build-status")).toContainText("Build complete.", { timeout: 20_000 });
    await expect
      .poll(async () => {
        const text = await page.locator("#build-output").textContent();
        try {
          const payload = JSON.parse(text || "{}");
          return {
            hasBundle: Boolean(payload?.bundle),
            hasLegacyPreviewReady: payload?.preview?.ready === true,
            schema: payload?.bundle?.spec?.schema || "",
          };
        } catch (_error) {
          return {
            hasBundle: false,
            hasLegacyPreviewReady: false,
            schema: "",
          };
        }
      }, { timeout: 20_000 })
      .toEqual({
        hasBundle: true,
        hasLegacyPreviewReady: false,
        schema: "agent-kernel/BuildSpec",
      });

    await expect(page.locator("#bundle-status")).toContainText("Loaded bundle from last build.", { timeout: 20_000 });
    await expect(page.locator("#preview-status")).toContainText(/preview loaded from snapshot\./i, { timeout: 20_000 });
    await expect(page.locator("#preview-status")).not.toContainText("Preview bundle is not ready yet.");
    await expect(page.locator("#preview-summary")).toContainText(/Map \d+x\d+/);
    await expect(page.locator("#preview-summary")).toContainText(/Actors \d+/);
    await expect(page.locator("#preview-actor-list")).not.toContainText("No actors loaded.");
  } finally {
    await stopProcess(served.proc);
  }
});

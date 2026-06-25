import { test, expect } from "@playwright/test";
import { resolveFixturePath, startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

const bundlePath = resolveFixturePath("tests", "fixtures", "ui", "build-spec-bundle", "bundle.json");

async function loadAuthoredBundleIntoPreview(page) {
  await page.setInputFiles("#bundle-file", bundlePath);
  await expect(page.locator("#bundle-status")).toContainText("Bundle loaded");
  await page.evaluate((id) => window.__ak_setActiveTab(id), "preview");
  await expect(page.locator('[data-tab-panel="preview"]').first()).toBeVisible();
  await expect(page.locator("#preview-status")).toContainText(/preview loaded from snapshot\./i, { timeout: 20_000 });
  await expect(page.locator("#preview-summary")).toContainText(/Map \d+x\d+/);
  await expect(page.locator("#preview-actor-list")).not.toContainText("No actors loaded.");
}



test("nav exposes only Design and Gameplay tab buttons", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    const tabButtons = page.locator("[data-tab]");
    await expect(tabButtons).toHaveCount(2);
    await expect(page.locator('[data-tab="design"]')).toBeVisible();
    await expect(page.locator('[data-tab="gameplay"]')).toBeVisible();
    await expect(page.locator('[data-tab="preview"]')).toHaveCount(0);
    await expect(page.locator('[data-tab="simulation"]')).toHaveCount(0);
    await expect(page.locator('[data-tab="diagnostics"]')).toHaveCount(0);
  } finally {
    await stopProcess(served.proc);
  }
});

test("diagnostics panel is accessible via setActiveTab and shows only the build pipeline", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await page.evaluate((id) => window.__ak_setActiveTab(id), "diagnostics");
    await expect(page.locator('[data-tab-panel="diagnostics"]').first()).toBeVisible();

    await expect(page.locator("#build-run")).toBeVisible();
    await expect(page.locator("#build-status")).toBeVisible();
    await expect(page.locator("#build-output")).toBeVisible();
    await expect(page.locator("#bundle-status")).toBeVisible();
    await expect(page.locator("#bundle-file")).toBeAttached();
    await expect(page.locator("#bundle-artifacts")).toBeAttached();

    await expect(page.locator("#diagnostic-toggle-allocator")).toHaveCount(0);
    await expect(page.locator("#diagnostic-toggle-llm-trace")).toHaveCount(0);
    await expect(page.locator("#diagnostic-toggle-adapter-playground")).toHaveCount(0);
    await expect(page.locator("#llm-trace-status")).toHaveCount(0);
    await expect(page.locator("#adapter-output")).toHaveCount(0);
    await expect(page.locator("#allocator-budget-json")).toHaveCount(0);
    await expect(page.locator("#ollama-run")).toHaveCount(0);
  } finally {
    await stopProcess(served.proc);
  }
});

test("preview panel has no renderer toggle controls", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await page.evaluate((id) => window.__ak_setActiveTab(id), "preview");
    await expect(page.locator('[data-tab-panel="preview"]').first()).toBeVisible();

    await expect(page.locator("#preview-build-and-load")).toBeVisible();
    await expect(page.locator("#preview-status")).toBeVisible();
    await expect(page.locator("#preview-summary")).toBeVisible();
    await expect(page.locator("#preview-actor-list")).toBeVisible();

    await expect(page.locator("#preview-renderer-canvas")).toHaveCount(0);
    await expect(page.locator("#preview-renderer-phaser")).toHaveCount(0);
    await expect(page.locator("#preview-renderer-host")).toHaveCount(0);
    await expect(page.locator("#preview-render-canvas")).toHaveCount(0);
    await expect(page.locator("#preview-frame-buffer")).toHaveCount(0);
  } finally {
    await stopProcess(served.proc);
  }
});

test("authored bundle reaches preview with summary and actor data", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await loadAuthoredBundleIntoPreview(page);
    await expect(page.locator("#preview-build-and-load")).toBeVisible();
    await expect(page.locator("#preview-renderer-canvas")).toHaveCount(0);
  } finally {
    await stopProcess(served.proc);
  }
});

test("served UI disables static module caching so preview renderer updates reach the browser", async ({ page }) => {
  const served = await startServeUi();

  try {
    const response = await page.request.get(new URL("/packages/ui-web/src/views/preview-renderers.js", served.url).href);
    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"]).toContain("no-store");
  } finally {
    await stopProcess(served.proc);
  }
});

test("served Preview tab loads the canonical build bundle result", async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await page.setInputFiles("#bundle-file", bundlePath);
    await expect(page.locator("#bundle-status")).toContainText("Bundle loaded");

    await page.evaluate((id) => window.__ak_setActiveTab(id), "preview");
    await expect(page.locator('[data-tab-panel="preview"]').first()).toBeVisible();

    await expect(page.locator("#bundle-status")).toContainText("Bundle loaded", { timeout: 20_000 });
    await expect(page.locator("#bundle-spec-edit")).toHaveValue(/"schema": "agent-kernel\/BuildSpec"/);
    await expect(page.locator("#bundle-artifacts")).toContainText("agent-kernel/SimConfigArtifact");
    await expect(page.locator("#bundle-artifacts")).toContainText("agent-kernel/InitialStateArtifact");
    await expect(page.locator("#preview-status")).toContainText(/preview loaded from snapshot\./i, { timeout: 20_000 });
    await expect(page.locator("#preview-status")).not.toContainText("Preview bundle is not ready yet.");
    await expect(page.locator("#preview-summary")).toContainText(/Map \d+x\d+/);
    await expect(page.locator("#preview-summary")).toContainText(/Actors \d+/);
    await expect(page.locator("#preview-actor-list")).not.toContainText("No actors loaded.");
  } finally {
    await stopProcess(served.proc);
  }
});

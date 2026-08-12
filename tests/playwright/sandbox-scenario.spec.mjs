/**
 * M7 — Sandbox scenario Playwright test
 *
 * Drives the UI with the M6 deterministic delver-warden-battle scenario:
 *   1. Load scenario into the gameplay view
 *   2. Step+ advances exactly one tick per click
 *   3. Run-To-End jumps to the final frame and disables forward stepping
 *   4. Gameplay renderer remains usable
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

async function loadScenario(page, scenario) {
  return await page.evaluate(async (s) => {
    return await window.__ak_loadScenario(s, { targetTab: "gameplay" });
  }, scenario);
}

async function getFrameIndex(page) {
  return await page.evaluate(() => {
    const view = window.__ak_gameplayView;
    if (!view) return null;
    // currentFrameIndex is closed over inside the view; expose via the step buttons
    const back = document.querySelector("#gameplay-step-back");
    const fwd = document.querySelector("#gameplay-step-forward");
    const runEnd = document.querySelector("#gameplay-run-to-end");
    return {
      backDisabled: back?.disabled ?? null,
      forwardDisabled: fwd?.disabled ?? null,
      runEndDisabled: runEnd?.disabled ?? null,
    };
  });
}

test("sandbox loads scenario fixture and Step+ advances exactly one frame per click", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeAttached({ timeout: 20_000 });

  const loaded = await loadScenario(page, scenarioJson);
  expect(loaded).toBe(true);

  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });

  // At tick 0: back disabled, forward enabled
  let state = await getFrameIndex(page);
  expect(state.backDisabled).toBe(true);
  expect(state.forwardDisabled).toBe(false);

  // Click Step+ once
  await page.locator("#gameplay-step-forward").click();
  state = await getFrameIndex(page);
  expect(state.backDisabled).toBe(false);  // back enabled after one step
  expect(state.forwardDisabled).toBe(false); // still more frames

  // Click Step+ several more times
  for (let i = 0; i < 5; i++) {
    await page.locator("#gameplay-step-forward").click();
  }
  state = await getFrameIndex(page);
  expect(state.backDisabled).toBe(false);
});

test("Run-To-End jumps to final frame and disables forward + run-to-end", async ({ page }) => {
  await page.goto(baseUrl);
  await loadScenario(page, scenarioJson);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });

  // Run-To-End should be enabled initially (frames > 1)
  let state = await getFrameIndex(page);
  expect(state.runEndDisabled).toBe(false);

  // Click Run-To-End
  await page.locator("#gameplay-run-to-end").click();

  // Status should reflect completion
  await expect(page.locator("#gameplay-status")).toContainText(/Run completed/i, { timeout: 5_000 });

  // Forward and Run-To-End should now be disabled, Back should be enabled
  state = await getFrameIndex(page);
  expect(state.forwardDisabled).toBe(true);
  expect(state.runEndDisabled).toBe(true);
  expect(state.backDisabled).toBe(false);
});

test("gameplay renderer remains usable after Run-To-End (Step- still works)", async ({ page }) => {
  await page.goto(baseUrl);
  await loadScenario(page, scenarioJson);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });

  await page.locator("#gameplay-run-to-end").click();
  await expect(page.locator("#gameplay-status")).toContainText(/Run completed/i);

  // Step- should rewind one frame
  await page.locator("#gameplay-step-back").click();
  const state = await getFrameIndex(page);
  expect(state.forwardDisabled).toBe(false);  // forward re-enabled after rewind
  expect(state.runEndDisabled).toBe(false);    // run-to-end re-enabled too

  // Canvas still visible
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible();
});

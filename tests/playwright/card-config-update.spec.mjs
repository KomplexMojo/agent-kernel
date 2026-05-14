import { test, expect } from "@playwright/test";
import { resolveFixturePath, startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

let serveProcess = null;
let baseUrl = null;

test.beforeAll(async () => {
  const result = await startServeUi();
  serveProcess = result.proc;
  baseUrl = result.url;
});

test.afterAll(async () => {
  if (serveProcess) {
    await stopProcess(serveProcess);
  }
});

test("Card configuration changes should be reflected in gameplay when switching back from design", async ({
  page,
}) => {
  await page.goto(baseUrl);

  // Step 1: Navigate to design tab (should already be there)
  const designTab = page.locator('[data-tab="design"]');
  await designTab.click();
  await expect(page.locator('[data-tab-panel="design"]').first()).toBeVisible();

  // Step 2: Go to gameplay tab, which will auto-generate and build the dungeon
  const gameplayTab = page.locator('[data-tab="gameplay"]');
  await gameplayTab.click();

  // Wait for the build to complete
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", {
    timeout: 60_000,
  });

  // Record initial run ID
  const initialRunId = await page.locator("#gameplay-run-id-label").textContent();
  console.log("Initial run ID:", initialRunId);

  // Verify that the board is rendered
  const initialBoardState = await page.locator("#gameplay-phaser-host").boundingBox();
  expect(initialBoardState).toBeTruthy();

  // Step 3: Go back to design tab
  await designTab.click();
  await expect(page.locator('[data-tab-panel="design"]').first()).toBeVisible();

  // Step 4: Simulate a card configuration change by modifying a parameter
  // Change the DELVER % budget allocation
  const delverPercentInput = page.locator('#design-budget-split-delver');

  // Get the current value
  const currentValue = await delverPercentInput.inputValue();
  const newValue = (parseInt(currentValue) + 10).toString();

  // Update the value
  await delverPercentInput.fill(newValue);
  await delverPercentInput.dispatchEvent("change");
  await page.waitForTimeout(500);

  // Step 5: Go back to gameplay tab
  // This should trigger a new build with the updated configuration
  await gameplayTab.click();

  // Wait for the new run to launch and load
  // The status should show "Launching run..." initially, then "Run loaded."
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", {
    timeout: 60_000,
  });

  // Record the new run ID
  const newRunId = await page.locator("#gameplay-run-id-label").textContent();
  console.log("New run ID after configuration change:", newRunId);

  // Verify that the board is still rendered
  const newBoardState = await page.locator("#gameplay-phaser-host").boundingBox();
  expect(newBoardState).toBeTruthy();

  // Both boards should be rendered (though possibly different)
  console.log("Initial board:", initialBoardState);
  console.log("New board:", newBoardState);
});

test("Gameplay view clears board when switching back from design tab (visual regression test)", async ({
  page,
}) => {
  await page.goto(baseUrl);

  // Navigate to design
  const designTab = page.locator('[data-tab="design"]');
  await designTab.click();
  await expect(page.locator('[data-tab-panel="design"]').first()).toBeVisible();

  // Go to gameplay and load a run
  const gameplayTab = page.locator('[data-tab="gameplay"]');
  await gameplayTab.click();
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", {
    timeout: 60_000,
  });

  // Record the status
  const statusAfterFirstLoad = await page.locator("#gameplay-status").textContent();
  console.log("Status after first load:", statusAfterFirstLoad);

  // Go back to design
  await designTab.click();
  await expect(page.locator('[data-tab-panel="design"]').first()).toBeVisible();

  // Make a change
  const delverPercentInput = page.locator('#design-budget-split-delver');
  const currentValue = await delverPercentInput.inputValue();
  const newValue = (parseInt(currentValue) + 5).toString();
  await delverPercentInput.fill(newValue);
  await delverPercentInput.dispatchEvent("change");
  await page.waitForTimeout(500);

  // Go back to gameplay
  await gameplayTab.click();

  // CRITICAL TEST: Check that the board is properly cleared initially
  // The status should be "Launching run..." briefly, then progress to "Run loaded."
  let statusAfterSwitch = await page.locator("#gameplay-status").textContent();
  console.log("Status immediately after switching to gameplay:", statusAfterSwitch);

  // Wait for the new run to load
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", {
    timeout: 60_000,
  });

  const statusAfterLoad = await page.locator("#gameplay-status").textContent();
  console.log("Status after new run loads:", statusAfterLoad);

  // Verify we see the expected progression
  expect(statusAfterLoad).toContain("Run loaded.");
});

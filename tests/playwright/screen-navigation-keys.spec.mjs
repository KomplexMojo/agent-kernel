import { test, expect } from "@playwright/test";
import { startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

test("Cmd+brackets and Ctrl+digits navigate screens; Cmd+arrows do not", async ({ page }) => {
  test.setTimeout(60_000);
  const served = await startServeUi();
  try {
    await page.goto(served.url);
    const activeTab = () => page.getAttribute(".workspace", "data-active-tab");

    expect(await activeTab()).toBe("design");

    await page.keyboard.press("Meta+]");
    await page.waitForTimeout(300);
    expect(await activeTab()).toBe("gameplay");

    await page.keyboard.press("Meta+[");
    await page.waitForTimeout(300);
    expect(await activeTab()).toBe("design");

    await page.keyboard.press("Control+2");
    await page.waitForTimeout(300);
    expect(await activeTab()).toBe("gameplay");

    await page.keyboard.press("Control+1");
    await page.waitForTimeout(300);
    expect(await activeTab()).toBe("design");

    // Cmd+arrows must no longer navigate screens from the design tab.
    await page.keyboard.press("Meta+ArrowRight");
    await page.waitForTimeout(300);
    expect(await activeTab()).toBe("design");
  } finally {
    await stopProcess(served.proc);
  }
});

/**
 * M4 (failing, TDD) — Cmd+Arrow tick-playback keyboard navigation.
 *
 * Feature under test (M5 will implement):
 *   - Cmd+ArrowRight -> step forward one tick
 *   - Cmd+ArrowLeft  -> step back one tick
 *   - Cmd+ArrowDown  -> jump to the final tick
 *   - Cmd+ArrowUp    -> jump to the first tick (tick 0)
 *   - Plain arrow keys (no modifier) keep their existing camera-pan behavior
 *     (gameplay-phaser-renderer.js keydown handler ~line 382-395) and must
 *     NOT move the playback cursor — they are reserved for future direct
 *     player movement.
 *
 * Today, event.metaKey is ignored entirely by the renderer's keydown handler,
 * and wireGameplayView has no jump-to-start control at all, so every
 * Cmd+Arrow assertion below is expected to fail until M5 lands.
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

/**
 * Reads the current actor positions from the introspection seam that already
 * exists in production: gameplay-phaser-renderer.js sets
 * stageEl.dataset.gameplayActorPositions (JSON array of {id, role, x, y})
 * inside drawBoard(), which runs on every renderRun/renderFrame call.
 * See packages/ui-web/src/views/gameplay-phaser-renderer.js:822-831.
 */
async function getActorPositions(page) {
  const json = await page.locator("[data-gameplay-phaser-stage]").getAttribute("data-gameplay-actor-positions");
  return json ? JSON.parse(json) : [];
}

/**
 * There is NO existing seam that exposes the current tick/frame index as a
 * DOM attribute — the step buttons (#gameplay-step-back/-forward) that the
 * old sandbox UI used for introspection do not exist in index_c.html. This
 * helper documents the gap: it looks for a data-gameplay-current-tick
 * attribute on the stage element, which does not exist yet. Its absence is
 * itself a legitimate failing assertion (see the "exposes current tick index"
 * test below) and is the M5 deliverable this spec calls for.
 */
async function getCurrentTickAttribute(page) {
  return await page.locator("[data-gameplay-phaser-stage]").getAttribute("data-gameplay-current-tick");
}

async function focusPhaserCanvas(page) {
  const canvas = page.locator("#gameplay-phaser-host canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await canvas.click({ position: { x: 5, y: 5 } });
  return canvas;
}

test("loading a scenario run and focusing the canvas succeeds (setup sanity)", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeAttached({ timeout: 20_000 });

  const loaded = await loadScenario(page, scenarioJson);
  expect(loaded).toBe(true);

  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await focusPhaserCanvas(page);

  const positions = await getActorPositions(page);
  expect(positions.length).toBeGreaterThan(0);
});

test("M5 gap: gameplay stage exposes the current tick index for introspection", async ({ page }) => {
  await page.goto(baseUrl);
  await loadScenario(page, scenarioJson);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await focusPhaserCanvas(page);

  // No production code sets data-gameplay-current-tick today. This is the new
  // introspection seam M5 must add so tests (and any future UI chrome) can
  // read the playback cursor without relying on the removed DOM step buttons.
  const tick = await getCurrentTickAttribute(page);
  expect(tick).not.toBeNull();
  expect(tick).toBe("0");
});

test("Cmd+ArrowRight steps the playback cursor forward one tick", async ({ page }) => {
  await page.goto(baseUrl);
  await loadScenario(page, scenarioJson);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await focusPhaserCanvas(page);

  const before = await getActorPositions(page);

  await page.keyboard.press("Meta+ArrowRight");
  await page.waitForTimeout(200);

  const tick = await getCurrentTickAttribute(page);
  expect(tick).toBe("1");

  // Movement visibility: not every tick in the fixture contains an accepted
  // move (tick 1 is a no-move tick), so step through the remaining ticks and
  // require that the positions differ from tick 0 somewhere along the way.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Meta+ArrowRight");
  }
  await page.waitForTimeout(300);
  const after = await getActorPositions(page);
  expect(after).not.toEqual(before);
});

test("Cmd+ArrowLeft steps the playback cursor back one tick", async ({ page }) => {
  await page.goto(baseUrl);
  await loadScenario(page, scenarioJson);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await focusPhaserCanvas(page);

  await page.keyboard.press("Meta+ArrowRight");
  await page.keyboard.press("Meta+ArrowRight");
  await page.waitForTimeout(200);
  const midTick = await getCurrentTickAttribute(page);
  expect(midTick).toBe("2");

  await page.keyboard.press("Meta+ArrowLeft");
  await page.waitForTimeout(200);

  const tick = await getCurrentTickAttribute(page);
  expect(tick).toBe("1");
});

test("Cmd+ArrowDown jumps the playback cursor to the final tick", async ({ page }) => {
  await page.goto(baseUrl);
  await loadScenario(page, scenarioJson);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await focusPhaserCanvas(page);

  await page.keyboard.press("Meta+ArrowDown");
  await page.waitForTimeout(200);

  await expect(page.locator("#gameplay-status")).toContainText(/Run completed/i, { timeout: 5_000 });

  // The fixture scenario runs 6 ticks (see delver-warden-battle-v1-basic.json ticks:6).
  const tick = await getCurrentTickAttribute(page);
  expect(tick).not.toBeNull();
  expect(Number(tick)).toBeGreaterThan(0);
});

test("Cmd+ArrowUp jumps the playback cursor back to the first tick (tick 0)", async ({ page }) => {
  await page.goto(baseUrl);
  await loadScenario(page, scenarioJson);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await focusPhaserCanvas(page);

  const initialPositions = await getActorPositions(page);

  // Move away from tick 0 first.
  await page.keyboard.press("Meta+ArrowDown");
  await page.waitForTimeout(200);
  const endTick = await getCurrentTickAttribute(page);
  expect(endTick).not.toBe("0");

  // Jump back to the start.
  await page.keyboard.press("Meta+ArrowUp");
  await page.waitForTimeout(200);

  const tick = await getCurrentTickAttribute(page);
  expect(tick).toBe("0");

  const positionsAfterJumpToStart = await getActorPositions(page);
  expect(positionsAfterJumpToStart).toEqual(initialPositions);
});

test("plain ArrowRight (no modifier) does NOT move the playback cursor", async ({ page }) => {
  await page.goto(baseUrl);
  await loadScenario(page, scenarioJson);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await focusPhaserCanvas(page);

  const before = await getActorPositions(page);
  const tickBefore = await getCurrentTickAttribute(page);

  // Plain ArrowRight is reserved for camera pan / future direct player
  // movement (gameplay-phaser-renderer.js ~line 382-395: `if (key ===
  // "arrowright"...) panCameraBy(...)`). It must never advance playback.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);

  const after = await getActorPositions(page);
  const tickAfter = await getCurrentTickAttribute(page);

  expect(after).toEqual(before);
  expect(tickAfter).toBe(tickBefore);
});

test("plain ArrowLeft/ArrowUp/ArrowDown (no modifier) do NOT move the playback cursor", async ({ page }) => {
  await page.goto(baseUrl);
  await loadScenario(page, scenarioJson);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await focusPhaserCanvas(page);

  const before = await getActorPositions(page);

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);

  const after = await getActorPositions(page);
  expect(after).toEqual(before);
});

test.skip("gameplay Cmd+ArrowRight repeated past final tick clamps at last frame", async () => {});
test.skip("gameplay Cmd+ArrowLeft repeated past tick 0 clamps at first frame", async () => {});
test.skip("gameplay Cmd+Arrow before any run is loaded is a no-op", async () => {});
test.skip("gameplay Cmd+ArrowDown then Cmd+ArrowUp round trips end to start", async () => {});
test.skip("gameplay Cmd+Arrow while canvas is unfocused does not move cursor", async () => {});
test.skip("gameplay Cmd+Shift+ArrowRight does not double fire", async () => {});
test.skip("gameplay rapid Cmd+ArrowRight across longer scenario stays bounded", async () => {});
test.skip("gameplay plain WASD keys remain unaffected by Cmd+Arrow feature", async () => {});

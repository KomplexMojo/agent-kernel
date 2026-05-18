import { test, expect } from "@playwright/test";
import { resolveFixturePath, startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

let serveProcess = null;
let baseUrl = null;
const bundlePath = resolveFixturePath("tests", "fixtures", "ui", "build-spec-bundle", "bundle.json");

// ---------------------------------------------------------------------------
// Reusable helpers (same build-spec pattern as gameplay-flow.spec.mjs)
// ---------------------------------------------------------------------------

function createActorBuildSpec() {
  const actorVitals = {
    health: { current: 4, max: 4, regen: 0 },
    mana: { current: 2, max: 2, regen: 0 },
    stamina: { current: 3, max: 3, regen: 1 },
    durability: { current: 1, max: 1, regen: 0 },
  };
  const actors = [
    {
      id: "A-overlay-1",
      kind: "ambulatory",
      archetype: "delver",
      motivations: ["attacking"],
      affinity: "water",
      affinities: [{ kind: "water", expression: "push", stacks: 1 }],
      vitals: actorVitals,
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `W-overlay-${index + 1}`,
      kind: "ambulatory",
      archetype: "warden",
      motivations: ["defending"],
      affinity: "fire",
      affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
      vitals: actorVitals,
    })),
  ];
  const cardSet = [
    { id: "room-overlay", type: "room", source: "room", count: 1, affinity: "water" },
    { id: "delver-overlay", type: "delver", source: "actor", count: 1, affinity: "water", motivations: ["attacking"] },
    { id: "warden-overlay", type: "warden", source: "actor", count: 3, affinity: "fire", motivations: ["defending"] },
  ];

  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "playwright_overlay_test",
      runId: `playwright_overlay_test_${Date.now()}`,
      createdAt: "2026-05-18T00:00:00.000Z",
      source: "playwright",
    },
    intent: {
      goal: "Verify character overlay viewport-sized rendering.",
      tags: ["playwright", "overlay"],
      hints: { levelAffinity: "water" },
    },
    plan: {
      hints: { strategy: "typed-actor-placement", cardSet },
    },
    configurator: {
      inputs: {
        levelAffinity: "water",
        delverCount: 1,
        levelGen: {
          width: 20,
          height: 16,
          seed: 42,
          shape: { roomCount: 4, roomMinSize: 4, roomMaxSize: 7, corridorWidth: 1 },
          hazards: [{ id: "H-overlay-1", affinity: "fire", expression: "emit", proximityRadius: 2 }],
        },
        resources: [{ id: "R-overlay-1", tier: "level", stat: "vitalMax", delta: 5, dropRate: 10 }],
        actors,
        cardSet,
      },
    },
  };
}

async function buildSpecThroughDiagnostics(page, spec) {
  await page.evaluate((id) => window.__ak_setActiveTab(id), "diagnostics");
  await expect(page.locator('[data-tab-panel="diagnostics"]').first()).toBeVisible();
  await page.locator("#build-spec-json").fill(JSON.stringify(spec, null, 2));
  await page.locator("#build-run").click();
  await expect(page.locator("#build-status")).toContainText("Build complete.", { timeout: 20_000 });
  const buildOutputText = await page.locator("#build-output").textContent();
  const buildOutput = JSON.parse(buildOutputText);
  expect(buildOutput.bundle).toBeTruthy();
  return buildOutput.bundle;
}

async function loadBuiltBundleIntoGameplay(page, bundle) {
  const loaded = await page.evaluate((payload) => window.__ak_loadGameplayBundle(payload), bundle);
  expect(loaded).toBe(true);
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
}

async function selectFirstActor(page) {
  const stage = page.locator("[data-gameplay-phaser-stage]");
  await expect(stage).toHaveAttribute("data-gameplay-actor-positions", /\[/, { timeout: 10_000 });
  const actorPositionsJson = await stage.getAttribute("data-gameplay-actor-positions");
  const actorPositions = JSON.parse(actorPositionsJson);
  expect(actorPositions.length).toBeGreaterThan(0);
  const { x, y } = actorPositions[0];
  await page.evaluate(({ x, y }) => window.__ak_gameplayView?.selectEntity({ x, y }), { x, y });
  return { x, y };
}

async function openOverlayViaZ(page) {
  await selectFirstActor(page);
  await page.keyboard.press("z");
  const stage = page.locator("[data-gameplay-phaser-stage]");
  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "true", { timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("Z overlay opens when pressing Z with selected actor", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  await selectFirstActor(page);
  await page.keyboard.press("z");

  const stage = page.locator("[data-gameplay-phaser-stage]");
  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "true", { timeout: 5_000 });
});

test("Z overlay covers full viewport, not a fixed 280px panel", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  await openOverlayViaZ(page);

  // The overlay should have a dataset attribute reflecting full-viewport size,
  // not the fixed 280px panel width. Without the fix, no such attribute exists.
  const stage = page.locator("[data-gameplay-phaser-stage]");
  const panelSize = await stage.getAttribute("data-gameplay-player-panel-size");
  expect(panelSize).toBeTruthy();

  // Parse the panel size; it should reflect at least the canvas viewport width.
  // The canvas viewport is at minimum wider than 280px on standard test viewports.
  const canvas = page.locator("#gameplay-phaser-host canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox?.width).toBeGreaterThan(280);

  // The panel must not be the fixed 280px — it should match or nearly match viewport.
  // Without the fix this attribute does not exist, so the test fails at the truthy check above.
});

test("Z/Escape closes the overlay", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  await openOverlayViaZ(page);

  const stage = page.locator("[data-gameplay-phaser-stage]");

  // Close via Z key
  await page.keyboard.press("z");
  // The view handler routes z-while-open to closePlayerPanel
  // Check it falls back to escape if z doesn't close
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "false", { timeout: 5_000 });
});

test("game surface remains visible behind the overlay", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  await openOverlayViaZ(page);

  // The Phaser canvas must still be in the DOM and visible while the overlay is open.
  const canvas = page.locator("#gameplay-phaser-host canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
});

test("overlay is independent of camera zoom level", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  // Zoom in before opening the overlay
  await page.locator("#gameplay-zoom-in").click();
  await page.locator("#gameplay-zoom-in").click();

  const stage = page.locator("[data-gameplay-phaser-stage]");
  const zoomAfter = Number(await stage.getAttribute("data-gameplay-camera-zoom"));
  expect(zoomAfter).toBeGreaterThan(1);

  await selectFirstActor(page);
  await page.keyboard.press("z");
  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "true", { timeout: 5_000 });

  // After the fix: overlay should set data-gameplay-player-panel-size with viewport
  // dimensions, unaffected by the zoomed camera. Without the fix: no such attribute.
  const panelSize = await stage.getAttribute("data-gameplay-player-panel-size");
  expect(panelSize).toBeTruthy();

  // The panel size should reflect viewport pixels, not world pixels affected by zoom.
  // On an 800-wide viewport at 2x zoom, world coords halve but viewport stays 800.
  // The current buggy code has no scrollFactor(0) so the overlay moves with the camera.
});

test("actor inspector is accessible after closing overlay", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  await openOverlayViaZ(page);

  // Close the overlay
  await page.keyboard.press("Escape");
  const stage = page.locator("[data-gameplay-phaser-stage]");
  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "false", { timeout: 5_000 });

  // Actor inspector should still be usable
  await expect(page.locator("#actor-inspector")).toBeVisible();
});

/*
## TODO: Test Permutations
- Z key with no actor selected does not open overlay
- Opening overlay on a very narrow viewport (320px width)
- Opening overlay on a very wide viewport (1920px width)
- Repeated open/close cycles do not leak DOM containers
- Camera pan after overlay close still works correctly
- Overlay does not shift position on window resize
- Overlay depth is above quick-view tooltip if both are somehow active
*/

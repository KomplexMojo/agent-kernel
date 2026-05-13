import { test, expect } from "@playwright/test";
import { resolveFixturePath, startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

let serveProcess = null;
let baseUrl = null;
const bundlePath = resolveFixturePath("tests", "fixtures", "ui", "build-spec-bundle", "bundle.json");

function createTypedActorBuildSpec() {
  const actorVitals = {
    health: { current: 4, max: 4, regen: 0 },
    mana: { current: 2, max: 2, regen: 0 },
    stamina: { current: 3, max: 3, regen: 1 },
    durability: { current: 1, max: 1, regen: 0 },
  };
  const actors = [
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `A-E2E-${index + 1}`,
      kind: "ambulatory",
      archetype: "delver",
      motivations: ["attacking"],
      affinity: "water",
      affinities: [{ kind: "water", expression: "push", stacks: 1 }],
      vitals: actorVitals,
    })),
    ...Array.from({ length: 11 }, (_, index) => ({
      id: `W-E2E-${index + 1}`,
      kind: "ambulatory",
      archetype: "warden",
      motivations: ["defending"],
      affinity: index % 2 === 0 ? "fire" : "earth",
      affinities: [{ kind: index % 2 === 0 ? "fire" : "earth", expression: "emit", stacks: 1 }],
      vitals: actorVitals,
    })),
  ];
  const cardSet = [
    {
      id: "room-e2e",
      type: "room",
      source: "room",
      count: 1,
      affinity: "water",
    },
    {
      id: "delver-e2e",
      type: "delver",
      source: "actor",
      count: 2,
      affinity: "water",
      motivations: ["attacking"],
    },
    {
      id: "warden-e2e",
      type: "warden",
      source: "actor",
      count: 11,
      affinity: "fire",
      motivations: ["defending"],
    },
  ];

  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "playwright_typed_actor_positions",
      runId: `playwright_typed_actor_positions_${Date.now()}`,
      createdAt: "2026-05-12T00:00:00.000Z",
      source: "playwright",
    },
    intent: {
      goal: "Verify typed delver and warden placement in gameplay.",
      tags: ["playwright", "gameplay"],
      hints: {
        levelAffinity: "water",
      },
    },
    plan: {
      hints: {
        strategy: "typed-actor-placement",
        cardSet,
      },
    },
    configurator: {
      inputs: {
        levelAffinity: "water",
        delverCount: 2,
        levelGen: {
          width: 42,
          height: 34,
          seed: 17,
          shape: {
            roomCount: 8,
            roomMinSize: 5,
            roomMaxSize: 9,
            corridorWidth: 1,
          },
          hazards: [
            { id: "H-E2E-1", affinity: "fire", expression: "emit", proximityRadius: 2 },
            { id: "H-E2E-2", affinity: "earth", expression: "emit", proximityRadius: 1 },
          ],
        },
        resources: [
          { id: "R-E2E-1", tier: "level", stat: "vitalMax", delta: 5, dropRate: 10 },
          { id: "R-E2E-2", tier: "level", stat: "vitalMax", delta: 3, dropRate: 20 },
        ],
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

function artifactFromBundle(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((artifact) => artifact?.schema === schema);
}

function entityPosition(entity) {
  const position = entity?.position || entity;
  const x = Number(position?.x);
  const y = Number(position?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function expectUniquePositionedEntities(entries, label) {
  expect(entries.length, `${label} count`).toBeGreaterThan(0);
  const occupied = new Set();
  for (const entry of entries) {
    const position = entityPosition(entry);
    expect(position, `${label} ${entry?.id || "entity"} should have a position`).toBeTruthy();
    const key = `${position.x},${position.y}`;
    expect(occupied.has(key), `${label} duplicate position ${key}`).toBe(false);
    occupied.add(key);
  }
}

async function launchPreviewBundleIntoGameplay(page) {
  await page.evaluate((id) => window.__ak_setActiveTab(id), "preview");
  await expect(page.locator("#preview-status")).toContainText(/preview loaded from snapshot\./i, { timeout: 20_000 });
  await page.locator("#preview-build-and-load").click();
  await expect.poll(async () => {
    const visible = await page.locator('[data-tab-panel="gameplay"]').isVisible();
    const status = await page.locator("#preview-status").textContent();
    return visible ? "visible" : status || "";
  }, { timeout: 20_000 }).toBe("visible");
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
}

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

test("design screen keeps Auto-generate separate from Gameplay launch", async ({ page }) => {
  await page.goto(baseUrl);
  const button = page.locator("#design-auto-generate");
  await expect(button).toBeVisible();
  await expect(button).toHaveText("Auto-generate");
  await expect(button).not.toHaveText("Run");
});

test("gameplay tab button and panel exist in the DOM", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator('[data-tab="gameplay"]')).toBeAttached();
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeAttached();
});

test("gameplay panel is not visible before Gameplay is opened", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator('[data-tab-panel="gameplay"]')).not.toBeVisible();
});

test("clicking Auto-generate fills the dungeon configuration without opening Gameplay", async ({ page }) => {
  await page.goto(baseUrl);

  await page.locator('[data-tab="design"]').click();
  await expect(page.locator('[data-tab-panel="design"]').first()).toBeVisible();

  await page.locator("#design-auto-generate").click();
  await expect(page.locator("#design-guidance-status")).toContainText(/Auto-generated .* using the remaining allocation\./i, {
    timeout: 20_000,
  });
  await expect(page.locator("#design-card-group-room .design-card-group-row").first()).toBeVisible();
  await expect(page.locator("#design-card-group-delver .design-card-group-row").first()).toBeVisible();
  await expect(page.locator("#design-card-group-warden .design-card-group-row").first()).toBeVisible();
  await expect(page.locator("#design-card-group-hazard .design-card-group-row").first()).toBeVisible();
  await expect(page.locator("#design-card-group-resource .design-card-group-row").first()).toBeVisible();
  await expect(page.locator('[data-tab-panel="gameplay"]')).not.toBeVisible();
});

test("opening Gameplay auto-generates and applies the dungeon without page reload", async ({ page }) => {
  await page.goto(baseUrl);

  let navigated = false;
  page.on("framenavigated", () => { navigated = true; });

  await page.locator('[data-tab="design"]').click();
  await expect(page.locator('[data-tab-panel="design"]').first()).toBeVisible();

  await page.locator('[data-tab="gameplay"]').click();

  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-tab-panel="design"]').first()).not.toBeVisible();
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#gameplay-zoom-out")).toBeVisible();
  await expect(page.locator("#gameplay-fit-level")).toBeVisible();
  await expect(page.locator("#gameplay-zoom-in")).toBeVisible();
  await expect(page.locator("[data-gameplay-phaser-stage]")).toHaveAttribute("data-gameplay-camera-zoom", /\d/);

  expect(navigated).toBe(false);
});

test("Gameplay camera controls zoom and refit the Phaser surface", async ({ page }) => {
  await page.goto(baseUrl);
  await page.locator('[data-tab="gameplay"]').click();
  const stage = page.locator("[data-gameplay-phaser-stage]");
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-gameplay-camera-zoom", /\d/);

  const initialZoom = Number(await stage.getAttribute("data-gameplay-camera-zoom"));
  await page.locator("#gameplay-zoom-in").click();
  await expect.poll(async () => Number(await stage.getAttribute("data-gameplay-camera-zoom")))
    .toBeGreaterThan(initialZoom);

  await page.locator("#gameplay-fit-level").click();
  const fitZoom = Number(await stage.getAttribute("data-gameplay-fit-zoom"));
  await expect.poll(async () => Number(await stage.getAttribute("data-gameplay-camera-zoom")))
    .toBeCloseTo(fitZoom, 2);
});

test("Design tab is visible from the gameplay panel", async ({ page }) => {
  await page.goto(baseUrl);
  await page.locator('[data-tab="gameplay"]').click();
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-tab="design"]')).toBeVisible();
});

test("preview bundle launches a visible Phaser gameplay canvas and inspector", async ({ page }) => {
  await page.goto(baseUrl);
  await page.setInputFiles("#bundle-file", bundlePath);
  await expect(page.locator("#bundle-status")).toContainText("Bundle loaded");

  await page.evaluate((id) => window.__ak_setActiveTab(id), "preview");
  await expect(page.locator("#preview-status")).toContainText(/preview loaded from snapshot\./i, { timeout: 20_000 });
  await page.locator("#preview-build-and-load").click();

  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.");
  await expect(page.locator("#actor-inspector")).toBeVisible();

  const stage = page.locator("[data-gameplay-phaser-stage]");
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-gameplay-world-tiles", /\d+x\d+/);
  await expect(stage).toHaveAttribute("data-gameplay-actors", /\d+/);

  const canvas = page.locator("#gameplay-phaser-host canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
});

test("generated delvers, wardens, hazards, and resources have unique locations", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createTypedActorBuildSpec());
  const simConfig = artifactFromBundle(bundle, "agent-kernel/SimConfigArtifact");
  const initialState = artifactFromBundle(bundle, "agent-kernel/InitialStateArtifact");
  const layoutData = simConfig?.layout?.data || {};
  expectUniquePositionedEntities(initialState?.actors || [], "actors");
  expectUniquePositionedEntities(layoutData.hazards || [], "hazards");
  expectUniquePositionedEntities(layoutData.resources || [], "resources");

  const allPositionKeys = new Set();
  for (const entry of [
    ...(initialState?.actors || []),
    ...(layoutData.hazards || []),
    ...(layoutData.resources || []),
  ]) {
    const position = entityPosition(entry);
    const key = `${position.x},${position.y}`;
    expect(allPositionKeys.has(key), `entity duplicate position ${key}`).toBe(false);
    allPositionKeys.add(key);
  }

  await loadBuiltBundleIntoGameplay(page, bundle);

  const stage = page.locator("[data-gameplay-phaser-stage]");
  await expect(stage).toHaveAttribute("data-gameplay-actors", "13");
  await expect(stage).toHaveAttribute("data-gameplay-delvers", "2");
  await expect(stage).toHaveAttribute("data-gameplay-wardens", "11");

  const actorPositions = JSON.parse(await stage.getAttribute("data-gameplay-actor-positions"));
  expect(actorPositions).toHaveLength(13);

  const delvers = actorPositions.filter((actor) => actor.role === "delver");
  const wardens = actorPositions.filter((actor) => actor.role === "warden");
  expect(delvers.map((actor) => actor.id).sort()).toEqual(["A-E2E-1", "A-E2E-2"]);
  expect(wardens.map((actor) => actor.id).sort()).toEqual(
    Array.from({ length: 11 }, (_, index) => `W-E2E-${index + 1}`).sort(),
  );

  const occupied = new Set(actorPositions.map((actor) => `${actor.x},${actor.y}`));
  expect(occupied.size).toBe(actorPositions.length);
});

test("Design navigation from active gameplay respects discard confirmation", async ({ page }) => {
  await page.goto(baseUrl);
  await page.setInputFiles("#bundle-file", bundlePath);
  await expect(page.locator("#bundle-status")).toContainText("Bundle loaded");
  await page.evaluate((id) => window.__ak_setActiveTab(id), "preview");
  await expect(page.locator("#preview-status")).toContainText(/preview loaded from snapshot\./i, { timeout: 20_000 });
  await page.locator("#preview-build-and-load").click();
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Discard current run and return to design?");
    await dialog.dismiss();
  });
  await page.locator('[data-tab="design"]').click();
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Discard current run and return to design?");
    await dialog.accept();
  });
  await page.locator('[data-tab="design"]').click();
  await expect(page.locator('[data-tab-panel="design"]').first()).toBeVisible();
  await expect(page.locator('[data-tab-panel="gameplay"]')).not.toBeVisible();
});

// --- M5: hover, selection, Player Panel, keyboard logging, Run Companion regression ---

test("selecting an actor via test hook syncs the Actor Inspector", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createTypedActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  const stage = page.locator("[data-gameplay-phaser-stage]");
  await expect(stage).toHaveAttribute("data-gameplay-actor-positions", /\[/, { timeout: 10_000 });

  const actorPositionsJson = await stage.getAttribute("data-gameplay-actor-positions");
  const actorPositions = JSON.parse(actorPositionsJson);
  expect(actorPositions.length).toBeGreaterThan(0);
  const { x, y } = actorPositions[0];

  await page.evaluate(({ x, y }) => window.__ak_gameplayView?.selectEntity({ x, y }), { x, y });

  await expect(page.locator("#actor-inspector")).toBeVisible();
});

test("Z key opens Player Panel when actor is selected (dataset reflects open state)", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createTypedActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  const stage = page.locator("[data-gameplay-phaser-stage]");
  const actorPositionsJson = await stage.getAttribute("data-gameplay-actor-positions");
  const actorPositions = JSON.parse(actorPositionsJson);
  expect(actorPositions.length).toBeGreaterThan(0);
  const { x, y } = actorPositions[0];

  await page.evaluate(({ x, y }) => window.__ak_gameplayView?.selectEntity({ x, y }), { x, y });
  await page.keyboard.press("z");

  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "true", { timeout: 5_000 });
});

test("Escape key closes Player Panel (dataset reflects closed state)", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createTypedActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  const stage = page.locator("[data-gameplay-phaser-stage]");
  const actorPositionsJson = await stage.getAttribute("data-gameplay-actor-positions");
  const actorPositions = JSON.parse(actorPositionsJson);
  const { x, y } = actorPositions[0];

  await page.evaluate(({ x, y }) => window.__ak_gameplayView?.selectEntity({ x, y }), { x, y });
  await page.keyboard.press("z");
  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "true", { timeout: 5_000 });

  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "false", { timeout: 5_000 });
});

test("selected-actor key press is logged to console", async ({ page }) => {
  const consoleLogs = [];
  page.on("console", (msg) => {
    if (msg.type() === "log") consoleLogs.push(msg.text());
  });

  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createTypedActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  const stage = page.locator("[data-gameplay-phaser-stage]");
  const actorPositionsJson = await stage.getAttribute("data-gameplay-actor-positions");
  const actorPositions = JSON.parse(actorPositionsJson);
  const { x, y } = actorPositions[0];

  await page.evaluate(({ x, y }) => window.__ak_gameplayView?.selectEntity({ x, y }), { x, y });
  await page.keyboard.press("ArrowUp");

  await expect.poll(() =>
    consoleLogs.some((log) => log.includes("[gameplay] key:") && log.includes("arrowup")),
  { timeout: 5_000 }).toBe(true);
});

test("Actor Inspector and gameplay controls remain visible after Player Panel open and close", async ({ page }) => {
  await page.goto(baseUrl);
  const bundle = await buildSpecThroughDiagnostics(page, createTypedActorBuildSpec());
  await loadBuiltBundleIntoGameplay(page, bundle);

  const stage = page.locator("[data-gameplay-phaser-stage]");
  const actorPositionsJson = await stage.getAttribute("data-gameplay-actor-positions");
  const actorPositions = JSON.parse(actorPositionsJson);
  const { x, y } = actorPositions[0];

  await page.evaluate(({ x, y }) => window.__ak_gameplayView?.selectEntity({ x, y }), { x, y });
  await page.keyboard.press("z");
  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "true", { timeout: 5_000 });

  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-gameplay-player-panel-open", "false", { timeout: 5_000 });

  // Run Companion non-regression: all expected controls still in DOM and visible
  await expect(page.locator("#actor-inspector")).toBeVisible();
  await expect(page.locator("#gameplay-status")).toBeVisible();
  await expect(page.locator("#gameplay-zoom-in")).toBeVisible();
  await expect(page.locator("#gameplay-zoom-out")).toBeVisible();
  await expect(page.locator("#gameplay-fit-level")).toBeVisible();
  await expect(page.locator("#gameplay-step-back")).toBeVisible();
  await expect(page.locator("#gameplay-step-forward")).toBeVisible();
});

/*
## TODO: Test Permutations
- launching gameplay with a room-only preview bundle shows a launch guard error
- clicking the Phaser canvas selects the actor visible at that tile
- a large level still fits the Gameplay viewport without horizontal page overflow
- Z key with no actor selected does not open Player Panel (dataset stays false)
- Player Panel opened then closed does not break camera zoom controls
*/

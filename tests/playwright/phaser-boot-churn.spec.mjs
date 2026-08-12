import { test, expect } from "@playwright/test";
import { resolveFixturePath, startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

// ---------------------------------------------------------------------------
// M11 investigation: U3 observation — loading index_c.html printed the Phaser
// v4.1.0 boot banner 12 times in one session while only one <canvas> existed
// in the DOM. This spec pins the measured ground truth.
//
// VERDICT: real churn, not a leak, not benign repeated logging.
//
// Phaser logs its boot banner exactly once per `new Phaser.Game(config)` call
// (Game.boot -> DebugHeader, phaser.esm.js), so banner count == Game
// construction count. Ground truth measured against this branch
// (test/interactive-interface-testing, 2026-07-09/10):
//
//   - Initial page load (design surface only):        1 banner, 1 canvas.
//   - First "gameplay" tab open (fresh Game built):    +1 banner  -> 2 canvas.
//   - Every subsequent design<->gameplay tab switch:   +1 banner, canvas
//     count stays at 2 (old canvas is torn down before the new one mounts,
//     so this is churn, not accumulation/leak).
//   - Repeated __ak_loadGameplayBundle pushes with an already-open gameplay
//     tab: +0 banners (gameplay's `ensureGame()` correctly guards on
//     `if (!game)` and is never the source of churn).
//
// Root cause (packages/ui-web/src/views/card-builder-phaser-renderer.js):
//   - `setRenderMode(mode)` (~line 1669) calls `recreateGame(mode)` whenever
//     `mode !== gameMode`. main.js's tab `onChange` handler calls
//     `phaserFrame.setRenderMode(tabId === "gameplay" ? "shelf" : "design")`
//     on *every* tab switch, so switching design->gameplay->design flips the
//     mode back and forth and `recreateGame` fires every time.
//   - `recreateGame` -> `applyRecreate` (~line 1489-1509) unconditionally
//     does `game.destroy(true); game = null; ...; await createGame(...)`,
//     i.e. it tears down and reconstructs the entire card-builder Phaser.Game
//     (WebGL context, texture cache, scene) on every single navigation
//     between the Design and Gameplay tabs — not just once per session.
//   - `createGame` (~line 1446) is the `new phaserRef.Game({...})` call site
//     confirmed via captured JS stack traces at banner-log time.
//   - The gameplay surface's own Phaser.Game
//     (gameplay-phaser-renderer.js `ensureGame`, ~line 785-802) is NOT part
//     of this churn — it is constructed once and reused correctly.
//
// This means "12 banners in one session" is fully explained by ordinary
// navigation: 1 (initial) + 1 (first gameplay open) + 2 per further
// design<->gameplay round trip (5 round trips -> 12).
//
// Updated 2026-07-10: U3 churn fixed in M12 — setRenderMode reconfigures
// scale in place. The design<->gameplay mode flip no longer destroys or
// reconstructs the design Phaser.Game; total constructions are stable at 2
// per session (initial design boot + first gameplay open). recreateGame
// survives only as a fallback for scale managers without the Phaser 4
// ScaleManager surface (injected test stubs) and never fires in a real
// browser. The former "PINNED CHURN" test below ("FIXED LIFECYCLE") now
// pins the fixed lifecycle.
// ---------------------------------------------------------------------------

let serveProcess = null;
let baseUrl = null;
const bundlePath = resolveFixturePath("tests", "fixtures", "ui", "build-spec-bundle", "bundle.json");

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

function collectBannerLogs(page, bucket) {
  page.on("console", (msg) => {
    const text = msg.text();
    if (/Phaser v[\d.]+/i.test(text)) {
      bucket.push(text);
    }
  });
}

async function fetchBundleJson(page) {
  return page.evaluate(async (path) => {
    const res = await fetch(path);
    return res.json();
  }, "/tests/fixtures/ui/build-spec-bundle/bundle.json");
}

test("initial page load boots exactly one Phaser game (design surface)", async ({ page }) => {
  const banners = [];
  collectBannerLogs(page, banners);
  await page.goto(baseUrl);
  await page.waitForTimeout(1500);

  expect(banners.length, "boot banners on initial load").toBe(1);
  expect(await page.locator("canvas").count(), "canvas elements on initial load").toBe(1);
});

test("opening the Gameplay tab boots exactly one additional Phaser game", async ({ page }) => {
  const banners = [];
  collectBannerLogs(page, banners);
  await page.goto(baseUrl);

  await page.evaluate((id) => window.__ak_setActiveTab(id), "gameplay");
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);

  expect(banners.length, "boot banners after first gameplay open").toBe(2);
  expect(await page.locator("canvas").count(), "canvas elements after first gameplay open").toBe(2);
});

// Updated 2026-07-10: U3 churn fixed in M12 — setRenderMode reconfigures
// scale in place.
//
// PINNED (FIXED) LIFECYCLE: this test previously pinned the U3 defect (2
// design-game reboots per design<->gameplay round trip via setRenderMode ->
// recreateGame). M12 replaced the recreate with an in-place Scale Manager
// reconfiguration (FIT/design <-> RESIZE/shelf) on the live game, so tab
// switching must now produce ZERO additional Phaser.Game constructions:
// total boots are stable at 2 for the whole session (initial design boot +
// the one gameplay ensureGame boot) no matter how much the user navigates.
// Equality assertions are intentional: any reintroduced churn (or a new
// hidden boot source) fails loudly instead of being absorbed.
test("FIXED LIFECYCLE: design<->gameplay tab switches boot zero additional Phaser games", async ({ page }) => {
  const banners = [];
  collectBannerLogs(page, banners);
  await page.goto(baseUrl);

  await page.setInputFiles("#bundle-file", bundlePath);
  await expect(page.locator("#bundle-status")).toContainText("Bundle loaded");
  const bundleJson = await fetchBundleJson(page);
  const loaded = await page.evaluate(
    (payload) => window.__ak_loadGameplayBundle(payload, { targetTab: "gameplay" }),
    bundleJson,
  );
  expect(loaded).toBe(true);
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300);

  // Tightened from the defect era (was 3: the bundle load's own
  // setRenderMode("shelf") used to trigger a design-surface recreate).
  // Fixed lifecycle: initial design boot + gameplay boot only.
  const baselineBanners = banners.length;
  expect(baselineBanners, "boot banners after bundle load into gameplay tab (no recreate from setRenderMode)").toBe(2);
  const baselineCanvas = await page.locator("canvas").count();
  expect(baselineCanvas, "canvas count stays at 2 (design + gameplay) once a run is loaded").toBe(2);

  const ROUND_TRIPS = 4;
  for (let i = 0; i < ROUND_TRIPS; i += 1) {
    await page.evaluate((id) => window.__ak_setActiveTab(id), "design");
    await page.waitForTimeout(150);
    await page.evaluate((id) => window.__ak_setActiveTab(id), "gameplay");
    await page.waitForTimeout(150);
  }

  const canvasAfterSwitches = await page.locator("canvas").count();
  const bannersAfterSwitches = banners.length;

  // Canvas count never grows (no DOM leak) ...
  expect(canvasAfterSwitches, "canvas count remains bounded across tab switches").toBe(2);

  // ... and Game construction count no longer grows at all: every mode flip
  // is an in-place scale reconfiguration of the live design game.
  expect(
    bannersAfterSwitches - baselineBanners,
    `expected exactly 0 additional Phaser.Game boots across ${ROUND_TRIPS} design<->gameplay round trips (setRenderMode reconfigures scale in place, no recreate)`,
  ).toBe(0);
});

test("repeated bundle pushes into an already-open Gameplay tab do not reboot the gameplay Phaser game", async ({ page }) => {
  const banners = [];
  collectBannerLogs(page, banners);
  await page.goto(baseUrl);

  await page.setInputFiles("#bundle-file", bundlePath);
  await expect(page.locator("#bundle-status")).toContainText("Bundle loaded");
  const bundleJson = await fetchBundleJson(page);

  await page.evaluate(
    (payload) => window.__ak_loadGameplayBundle(payload, { targetTab: "gameplay" }),
    bundleJson,
  );
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300);

  const bannersAfterFirstLoad = banners.length;
  const canvasAfterFirstLoad = await page.locator("canvas").count();

  for (let i = 0; i < 3; i += 1) {
    const loaded = await page.evaluate(
      (payload) => window.__ak_loadGameplayBundle(payload, { targetTab: "gameplay" }),
      bundleJson,
    );
    expect(loaded).toBe(true);
    await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(150);
  }

  expect(banners.length, "no additional boots from repeated bundle pushes while gameplay tab stays active").toBe(bannersAfterFirstLoad);
  expect(await page.locator("canvas").count(), "canvas count unchanged by repeated bundle pushes").toBe(canvasAfterFirstLoad);
});

test("Phaser.Game construction is attributable only to card-builder recreateGame and gameplay ensureGame", async ({ page }) => {
  // Wrap console.log to capture a stack trace at the moment each boot banner
  // fires — Phaser logs the banner synchronously inside Game.boot, called
  // from `new Phaser.Game(...)`, so the stack pins the exact call site.
  await page.addInitScript(() => {
    window.__ak_probe_stacks = [];
    const originalLog = console.log;
    console.log = function patchedConsoleLog(...args) {
      const first = args[0];
      if (typeof first === "string" && first.includes("Phaser v")) {
        window.__ak_probe_stacks.push(new Error("boot").stack || "");
      }
      return originalLog.apply(console, args);
    };
  });

  await page.goto(baseUrl);
  await page.evaluate((id) => window.__ak_setActiveTab(id), "gameplay");
  await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
  await page.evaluate((id) => window.__ak_setActiveTab(id), "design");
  await page.waitForTimeout(150);
  await page.evaluate((id) => window.__ak_setActiveTab(id), "gameplay");
  await page.waitForTimeout(300);

  const stacks = await page.evaluate(() => window.__ak_probe_stacks);
  expect(stacks.length, "at least one boot captured").toBeGreaterThan(0);

  const attributable = stacks.every(
    (s) => s.includes("card-builder-phaser-renderer.js") || s.includes("gameplay-phaser-renderer.js"),
  );
  expect(attributable, "every Phaser.Game construction traces to a known renderer module").toBe(true);

  // Tightened for the fixed lifecycle (M12): the very first construction is
  // the initial mount(); the ONLY other legitimate construction is the
  // gameplay surface's one-time ensureGame boot. Tab switches reconfigure
  // the design game's scale in place, so recreateGame/applyRecreate must
  // never appear in a boot stack — if they do, either the churn regressed
  // or the in-place path silently fell back to a rebuild in a real browser.
  const postSwitchStacks = stacks.slice(1);
  expect(postSwitchStacks.length, "exactly one post-initial-mount boot (gameplay ensureGame)").toBe(1);
  const allFromEnsureGame = postSwitchStacks.every((s) => s.includes("ensureGame"));
  expect(allFromEnsureGame, "post-initial-mount boots all trace through gameplay ensureGame only (no recreateGame/applyRecreate)").toBe(true);
});

// ## TODO: Test Permutations
test.skip("gameplay<->preview tab switching does not reboot the design Phaser game (preview tab doesn't flip renderMode)", async () => {});
test.skip("rapid back-to-back tab switches (no settle delay) still produce zero additional boots, no debounce-related over/under count", async () => {});
test.skip("switching tabs while a design->gameplay build is in flight does not produce overlapping mode switches / orphaned Game instances", async () => {});
test.skip("card-builder icon textures remain valid across in-place mode switches (no stale/missing textures post-switch)", async () => {});
test.skip("gameplay Phaser game survives a design-tab card edit + return (reuseActiveRun path) without a banner, per shouldReuseActiveRun", async () => {});
test.skip("10+ rapid tab switches do not throw, leak listeners, or desync data-gameplay-camera-zoom from the live game instance", async () => {});

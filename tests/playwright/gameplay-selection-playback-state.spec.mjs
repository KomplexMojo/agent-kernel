/**
 * M7 (U1 — adjudicated contract, pinned as a FAILING browser test until fixed):
 *
 *   __ak_gameplayView.selectEntityById(id) and getSelectedEntity() must return
 *   the entity as of the CURRENT PLAYBACK TICK (position + vitals), not the
 *   static initial-state record. Initial-state remains available from the
 *   bundle artifacts and must not be mutated.
 *
 * OBSERVED DEFECT (live browser session, 2026-07-09): loading a GameplayBundle
 * whose tick frames contain accepted move actions (single delver, 2 accepted
 * moves (4,3)->(3,3)->(2,2)), calling runToEnd() animates the sprite to (2,2),
 * but selectEntityById("card_delver_1-1").position still reports (4,3).
 *
 * See packages/ui-web/src/views/gameplay-view.js: entityIndex is built once
 * from InitialStateArtifact in loadRun() and never rebuilt as the playback
 * cursor (currentFrameIndex) advances via stepForward/runToEnd/runToStart.
 * Rendering (buildTickBoardStates) DOES replay acceptedActions from
 * bundle.tickFrames to derive per-tick position, so rendering and selection
 * disagree once playback moves past tick 0.
 *
 * Bundle is loaded directly via window.__ak_loadGameplayBundle(bundle) —
 * no WS bridge / MCP round trip needed for this contract.
 */
import { test, expect } from "@playwright/test";
import { startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

let serveProcess = null;
let baseUrl = null;

const ACTOR_ID = "card_delver_1-1";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";

function buildBundle() {
  const simConfig = {
    schema: SIM_CONFIG_SCHEMA,
    schemaVersion: 1,
    meta: { id: "sim1", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 6,
        height: 6,
        tiles: ["......", "......", "......", "......", "......", "......"],
        spawn: { x: 4, y: 3 },
        exit: { x: 0, y: 0 },
        rooms: [],
        traps: [],
      },
    },
  };
  const initialState = {
    schema: INITIAL_STATE_SCHEMA,
    schemaVersion: 1,
    meta: { id: "state1", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z" },
    simConfigRef: { id: "sim1", schema: SIM_CONFIG_SCHEMA, schemaVersion: 1 },
    actors: [
      { id: ACTOR_ID, kind: "ambulatory", archetype: "delver", role: "delver", position: { x: 4, y: 3 } },
    ],
  };
  const tickFrames = [
    { tick: 1, acceptedActions: [{ kind: "move", actorId: ACTOR_ID, params: { to: { x: 3, y: 3 } } }] },
    { tick: 2, acceptedActions: [{ kind: "move", actorId: ACTOR_ID, params: { to: { x: 2, y: 2 } } }] },
  ];
  return {
    schema: "agent-kernel/GameplayBundle",
    schemaVersion: 1,
    meta: { id: "bundle1", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z" },
    artifacts: [simConfig, initialState],
    tickFrames,
  };
}

test.beforeAll(async () => {
  const result = await startServeUi();
  serveProcess = result.proc;
  baseUrl = result.url;
});

test.afterAll(async () => {
  if (serveProcess) await stopProcess(serveProcess);
});

async function loadBundle(page, bundle) {
  return await page.evaluate(async (b) => {
    return await window.__ak_loadGameplayBundle(b, { targetTab: "gameplay" });
  }, bundle);
}

test("PINNED DEFECT: selectEntityById after runToEnd() reports the final-tick position, not the initial position", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeAttached({ timeout: 20_000 });

  const loaded = await loadBundle(page, buildBundle());
  expect(loaded).toBe(true);

  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });

  // Sanity: at tick 0, selection matches the initial-state position.
  const atTickZero = await page.evaluate((id) => {
    const entity = window.__ak_gameplayView.selectEntityById(id);
    return entity?.position ?? null;
  }, ACTOR_ID);
  expect(atTickZero).toEqual({ x: 4, y: 3 });

  // Advance playback to the final tick.
  await page.evaluate(() => window.__ak_gameplayView.runToEnd());

  const afterRunToEnd = await page.evaluate((id) => {
    const entity = window.__ak_gameplayView.selectEntityById(id);
    return entity?.position ?? null;
  }, ACTOR_ID);

  // Contract: after runToEnd(), selectEntityById must report the FINAL tick
  // position (2, 2) — the position after both accepted moves have been
  // applied. Today this fails: selectEntityById still returns (4, 3), the
  // static initial-state position, because entityIndex is never rebuilt as
  // the playback cursor advances.
  expect(afterRunToEnd).toEqual({ x: 2, y: 2 });
});

test("PINNED DEFECT: getSelectedEntity after runToEnd() reflects the final-tick position", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeAttached({ timeout: 20_000 });

  await loadBundle(page, buildBundle());
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });

  await page.evaluate((id) => window.__ak_gameplayView.selectEntityById(id), ACTOR_ID);
  await page.evaluate(() => window.__ak_gameplayView.runToEnd());

  const selectedPosition = await page.evaluate(() => {
    const selected = window.__ak_gameplayView.getSelectedEntity();
    return selected?.position ?? null;
  });

  expect(selectedPosition).toEqual({ x: 2, y: 2 });
});

test("selectEntityById after runToEnd() then runToStart() returns the initial position again", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeAttached({ timeout: 20_000 });

  await loadBundle(page, buildBundle());
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });

  await page.evaluate(() => window.__ak_gameplayView.runToEnd());
  await page.evaluate(() => window.__ak_gameplayView.runToStart());

  const position = await page.evaluate((id) => {
    const entity = window.__ak_gameplayView.selectEntityById(id);
    return entity?.position ?? null;
  }, ACTOR_ID);

  expect(position).toEqual({ x: 4, y: 3 });
});

test("the InitialStateArtifact is not mutated by playback + selection", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeAttached({ timeout: 20_000 });

  const bundle = buildBundle();
  await loadBundle(page, bundle);
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });

  const initialStatePositionBefore = bundle.artifacts.find((a) => a.schema === INITIAL_STATE_SCHEMA)
    .actors[0].position;

  await page.evaluate(() => window.__ak_gameplayView.runToEnd());
  await page.evaluate((id) => window.__ak_gameplayView.selectEntityById(id), ACTOR_ID);
  await page.evaluate(() => window.__ak_gameplayView.runToStart());

  expect(initialStatePositionBefore).toEqual({ x: 4, y: 3 });
});

test.skip("gameplay: vitals reported by getSelectedEntity reflect the current tick, not just position", async () => {});
test.skip("gameplay: selectEntityById mid-run (single stepForward) resolves the tick-1 position in the browser", async () => {});
test.skip("gameplay: clicking the sprite at its current rendered tile after runToEnd() resolves the actor", async () => {});

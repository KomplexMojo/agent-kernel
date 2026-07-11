/**
 * M9 (U2 — adjudicated contract, pinned as a FAILING browser test until fixed):
 *
 * OBSERVED DEFECT (live browser session, 2026-07-09): after pushing a
 * GameplayBundle for benchmark scenario 1 (single fire delver, budget 2000,
 * budget-receipt records 82 spent with approved line items) into index_c.html
 * via the sandbox bridge, the right-hand INVENTORY panel showed
 * "ROOM 0-[0]=0t", "DELVER 2000-[0]=2000t", footer "Budget: 2000t | Spent: 0t"
 * — i.e. zero itemization/spend for the pushed delver.
 *
 * ROOT CAUSE (see tests/ui-web/card-builder-inventory-budget-itemization.test.mjs
 * for the full investigation notes and unit-level pin):
 *
 *   packages/ui-web/src/main.js:209-222 (`globalThis.__ak_loadGameplayBundle`)
 *   auto-focuses the editor onto the bundle's first delver/warden card via
 *   `ctrl.pullCardToEditor(firstActor.id)`. `pullCardToEditor`
 *   (packages/ui-web/src/design-guidance.js:820-847) SPLICES that card out of
 *   `state.cards` (the shelf's card list) and only restores a card into the
 *   shelf if there was a PREVIOUSLY configured active-editor card to
 *   auto-restash — never true on a fresh push. The Phaser INVENTORY shelf's
 *   allocation ledger (packages/ui-web/src/views/card-builder-phaser-renderer.js
 *   `drawShelf`/`drawStatusBar`, fed by `controller.getAllocationLedger()`)
 *   sums `usedTokens` from `state.cards`, so the auto-pulled card's own type
 *   bucket zeroes out. For a delver-only bundle (no other delver/warden/room
 *   cards), this empties the shelf's card list entirely.
 *
 * This spec drives the exact sandbox-bridge-equivalent entry point
 * (`window.__ak_loadGameplayBundle`, same call gameplay-selection-playback-state
 * .spec.mjs uses for its own pinned defect) with a delver-only GameplayBundle
 * whose `spec` carries a fully-configured card set, and asserts the Phaser
 * card-builder controller's allocation ledger after the push.
 */
import { test, expect } from "@playwright/test";
import { startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

let serveProcess = null;
let baseUrl = null;

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";

function delverCardEntry() {
  return {
    id: "card_delver_1",
    type: "delver",
    source: "actor",
    count: 1,
    affinity: "fire",
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    expressions: ["push"],
    motivations: ["random", "user_controlled"],
    setupMode: "auto",
    vitals: {
      health: { current: 1, max: 1, regen: 0 },
      mana: { current: 0, max: 0, regen: 0 },
      stamina: { current: 0, max: 0, regen: 0 },
      durability: { current: 1, max: 1, regen: 0 },
    },
    flipped: false,
  };
}

function buildDelverOnlyBundle() {
  const cardSet = [delverCardEntry()];
  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: { runId: "playwright_delver_only" },
    intent: { hints: { levelAffinity: "fire", poolWeights: [{ id: "delver", weight: 0.2 }], budgetTokens: 2000 } },
    plan: { hints: { cardSet } },
    configurator: { inputs: { cardSet } },
    authoring: {},
  };

  const simConfig = {
    schema: SIM_CONFIG_SCHEMA,
    schemaVersion: 1,
    meta: { id: "sim_delver_only", runId: "playwright_delver_only", createdAt: "2026-01-01T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 4,
        height: 4,
        tiles: ["....", "....", "....", "...."],
        spawn: { x: 0, y: 0 },
        exit: { x: 3, y: 3 },
        rooms: [],
        traps: [],
      },
    },
  };
  const initialState = {
    schema: INITIAL_STATE_SCHEMA,
    schemaVersion: 1,
    meta: { id: "state_delver_only", runId: "playwright_delver_only", createdAt: "2026-01-01T00:00:00.000Z" },
    simConfigRef: { id: "sim_delver_only", schema: SIM_CONFIG_SCHEMA, schemaVersion: 1 },
    actors: [
      { id: "card_delver_1-1", kind: "ambulatory", archetype: "delver", role: "delver", position: { x: 0, y: 0 } },
    ],
  };

  return {
    schema: "agent-kernel/GameplayBundle",
    schemaVersion: 1,
    meta: { id: "bundle_delver_only", runId: "playwright_delver_only", createdAt: "2026-01-01T00:00:00.000Z" },
    artifacts: [simConfig, initialState],
    spec,
    tickFrames: [{ tick: 0, acceptedActions: [] }],
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

test("PINNED DEFECT: pushing a delver-only bundle leaves the INVENTORY shelf's DELVER bucket at zero used tokens", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("#phaser-frame-root")).toBeAttached({ timeout: 20_000 });

  const loaded = await loadBundle(page, buildDelverOnlyBundle());
  expect(loaded).toBe(true);

  // Give the async ingest + render pipeline (phaserFrame.ingest -> pullCardToEditor
  // -> surface.render()) a moment to settle before reading controller state.
  await page.waitForTimeout(200);

  const ledger = await page.evaluate(() => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    const ctrl = surface?.getController?.();
    return {
      cards: ctrl?.getCards?.() ?? null,
      allocationLedger: ctrl?.getAllocationLedger?.() ?? null,
    };
  });

  expect(ledger.allocationLedger).not.toBeNull();

  // Contract: the delver card pushed in this bundle has real vitals + one
  // affinity stack, which prices to a nonzero token cost. The INVENTORY
  // shelf's DELVER bucket must reflect that cost.
  //
  // Today this fails: __ak_loadGameplayBundle auto-pulls the sole delver card
  // into the editor (main.js:209-222), which empties the shelf's card list
  // (design-guidance.js pullCardToEditor splices with nothing restashed on a
  // blank editor), so usedTokens reports 0 — reproducing the live-observed
  // "DELVER 2000-[0]=2000t" zero-itemization defect.
  expect(
    ledger.allocationLedger?.byType?.delver?.usedTokens,
    `PINNED DEFECT (U2): expected DELVER usedTokens > 0 after pushing a delver-only ` +
      `bundle, got byType.delver=${JSON.stringify(ledger.allocationLedger?.byType?.delver)}, ` +
      `cards=${JSON.stringify(ledger.cards)}`,
  ).toBeGreaterThan(0);
});

test("PINNED DEFECT: pushing a delver-only bundle leaves the shelf's card list empty (not just zero-priced)", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("#phaser-frame-root")).toBeAttached({ timeout: 20_000 });

  await loadBundle(page, buildDelverOnlyBundle());
  await page.waitForTimeout(200);

  const cardCount = await page.evaluate(() => {
    const surface = window.__ak_phaserFrame?.getCardBuilderSurface?.();
    const ctrl = surface?.getController?.();
    return (ctrl?.getCards?.() ?? []).length;
  });

  // Today this fails: getCards() reports 0 because pullCardToEditor removed
  // the sole card from state.cards with nothing put back.
  expect(
    cardCount,
    "PINNED DEFECT (U2): the card-builder controller's shelf card list must not become " +
      "empty merely because the bundle's only delver was auto-focused into the editor",
  ).toBeGreaterThan(0);
});

// ## TODO: Test Permutations
test.skip("pushing a warden-only bundle reproduces the same zero-itemization defect for the WARDEN bucket", async () => {});
test.skip("pushing a room+delver bundle: ROOM bucket itemizes correctly while DELVER bucket still zeroes (auto-pulled type only)", async () => {});
test.skip("footer status-bar 'Spent:' total reads 0t after a delver-only push, matching the live-session screenshot", async () => {});
test.skip("re-opening the Design tab after a delver-only Gameplay push shows the delver card missing from the shelf UI", async () => {});
test.skip("pushing a second bundle after the first auto-pull still reproduces the defect (not a one-time-only glitch)", async () => {});

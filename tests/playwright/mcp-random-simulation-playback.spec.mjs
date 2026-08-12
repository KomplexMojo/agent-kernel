/**
 * M6 (failing, TDD) — MCP -> CLI -> UI random-movement scenario playback.
 *
 * Acceptance scenario: "Create a 5 room level with 10 wardens and 1 delver.
 * The wardens and delvers should have random movement motivation. Run the
 * simulation for 100 ticks." The bundle under test here is compiled with the
 * same in-process pipeline the CLI/MCP tools use
 * (packages/runtime/src/runner/core-facade.js compileScenarioPlaybackBundle,
 * the same function packages/ui-web/src/scenario-loader.js
 * compileScenarioToBundle delegates to), so this spec exercises the real
 * bundle-shape contract without depending on the still-missing
 * ak_push_to_ui MCP tool (see tests/integration/mcp-cli-ui-random-scenario.test.js
 * for that gap, pinned separately at the CLI/MCP layer).
 *
 * Per M5 (landed): the stage element [data-gameplay-phaser-stage] exposes
 * data-gameplay-current-tick and data-gameplay-actor-positions, and
 * Meta+ArrowRight/Left/Down/Up drive step/jump playback. See
 * tests/playwright/gameplay-tick-navigation.spec.mjs for the working idioms
 * reused here (scenario load via window.__ak_loadGameplayBundle, canvas
 * focus, key presses, dataset reads).
 *
 * Per the task brief: load via window.__ak_loadGameplayBundle(bundle,
 * { targetTab: "gameplay" }) — never click [data-tab] buttons (the HTML tab
 * bar is hidden once the Phaser frame mounts) and never look for DOM step
 * buttons (#gameplay-step-back/-forward do not drive playback here).
 */
import { test, expect } from "@playwright/test";
import { startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

let serveProcess = null;
let baseUrl = null;

const ROOM_COUNT = 5;
const WARDEN_COUNT = 10;
const DELVER_COUNT = 1;
const TICKS = 100;
const ROOM_WIDTH = 40;
const ROOM_HEIGHT = 10;

/**
 * Build a deterministic 5-room-shaped scenario (single wide corridor of 5
 * "rooms" for simplicity — the pipeline gap under test is motivation/tick
 * plumbing, not level-generation geometry) with 10 wardens + 1 delver, all
 * tagged motivation.kind "random", matching the fixture shape used by
 * tests/fixtures/scenarios/delver-warden-battle-v1-basic.json.
 */
function makeFloorGrid(width, height) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      row += y === 0 || y === height - 1 || x === 0 || x === width - 1 ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}

function buildRandomMotionScenario() {
  const tiles = makeFloorGrid(ROOM_WIDTH, ROOM_HEIGHT);
  const rooms = Array.from({ length: ROOM_COUNT }, (_, index) => ({
    id: `room_${index + 1}`,
    x: 1 + index * 7,
    y: 1,
    width: 6,
    height: ROOM_HEIGHT - 2,
  }));

  const defaultVitals = {
    health: { current: 10, max: 10, regen: 0 },
    mana: { current: 10, max: 10, regen: 0 },
    stamina: { current: 10, max: 10, regen: 0 },
    durability: { current: 1, max: 1, regen: 0 },
  };

  const actors = [];
  for (let i = 0; i < DELVER_COUNT; i += 1) {
    actors.push({
      id: `delver_${i + 1}`,
      kind: "ambulatory",
      archetype: "delver",
      role: "delver",
      position: { x: 2 + i, y: 2 },
      motivation: { kind: "random", seed: 100 + i },
      traits: { affinities: { water: 1 } },
      vitals: defaultVitals,
    });
  }
  for (let i = 0; i < WARDEN_COUNT; i += 1) {
    actors.push({
      id: `warden_${i + 1}`,
      kind: "ambulatory",
      archetype: "warden",
      role: "warden",
      position: { x: 3 + (i % ROOM_WIDTH), y: 3 + (i % (ROOM_HEIGHT - 4)) },
      motivation: { kind: "random", seed: 200 + i },
      traits: { affinities: { fire: 1 } },
      vitals: defaultVitals,
    });
  }

  const simConfig = {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: {
      id: "mcp_random_scenario_sim",
      runId: "mcp_random_scenario",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    seed: 1,
    layout: {
      kind: "grid",
      data: {
        width: ROOM_WIDTH,
        height: ROOM_HEIGHT,
        tiles,
        rooms,
      },
    },
  };

  const initialState = {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: {
      id: "mcp_random_scenario_state",
      runId: "mcp_random_scenario",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    simConfigRef: {
      id: "mcp_random_scenario_sim",
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
    },
    actors,
  };

  return {
    $schema: "agent-kernel/Scenario",
    schemaVersion: 1,
    id: "mcp-random-scenario-v1",
    name: "MCP random-movement scenario (5 rooms / 10 wardens / 1 delver)",
    description:
      "Create a 5 room level with 10 wardens and 1 delver. The wardens and " +
      "delvers should have random movement motivation. Run the simulation for 100 ticks.",
    ticks: TICKS,
    simConfig,
    initialState,
  };
}

async function compileBundle() {
  const { compileScenarioPlaybackBundle } = await import(
    "../../packages/runtime/src/runner/core-facade.js"
  );
  const scenario = buildRandomMotionScenario();
  return compileScenarioPlaybackBundle(scenario, { now: () => "2026-07-01T00:00:00.000Z" });
}

async function loadBundle(page, bundle) {
  const loaded = await page.evaluate(
    (payload) => window.__ak_loadGameplayBundle(payload, { targetTab: "gameplay" }),
    bundle,
  );
  expect(loaded).toBe(true);
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#gameplay-status")).toContainText("Run loaded.", { timeout: 20_000 });
}

async function focusPhaserCanvas(page) {
  const canvas = page.locator("#gameplay-phaser-host canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await canvas.click({ position: { x: 5, y: 5 } });
  return canvas;
}

async function getCurrentTickAttribute(page) {
  return page.locator("[data-gameplay-phaser-stage]").getAttribute("data-gameplay-current-tick");
}

async function getActorPositions(page) {
  const json = await page.locator("[data-gameplay-phaser-stage]").getAttribute("data-gameplay-actor-positions");
  return json ? JSON.parse(json) : [];
}

test.beforeAll(async () => {
  const result = await startServeUi();
  serveProcess = result.proc;
  baseUrl = result.url;
});

test.afterAll(async () => {
  if (serveProcess) await stopProcess(serveProcess);
});

test("compiled bundle carries tick frames covering all 100 ticks with 1 delver + 10 wardens, all motivation random (sanity on the fixture itself)", async () => {
  const bundle = await compileBundle();
  expect(bundle.schema).toBe("agent-kernel/GameplayBundle");

  // GROUND TRUTH: compileScenarioPlaybackBundle records one agent-kernel/TickFrame
  // per sub-phase of the six-phase tick orchestration (init, observe, decide,
  // apply, emit, summarize), not one frame per tick — confirmed by direct
  // invocation during test authoring (100 ticks -> 501 frames, matching the
  // CLI's run-summary.json metrics.frames for the same tick count). The
  // meaningful contract is distinct `tick` value coverage 0..TICKS inclusive.
  const distinctTicks = new Set(bundle.tickFrames.map((frame) => frame.tick));
  expect(Math.min(...distinctTicks)).toBe(0);
  expect(Math.max(...distinctTicks)).toBe(TICKS);
  expect(distinctTicks.size).toBe(TICKS + 1);

  const initialState = bundle.artifacts.find((a) => a.schema === "agent-kernel/InitialStateArtifact");
  expect(initialState).toBeTruthy();
  const delvers = initialState.actors.filter((a) => a.role === "delver");
  const wardens = initialState.actors.filter((a) => a.role === "warden");
  expect(delvers).toHaveLength(DELVER_COUNT);
  expect(wardens).toHaveLength(WARDEN_COUNT);
  for (const actor of [...delvers, ...wardens]) {
    expect(actor.motivation?.kind).toBe("random");
  }
});

test("GAP: every actor beyond the first in InitialState.actors receives move/wait proposals across the 100-tick run, not just the first", async () => {
  // GROUND TRUTH (confirmed by direct invocation during test authoring, with
  // both the full 11-actor scenario and minimal 2-warden-only repros): only
  // the FIRST entry in initialState.actors ever receives an accepted action
  // across the whole run — every other actor (all 10 wardens, when a delver
  // is actors[0]; or warden_2+ when two wardens are actors[0..1] with no
  // delver at all) is silently skipped every tick. This is not a
  // delver-vs-warden role gap — a warden-only scenario with 2 wardens shows
  // the identical pattern (only actors[0] acts). This is the multi-actor
  // orchestration gap the acceptance scenario's "10 wardens and 1 delver"
  // requirement would immediately expose: only 1 of the 11 actors would ever
  // move, so "watchable" movement for the other 10 never happens.
  const bundle = await compileBundle();
  const allActions = bundle.tickFrames.flatMap((frame) => (Array.isArray(frame.acceptedActions) ? frame.acceptedActions : []));
  const actingActorIds = new Set(allActions.map((action) => action.actorId));

  const initialState = bundle.artifacts.find((a) => a.schema === "agent-kernel/InitialStateArtifact");
  const allActorIds = initialState.actors.map((a) => a.id);

  expect(
    allActorIds.every((id) => actingActorIds.has(id)),
    `expected every actor to receive at least one accepted action across ${TICKS} ticks; ` +
      `only these actors ever acted: ${JSON.stringify([...actingActorIds])} out of ${JSON.stringify(allActorIds)}`,
  ).toBe(true);
});

test("loading the MCP-shaped random scenario bundle via __ak_loadGameplayBundle renders the gameplay Phaser stage", async ({ page }) => {
  const bundle = await compileBundle();

  await page.goto(baseUrl);
  await expect(page.locator('[data-tab-panel="gameplay"]')).toBeAttached({ timeout: 20_000 });

  await loadBundle(page, bundle);
  await focusPhaserCanvas(page);

  const stage = page.locator("[data-gameplay-phaser-stage]");
  await expect(stage).toHaveAttribute("data-gameplay-actors", String(DELVER_COUNT + WARDEN_COUNT), { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-gameplay-delvers", String(DELVER_COUNT));
  await expect(stage).toHaveAttribute("data-gameplay-wardens", String(WARDEN_COUNT));

  const positions = await getActorPositions(page);
  expect(positions.length).toBe(DELVER_COUNT + WARDEN_COUNT);
});

test("data-gameplay-current-tick starts at 0 after loading the 100-tick random scenario bundle", async ({ page }) => {
  const bundle = await compileBundle();

  await page.goto(baseUrl);
  await loadBundle(page, bundle);
  await focusPhaserCanvas(page);

  const tick = await getCurrentTickAttribute(page);
  expect(tick).not.toBeNull();
  expect(tick).toBe("0");
});

test("Meta+ArrowRight/Meta+ArrowDown step and jump the playback cursor across the 100-tick random scenario", async ({ page }) => {
  const bundle = await compileBundle();

  await page.goto(baseUrl);
  await loadBundle(page, bundle);
  await focusPhaserCanvas(page);

  expect(await getCurrentTickAttribute(page)).toBe("0");

  await page.keyboard.press("Meta+ArrowRight");
  await page.waitForTimeout(200);
  expect(await getCurrentTickAttribute(page)).toBe("1");

  await page.keyboard.press("Meta+ArrowDown");
  await page.waitForTimeout(300);
  await expect(page.locator("#gameplay-status")).toContainText(/Run completed/i, { timeout: 10_000 });

  const finalTick = Number(await getCurrentTickAttribute(page));
  expect(finalTick).toBeGreaterThan(0);
  // 100 recorded tick frames -> final tick index is TICKS-1 (0-indexed) or TICKS
  // (1-indexed); assert only the documented invariant (it reaches the end),
  // not a specific indexing convention that isn't pinned elsewhere in this repo.
  expect(finalTick).toBeGreaterThanOrEqual(TICKS - 1);
});

test("actor positions change across the 100-tick random scenario (tick 0 vs final tick)", async ({ page }) => {
  const bundle = await compileBundle();

  await page.goto(baseUrl);
  await loadBundle(page, bundle);
  await focusPhaserCanvas(page);

  const initialPositions = await getActorPositions(page);
  expect(initialPositions.length).toBe(DELVER_COUNT + WARDEN_COUNT);

  await page.keyboard.press("Meta+ArrowDown");
  await page.waitForTimeout(300);
  await expect(page.locator("#gameplay-status")).toContainText(/Run completed/i, { timeout: 10_000 });

  const finalPositions = await getActorPositions(page);
  expect(finalPositions.length).toBe(DELVER_COUNT + WARDEN_COUNT);

  // Random motivation over 100 ticks in a 5-room level must move at least
  // one actor somewhere — positions may legitimately be unchanged on any
  // single tick (bounce/wait), but not across the whole run end-to-end.
  //
  // GROUND TRUTH: this currently fails not because random movement itself is
  // broken (a single actor alone in a room moves correctly every tick, see
  // the "GAP: every actor beyond the first..." test above), but because only
  // initialState.actors[0] (the delver, in this scenario's ordering) ever
  // receives accepted actions — the 10 wardens never move at all, and with
  // this test's specific starting layout the delver's random walk also
  // happens to return to (or near) its start by tick 100 in this fixture's
  // deterministic seed. Fix the multi-actor orchestration gap first; this
  // assertion should then pass without needing any change here.
  expect(finalPositions).not.toEqual(initialPositions);
});

test("Meta+ArrowUp returns the playback cursor to tick 0 with the original actor positions", async ({ page }) => {
  const bundle = await compileBundle();

  await page.goto(baseUrl);
  await loadBundle(page, bundle);
  await focusPhaserCanvas(page);

  const initialPositions = await getActorPositions(page);

  await page.keyboard.press("Meta+ArrowDown");
  await page.waitForTimeout(300);
  expect(await getCurrentTickAttribute(page)).not.toBe("0");

  await page.keyboard.press("Meta+ArrowUp");
  await page.waitForTimeout(200);

  expect(await getCurrentTickAttribute(page)).toBe("0");
  expect(await getActorPositions(page)).toEqual(initialPositions);
});

test.skip("random playback ticks=1 bundle keeps current tick at 0 and Meta+ArrowDown no-ops", async () => {});
test.skip("random playback ticks=10 lands exactly on final tick without overshoot", async () => {});
test.skip("random playback delver-only bundle renders data-gameplay-wardens zero", async () => {});
test.skip("random playback warden-only bundle renders data-gameplay-delvers zero", async () => {});
test.skip("random playback actor missing motivation defaults and plays without throwing", async () => {});
test.skip("random playback Meta+ArrowRight past final tick clamps at last frame", async () => {});
test.skip("random playback Meta+ArrowLeft past tick 0 clamps at first frame", async () => {});
test.skip("random playback loading second bundle mid-run replaces playback state", async () => {});

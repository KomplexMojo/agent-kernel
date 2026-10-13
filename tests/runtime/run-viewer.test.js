/**
 * The run viewer shows a recorded run in the play session's view shape, so the
 * terminal UI can draw `ak run` output the way it draws a live game. Each tick's
 * view must be what the run recorded at that tick, never a re-simulation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { createPlaybackRuntime, createRuntimeCore } from "../../packages/runtime/src/runner/core-facade.js";
import { createRunViewer } from "../../packages/runtime/src/runner/run-viewer.js";
import { buildPlayView, playLegend, playStatus } from "../../packages/runtime/src/runner/play-session.js";

const LEVEL_DIR = new URL("../fixtures/ui-ascii/levels/", import.meta.url);
const readLevel = (name) => ({
  simConfig: JSON.parse(readFileSync(new URL(`${name}.sim-config.json`, LEVEL_DIR), "utf8")),
  initialState: JSON.parse(readFileSync(new URL(`${name}.initial-state.json`, LEVEL_DIR), "utf8")),
});

/** Run a level for `ticks` ticks; returns its frames and the registry after each tick. */
async function recordRun({ simConfig, initialState }, ticks) {
  const runtime = createPlaybackRuntime({ core: createRuntimeCore(), clock: () => "2026-10-13T00:00:00.000Z" });
  await runtime.init({ seed: simConfig.seed ?? 0, simConfig, initialState });
  const snapshots = [runtime.getActorSnapshot()];
  for (let i = 0; i < ticks; i += 1) {
    await runtime.step();
    snapshots.push(runtime.getActorSnapshot());
  }
  return { frames: runtime.getTickFrames(), snapshots, presentation: runtime.getActorPresentation() };
}

test("each tick's view is the registry the run recorded at that tick", async () => {
  const level = readLevel("warden-hall");
  const { frames, snapshots, presentation } = await recordRun(level, 6);
  const viewer = createRunViewer({ ...level, frames });
  assert.equal(viewer.maxTick, 6);
  const moved = snapshots.some((snapshot) => JSON.stringify(snapshot.actors.map((a) => a.position))
    !== JSON.stringify(snapshots[0].actors.map((a) => a.position)));
  assert.ok(moved, "the recorded run must move someone, or this test proves nothing");
  for (let tick = 0; tick <= 6; tick += 1) {
    const snapshot = snapshots[tick];
    const playerId = viewer.playerActorId;
    const expected = buildPlayView({
      snapshot, presentation, legend: playLegend(level.simConfig), playerId, tick,
      status: playStatus({ snapshot, playerId, exited: false, tick }),
    });
    assert.deepEqual(viewer.view(tick), expected, `tick ${tick}`);
  }
});

test("the view has nothing hidden: a viewer watches the whole run", async () => {
  const level = readLevel("warden-hall");
  const { frames } = await recordRun(level, 2);
  const view = createRunViewer({ ...level, frames }).view(2);
  assert.ok(view.sight.every((row) => /^v+$/.test(row)));
  assert.ok(view.rows.every((row) => !row.includes("?")));
  assert.ok(view.actors.length > 0, "the wardens are reported for the UI to draw");
});

test("a run without registry snapshots replays recorded move targets", () => {
  const level = readLevel("first-steps");
  const viewer = createRunViewer({ ...level, frames: [] });
  const start = viewer.view(0).player.position;
  const target = { x: start.x + 1, y: start.y };
  const frames = [{ tick: 1, acceptedActions: [{ kind: "move", actorId: viewer.playerActorId, params: { target } }] }];
  const legacy = createRunViewer({ ...level, frames });
  assert.deepEqual(legacy.view(1).player.position, target);
  assert.deepEqual(legacy.view(0).player.position, start);
});

test("a tick outside the run is refused", async () => {
  const level = readLevel("first-steps");
  const { frames } = await recordRun(level, 2);
  const viewer = createRunViewer({ ...level, frames });
  assert.throws(() => viewer.view(3), /tick must be an integer from 0 to 2/);
  assert.throws(() => viewer.view(-1), /tick must be/);
});

test("the HUD centres on a named actor, and an unknown one is refused", async () => {
  const level = readLevel("warden-hall");
  const warden = level.initialState.actors.find((actor) => level.initialState.presentation[actor.id].category === "warden");
  const viewer = createRunViewer({ ...level, frames: [], playerActorId: warden.id });
  assert.equal(viewer.view(0).player.id, warden.id);
  assert.equal(viewer.view(0).player.role, "warden");
  assert.throws(() => createRunViewer({ ...level, playerActorId: "nobody" }), /not an actor in this level/);
});

// ## TODO: Test Permutations
// - a player that exits mid-run: status.exited from the recorded exitedActorIds
// - a defeated focus actor: status.defeated and no loot
// - a level with a render legend override draws its own glyphs in the replay

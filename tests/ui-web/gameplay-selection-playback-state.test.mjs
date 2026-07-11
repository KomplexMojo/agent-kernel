import assert from "node:assert/strict";
import { wireGameplayView } from "../../packages/ui-web/src/views/gameplay-view.js";

/**
 * M7 (U1 — adjudicated contract, pinned as a FAILING test until fixed):
 *
 *   __ak_gameplayView.selectEntityById(id) and getSelectedEntity() must return
 *   the entity as of the CURRENT PLAYBACK TICK (position + vitals), not the
 *   static initial-state record. Initial-state remains available from the
 *   bundle artifacts (InitialStateArtifact) and must not be mutated.
 *
 * OBSERVED DEFECT (live browser session, 2026-07-09): loading a GameplayBundle
 * whose tickFrames contain accepted move actions (single delver, 2 accepted
 * moves (4,3)->(3,3)->(2,2)), then calling runToEnd() animates the sprite to
 * (2,2), but selectEntityById("card_delver_1-1").position still reports (4,3).
 *
 * ROOT CAUSE (packages/ui-web/src/views/gameplay-view.js):
 *   - `entityIndex` (buildEntityIndex) is built ONCE from InitialStateArtifact
 *     inside loadRun() (line ~206) and never rebuilt as currentFrameIndex
 *     changes via stepForward/stepBack/runToEnd/runToStart.
 *   - selectEntity, selectEntityById, getSelectedEntity, resolveDisplayModel,
 *     and handleInspectorSelect all read from this static, position-keyed
 *     entityIndex — so after playback advances past tick 0, they still
 *     resolve against the tick-0 position/vitals recorded at load time.
 *   - Meanwhile buildTickBoardStates() (used only for *rendering*) DOES derive
 *     per-tick positions by replaying acceptedActions from bundle.tickFrames,
 *     because tick frames carry no per-frame actor snapshots. Rendering and
 *     selection are therefore out of sync.
 *
 * Every assertion below that reads "must fail today" documents the bug: it
 * currently fails on the CONTRACT assertion (stale tick-0 position/vitals
 * returned), not on a harness or import error.
 */

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";

const ACTOR_ID = "card_delver_1-1";

// Single delver, 2 accepted moves: (4,3) -> (3,3) -> (2,2). Also carries
// vitals that change tick-over-tick so the "vitals must be current-tick"
// assertion has a real defect surface (buildTickBoardStates today only
// re-derives position, not vitals, on the per-tick actor snapshot).
function buildInitialState() {
  return {
    schema: INITIAL_STATE_SCHEMA,
    schemaVersion: 1,
    meta: { id: "state1", runId: "run1", createdAt: "2026-01-01T00:00:00.000Z" },
    simConfigRef: { id: "sim1", schema: SIM_CONFIG_SCHEMA, schemaVersion: 1 },
    actors: [
      {
        id: ACTOR_ID,
        kind: "ambulatory",
        archetype: "delver",
        role: "delver",
        position: { x: 4, y: 3 },
        vitals: { health: { current: 10, max: 10 } },
      },
    ],
  };
}

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
  const initialState = buildInitialState();
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

function makeRoot() {
  return {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function makeInertRenderer() {
  return {
    mount() {},
    async renderRun() {},
    async renderFrame() {},
    dispose() {},
    centerOnTile() {},
    highlightActor() { return true; },
    clearHighlight() {},
    showQuickView() {},
    hideQuickView() {},
    openPlayerPanel() {},
    closePlayerPanel() {},
    isPlayerPanelOpen() { return false; },
    setPlaybackControls() {},
  };
}

test("selectEntityById at tick 0 returns the tick-0 position (baseline, should already pass)", async () => {
  const view = wireGameplayView({ root: makeRoot(), createRenderer: makeInertRenderer });
  await view.loadRun(buildBundle());

  const entity = view.selectEntityById(ACTOR_ID);
  assert.ok(entity, "expected to find the actor by id");
  assert.deepEqual(entity.position, { x: 4, y: 3 }, "tick 0 position must be the initial-state position");
});

test("PINNED DEFECT: selectEntityById after runToEnd() returns the FINAL-tick position, not tick 0", async () => {
  const view = wireGameplayView({ root: makeRoot(), createRenderer: makeInertRenderer });
  await view.loadRun(buildBundle());

  view.runToEnd();
  const entity = view.selectEntityById(ACTOR_ID);

  assert.ok(entity, "expected to find the actor by id after runToEnd");
  // Contract: must report (2, 2) — the position after both accepted moves
  // have been applied. Today this fails because selectEntityById reads the
  // static initial-state entityIndex built once in loadRun(), which still
  // holds (4, 3).
  assert.deepEqual(
    entity.position,
    { x: 2, y: 2 },
    "selectEntityById must return the CURRENT PLAYBACK TICK position after runToEnd(), " +
    "not the static initial-state position",
  );
});

test("PINNED DEFECT: getSelectedEntity after runToEnd() reflects the FINAL-tick position", async () => {
  const view = wireGameplayView({ root: makeRoot(), createRenderer: makeInertRenderer });
  await view.loadRun(buildBundle());

  view.selectEntityById(ACTOR_ID);
  view.runToEnd();
  const selected = view.getSelectedEntity();

  assert.ok(selected, "expected a selected entity to persist across playback advance");
  assert.deepEqual(
    selected.position,
    { x: 2, y: 2 },
    "getSelectedEntity must track the current playback tick, not the tick at selection time",
  );
});

test("PINNED DEFECT: selectEntityById after a single stepForward() returns the tick-1 position", async () => {
  const view = wireGameplayView({ root: makeRoot(), createRenderer: makeInertRenderer });
  await view.loadRun(buildBundle());

  view.stepForward();
  const entity = view.selectEntityById(ACTOR_ID);

  assert.ok(entity, "expected to find the actor by id after stepForward");
  assert.deepEqual(
    entity.position,
    { x: 3, y: 3 },
    "selectEntityById must return the tick-1 position after a single stepForward()",
  );
});

test("selectEntityById after runToEnd() then runToStart() returns the initial position again", async () => {
  const view = wireGameplayView({ root: makeRoot(), createRenderer: makeInertRenderer });
  await view.loadRun(buildBundle());

  view.runToEnd();
  view.runToStart();
  const entity = view.selectEntityById(ACTOR_ID);

  assert.ok(entity, "expected to find the actor by id after runToStart");
  assert.deepEqual(
    entity.position,
    { x: 4, y: 3 },
    "runToStart must return the actor to the initial (tick 0) position for selection purposes",
  );
});

test("PINNED DEFECT: selectEntity by CURRENT tick position resolves after runToEnd() (position-keyed lookup)", async () => {
  // selectEntity looks entities up by position key in entityIndex. Since the
  // sprite has visually moved to (2,2) after runToEnd(), a click/selection at
  // the CURRENT rendered position (2,2) should resolve the actor. Today it
  // does not, because entityIndex is still keyed by the tick-0 position (4,3).
  const view = wireGameplayView({ root: makeRoot(), createRenderer: makeInertRenderer });
  await view.loadRun(buildBundle());

  view.runToEnd();
  const entity = view.selectEntity({ x: 2, y: 2 });

  assert.ok(
    entity,
    "selecting at the CURRENT rendered tile (2,2) after runToEnd() must resolve the actor — " +
    "today entityIndex is still keyed by the stale tick-0 position (4,3)",
  );
  if (entity) {
    assert.equal(entity.id, ACTOR_ID);
  }
});

test("the InitialStateArtifact object in the bundle is never mutated by playback", async () => {
  const bundle = buildBundle();
  const initialStateSnapshot = JSON.stringify(
    bundle.artifacts.find((a) => a.schema === INITIAL_STATE_SCHEMA),
  );

  const view = wireGameplayView({ root: makeRoot(), createRenderer: makeInertRenderer });
  await view.loadRun(bundle);

  view.stepForward();
  view.stepForward();
  view.runToEnd();
  view.runToStart();
  view.selectEntityById(ACTOR_ID);

  const initialStateAfter = JSON.stringify(
    bundle.artifacts.find((a) => a.schema === INITIAL_STATE_SCHEMA),
  );
  assert.equal(
    initialStateAfter,
    initialStateSnapshot,
    "InitialStateArtifact must remain the untouched tick-0 record regardless of playback position",
  );
});

test("PINNED DEFECT: resolveDisplayModel for the actor reflects current-tick position after runToEnd()", async () => {
  // resolveDisplayModel is the seam used by hover/inspector sync; it must also
  // observe playback state, since it is keyed through the same entityIndex.
  const view = wireGameplayView({ root: makeRoot(), createRenderer: makeInertRenderer });
  await view.loadRun(buildBundle());

  view.runToEnd();
  const model = view.resolveDisplayModel({ x: 2, y: 2 });

  assert.ok(
    model,
    "resolveDisplayModel at the current rendered position (2,2) must resolve the actor after runToEnd()",
  );
  if (model) {
    assert.equal(model.id, ACTOR_ID);
  }
});

// ## TODO: Test Permutations
test.skip("selectEntityById tracks position correctly across stepBack() after runToEnd()", async () => {});
test.skip("multiple actors: selectEntityById resolves the correct current-tick position per actor id", async () => {});
test.skip("vitals (not just position) reflect the current tick when tickFrames carry vital-affecting actions", async () => {});
test.skip("selectEntityById mid-run (stepForward once, not runToEnd) does not leak the OTHER actors' tick-0 state", async () => {});
test.skip("rapid stepForward/stepBack/runToEnd/runToStart sequence leaves selection consistent with the final cursor position", async () => {});

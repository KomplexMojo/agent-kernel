import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "../../packages/bindings-ts/src/core-as.js";
import { initializeCoreFromArtifacts } from "../../packages/runtime/src/runner/core-setup.mjs";
import { setupPlayback } from "../../packages/ui-web/src/movement-ui.js";

function makeElement() {
  let text = "";
  let html = "";
  return {
    disabled: false,
    setAttribute() {},
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = String(value);
      html = text;
    },
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = String(value);
      text = html.replace(/<[^>]+>/g, "");
    },
  };
}

function makeElements() {
  return {
    frame: makeElement(),
    baseTiles: makeElement(),
    actorList: makeElement(),
    affinityList: makeElement(),
    tileActorList: makeElement(),
    tileActorCount: makeElement(),
    trapList: makeElement(),
    trapCount: makeElement(),
    status: makeElement(),
    playButton: makeElement(),
    stepBack: makeElement(),
    stepForward: makeElement(),
    reset: makeElement(),
  };
}

function buildScenario() {
  const vitals = {
    health: { current: 10, max: 10, regen: 0 },
    mana: { current: 0, max: 0, regen: 0 },
    stamina: { current: 10, max: 10, regen: 0 },
    durability: { current: 0, max: 0, regen: 0 },
  };
  return {
    simConfig: {
      seed: 0,
      layout: {
        kind: "grid",
        data: {
          width: 7,
          height: 7,
          tiles: [
            "#######",
            "#S....#",
            "#.....#",
            "#.....#",
            "#....E#",
            "#.....#",
            "#######",
          ],
          spawn: { x: 1, y: 1 },
          exit: { x: 5, y: 4 },
        },
      },
    },
    initialState: {
      actors: [
        { id: "A-AAA111-1", position: { x: 1, y: 1 }, vitals },
        { id: "D-BBB222-1", position: { x: 3, y: 3 }, vitals },
      ],
    },
  };
}

test("setupPlayback can apply realtime movement to a selected defender", async () => {
  const core = await loadCore({ wasmUrl: new URL("../../build/core-as.wasm", import.meta.url) });
  const { simConfig, initialState } = buildScenario();
  const elements = makeElements();

  const controller = setupPlayback({
    core,
    actions: [],
    actorIds: ["A-AAA111-1", "D-BBB222-1"],
    elements,
    initCore: () => {
      core.init(0);
      initializeCoreFromArtifacts(core, { simConfig, initialState });
    },
  });

  assert.match(elements.actorList.textContent, /D-BBB222-1 \[motivated\] @\(3,3\)/);
  const result = controller.performRealtimeAction({
    action: "right",
    actorId: "D-BBB222-1",
  });

  assert.equal(result?.ok, true);
  assert.match(elements.actorList.textContent, /D-BBB222-1 \[motivated\] @\(4,3\)/);
  const visibility = controller.getVisibilitySummary();
  assert.equal(visibility?.viewerActorId, "D-BBB222-1");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { setupPlayback } from "../../packages/ui-web/src/movement-ui.js";

function makeEl() {
  let text = "";
  let html = "";
  const el = { disabled: false, setAttribute() {} };
  Object.defineProperty(el, "textContent", {
    get: () => text,
    set: (value) => {
      text = String(value);
      html = text;
    },
  });
  Object.defineProperty(el, "innerHTML", {
    get: () => html,
    set: (value) => {
      html = String(value);
      text = html.replace(/<[^>]+>/g, "");
    },
  });
  return el;
}

function createFogCoreStub({
  width = 7,
  height = 7,
  rows = null,
  actors = [],
} = {}) {
  const resolvedRows = Array.isArray(rows) && rows.length > 0
    ? rows.map((row) => String(row || ""))
    : Array.from({ length: height }, () => ".".repeat(width));
  const state = {
    width,
    height,
    rows: resolvedRows,
    actors: actors.map((entry, index) => ({
      id: index + 1,
      position: { x: entry.position.x, y: entry.position.y },
      kind: entry.kind ?? 2,
      vitals: entry.vitals || [
        { current: 10, max: 10, regen: 0 },
        { current: 0, max: 0, regen: 0 },
        { current: 10, max: 10, regen: 0 },
        { current: 1, max: 1, regen: 0 },
      ],
    })),
    tick: 0,
  };

  return {
    init() {
      state.tick = 0;
    },
    loadMvpScenario() {},
    clearEffects() {},
    getMapWidth() {
      return state.width;
    },
    getMapHeight() {
      return state.height;
    },
    renderBaseCellChar(x, y) {
      return state.rows[y]?.charCodeAt(x) ?? ".".charCodeAt(0);
    },
    renderCellChar(x, y) {
      return state.rows[y]?.charCodeAt(x) ?? ".".charCodeAt(0);
    },
    getCurrentTick() {
      return state.tick;
    },
    getTileActorKind() {
      return 0;
    },
    getTileActorCount() {
      return 0;
    },
    getActorX() {
      return state.actors[0]?.position.x ?? 0;
    },
    getActorY() {
      return state.actors[0]?.position.y ?? 0;
    },
    getActorKind() {
      return state.actors[0]?.kind ?? 2;
    },
    getActorVitalCurrent(kind) {
      return state.actors[0]?.vitals?.[kind]?.current ?? 0;
    },
    getActorVitalMax(kind) {
      return state.actors[0]?.vitals?.[kind]?.max ?? 0;
    },
    getActorVitalRegen(kind) {
      return state.actors[0]?.vitals?.[kind]?.regen ?? 0;
    },
    getMotivatedActorCount() {
      return state.actors.length;
    },
    getMotivatedActorIdByIndex(index) {
      return state.actors[index]?.id ?? 0;
    },
    getMotivatedActorXByIndex(index) {
      return state.actors[index]?.position.x ?? 0;
    },
    getMotivatedActorYByIndex(index) {
      return state.actors[index]?.position.y ?? 0;
    },
    getMotivatedActorVitalCurrentByIndex(index, kind) {
      return state.actors[index]?.vitals?.[kind]?.current ?? 0;
    },
    getMotivatedActorVitalMaxByIndex(index, kind) {
      return state.actors[index]?.vitals?.[kind]?.max ?? 0;
    },
    getMotivatedActorVitalRegenByIndex(index, kind) {
      return state.actors[index]?.vitals?.[kind]?.regen ?? 0;
    },
    getMotivatedActorMovementCostByIndex() {
      return 1;
    },
    getMotivatedActorActionCostManaByIndex() {
      return 0;
    },
    getMotivatedActorActionCostStaminaByIndex() {
      return 0;
    },
  };
}

function createElements() {
  return {
    frame: makeEl(),
    baseTiles: makeEl(),
    actorId: makeEl(),
    actorPos: makeEl(),
    actorHp: makeEl(),
    actorList: makeEl(),
    affinityList: makeEl(),
    tick: makeEl(),
    status: makeEl(),
    playButton: makeEl(),
    stepBack: makeEl(),
    stepForward: makeEl(),
    reset: makeEl(),
  };
}

function runFogScenario({ affinityEffects }) {
  const core = createFogCoreStub({
    actors: [
      { position: { x: 3, y: 3 } },
      { position: { x: 4, y: 3 } },
    ],
  });
  const elements = createElements();
  const controller = setupPlayback({
    core,
    actions: [],
    actorIdLabel: "actor_mvp",
    actorIdValue: 1,
    elements,
    affinityEffects,
    initCore: () => {},
    visibility: {
      mode: "gameplay_fog",
      viewerActorId: "actor_mvp",
      visionRadius: 2,
      viewportSize: 7,
    },
  });
  return {
    controller,
    elements,
    visibility: controller.getVisibilitySummary(),
  };
}

test("darkness obscuration blocks exploration and hidden actors unless viewer has light affinity", () => {
  const noLight = runFogScenario({
    affinityEffects: {
      actors: [
        { actorId: "actor_mvp", affinityTargets: { "fire:push:enemy": 1 } },
        { actorId: "actor_2", affinityTargets: { "dark:emit:area": 2 } },
      ],
      traps: [
        {
          position: { x: 4, y: 3 },
          affinities: [{ kind: "dark", expression: "emit", stacks: 2, targetType: "floor" }],
          manaReserve: 20,
        },
      ],
    },
  });

  const withLight = runFogScenario({
    affinityEffects: {
      actors: [
        { actorId: "actor_mvp", affinityTargets: { "light:emit:area": 1 } },
        { actorId: "actor_2", affinityTargets: { "dark:emit:area": 2 } },
      ],
      traps: [
        {
          position: { x: 4, y: 3 },
          affinities: [{ kind: "dark", expression: "emit", stacks: 2, targetType: "floor" }],
          manaReserve: 20,
        },
      ],
    },
  });

  assert.equal(noLight.visibility.mode, "gameplay_fog");
  assert.equal(noLight.visibility.viewerActorId, "actor_mvp");
  assert.equal(noLight.visibility.viewer.lightSight, false);
  assert.ok(noLight.elements.frame.textContent.includes("?"));
  assert.doesNotMatch(noLight.elements.actorList.textContent, /actor_2/);

  assert.equal(withLight.visibility.viewer.lightSight, true);
  assert.match(withLight.elements.actorList.textContent, /actor_2/);
  assert.ok(withLight.visibility.viewer.exploredTiles > noLight.visibility.viewer.exploredTiles);
});

test("room focus in full mode crops rendered map and actors to selected room bounds", () => {
  const core = createFogCoreStub({
    width: 8,
    height: 5,
    rows: [
      "########",
      "#......#",
      "#.####.#",
      "#......#",
      "########",
    ],
    actors: [
      { position: { x: 2, y: 1 } },
      { position: { x: 6, y: 3 } },
    ],
  });
  const elements = createElements();
  const controller = setupPlayback({
    core,
    actions: [],
    actorIdLabel: "actor_mvp",
    actorIdValue: 1,
    elements,
    initCore: () => {},
    visibility: {
      mode: "simulation_full",
      focusRoom: { x: 1, y: 1, width: 4, height: 3 },
    },
  });

  assert.equal(elements.baseTiles.textContent, "....\n.###\n....");
  assert.match(elements.actorList.textContent, /actor_mvp/);
  assert.doesNotMatch(elements.actorList.textContent, /actor_2/);
  const focused = controller.getVisibilitySummary();
  assert.equal(focused.mode, "simulation_full");
  assert.equal(focused.viewport.startX, 1);
  assert.equal(focused.viewport.startY, 1);
  assert.equal(focused.viewport.width, 4);
  assert.equal(focused.viewport.height, 3);

  controller.setVisibilityFocusRoom(null);
  assert.equal(elements.baseTiles.textContent.split("\n").length, 5);
  const full = controller.getVisibilitySummary();
  assert.equal(full.viewport.width, 8);
  assert.equal(full.viewport.height, 5);
});

test("fog full-map mode preserves unknown cells across the full level", () => {
  const core = createFogCoreStub({
    width: 9,
    height: 9,
    actors: [
      { position: { x: 4, y: 4 } },
      { position: { x: 8, y: 8 } },
    ],
  });
  const elements = createElements();
  const controller = setupPlayback({
    core,
    actions: [],
    actorIdLabel: "actor_mvp",
    actorIdValue: 1,
    elements,
    initCore: () => {},
    visibility: {
      mode: "gameplay_fog",
      viewerActorId: "actor_mvp",
      visionRadius: 1,
      viewportSize: 3,
      fogFullMap: true,
    },
  });

  const fullFogRows = elements.frame.textContent.trim().split("\n");
  assert.equal(fullFogRows.length, 9);
  assert.ok(elements.frame.textContent.includes("?"));
  let summary = controller.getVisibilitySummary();
  assert.equal(summary.mode, "gameplay_fog");
  assert.equal(summary.viewport.width, 9);
  assert.equal(summary.viewport.height, 9);

  controller.setFogFullMap(false);
  const croppedRows = elements.frame.textContent.trim().split("\n");
  assert.ok(croppedRows.length <= 3);
  summary = controller.getVisibilitySummary();
  assert.ok(summary.viewport.width <= 3);
  assert.ok(summary.viewport.height <= 3);
});

test("affinity-assigned floor tiles render colored dot spans", () => {
  const core = createFogCoreStub({
    width: 5,
    height: 5,
    actors: [{ position: { x: 2, y: 2 } }],
  });
  const elements = createElements();
  setupPlayback({
    core,
    actions: [],
    actorIdLabel: "actor_mvp",
    actorIdValue: 1,
    elements,
    initCore: () => {},
    affinityEffects: {
      traps: [
        {
          position: { x: 1, y: 1 },
          affinities: [{ kind: "fire", expression: "emit", stacks: 2, targetType: "floor" }],
        },
      ],
    },
    visibility: {
      mode: "simulation_full",
    },
  });

  assert.match(elements.frame.innerHTML, /class="affinity-floor-cell"/);
  assert.match(elements.frame.innerHTML, /data-affinity="fire"/);
  assert.match(elements.frame.innerHTML, />\.<\/span>/);
});

test("playback preserves provided actor ids and can switch viewer to defender id", () => {
  const core = createFogCoreStub({
    actors: [
      { position: { x: 3, y: 3 } },
      { position: { x: 4, y: 3 } },
    ],
  });
  const elements = createElements();
  const controller = setupPlayback({
    core,
    actions: [],
    actorIdLabel: "A-2RB89Z-1",
    actorIds: ["A-2RB89Z-1", "D-5JH2QW-1"],
    actorIdValue: 1,
    elements,
    initCore: () => {},
    visibility: {
      mode: "gameplay_fog",
      viewerActorId: "A-2RB89Z-1",
      visionRadius: 2,
      viewportSize: 7,
    },
  });

  let visibility = controller.getVisibilitySummary();
  assert.equal(visibility.viewerActorId, "A-2RB89Z-1");
  assert.match(elements.actorList.textContent, /A-2RB89Z-1/);
  assert.match(elements.actorList.textContent, /D-5JH2QW-1/);

  controller.setViewerActor("D-5JH2QW-1");
  visibility = controller.getVisibilitySummary();
  assert.equal(visibility.viewerActorId, "D-5JH2QW-1");
});

test("viewer keeps self tile visible when darkness obscures their position", () => {
  const core = createFogCoreStub({
    actors: [{ position: { x: 3, y: 3 } }],
  });
  const elements = createElements();
  const controller = setupPlayback({
    core,
    actions: [],
    actorIdLabel: "D-5JH2QW-1",
    actorIds: ["D-5JH2QW-1"],
    actorIdValue: 1,
    elements,
    initCore: () => {},
    affinityEffects: {
      actors: [{ actorId: "D-5JH2QW-1", affinityTargets: { "dark:emit:area": 2 } }],
      traps: [
        {
          position: { x: 3, y: 3 },
          affinities: [{ kind: "dark", expression: "emit", stacks: 2, targetType: "floor" }],
          manaReserve: 20,
        },
      ],
    },
    visibility: {
      mode: "gameplay_fog",
      viewerActorId: "D-5JH2QW-1",
      viewportSize: 7,
      visionRadius: 2,
      fogFullMap: true,
    },
  });

  const summary = controller.getVisibilitySummary();
  assert.equal(summary.viewerActorId, "D-5JH2QW-1");
  assert.ok(summary.viewer.exploredTiles >= 1);
  assert.match(elements.frame.innerHTML, /data-actor-id="D-5JH2QW-1"/);
});

test("switching from fog mode back to simulation full restores full playing surface", () => {
  const core = createFogCoreStub({
    width: 9,
    height: 9,
    actors: [
      { position: { x: 4, y: 4 } },
      { position: { x: 8, y: 8 } },
    ],
  });
  const elements = createElements();
  const controller = setupPlayback({
    core,
    actions: [],
    actorIdLabel: "A-2RB89Z-1",
    actorIds: ["A-2RB89Z-1", "D-5JH2QW-1"],
    actorIdValue: 1,
    elements,
    initCore: () => {},
    visibility: {
      mode: "gameplay_fog",
      viewerActorId: "D-5JH2QW-1",
      viewportSize: 3,
      visionRadius: 1,
      fogFullMap: true,
    },
  });

  assert.ok(elements.frame.textContent.includes("?"));
  let summary = controller.getVisibilitySummary();
  assert.equal(summary.mode, "gameplay_fog");
  assert.equal(summary.viewport.width, 9);
  assert.equal(summary.viewport.height, 9);

  controller.setVisibilityFocusRoom(null);
  controller.setFogFullMap(false);
  controller.setVisibilityMode("simulation_full");

  summary = controller.getVisibilitySummary();
  assert.equal(summary.mode, "simulation_full");
  assert.equal(summary.viewport.width, 9);
  assert.equal(summary.viewport.height, 9);
  assert.doesNotMatch(elements.frame.textContent, /\?/);
});

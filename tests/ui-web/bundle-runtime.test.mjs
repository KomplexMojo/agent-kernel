import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { setupPlayback } from "../../packages/ui-web/src/movement-ui.js";
import { initializeCoreFromArtifacts } from "../../packages/runtime/src/runner/core-setup.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function makeEl() {
  return { textContent: "", disabled: false };
}

function createStubCore() {
  const state = {
    width: 1,
    height: 1,
    grid: [[1]],
    actor: { x: 0, y: 0, kind: 0, vitals: [] },
    tick: 0,
  };

  return {
    init() {
      state.tick = 0;
    },
    configureGrid(width, height) {
      state.width = width;
      state.height = height;
      state.grid = Array.from({ length: height }, () => Array.from({ length: width }, () => 1));
      return 0;
    },
    setTileAt(x, y, value) {
      if (state.grid[y]) state.grid[y][x] = value;
    },
    spawnActorAt(x, y) {
      state.actor.x = x;
      state.actor.y = y;
    },
    setActorVital(index, current, max, regen) {
      state.actor.vitals[index] = { current, max, regen };
    },
    getMapWidth() {
      return state.width;
    },
    getMapHeight() {
      return state.height;
    },
    renderBaseCellChar() {
      return ".".charCodeAt(0);
    },
    renderCellChar() {
      return ".".charCodeAt(0);
    },
    getActorX() {
      return state.actor.x;
    },
    getActorY() {
      return state.actor.y;
    },
    getActorKind() {
      return state.actor.kind;
    },
    getActorVitalCurrent(index) {
      return state.actor.vitals[index]?.current ?? 0;
    },
    getActorVitalMax(index) {
      return state.actor.vitals[index]?.max ?? 0;
    },
    getActorVitalRegen(index) {
      return state.actor.vitals[index]?.regen ?? 0;
    },
    getTileActorKind() {
      return 0;
    },
    getTileActorCount() {
      return 0;
    },
    getCurrentTick() {
      return state.tick;
    },
    clearEffects() {},
  };
}

test("bundle artifacts can drive a dry-run playback (ticks=0)", () => {
  const bundle = JSON.parse(
    readFileSync(path.join(root, "tests/fixtures/ui/build-spec-bundle/bundle.json"), "utf8"),
  );
  const simConfig = bundle.artifacts.find((artifact) => artifact.schema === "agent-kernel/SimConfigArtifact");
  const initialState = bundle.artifacts.find((artifact) => artifact.schema === "agent-kernel/InitialStateArtifact");

  assert.ok(simConfig);
  assert.ok(initialState);

  const core = createStubCore();
  const elements = {
    frame: makeEl(),
    baseTiles: makeEl(),
    actorId: makeEl(),
    actorPos: makeEl(),
    actorHp: makeEl(),
    tick: makeEl(),
    status: makeEl(),
    playButton: makeEl(),
    stepBack: makeEl(),
    stepForward: makeEl(),
    reset: makeEl(),
  };

  const controller = setupPlayback({
    core,
    actions: [],
    actorIdLabel: initialState.actors?.[0]?.id || "actor_bundle",
    actorIdValue: 1,
    elements,
    initCore: () => {
      core.init();
      const { layout, actor } = initializeCoreFromArtifacts(core, { simConfig, initialState });
      if (!layout.ok) throw new Error(layout.reason);
      if (!actor.ok) throw new Error(actor.reason);
    },
  });

  assert.equal(elements.tick.textContent, "0");
  assert.match(elements.status.textContent, /Out of actions|Ready/);
  controller.reset();
});

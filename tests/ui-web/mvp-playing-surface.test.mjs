import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runEsm } from "../helpers/esm-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

test("playing surface controller steps through frames and disables at exit", async (t) => {
const script = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runMvpMovement } from ${JSON.stringify(pathToFileURL(path.resolve(root, "packages/runtime/src/mvp/movement.js")).href)};
import { setupPlayback } from ${JSON.stringify(pathToFileURL(path.resolve(root, "packages/ui-web/src/movement-ui.js")).href)};

const wasmBuffer = await readFile(${JSON.stringify(path.resolve(root, "build/core-as.wasm"))});
const { instance } = await WebAssembly.instantiate(wasmBuffer, {
  env: { abort(_msg, _file, line, column) { throw new Error(\`WASM abort at \${line}:\${column}\`); } },
});
const exports = instance.exports;
const core = {
  init: exports.init,
  loadMvpScenario: exports.loadMvpScenario,
  applyAction: exports.applyAction,
  setMoveAction: exports.setMoveAction,
  getMapWidth: exports.getMapWidth,
  getMapHeight: exports.getMapHeight,
  getActorX: exports.getActorX,
  getActorY: exports.getActorY,
  getActorKind: exports.getActorKind,
  getActorHp: exports.getActorHp,
  getActorMaxHp: exports.getActorMaxHp,
  getActorVitalCurrent: exports.getActorVitalCurrent,
  getActorVitalMax: exports.getActorVitalMax,
  getActorVitalRegen: exports.getActorVitalRegen,
  getTileActorCount: exports.getTileActorCount,
  getTileActorXByIndex: exports.getTileActorXByIndex,
  getTileActorYByIndex: exports.getTileActorYByIndex,
  getTileActorKindByIndex: exports.getTileActorKindByIndex,
  getTileActorIdByIndex: exports.getTileActorIdByIndex,
  getTileActorDurabilityByIndex: exports.getTileActorDurabilityByIndex,
  getCurrentTick: exports.getCurrentTick,
  getTileActorKind: exports.getTileActorKind,
  renderCellChar: exports.renderCellChar,
  renderBaseCellChar: exports.renderBaseCellChar,
  clearEffects: exports.clearEffects,
};

const actionFixture = JSON.parse(await readFile(${JSON.stringify(path.resolve(root, "tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json"))}, "utf8"));
const frameFixture = JSON.parse(await readFile(${JSON.stringify(path.resolve(root, "tests/fixtures/artifacts/frame-buffer-log-v1-mvp.json"))}, "utf8"));
const affinityFixture = JSON.parse(await readFile(${JSON.stringify(path.resolve(root, "tests/fixtures/personas/affinity-resolution-v1-basic.json"))}, "utf8"));

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

const movement = runMvpMovement({ core });
const elements = {
  frame: makeEl(),
  baseTiles: makeEl(),
  actorId: makeEl(),
  actorPos: makeEl(),
  actorHp: makeEl(),
  actorList: makeEl(),
  affinityList: makeEl(),
  tileActorList: makeEl(),
  tileActorCount: makeEl(),
  trapList: makeEl(),
  trapCount: makeEl(),
  eventStream: makeEl(),
  trapTab: { disabled: false, setAttribute() {} },
  tick: makeEl(),
  status: makeEl(),
  playButton: makeEl(),
  stepBack: makeEl(),
  stepForward: makeEl(),
  reset: makeEl(),
};

const controller = setupPlayback({
  core,
  actions: movement.actions,
  elements,
  affinityEffects: affinityFixture.expected,
});
assert.equal(elements.frame.textContent.trim(), frameFixture.frames[0].buffer.join("\\n"));
assert.equal(elements.baseTiles.textContent.trim(), frameFixture.baseTiles.join("\\n"));
assert.match(elements.frame.innerHTML, /class="actor-cell"/);
assert.doesNotMatch(elements.frame.innerHTML, /[^\\x00-\\x7F]/);
assert.ok(elements.actorList.textContent.includes("actor_mvp"));
assert.ok(elements.actorList.textContent.includes("H:10/10+0"));
assert.ok(elements.affinityList.textContent.includes("affinities:"));
assert.ok(elements.affinityList.textContent.includes("fire:push x2"));
assert.ok(Number(elements.tileActorCount.textContent) > 0);
assert.ok(elements.tileActorList.textContent.includes("tile_"));
assert.ok(elements.trapList.textContent.includes("trap @(2,2)"));
assert.ok(elements.trapList.textContent.includes("fire:push x2"));
assert.equal(elements.eventStream.textContent.trim(), "No events yet.");
controller.stepForward();
assert.equal(elements.frame.textContent.trim(), frameFixture.frames[1].buffer.join("\\n"));
assert.equal(elements.tick.textContent, "1");
assert.equal(elements.stepBack.disabled, false);
assert.ok(elements.eventStream.textContent.includes("t1"));
assert.ok(elements.eventStream.textContent.includes("move"));
controller.toggle();
assert.equal(elements.playButton.textContent, "Pause");
assert.equal(elements.playButton.disabled, false);
controller.toggle();
assert.equal(elements.playButton.textContent, "Play");
assert.equal(elements.playButton.disabled, false);
controller.reset();
assert.equal(elements.frame.textContent.trim(), frameFixture.frames[0].buffer.join("\\n"));
assert.equal(elements.tick.textContent, "0");
controller.gotoIndex(actionFixture.actions.length);
assert.equal(elements.status.textContent, "Reached exit");
assert.equal(elements.stepForward.disabled, true);
assert.equal(elements.playButton.disabled, true);
controller.reset();
controller.setVisibilityMode("gameplay_fog");
controller.setViewerActor("actor_mvp");
controller.setVisionRadius(1);
controller.setViewportSize(5);
const fogLines = elements.frame.textContent.trim().split("\\n");
assert.ok(fogLines.length <= 5);
assert.ok(fogLines.every((row) => row.length <= 5));
assert.ok(elements.frame.textContent.includes("?"));
const visibility = controller.getVisibilitySummary();
assert.equal(visibility.mode, "gameplay_fog");
assert.equal(visibility.viewerActorId, "actor_mvp");
assert.ok(visibility.viewer.exploredTiles > 0);
`;

  await readFile(path.resolve(root, "build/core-as.wasm")); // ensure wasm exists before running
  runEsm(script);
});

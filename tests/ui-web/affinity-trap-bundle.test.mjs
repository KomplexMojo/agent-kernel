import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runEsm } from "../helpers/esm-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

test("ui affinity trap bundle renders affinity and trap panels", async () => {
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

const bundleDir = ${JSON.stringify(path.resolve(root, "tests/fixtures/ui/affinity-trap-bundle"))};
const simConfig = JSON.parse(await readFile(path.join(bundleDir, "sim-config.json"), "utf8"));
const initialState = JSON.parse(await readFile(path.join(bundleDir, "initial-state.json"), "utf8"));
const affinityEffects = JSON.parse(await readFile(path.join(bundleDir, "affinity-effects.json"), "utf8"));

assert.ok(simConfig.layout?.data?.traps?.length > 0);
assert.ok(initialState.actors?.length > 0);
assert.ok(affinityEffects.traps?.length > 0);

function makeEl() { return { textContent: "", disabled: false, setAttribute() {} }; }

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
  trapTab: { disabled: false, setAttribute() {} },
  tick: makeEl(),
  status: makeEl(),
  playButton: makeEl(),
  stepBack: makeEl(),
  stepForward: makeEl(),
  reset: makeEl(),
};

setupPlayback({
  core,
  actions: movement.actions,
  elements,
  affinityEffects,
});

assert.ok(elements.affinityList.textContent.includes("affinities:"));
assert.ok(elements.affinityList.textContent.includes("actor_mvp"));
assert.ok(elements.trapList.textContent.includes("trap @(2,2)"));
assert.ok(elements.trapList.textContent.includes("fire:push x2"));
`;

  await readFile(path.resolve(root, "build/core-as.wasm"));
  runEsm(script);
});

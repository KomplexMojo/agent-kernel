const test = require("node:test");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const RUNTIME_MODULE = moduleUrl("packages/runtime/src/index.js");

test("runtime default movement generates golden actions and frames", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }

  const script = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runMvpMovement } from ${JSON.stringify(RUNTIME_MODULE)};

const buffer = await readFile(${JSON.stringify(WASM_PATH)});
const { instance } = await WebAssembly.instantiate(buffer, {
  env: {
    abort(_msg, _file, line, column) {
      throw new Error(\`WASM abort at \${line}:\${column}\`);
    },
  },
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
  getCurrentTick: exports.getCurrentTick,
  renderCellChar: exports.renderCellChar,
  renderBaseCellChar: exports.renderBaseCellChar,
  clearEffects: exports.clearEffects,
};

const actionFixture = JSON.parse(await readFile(path.resolve("tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json"), "utf8"));
const frameFixture = JSON.parse(await readFile(path.resolve("tests/fixtures/artifacts/frame-buffer-log-v1-mvp.json"), "utf8"));

const { actions, frames, baseTiles } = runMvpMovement({ core });
assert.deepEqual(actions, actionFixture.actions);
assert.deepEqual(frames.map((f) => f.buffer), frameFixture.frames.map((f) => f.buffer));
assert.deepEqual(baseTiles, frameFixture.baseTiles);
`;

  runEsm(script);
});

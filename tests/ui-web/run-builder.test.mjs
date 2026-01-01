import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runEsm } from "../helpers/esm-runner.js";
import { wireRunBuilder } from "../../packages/ui-web/src/run-builder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function makeInput(value = "") {
  const handlers = {};
  return {
    value,
    disabled: false,
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    trigger(event) {
      handlers[event]?.();
    },
  };
}

function makeButton() {
  const handlers = {};
  return {
    disabled: false,
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    click() {
      handlers.click?.();
    },
  };
}

test("run builder validates seed and name before enabling start", () => {
  const seedInput = makeInput("-1");
  const actorNameInput = makeInput(" ");
  const startButton = makeButton();
  const badgeSeed = { textContent: "" };
  const badgeName = { textContent: "" };
  wireRunBuilder({
    elements: {
      seedInput,
      actorNameInput,
      actorIdInput: makeInput("actor_mvp"),
      mapSelect: makeInput("mvp-grid"),
      fixtureSelect: makeInput("fixture"),
      seedBadge: badgeSeed,
      nameBadge: badgeName,
      modeBadge: { textContent: "" },
      startButton,
      resetButton: makeButton(),
      preview: { textContent: "" },
      vitals: {
        health: { current: makeInput("10"), max: makeInput("10"), regen: makeInput("0") },
        mana: { current: makeInput("0"), max: makeInput("0"), regen: makeInput("0") },
        stamina: { current: makeInput("10"), max: makeInput("10"), regen: makeInput("0") },
        durability: { current: makeInput("10"), max: makeInput("10"), regen: makeInput("0") },
      },
    },
  });

  assert.equal(startButton.disabled, true);
  assert.match(badgeSeed.textContent, /Invalid/);
  assert.match(badgeName.textContent, /Name required/);

  seedInput.value = "1337";
  actorNameInput.value = "Walker";
  seedInput.trigger("input");
  actorNameInput.trigger("input");

  assert.equal(startButton.disabled, false);
});

test("run builder start with defaults produces golden actions/frames", async () => {
  const script = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runMvpMovement } from ${JSON.stringify(pathToFileURL(path.resolve(root, "packages/runtime/src/mvp/movement.js")).href)};
import { wireRunBuilder } from ${JSON.stringify(pathToFileURL(path.resolve(root, "packages/ui-web/src/run-builder.js")).href)};

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
  getCurrentTick: exports.getCurrentTick,
  renderCellChar: exports.renderCellChar,
  renderBaseCellChar: exports.renderBaseCellChar,
  clearEffects: exports.clearEffects,
};

const actionsFixture = JSON.parse(await readFile(${JSON.stringify(path.resolve(root, "tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json"))}, "utf8"));
const framesFixture = JSON.parse(await readFile(${JSON.stringify(path.resolve(root, "tests/fixtures/artifacts/frame-buffer-log-v1-mvp.json"))}, "utf8"));

let capturedConfig = null;
const seedInput = { value: "1337", addEventListener() {} };
const startButton = {
  disabled: false,
  addEventListener(_e, fn) { this.fn = fn; },
  click() { this.fn?.(); },
};

wireRunBuilder({
  elements: {
    seedInput,
    actorNameInput: { value: "MVP Walker", addEventListener() {} },
    actorIdInput: { value: "actor_mvp", addEventListener() {} },
    mapSelect: { value: "mvp-grid", addEventListener() {} },
    fixtureSelect: { value: "fixture", addEventListener() {} },
    seedBadge: { textContent: "" },
    nameBadge: { textContent: "" },
    modeBadge: { textContent: "" },
    startButton,
    resetButton: { disabled: false, addEventListener() {} },
    preview: { textContent: "" },
    vitals: {
      health: { current: { value: "10", addEventListener() {} }, max: { value: "10", addEventListener() {} }, regen: { value: "0", addEventListener() {} } },
      mana: { current: { value: "0", addEventListener() {} }, max: { value: "0", addEventListener() {} }, regen: { value: "0", addEventListener() {} } },
      stamina: { current: { value: "10", addEventListener() {} }, max: { value: "10", addEventListener() {} }, regen: { value: "0", addEventListener() {} } },
      durability: { current: { value: "10", addEventListener() {} }, max: { value: "10", addEventListener() {} }, regen: { value: "0", addEventListener() {} } },
    },
  },
  onStart: (config) => { capturedConfig = config; },
});

startButton.click();

assert.ok(capturedConfig);
const movement = runMvpMovement({ core, seed: capturedConfig.seed, actorIdLabel: capturedConfig.actorId, actorIdValue: 1 });
assert.deepEqual(movement.actions, actionsFixture.actions);
assert.deepEqual(movement.frames.map((f) => f.buffer), framesFixture.frames.map((f) => f.buffer));
`;

  await readFile(path.resolve(root, "build/core-as.wasm")); // ensure wasm exists
  runEsm(script);
});
